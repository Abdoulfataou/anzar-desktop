/**
 * AgentTools — Outils exposés à l'agent ANZAR (boucle tool-use)
 *
 * Chaque outil est défini au format OpenAI function-calling (passé au
 * backend proxy → DeepSeek) et mappé sur un exécuteur local :
 *  - Fichiers  : fileSystemService (scope FS Tauri + assertAllowedPath)
 *  - Commandes : terminalService (allowlist + validateCommand)
 *
 * Sécurité : aucune exécution hors du dossier projet (projectRoot),
 * commandes shell limitées à l'allowlist Tauri existante.
 */

import { ToolDefinition, ToolCall } from '@/types';
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { terminalService } from '@/services/terminal';
import { appendProjectMemory } from './agentContext';

// ============================================================================
// TYPES
// ============================================================================

export interface ToolExecutionContext {
  /** Racine absolue du projet — toutes les opérations sont relatives à elle */
  projectRoot: string;
  /** Signal d'annulation de la session */
  signal?: AbortSignal;
  /** Callback appelé quand un fichier est écrit/modifié (pour rafraîchir l'UI) */
  onFileChanged?: (relativePath: string, content: string, action: 'create' | 'edit' | 'delete') => void;
}

export interface ToolResult {
  /** Contenu renvoyé au modèle (message role:tool) */
  output: string;
  /** True si l'outil signale la fin de la tâche */
  isDone?: boolean;
  /** True si l'exécution a échoué (l'agent verra l'erreur et pourra corriger) */
  isError?: boolean;
}

// ============================================================================
// LIMITES
// ============================================================================

const MAX_FILE_READ_CHARS = 48_000;      // ~12k tokens par lecture
const MAX_COMMAND_OUTPUT_CHARS = 12_000;
const MAX_SEARCH_RESULTS = 40;
const MAX_LIST_ENTRIES = 300;
const COMMAND_TIMEOUT_MS = 120_000;

// ============================================================================
// DÉFINITIONS (envoyées au modèle)
// ============================================================================

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        "Lit le contenu d'un fichier du projet. Utilise offset/limit pour les gros fichiers (lignes).",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif au projet (ex: src/App.tsx)' },
          offset: { type: 'number', description: 'Ligne de départ (1-indexée, optionnel)' },
          limit: { type: 'number', description: 'Nombre max de lignes (optionnel)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Crée ou remplace ENTIÈREMENT un fichier. Pour modifier un fichier existant, préfère edit_file (plus sûr et moins coûteux).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif au projet' },
          content: { type: 'string', description: 'Contenu complet du fichier' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        "Modifie un fichier par remplacement exact de texte. old_text doit apparaître EXACTEMENT une fois dans le fichier (inclut l'indentation). Échoue si introuvable ou ambigu.",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif au projet' },
          old_text: { type: 'string', description: 'Texte exact à remplacer (unique dans le fichier)' },
          new_text: { type: 'string', description: 'Nouveau texte' },
          replace_all: { type: 'boolean', description: 'Remplacer toutes les occurrences (défaut: false)' },
        },
        required: ['path', 'old_text', 'new_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Supprime un fichier du projet.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif au projet' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: "Liste le contenu d'un dossier (fichiers + sous-dossiers, non récursif au-delà de depth).",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: "Chemin relatif au projet ('' ou '.' = racine)" },
          depth: { type: 'number', description: 'Profondeur (défaut: 2, max: 4)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description:
        'Recherche un motif (regex) dans les fichiers texte du projet. Renvoie fichier:ligne: extrait.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Expression régulière (JavaScript)' },
          path: { type: 'string', description: 'Sous-dossier à chercher (optionnel, défaut: racine)' },
          file_glob: { type: 'string', description: "Filtre d'extension simple, ex: '.ts' ou '.py' (optionnel)" },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        "Exécute une commande shell dans le projet (allowlist: node, npm, npx, git, pip, python, cargo…). Utilise-la pour installer des dépendances, lancer build/lint/tests et VÉRIFIER ton travail. Renvoie stdout/stderr + code de sortie.",
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: "Commande complète, ex: 'npm run build'" },
          cwd: { type: 'string', description: 'Sous-dossier relatif (optionnel, défaut: racine du projet)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawn_subagents',
      description:
        "Lance 2 à 3 sous-agents EN PARALLÈLE pour des sous-tâches INDÉPENDANTES (fichiers différents, aucun chevauchement). Chaque sous-agent a les mêmes outils mais un budget réduit et pas de vérification finale — c'est TOI qui vérifies après. À utiliser uniquement pour les grosses tâches parallélisables (ex: créer 3 pages distinctes). Renvoie le résumé de chaque sous-agent.",
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: { type: 'string' },
            description: '2 à 3 sous-tâches indépendantes, chacune décrite précisément (fichiers cibles inclus)',
          },
        },
        required: ['tasks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description:
        "Enregistre une information durable dans la mémoire du projet (ANZAR.md) : convention de code, décision d'architecture, piège découvert, commande de build particulière. Sera relue dans les prochaines sessions. N'enregistre PAS de banalités ni le détail de la tâche en cours.",
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: "Catégorie courte: 'convention', 'architecture', 'piège', 'build', 'dépendance'…",
          },
          note: { type: 'string', description: "L'information à retenir (1-4 phrases, précise et actionnable)" },
        },
        required: ['category', 'note'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_done',
      description:
        "Signale que la tâche est TERMINÉE et vérifiée. À appeler UNIQUEMENT après avoir vérifié ton travail (build/lint/tests via run_command quand c'est possible).",
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: "Résumé de ce qui a été fait, en français" },
          verification: { type: 'string', description: 'Comment le travail a été vérifié (commande + résultat)' },
        },
        required: ['summary'],
      },
    },
  },
];

// ============================================================================
// HELPERS
// ============================================================================

/** Joint projectRoot + chemin relatif en bloquant les évasions */
function resolvePath(root: string, relPath: string | undefined): string {
  const cleanRoot = root.replace(/[\\/]+$/, '');
  const rel = (relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!rel || rel === '.') return cleanRoot;
  if (rel.split('/').some((seg) => seg === '..')) {
    throw new Error(`Chemin non autorisé (sortie du projet): ${relPath}`);
  }
  return `${cleanRoot}/${rel}`;
}

function truncate(text: string, max: number, label = 'sortie'): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [${label} tronquée: ${text.length - max} caractères restants]`;
}

function isTextFile(name: string): boolean {
  return !/\.(png|jpe?g|gif|webp|ico|icns|pdf|zip|gz|tar|rar|7z|exe|dll|so|dylib|woff2?|ttf|eot|mp[34]|avi|mov|bin|lock)$/i.test(name);
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next', '__pycache__', '.venv', 'venv', 'coverage']);

// ============================================================================
// EXÉCUTEURS
// ============================================================================

async function execReadFile(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const abs = resolvePath(ctx.projectRoot, args.path);
  const raw = await fileSystemService.readFile(abs);
  let content = raw;
  if (args.offset || args.limit) {
    const lines = raw.split('\n');
    const start = Math.max(0, (args.offset ?? 1) - 1);
    const count = args.limit ?? lines.length;
    content = lines.slice(start, start + count).join('\n');
  }
  return { output: truncate(content, MAX_FILE_READ_CHARS, 'lecture') };
}

async function execWriteFile(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const abs = resolvePath(ctx.projectRoot, args.path);
  const existed = await fileSystemService.exists(abs);
  await fileSystemService.writeFile(abs, args.content ?? '');
  ctx.onFileChanged?.(args.path, args.content ?? '', existed ? 'edit' : 'create');
  return { output: `OK — ${existed ? 'fichier remplacé' : 'fichier créé'}: ${args.path} (${(args.content ?? '').length} caractères)` };
}

async function execEditFile(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const abs = resolvePath(ctx.projectRoot, args.path);
  const content = await fileSystemService.readFile(abs);
  const oldText: string = args.old_text ?? '';
  const newText: string = args.new_text ?? '';
  if (!oldText) return { output: 'Erreur: old_text vide.', isError: true };

  const occurrences = content.split(oldText).length - 1;
  if (occurrences === 0) {
    return {
      output: `Erreur: old_text introuvable dans ${args.path}. Relis le fichier (read_file) et réessaie avec le texte EXACT (indentation comprise).`,
      isError: true,
    };
  }
  if (occurrences > 1 && !args.replace_all) {
    return {
      output: `Erreur: old_text apparaît ${occurrences} fois dans ${args.path}. Ajoute du contexte pour le rendre unique, ou utilise replace_all:true.`,
      isError: true,
    };
  }

  const updated = args.replace_all
    ? content.split(oldText).join(newText)
    : content.replace(oldText, newText);
  await fileSystemService.writeFile(abs, updated);
  ctx.onFileChanged?.(args.path, updated, 'edit');
  return { output: `OK — ${args.path} modifié (${occurrences} remplacement${occurrences > 1 ? 's' : ''}).` };
}

async function execDeleteFile(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const abs = resolvePath(ctx.projectRoot, args.path);
  await fileSystemService.deleteFile(abs);
  ctx.onFileChanged?.(args.path, '', 'delete');
  return { output: `OK — supprimé: ${args.path}` };
}

async function execListDir(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const abs = resolvePath(ctx.projectRoot, args.path);
  const depth = Math.min(Math.max(args.depth ?? 2, 1), 4);
  const tree = await fileSystemService.readDirectoryTree(abs, depth);

  const lines: string[] = [];
  const walk = (nodes: any[], prefix: string) => {
    for (const n of nodes) {
      if (lines.length >= MAX_LIST_ENTRIES) return;
      if (n.type === 'directory' && IGNORED_DIRS.has(n.name)) {
        lines.push(`${prefix}${n.name}/ [ignoré]`);
        continue;
      }
      lines.push(`${prefix}${n.name}${n.type === 'directory' ? '/' : ''}`);
      if (n.children) walk(n.children, prefix + '  ');
    }
  };
  walk(tree as any[], '');
  if (lines.length === 0) return { output: '(dossier vide)' };
  const suffix = lines.length >= MAX_LIST_ENTRIES ? `\n… [liste tronquée à ${MAX_LIST_ENTRIES} entrées]` : '';
  return { output: lines.join('\n') + suffix };
}

async function execSearchFiles(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  let regex: RegExp;
  try {
    regex = new RegExp(args.pattern, 'i');
  } catch (e: any) {
    return { output: `Erreur: regex invalide — ${e.message}`, isError: true };
  }

  const rootAbs = resolvePath(ctx.projectRoot, args.path);
  const files = await fileSystemService.readProjectFiles(rootAbs, 6);
  const ext = (args.file_glob || '').replace(/^\*+/, ''); // '.ts'
  const results: string[] = [];

  for (const f of files) {
    if (results.length >= MAX_SEARCH_RESULTS) break;
    const p: string = (f as any).path || (f as any).name || '';
    if (ext && !p.endsWith(ext)) continue;
    if (!isTextFile(p)) continue;
    const content: string = (f as any).content || '';
    if (!content) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && results.length < MAX_SEARCH_RESULTS; i++) {
      if (regex.test(lines[i])) {
        results.push(`${p}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
      }
    }
  }

  if (results.length === 0) return { output: `Aucun résultat pour /${args.pattern}/` };
  return { output: truncate(results.join('\n'), MAX_COMMAND_OUTPUT_CHARS, 'recherche') };
}

async function execRunCommand(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const cwd = resolvePath(ctx.projectRoot, args.cwd);
  const result = await terminalService.exec(args.command, {
    cwd,
    timeout: COMMAND_TIMEOUT_MS,
    silent: false,
  });

  const parts = [
    `exit_code: ${result.exitCode} (${result.durationMs}ms)`,
    result.stdout ? `stdout:\n${truncate(result.stdout, MAX_COMMAND_OUTPUT_CHARS, 'stdout')}` : '',
    result.stderr ? `stderr:\n${truncate(result.stderr, MAX_COMMAND_OUTPUT_CHARS, 'stderr')}` : '',
  ].filter(Boolean);

  return { output: parts.join('\n\n'), isError: !result.success };
}

async function execSpawnSubagents(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const tasks: string[] = Array.isArray(args.tasks)
    ? args.tasks.filter((t: any) => typeof t === 'string' && t.trim()).slice(0, 3)
    : [];
  if (tasks.length < 2) {
    return { output: 'Erreur: spawn_subagents requiert 2 à 3 sous-tâches indépendantes. Pour une seule tâche, fais-la toi-même.', isError: true };
  }

  // Import dynamique pour éviter le cycle agentTools ↔ agentLoop
  const { runAgentSession } = await import('./agentLoop');
  const projectName = ctx.projectRoot.split(/[\\/]/).filter(Boolean).pop() || 'projet';

  const results = await Promise.all(
    tasks.map((task, i) =>
      runAgentSession({
        prompt: { projectName, projectRoot: ctx.projectRoot },
        task,
        maxSteps: 15,
        gitCheckpoint: false,   // le checkpoint parent couvre déjà la session
        autoVerify: false,      // le parent vérifie après consolidation
        signal: ctx.signal,
        onFileChanged: ctx.onFileChanged,
      }).catch((e: any) => ({
        stopReason: 'error' as const,
        summary: e?.message || String(e),
        steps: 0,
        messages: [],
        filesChanged: [] as string[],
      })).then(r => ({ index: i + 1, task, ...r }))
    )
  );

  const report = results
    .map(r =>
      `── Sous-agent ${r.index} [${r.stopReason}] — ${r.task.slice(0, 80)}\n` +
      `Fichiers: ${r.filesChanged.join(', ') || 'aucun'}\n` +
      `Résumé: ${r.summary.slice(0, 500)}`
    )
    .join('\n\n');

  const anyError = results.some(r => r.stopReason === 'error');
  return {
    output: `${report}\n\n→ Vérifie maintenant la cohérence de l'ensemble (imports croisés, build) avant task_done.`,
    isError: anyError,
  };
}

async function execRemember(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const category = String(args.category || 'note').slice(0, 40);
  const note = String(args.note || '').trim();
  if (!note) return { output: 'Erreur: note vide.', isError: true };
  await appendProjectMemory(ctx.projectRoot, category, note);
  return { output: `OK — mémorisé dans ANZAR.md [${category}].` };
}

async function execTaskDone(args: any): Promise<ToolResult> {
  const summary = args.summary || 'Tâche terminée.';
  const verification = args.verification ? `\nVérification: ${args.verification}` : '';
  return { output: `${summary}${verification}`, isDone: true };
}

// ============================================================================
// DISPATCH
// ============================================================================

type ToolExecutor = (args: any, ctx: ToolExecutionContext) => Promise<ToolResult>;

const EXECUTORS: Record<string, ToolExecutor> = {
  read_file: execReadFile,
  write_file: execWriteFile,
  edit_file: execEditFile,
  delete_file: execDeleteFile,
  list_dir: execListDir,
  search_files: execSearchFiles,
  run_command: execRunCommand,
  spawn_subagents: execSpawnSubagents,
  remember: execRemember,
  task_done: execTaskDone,
};

/**
 * Exécute un ToolCall du modèle et renvoie le résultat à réinjecter.
 * Ne throw jamais : toute erreur devient un ToolResult isError que
 * l'agent peut lire et corriger.
 */
export async function executeToolCall(
  toolCall: ToolCall,
  ctx: ToolExecutionContext
): Promise<ToolResult> {
  const name = toolCall.function.name;
  const executor = EXECUTORS[name];
  if (!executor) {
    return { output: `Erreur: outil inconnu "${name}". Outils disponibles: ${Object.keys(EXECUTORS).join(', ')}`, isError: true };
  }

  let args: any = {};
  try {
    args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
  } catch {
    return { output: `Erreur: arguments JSON invalides pour ${name}: ${toolCall.function.arguments?.slice(0, 300)}`, isError: true };
  }

  if (ctx.signal?.aborted) {
    return { output: 'Session annulée par l’utilisateur.', isError: true };
  }

  try {
    return await executor(args, ctx);
  } catch (e: any) {
    return { output: `Erreur ${name}: ${e?.message || String(e)}`, isError: true };
  }
}
