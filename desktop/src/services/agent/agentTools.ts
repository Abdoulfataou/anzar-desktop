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
import { diagnoseChange, diagnoseFile, formatDiagnostics, languageOf, warmUp } from '@/services/lsp/manager';
import { useSettingsStore } from '@/stores/settingsStore';
import { vendorLibs } from '@/services/skillsPack/vendorLibs';
import { toolsCatalog, toolInstall, confirmToolInstall } from '@/services/toolsRuntime';
import { SUBAGENT_ROLE_PROMPTS, detectSubagentRole, type SubagentRole } from './agentPrompts';
import { BUILTIN_SKILLS } from '@/services/skillsPack';

// ============================================================================
// TYPES
// ============================================================================

/** Progression en direct d'un sous-agent (affichée dans le chat pendant l'exécution). */
export interface SubagentProgress {
  task: string;
  /** Spécialisation affichée dans l'UI (motion-designer, dev, redaction) */
  role?: SubagentRole;
  status: 'running' | 'done' | 'error';
  /** Action en cours (dernier outil appelé) */
  current?: string;
  steps: number;
}

export interface ToolExecutionContext {
  /** Racine absolue du projet — toutes les opérations sont relatives à elle */
  projectRoot: string;
  /** Signal d'annulation de la session */
  signal?: AbortSignal;
  /** Callback appelé quand un fichier est écrit/modifié (pour rafraîchir l'UI) */
  onFileChanged?: (relativePath: string, content: string, action: 'create' | 'edit' | 'delete') => void;
  /** Progression en direct des sous-agents (spawn_subagents) pour l'UI */
  onSubagentProgress?: (progress: SubagentProgress[]) => void;
}

export interface ToolResult {
  /** Contenu renvoyé au modèle (message role:tool) */
  output: string;
  /** True si l'outil signale la fin de la tâche */
  isDone?: boolean;
  /** True si l'exécution a échoué (l'agent verra l'erreur et pourra corriger) */
  isError?: boolean;
  /** Coût des appels au modèle faits par l'outil (explorateurs), ajouté à celui de la réponse */
  costFCFA?: number;
  /** Captures d'écran à montrer au modèle juste après le résultat (capture_page) */
  images?: { label: string; dataUrl: string }[];
  /** Vidéo ou image produite (chemin absolu) : affichée en lecteur dans la conversation */
  media?: { path: string; kind: 'video' | 'image' };
}

// ============================================================================
// LIMITES
// ============================================================================

const MAX_FILE_READ_CHARS = 32_000;      // ~8k tokens par lecture (relire par tranches avec offset/limit)
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
      name: 'start_dev_server',
      description:
        "Lance en arrière-plan le serveur de développement du projet (npm run dev, npm start…) et renvoie son adresse locale. " +
        "Sans command, la commande est devinée depuis package.json. Un seul serveur par projet : s'il tourne déjà, son adresse est renvoyée. " +
        "À utiliser avant check_page pour vérifier une app web que tu as modifiée.",
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Commande de lancement (facultative), ex : npm run dev' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dev_server_logs',
      description: "Dernières lignes du serveur de développement lancé par start_dev_server : erreurs de compilation, requêtes reçues, plantages côté serveur.",
      parameters: { type: 'object', properties: { lines: { type: 'number', description: 'Nombre de lignes (60 par défaut)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_dev_server',
      description: 'Arrête le serveur de développement lancé par start_dev_server.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_page',
      description:
        "Ouvre une page dans un vrai navigateur (sans fenêtre) et rapporte : titre, erreurs et avertissements de la console, requêtes en échec, " +
        "et le contenu de la page sous forme d'arbre avec des repères ref=… (pour page_action). Sans url : l'adresse du serveur lancé par start_dev_server. " +
        "Utilise-le pour VÉRIFIER une app web après tes modifications, comme le ferait l'utilisateur.",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Adresse complète, ex : http://localhost:5173/connexion (facultative)' },
          wait_for_text: { type: 'string', description: 'Texte à attendre avant de lire la page (facultatif)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'capture_page',
      description:
        "Prend des captures d'écran d'une page et te les MONTRE, pour juger le rendu visuel comme un designer : mise en page, typographie, " +
        "couleurs, contraste, débordements, version téléphone. Pour une animation, donne frames (instants en millisecondes, ex [0, 150, 400, 1000]) : " +
        "toutes les animations (CSS, GSAP, canvas, three.js, JavaScript) sont figées à chaque instant exact grâce à une horloge virtuelle. " +
        "Pour un fichier HTML du projet, donne file (aucun serveur nécessaire). Sans url ni file : le serveur lancé par start_dev_server, sinon la page ouverte par check_page. " +
        "À utiliser après TOUTE création ou modification visuelle (interface, page, affiche, animation), puis corriger ce que tu vois.",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Adresse complète, ex : http://localhost:5173/ (facultative)' },
          file: { type: 'string', description: 'Fichier HTML du projet à capturer, ex : pub/index.html (facultatif, remplace url)' },
          viewports: { type: 'array', items: { type: 'string', enum: ['desktop', 'mobile'] }, description: 'Formats : desktop (1280×800) et/ou mobile (390×844). Par défaut les deux.' },
          frames: { type: 'array', items: { type: 'number' }, description: 'Animation : instants à capturer, en ms (6 au plus)' },
          full_page: { type: 'boolean', description: 'Capturer toute la hauteur de la page (sans frames)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'export_animation',
      description:
        "Exporte une page animée en VIDÉO MP4 (ou GIF) : la page est enregistrée image par image au rythme exact (fps) avec une horloge  RÈGLE ABSOLUE : l'export est la DERNIÈRE étape. Après toute modification de la page (même minime), réexporte avant de conclure : la vidéo livrée doit correspondre à la dernière version. Ne demande JAMAIS a l'utilisateur de dire « réexporte »." +
        "virtuelle (CSS, GSAP, canvas, three.js, JavaScript : tout est déterministe), puis assemblée en vidéo dans l'app (rien à installer). Pas de son. " +
        "Formats : story (1080×1920, Reels, TikTok, statut WhatsApp), carre (1080×1080), portrait (1080×1350), paysage (1920×1080), " +
        "ou width/height. Musique de fond possible (music : fichier MP3, M4A ou WAV fourni par l'utilisateur ; découpée à la durée, en boucle si trop courte, avec fondus). " +
        "Tu reçois ensuite 4 images clés de la vidéo pour la vérifier. Pour un fichier HTML du projet, donne file (aucun serveur nécessaire).",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Page à enregistrer, ex : http://localhost:4321/pub.html (facultative)' },
          file: { type: 'string', description: 'Fichier HTML du projet à enregistrer, ex : pub/index.html (remplace url)' },
          format: { type: 'string', enum: ['mp4', 'gif', 'png'], description: 'mp4 (défaut), gif (court, léger) ou png (une seule image : visuel fixe, affiche, publication)' },
          size: { type: 'string', enum: ['story', 'carre', 'portrait', 'paysage', 'a4'], description: 'Format (défaut : story ; a4 = affiche 2480×3508)' },
          width: { type: 'number', description: 'Largeur en px (remplace size)' },
          height: { type: 'number', description: 'Hauteur en px (remplace size)' },
          duration_ms: { type: 'number', description: 'Durée en ms (défaut 4000 ; 60000 au plus en mp4, 20000 en gif). En png : instant capturé (défaut 1500)' },
          fps: { type: 'number', description: 'Images par seconde (défaut 30 en mp4, 15 en gif ; 60 au plus)' },
          output: { type: 'string', description: 'Fichier à créer dans le projet, ex : export/pub-boutique.mp4 (défaut : export/animation.mp4)' },
          music: { type: 'string', description: "Musique de fond (MP3, M4A ou WAV) : chemin d'un fichier du projet, ex : .anzar/fichiers/musique.mp3 (mp4 seulement)" },
          music_start_ms: { type: 'number', description: 'Où commencer dans la musique, en ms (défaut 0)' },
          music_volume: { type: 'number', description: 'Volume de la musique, de 0 à 1 (défaut 1)' },
          fade_out_ms: { type: 'number', description: 'Fondu de sortie de la musique, en ms (défaut 800)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_action',
      description:
        "Agit sur la page ouverte par check_page, puis rapporte son nouvel état (console, requêtes, contenu). " +
        "click : cliquer ; type : saisir du texte (submit:true appuie sur Entrée) ; select : choisir une option ; press : touche (key) ; wait : attendre un texte ou quelques secondes. " +
        "target est le repère ref=… de l'élément, tel qu'il apparaît dans le contenu de la page.",
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['click', 'type', 'select', 'press', 'wait'] },
          target: { type: 'string', description: 'Repère de l\'élément, ex : e12' },
          element: { type: 'string', description: "Description lisible de l'élément, ex : bouton « Se connecter »" },
          text: { type: 'string', description: 'Texte à saisir (type), option (select) ou texte attendu (wait)' },
          submit: { type: 'boolean', description: 'type : appuyer sur Entrée après la saisie' },
          values: { type: 'array', items: { type: 'string' }, description: 'select : options à choisir' },
          key: { type: 'string', description: 'press : touche, ex : Enter, Escape, ArrowDown' },
          seconds: { type: 'number', description: 'wait : durée maximale en secondes (30 au plus)' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'explore',
      description:
        "Lance 1 à 8 explorateurs rapides EN PARALLÈLE, en lecture seule : chacun répond à une question précise sur le code du projet et ne te rend qu'un résumé court avec les fichiers et lignes clés. " +
        "Utilise-le pour comprendre un projet moyen ou gros sans remplir ton contexte (où est géré X, comment Y est branché, quels fichiers utilisent Z). " +
        "Pose des questions indépendantes et précises. Inutile pour lire un ou deux fichiers que tu connais déjà : fais-le toi-même.",
      parameters: {
        type: 'object',
        properties: {
          questions: { type: 'array', items: { type: 'string' }, description: 'Questions indépendantes, une par explorateur (8 au plus)' },
        },
        required: ['questions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_diagnostics',
      description:
        "Erreurs de code (types, noms inconnus, imports) de fichiers TypeScript/JavaScript ou Python, sans lancer de build. " +
        "Les fichiers que tu écris sont déjà vérifiés automatiquement : utilise cet outil pour contrôler d'autres fichiers touchés par ton changement (ceux qui importent ce que tu as modifié).",
      parameters: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'Chemins relatifs des fichiers à vérifier (8 au plus)' },
        },
        required: ['paths'],
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
        "Exécute UNE commande dans le projet. Programmes autorisés : npm, npx, node, git, python, pip, cargo — rien d'autre (pas de grep, ls, cat, find, head, echo). " +
        "Jamais node -e ni python -c (refusés) : pour un traitement, écris un fichier script (.mjs/.py) avec write_file puis lance-le. Interdits : |, ;, &&, ||, >, <, $(…) et chemins absolus. Pour chercher dans le code utilise search_files, pour lister list_dir, pour lire read_file. " +
        "Sert à installer des dépendances, lancer build/lint/tests et VÉRIFIER ton travail. Renvoie stdout/stderr + code de sortie.",
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: "Une seule commande, ex: 'npm run build' ou 'git log --oneline -5'" },
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
        "Lance 2 à 3 sous-agents EN PARALLÈLE pour des sous-tâches INDÉPENDANTES (fichiers différents, aucun chevauchement). Chaque sous-agent a les mêmes outils mais un budget réduit et pas de vérification finale — c'est TOI qui vérifies après consolidation. " +
        "Précise le rôle de chacun : 'motion-designer' (visuels/animations/vidéos — reçoit automatiquement les skills motion-system et gsap-cookbook), 'redaction' (textes), 'dev' (code, défaut). Idéal pour plusieurs variantes de visuels en parallèle.",
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                task: { type: 'string', description: 'La sous-tâche complète et autonome (fichiers cibles inclus)' },
                role: { type: 'string', enum: ['motion-designer', 'dev', 'redaction'], description: 'Spécialisation (défaut : déduite de la tâche)' },
              },
              required: ['task'],
            },
          },
        },
        required: ['tasks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'install_tool',
      description:
        "Installe un outil binaire du catalogue vérifié d'ANZAR (avec l'accord de l'utilisateur, une seule fois) : " +
        "'ffmpeg' (encodage vidéo rapide, conversion GIF/MP4, compression pour WhatsApp — utile pour livrer des vidéos légères) " +
        "'ripgrep' (recherche instantanée rg). Rangé dans les fichiers d'ANZAR, empreinte vérifiée, rien sur le système. " +
        "Après installation, la commande est directement utilisable dans run_command. Vérifie d'abord l'état renvoyé (installed).",
      parameters: {
        type: 'object',
        properties: {
          tool: { type: 'string', enum: ['ffmpeg', 'ripgrep'], description: "L'outil à installer" },
        },
        required: ['tool'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vendor_lib',
      description:
        "Copie des bibliothèques d'animation VENDÉES dans ANZAR (hors ligne, version figée) dans libs/ du projet : " +
        "'gsap' (core), 'split-text' (typo par lignes/mots/lettres), 'draw-svg' (SVG tracé), 'morph-svg' (morphing), " +
        "'scramble-text' (texte brouillé), 'flip' (transitions layout), 'custom-ease', ou 'all' pour tout GSAP 3.13. " +
        "Renvoie les balises <script> exactes et le gsap.registerPlugin à insérer. Utilise-le pour toute page animée " +
        "au lieu d'un CDN (capture reproductible, jamais coupée par le réseau).",
      parameters: {
        type: 'object',
        properties: {
          libs: {
            type: 'array',
            items: { type: 'string' },
            description: "Libs à copier, ex : ['gsap','split-text','draw-svg'] ou ['all']",
          },
        },
        required: ['libs'],
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

/** Diagnostics activés dans les Paramètres (par défaut : oui) */
const diagnosticsEnabled = () => useSettingsStore.getState().settings.codeDiagnostics !== false;

/**
 * Ajoute au résultat d'une écriture les erreurs que le serveur de langage y trouve.
 * Ne bloque jamais : si les diagnostics ne sont pas disponibles, le résultat reste tel quel.
 */
async function withDiagnostics(output: string, ctx: ToolExecutionContext, path: string, before: string | null, after: string): Promise<string> {
  if (!diagnosticsEnabled() || !languageOf(path) || ctx.signal?.aborted) return output;
  const d = await diagnoseChange(ctx.projectRoot, path, before, after, { waitMs: 8_000 }).catch(() => null);
  return d ? `${output}\n\n${formatDiagnostics(d)}` : output;
}

async function execGetDiagnostics(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  if (!diagnosticsEnabled()) return { output: 'Diagnostics désactivés dans les Paramètres. Utilise run_command (build, lint) pour vérifier.', isError: true };
  const paths: string[] = (Array.isArray(args.paths) ? args.paths : [args.paths]).filter((p: any) => typeof p === 'string' && p.trim()).slice(0, 8);
  if (!paths.length) return { output: 'Erreur: indique au moins un fichier dans paths.', isError: true };
  const parts: string[] = [];
  for (const path of paths) {
    if (!languageOf(path)) { parts.push(`${path} : langage non pris en charge (TypeScript, JavaScript, Python).`); continue; }
    const text = await fileSystemService.readFile(resolvePath(ctx.projectRoot, path)).catch(() => null);
    if (text === null) { parts.push(`${path} : fichier introuvable.`); continue; }
    // Demande explicite : on laisse au serveur le temps de démarrer s'il ne tourne pas encore
    const d = await diagnoseFile(ctx.projectRoot, path, text, { waitMs: 25_000 }).catch(() => null);
    parts.push(d ? `${path}\n${formatDiagnostics(d)}` : `${path} : diagnostics indisponibles (serveur en démarrage ou Node.js absent). Vérifie avec run_command.`);
  }
  return { output: parts.join('\n\n') };
}

async function execReadFile(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const abs = resolvePath(ctx.projectRoot, args.path);
  const raw = await fileSystemService.readFile(abs);
  // Le serveur de langage démarre pendant que l'agent lit : prêt pour sa première modification
  if (diagnosticsEnabled() && languageOf(String(args.path || ''))) warmUp(ctx.projectRoot, args.path);
  let content = raw;
  if (args.offset || args.limit) {
    const lines = raw.split('\n');
    const start = Math.max(0, (args.offset ?? 1) - 1);
    const count = args.limit ?? lines.length;
    content = lines.slice(start, start + count).join('\n');
  }
  const out = truncate(content, MAX_FILE_READ_CHARS, 'lecture');
  return {
    output: out.length < content.length
      ? `${out}\n(Fichier long : lis la suite avec offset/limit, par exemple offset=${content.slice(0, MAX_FILE_READ_CHARS).split('\n').length} limit=300.)`
      : out,
  };
}

async function execWriteFile(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const abs = resolvePath(ctx.projectRoot, args.path);
  const existed = await fileSystemService.exists(abs);
  const before = existed && languageOf(String(args.path || '')) ? await fileSystemService.readFile(abs).catch(() => null) : null;
  await fileSystemService.writeFile(abs, args.content ?? '');
  ctx.onFileChanged?.(args.path, args.content ?? '', existed ? 'edit' : 'create');
  const out = `OK — ${existed ? 'fichier remplacé' : 'fichier créé'}: ${args.path} (${(args.content ?? '').length} caractères)`;
  return { output: await withDiagnostics(out, ctx, args.path, before, args.content ?? '') };
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
  const out = `OK — ${args.path} modifié (${occurrences} remplacement${occurrences > 1 ? 's' : ''}).`;
  return { output: await withDiagnostics(out, ctx, args.path, content, updated) };
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

const MAX_SEARCH_LINE = 2000;       // lignes plus longues (fichiers minifiés) testées sur leur début
const SEARCH_TIME_BUDGET_MS = 4000;

/**
 * Regex du modèle, sans risque de bloquer l'app (S5) : un motif à retour arrière
 * catastrophique (quantificateurs imbriqués, références arrière) est cherché comme texte.
 */
export function compileSearchPattern(pattern: string): { regex: RegExp; literal: boolean; note?: string } {
  const src = String(pattern ?? '');
  const literal = (note?: string) => ({ regex: new RegExp(src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), literal: true, note });
  if (src.length > 300) return literal('motif trop long : cherché comme texte');
  const nested = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d)/.test(src);
  const backref = /\\[1-9]/.test(src);
  if (nested || backref) return literal('motif à risque (quantificateurs imbriqués ou référence arrière) : cherché comme texte');
  try {
    return { regex: new RegExp(src, 'i'), literal: false };
  } catch {
    return literal('regex invalide : cherché comme texte');
  }
}

async function execSearchFiles(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const { regex, note } = compileSearchPattern(args.pattern);

  const rootAbs = resolvePath(ctx.projectRoot, args.path);
  const files = await fileSystemService.readProjectFiles(rootAbs, 6);
  const ext = (args.file_glob || '').replace(/^\*+/, ''); // '.ts'
  const results: string[] = [];
  const started = Date.now();
  let timedOut = false;

  for (let n = 0; n < files.length; n++) {
    const f = files[n];
    if (results.length >= MAX_SEARCH_RESULTS) break;
    if (Date.now() - started > SEARCH_TIME_BUDGET_MS) { timedOut = true; break; }
    if (n % 25 === 24) await new Promise((r) => setTimeout(r, 0)); // laisse respirer l'interface
    const p: string = (f as any).path || (f as any).name || '';
    if (ext && !p.endsWith(ext)) continue;
    if (!isTextFile(p)) continue;
    const content: string = (f as any).content || '';
    if (!content) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && results.length < MAX_SEARCH_RESULTS; i++) {
      if (regex.test(lines[i].length > MAX_SEARCH_LINE ? lines[i].slice(0, MAX_SEARCH_LINE) : lines[i])) {
        results.push(`${p}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
      }
    }
  }
  if (note) results.unshift(`(${note})`);
  if (timedOut) results.push(`… [recherche arrêtée après ${SEARCH_TIME_BUDGET_MS / 1000} s : précise le chemin ou le motif]`);

  if (results.length === 0 || (results.length === 1 && note)) return { output: `Aucun résultat pour /${args.pattern}/${note ? ` (${note})` : ''}` };
  return { output: truncate(results.join('\n'), MAX_COMMAND_OUTPUT_CHARS, 'recherche') };
}

const RUNNABLE = new Set(['npm', 'npx', 'node', 'git', 'cargo', 'python', 'python3', 'pip', 'pip3']);
const READ_INSTEAD: Record<string, string> = {
  grep: 'search_files', rg: 'search_files', find: 'search_files ou list_dir', ls: 'list_dir', tree: 'list_dir',
  cat: 'read_file', head: 'read_file', tail: 'read_file', less: 'read_file', wc: 'read_file',
};

/**
 * Refuse tôt, avec une consigne utile, ce que le terminal bloquerait de toute façon :
 * l'agent comprend quoi faire à la place au lieu de réessayer la même erreur.
 */
function precheckCommand(command: string): string | null {
  const cmd = String(command || '').trim();
  if (/[|;<>]|&&|\$\(|`/.test(cmd)) {
    return "Refusé : un seul programme par appel, sans |, ;, &&, >, < ni $(…). Découpe en plusieurs appels run_command, ou utilise search_files / list_dir / read_file.";
  }
  const exe = (cmd.split(/\s+/)[0] || '').toLowerCase();
  if (!RUNNABLE.has(exe)) {
    const alt = READ_INSTEAD[exe];
    return alt
      ? `Refusé : « ${exe} » n'est pas disponible. Utilise l'outil ${alt}.`
      : `Refusé : « ${exe} » n'est pas autorisé. Programmes possibles : ${[...RUNNABLE].join(', ')}.`;
  }
  return null;
}

async function execRunCommand(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const refused = precheckCommand(args.command);
  if (refused) return { output: refused, isError: true };
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

// ── Vérification web : serveur de développement et navigateur intégré ──
async function execStartDevServer(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const { startDevServer } = await import('./devServer');
  const command = typeof args.command === 'string' && args.command.trim() ? args.command.trim() : undefined;
  if (command && precheckCommand(command)) return { output: precheckCommand(command)!, isError: true };
  const r = await startDevServer(ctx.projectRoot, command);
  return { output: r.output, isError: r.isError };
}

async function execDevServerLogs(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const { devServerLogs } = await import('./devServer');
  return devServerLogs(ctx.projectRoot, Number(args.lines) || 60);
}

async function execStopDevServer(_args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const { stopDevServer } = await import('./devServer');
  return stopDevServer(ctx.projectRoot);
}

async function execCheckPage(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const [{ checkPage }, { devServerUrl }] = await Promise.all([import('./browserCheck'), import('./devServer')]);
  const url = typeof args.url === 'string' && args.url.trim() ? args.url.trim() : devServerUrl(ctx.projectRoot);
  if (!url) return { output: "Indique url, ou lance d'abord le serveur du projet avec start_dev_server.", isError: true };
  return checkPage(url, { waitForText: args.wait_for_text, signal: ctx.signal });
}

async function execCapturePage(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const [{ capturePage }, { devServerUrl }, { captureWithRenderer }] = await Promise.all([
    import('./browserCheck'), import('./devServer'), import('@/services/motion/captures'),
  ]);
  const file = typeof args.file === 'string' && args.file.trim() ? resolvePath(ctx.projectRoot, args.file) : undefined;
  const url = file ? undefined : typeof args.url === 'string' && args.url.trim() ? args.url.trim() : devServerUrl(ctx.projectRoot) || undefined;
  if (file || url) {
    const viaRenderer = await captureWithRenderer({
      url, file, root: ctx.projectRoot,
      viewports: Array.isArray(args.viewports) ? args.viewports : undefined,
      frames: Array.isArray(args.frames) ? args.frames.map(Number) : undefined,
      fullPage: !!args.full_page,
      signal: ctx.signal,
    });
    if (viaRenderer) return viaRenderer;
  }
  return capturePage({
    url,
    viewports: Array.isArray(args.viewports) ? args.viewports : undefined,
    frames: Array.isArray(args.frames) ? args.frames.map(Number) : undefined,
    fullPage: !!args.full_page,
    signal: ctx.signal,
  });
}

const ANIM_SIZES: Record<string, [number, number]> = {
  story: [1080, 1920], carre: [1080, 1080], portrait: [1080, 1350], paysage: [1920, 1080], a4: [2480, 3508],
};

/**
 * Garde-fou qualité pour les pages animées exportées :
 * - un <script>/<link> externe (CDN) = capture cassée si le réseau flanche → refus
 *   avec la marche à suivre (vendor_lib). Les polices Google sont autorisées.
 * - Math.random() nu = vidéo non reproductible après retouche → avertissement.
 */
async function checkMotionHtml(absFile: string): Promise<{ output?: string; isError?: boolean; note?: string }> {
  try {
    const { readTextFile } = await import('@tauri-apps/api/fs');
    const html = await readTextFile(absFile);
    const externals: string[] = [];
    const re = /<(script|link)\b[^>]*?(?:src|href)=["'](https?:\/\/[^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const u = m[2];
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/i.test(u)) continue;      // serveur local du projet
      if (/fonts\.(googleapis|gstatic)\.com/i.test(u)) continue;                     // polices : autorisées
      externals.push(u);
    }
    if (externals.length) {
      return {
        isError: true,
        output:
          `La page charge des ressources externes (interdit : une capture coupée par le réseau ruine la vidéo) :\n` +
          externals.map((u) => `- ${u}`).join('\n') +
          `\nRemédiation : appelle vendor_lib (ex : ["gsap","split-text"]) et remplace ces balises par les <script src="libs/…"> locaux renvoyés.`,
      };
    }
    if (/Math\.random\s*\(/.test(html) && !/mulberry32|seedrandom|xorshift/i.test(html)) {
      return { note: 'Math.random() détecté sans PRNG seedé : la vidéo ne sera pas identique après retouche. Utilise mulberry32 (skill motion-system).' };
    }
    return {};
  } catch {
    return {}; // fichier illisible : le renderer donnera l'erreur réelle
  }
}

async function execExportAnimation(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const [{ captureFrames }, { devServerUrl }, { createStreamEncoder }, renderer] = await Promise.all([
    import('./browserCheck'), import('./devServer'), import('@/services/motion/encode'), import('@/services/motion/renderer'),
  ]);
  const file = typeof args.file === 'string' && args.file.trim() ? resolvePath(ctx.projectRoot, args.file) : undefined;
  const url = file ? undefined : typeof args.url === 'string' && args.url.trim() ? args.url.trim() : devServerUrl(ctx.projectRoot);
  if (!url && !file) return { output: 'Indique file (fichier HTML du projet) ou url.', isError: true };
  if (file) {
    const guard = await checkMotionHtml(file);
    if (guard.isError && guard.output) return { output: guard.output, isError: true };
  }
  const [dw, dh] = ANIM_SIZES[String(args.size || 'story')] || ANIM_SIZES.story;
  const width = Math.min(3840, Math.max(64, Math.round(Number(args.width) || dw)));
  const height = Math.min(3840, Math.max(64, Math.round(Number(args.height) || dh)));
  if (args.format === 'png') return exportStill({ url, file, width, height, at: Number(args.duration_ms) || 1500, output: args.output, ctx });
  const format: 'mp4' | 'gif' = args.format === 'gif' ? 'gif' : 'mp4';
  const maxMs = format === 'gif' ? 20_000 : 60_000;
  const durationMs = Math.min(maxMs, Math.max(200, Number(args.duration_ms) || 4000));
  const fps = Math.min(60, Math.max(1, Math.round(Number(args.fps) || (format === 'gif' ? 15 : 30))));
  const count = Math.max(1, Math.round((durationMs / 1000) * fps));
  if (count > 1800) return { output: `Trop d'images (${count}, 1800 au plus) : réduis la durée ou les fps (60 s à 30 images/s au plus).`, isError: true };
  let rel = String(args.output || `export/animation.${format}`).replace(/\\/g, '/');
  if (!/\.(mp4|webm|gif)$/i.test(rel)) rel += `.${format}`;

  // Musique de fond (fichier fourni par l'utilisateur), préparée à la durée exacte de la vidéo
  let audio: AudioBuffer | undefined;
  let musicNote = '';
  if (typeof args.music === 'string' && args.music.trim()) {
    if (format === 'gif') {
      musicNote = 'Un GIF ne contient pas de son : la musique n\'a pas été ajoutée (exporte en mp4 pour l\'avoir).';
    } else {
      try {
        const musicAbs = resolvePath(ctx.projectRoot, args.music);
        const { readBinaryFile } = await import('@tauri-apps/api/fs');
        const bytes = await readBinaryFile(musicAbs);
        if (bytes.byteLength > 80 * 1048576) throw new Error('fichier audio trop lourd (80 Mo au plus)');
        const { prepareSoundtrack } = await import('@/services/motion/audio');
        audio = await prepareSoundtrack(bytes, {
          durationSec: count / fps,
          startMs: Number(args.music_start_ms) || 0,
          volume: args.music_volume === undefined ? 1 : Number(args.music_volume),
          fadeOutMs: args.fade_out_ms === undefined ? undefined : Number(args.fade_out_ms),
        });
      } catch (e: any) {
        return { output: `Musique inutilisable (${args.music}) : ${e?.message || e}`, isError: true };
      }
    }
  }

  let enc;
  try {
    enc = await createStreamEncoder({ fps, width, height, format, audio });
  } catch (e: any) {
    return { output: `Assemblage de la vidéo impossible : ${e?.message || e}`, isError: true };
  }
  // Assemblage au fur et à mesure : chaque image est encodée puis oubliée (mémoire faible, même à 60 s)
  const picks = new Set([0, Math.floor(count / 3), Math.floor((2 * count) / 3), count - 1]);
  const keyFrames = new Map<number, Blob>();
  let added = 0;
  let encodeError = '';
  let chain: Promise<void> = Promise.resolve();
  const { removeFile, writeBinaryFile, createDir } = await import('@tauri-apps/api/fs');
  const addFrame = (i: number, blob: Blob) => {
    if (picks.has(i)) keyFrames.set(i, blob);
    return enc.add(blob).then(() => { added++; });
  };

  let realTime = false;
  let warning = '';
  const times = Array.from({ length: count }, (_, i) => (i * 1000) / fps);
  const r = await renderer.renderFrames({ url, file, root: ctx.projectRoot, width, height, times }, {
    signal: ctx.signal,
    onFrame: (i, path) => {
      chain = chain.then(async () => {
        if (encodeError) return;
        await addFrame(i, await renderer.readFrame(path));
        void removeFile(path).catch(() => {});
      }).catch((e: any) => { encodeError = String(e?.message || e); });
    },
  });
  await chain;
  await renderer.cleanupRender(r);
  if (r.pageErrors.length) warning = `erreurs JavaScript de la page : ${r.pageErrors.slice(0, 3).join(' | ')}`;
  if (r.error) {
    if (renderer.isPageError(r.code) || file || !url || r.code === 'ABORT') return { output: r.error, isError: true };
    // Moteur indisponible : navigateur intégré en secours (plus lent, 20 s au plus)
    if (durationMs > 20_000) return { output: `${r.error}\nSans le moteur de rendu, 20 s au plus : réduis la durée.`, isError: true };
    const shot = await captureFrames({ url, width, height, durationMs, fps, signal: ctx.signal });
    if (shot.error && !shot.frames.length) return { output: shot.error, isError: true };
    realTime = shot.realTime;
    if (shot.error) warning = shot.error;
    for (let i = 0; i < shot.frames.length && !encodeError; i++) {
      try { await addFrame(i, shot.frames[i]); } catch (e: any) { encodeError = String(e?.message || e); }
    }
  }
  if (encodeError) return { output: `Assemblage de la vidéo impossible : ${encodeError}`, isError: true };
  if (!added) return { output: 'Aucune image enregistrée.', isError: true };

  let encoded;
  try {
    encoded = await enc.finish();
  } catch (e: any) {
    return { output: `Assemblage de la vidéo impossible : ${e?.message || e}`, isError: true };
  }
  if (encoded.format === 'webm') rel = rel.replace(/\.mp4$/i, '.webm');
  const abs = resolvePath(ctx.projectRoot, rel);
  await createDir(abs.replace(/[\\/][^\\/]+$/, ''), { recursive: true }).catch(() => {});
  const existed = await fileSystemService.exists(abs);
  await writeBinaryFile(abs, encoded.bytes);
  ctx.onFileChanged?.(rel, '', existed ? 'edit' : 'create');

  // Quatre images clés pour que l'agent vérifie le résultat
  const { imageToDataUrl } = await import('@/lib/imageAttach');
  const images = await Promise.all([...keyFrames.entries()].sort((x, y) => x[0] - y[0]).map(async ([n, blob]) => ({
    label: `${encoded.format.toUpperCase()}, image à ${Math.round((n * 1000) / fps)} ms`,
    dataUrl: await imageToDataUrl(blob),
  })));
  const mo = (encoded.bytes.byteLength / 1048576).toFixed(1).replace('.', ',');
  return {
    output: `Vidéo créée : ${rel} (${encoded.format.toUpperCase()}, ${width}×${height}, ${(added / fps).toFixed(1)} s, ${fps} images/s, ${mo} Mo).` +
      (encoded.format === 'webm' ? ' Ce système n\'encode pas le H.264 : vidéo enregistrée en WebM.' : '') +
      (audio && encoded.hasAudio ? ` Musique incluse (${args.music}).` : '') +
      (encoded.audioNote ? ` Son : ${encoded.audioNote}.` : '') +
      (musicNote ? ` ${musicNote}` : '') +
      (realTime ? ' Attention : animations non figeables, capturées en temps réel : le rythme peut être irrégulier.' : '') +
      (warning ? ` À signaler : ${warning}` : '') +
      ' Les images clés te sont montrées : vérifie le début, le milieu et la fin. La vidéo s\'affiche déjà dans la conversation avec un lecteur : ne la décris pas en détail, donne juste son nom. Si tu modifies encore la page, réexporte la vidéo avant de finir.',
    images,
    media: { path: abs, kind: encoded.format === 'gif' ? 'image' : 'video' },
  };
}

/** Export d'une image PNG unique (visuel, affiche, publication) à l'instant `at`. */
async function exportStill(o: { url?: string; file?: string; width: number; height: number; at: number; output?: string; ctx: ToolExecutionContext }): Promise<ToolResult> {
  if (o.file) {
    const guard = await checkMotionHtml(o.file);
    if (guard.isError && guard.output) return { output: guard.output, isError: true };
  }
  const { renderFrames, cleanupRender } = await import('@/services/motion/renderer');
  let rel = String(o.output || 'export/visuel.png').replace(/\\/g, '/');
  if (!/\.png$/i.test(rel)) rel = rel.replace(/\.[a-z0-9]+$/i, '') + '.png';
  const r = await renderFrames({ url: o.url, file: o.file, root: o.ctx.projectRoot, width: o.width, height: o.height, times: [Math.max(0, o.at)], imageType: 'png' }, { signal: o.ctx.signal });
  try {
    if (r.error || !r.files[0]) return { output: r.error || 'Aucune image produite.', isError: true };
    const { readBinaryFile, writeBinaryFile, createDir } = await import('@tauri-apps/api/fs');
    const bytes = await readBinaryFile(r.files[0]);
    const abs = resolvePath(o.ctx.projectRoot, rel);
    await createDir(abs.replace(/[\\/][^\\/]+$/, ''), { recursive: true }).catch(() => {});
    const existed = await fileSystemService.exists(abs);
    await writeBinaryFile(abs, bytes);
    o.ctx.onFileChanged?.(rel, '', existed ? 'edit' : 'create');
    const { imageToDataUrl } = await import('@/lib/imageAttach');
    const preview = await imageToDataUrl(new Blob([bytes as unknown as BlobPart], { type: 'image/png' }));
    return {
      output: `Image créée : ${rel} (PNG, ${o.width}×${o.height}, ${Math.max(1, Math.round(bytes.byteLength / 1024))} Ko). Elle t'est montrée : vérifie-la. Elle s'affiche déjà dans la conversation : donne juste son nom.` +
        (r.pageErrors.length ? ` Erreurs JavaScript de la page : ${r.pageErrors.slice(0, 3).join(' | ')}` : ''),
      images: [{ label: `PNG ${o.width}×${o.height}`, dataUrl: preview }],
      media: { path: abs, kind: 'image' },
    };
  } finally {
    await cleanupRender(r);
  }
}

async function execPageAction(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const { pageAction } = await import('./browserCheck');
  return pageAction(args, ctx.signal);
}

async function execExplore(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const questions: string[] = (Array.isArray(args.questions) ? args.questions : [args.questions])
    .filter((q: any) => typeof q === 'string' && q.trim());
  if (!questions.length) return { output: 'Erreur: indique au moins une question dans questions.', isError: true };
  // Import dynamique : explorers importe ce module
  const { exploreInParallel, formatExploreResults } = await import('./explorers');
  const { results, costFCFA } = await exploreInParallel(questions, ctx);
  const failed = results.filter((r) => !r.ok).length;
  return {
    output: `${results.length} exploration${results.length > 1 ? 's' : ''} terminée${results.length > 1 ? 's' : ''}${failed ? ` (${failed} sans réponse)` : ''}. Résumés :\n\n${formatExploreResults(results)}\n\n(Vérifie toi-même avec read_file un point précis avant de modifier le code.)`,
    isError: failed === results.length,
    costFCFA,
  };
}

async function execSpawnSubagents(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  // Tâches : objets {task, role} (ou chaînes simples, rôle déduit)
  const rawTasks: any[] = Array.isArray(args.tasks) ? args.tasks.slice(0, 3) : [];
  const tasks: { task: string; role: SubagentRole }[] = rawTasks
    .map((t: any) => {
      const text = typeof t === 'string' ? t : typeof t?.task === 'string' ? t.task : '';
      if (!text.trim()) return null;
      const role: SubagentRole =
        t?.role === 'motion-designer' || t?.role === 'dev' || t?.role === 'redaction'
          ? t.role
          : detectSubagentRole(text);
      return { task: text.trim(), role };
    })
    .filter(Boolean) as { task: string; role: SubagentRole }[];
  if (tasks.length < 2) {
    return { output: 'Erreur: spawn_subagents requiert 2 à 3 sous-tâches indépendantes (objets {task, role}). Pour une seule tâche, fais-la toi-même.', isError: true };
  }

  // Rôle motion-designer → les deux skills motion injectées dans son prompt système
  const motionSkills = ['motion-system', 'gsap-cookbook']
    .map((n) => BUILTIN_SKILLS.find((sk) => sk.name === n)?.markdown)
    .filter(Boolean)
    .join('\n\n---\n\n');
  const extraFor = (role: SubagentRole): string | undefined =>
    role === 'motion-designer' && motionSkills
      ? SUBAGENT_ROLE_PROMPTS[role] + '\n\n# SKILLS OBLIGATOIRES (applique-les à la lettre)\n' + motionSkills
      : SUBAGENT_ROLE_PROMPTS[role] || undefined;

  // Import dynamique pour éviter le cycle agentTools ↔ agentLoop
  const { runAgentSession } = await import('./agentLoop');
  const projectName = ctx.projectRoot.split(/[\\/]/).filter(Boolean).pop() || 'projet';

  // Progression en direct vers l'UI (une ligne par sous-agent, action courante)
  const progress: SubagentProgress[] = tasks.map(({ task, role }) => ({
    task: task.length > 90 ? task.slice(0, 87) + '…' : task,
    role,
    status: 'running' as const,
    steps: 0,
  }));
  const pushProgress = () => ctx.onSubagentProgress?.(progress.map((p) => ({ ...p })));
  pushProgress();
  const shortAction = (name: string, args: Record<string, any>): string => {
    const a = args.path || args.file_path || args.command || args.query || args.url || args.output || '';
    return a ? `${name} · ${String(a).slice(0, 60)}` : name;
  };

  const results = await Promise.all(
    tasks.map(({ task, role }, i) =>
      runAgentSession({
        prompt: { projectName, projectRoot: ctx.projectRoot },
        task,
        systemPromptExtra: extraFor(role),
        maxSteps: 15,
        gitCheckpoint: false,   // le checkpoint parent couvre déjà la session
        autoVerify: false,      // le parent vérifie après consolidation
        signal: ctx.signal,
        onFileChanged: ctx.onFileChanged,
        onEvent: (ev) => {
          const p = progress[i];
          if (!p) return;
          if (ev.type === 'step_start') { p.steps = ev.step; pushProgress(); }
          else if (ev.type === 'tool_call') { p.current = shortAction(ev.name, ev.args); pushProgress(); }
          else if (ev.type === 'done') { p.status = 'done'; p.current = undefined; p.steps = ev.steps; pushProgress(); }
          else if (ev.type === 'error') { p.status = 'error'; p.current = ev.message.slice(0, 80); pushProgress(); }
        },
      }).catch((e: any) => {
        progress[i] = { ...progress[i], status: 'error', current: e?.message?.slice(0, 80) };
        pushProgress();
        return {
          stopReason: 'error' as const,
          summary: e?.message || String(e),
          steps: 0,
          messages: [],
          filesChanged: [] as string[],
        };
      })
      .then(r => ({ index: i + 1, task, role, ...r }))
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

async function execInstallTool(args: Record<string, any>): Promise<ToolResult> {
  const catalog = await toolsCatalog();
  const info = catalog.find((t) => t.name === String(args.tool || ''));
  if (!info) {
    return { output: `Outil inconnu. Catalogue : ${catalog.map((t) => t.name).join(', ') || 'vide'}.`, isError: true };
  }
  if (info.installed) return { output: `${info.name} ${info.version} est déjà installé : utilisable directement dans run_command.` };
  if (!info.available) return { output: `${info.name} n'est pas disponible sur cette plateforme.`, isError: true };

  // Accord explicite de l'utilisateur — jamais d'installation silencieuse
  const ok = await confirmToolInstall(info);
  if (!ok) {
    return { output: "L'utilisateur a refusé l'installation. Ne réessaie pas dans cette tâche ; propose une alternative sans cet outil." };
  }
  const r = await toolInstall(info.name);
  if (!r.ok) return { output: `Échec de l'installation de ${info.name} : ${r.error}`, isError: true };
  return { output: `${info.name} ${r.version} installé et vérifié. La commande est maintenant disponible dans run_command (le PATH de l'app est à jour).` };
}

async function execVendorLib(args: Record<string, any>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const names = Array.isArray(args.libs) ? args.libs.map(String) : [];
  if (!names.length) return { output: "Indique libs, ex : ['gsap','split-text'] ou ['all'].", isError: true };
  return vendorLibs(ctx.projectRoot, names);
}

const EXECUTORS: Record<string, ToolExecutor> = {
  install_tool: execInstallTool,
  vendor_lib: execVendorLib,
  read_file: execReadFile,
  write_file: execWriteFile,
  edit_file: execEditFile,
  delete_file: execDeleteFile,
  list_dir: execListDir,
  search_files: execSearchFiles,
  get_diagnostics: execGetDiagnostics,
  explore: execExplore,
  start_dev_server: execStartDevServer,
  dev_server_logs: execDevServerLogs,
  stop_dev_server: execStopDevServer,
  check_page: execCheckPage,
  capture_page: execCapturePage,
  export_animation: execExportAnimation,
  page_action: execPageAction,
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
