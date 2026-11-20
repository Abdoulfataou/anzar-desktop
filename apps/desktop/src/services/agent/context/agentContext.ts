/**
 * AgentContext — Contexte intelligent + mémoire projet (Phase 3)
 *
 * 1. CODE MAP : indexe le projet via codeIndexer (symboles, dépendances)
 *    et produit une carte compacte injectée dans le system prompt.
 *    L'agent sait OÙ chercher sans qu'on injecte les contenus complets —
 *    il lit ensuite précisément avec read_file (économie massive de tokens).
 *
 * 2. HINTS : pour la tâche donnée, les fichiers les plus pertinents
 *    (scoring codeIndexer : mentions, symboles, graphe de dépendances).
 *
 * 3. MÉMOIRE : ANZAR.md à la racine du projet (équivalent CLAUDE.md) —
 *    conventions, décisions, leçons. Lu à chaque session, enrichi par
 *    l'outil `remember` de l'agent.
 */

import { fileSystemService } from '@/services/filesystem/fileSystem';
import { codeIndexer } from '@/services/filesystem/codeIndexer';
import { pageRank, rankedFiles } from './repoRank';

// ============================================================================
// TYPES
// ============================================================================

export interface AgentProjectContext {
  /** Carte du code : fichiers + symboles clés (bornée) */
  codeMap: string;
  /** Fichiers probablement pertinents pour la tâche, avec leurs symboles */
  taskHints: string;
  /** Contenu de la mémoire projet (ANZAR.md), vide si absente */
  memory: string;
  /** Stats pour l'UI */
  stats: { totalFiles: number; totalSymbols: number; indexMs: number };
}

export const MEMORY_FILENAME = 'ANZAR.md';

const MAX_CODE_MAP_CHARS = 6_000;   // renvoyé à chaque étape : l'agent complète avec list_dir
const MAX_HINTS_CHARS = 2_500;
const MAX_MEMORY_CHARS = 5_000;
const MAX_INDEXED_FILES = 400;
const MAX_FILE_SIZE_TO_INDEX = 120_000;

// ============================================================================
// LECTURE DU PROJET
// ============================================================================

async function readProjectAsRecord(projectRoot: string): Promise<Record<string, string>> {
  // Lecture plafonnée : au-delà, l'agent explore lui-même avec list_dir / search_files
  const files = await fileSystemService.readProjectFiles(projectRoot, 6, MAX_INDEXED_FILES * 2);
  const record: Record<string, string> = {};
  let count = 0;
  for (const f of files) {
    if (count >= MAX_INDEXED_FILES) break;
    if (!f.content || f.content.length > MAX_FILE_SIZE_TO_INDEX) continue;
    // Chemins relatifs à la racine pour la carte
    const rel = f.path.startsWith(projectRoot)
      ? f.path.slice(projectRoot.length).replace(/^[\\/]+/, '')
      : f.path;
    record[rel] = f.content;
    count++;
  }
  return record;
}

// ============================================================================
// CODE MAP
// ============================================================================

function buildCodeMap(index: ReturnType<typeof codeIndexer.indexProject>): string {
  const lines: string[] = [];

  lines.push(
    `${index.stats.totalFiles} fichiers, ${index.stats.totalSymbols} symboles. ` +
    `Langages: ${Object.entries(index.stats.languages).map(([l, n]) => `${l}(${n})`).join(', ')}.`
  );
  if (index.stats.topLevelPackages.length > 0) {
    lines.push(`Packages: ${index.stats.topLevelPackages.slice(0, 25).join(', ')}`);
  }
  lines.push('');

  // Fichiers triés par importance : PageRank sur le graphe des imports (stable d'un message à
  // l'autre, donc compatible avec le cache DeepSeek)
  const order = rankedFiles(pageRank([...index.files.keys()], index.dependencies));
  const ranked = order.map((p) => [p, index.files.get(p)!] as const).filter(([, fi]) => !!fi);

  let used = lines.join('\n').length;
  for (const [path, fi] of ranked) {
    const symbols = fi.symbols
      .slice(0, 8)
      .map(s => s.name)
      .join(', ');
    const entry = `${path} (${fi.lineCount}l)${symbols ? ` — ${symbols}` : ''}`;
    if (used + entry.length > MAX_CODE_MAP_CHARS) {
      lines.push(`… [+ ${index.files.size - lines.length + 3} autres fichiers — utilise list_dir/search_files]`);
      break;
    }
    lines.push(entry);
    used += entry.length + 1;
  }

  return lines.join('\n');
}

// ============================================================================
// HINTS PAR TÂCHE
// ============================================================================

function buildTaskHints(
  index: ReturnType<typeof codeIndexer.indexProject>,
  files: Record<string, string>,
  task: string
): string {
  try {
    const { relevantFiles: matched } = codeIndexer.buildSmartContext(index, task, files, 20_000);
    if (matched.length === 0) return '';
    // PageRank personnalisé par les fichiers trouvés pour la tâche : ils restent en tête, et
    // leurs voisins importants (store, utilitaires, types) remontent avec eux.
    const personalization = new Map(matched.slice(0, 12).map((p, i) => [p, 1 / (i + 1)]));
    const rank = pageRank([...index.files.keys()], index.dependencies, { personalization });
    const relevantFiles = rankedFiles(rank).filter((p) => rank.get(p)! > 0);

    const lines: string[] = [];
    let used = 0;
    for (const path of relevantFiles.slice(0, 10)) {
      const fi = index.files.get(path);
      if (!fi) continue;
      const syms = fi.symbols.slice(0, 12).map(s => `${s.kind}:${s.name}`).join(', ');
      const deps = index.reverseDependencies.get(path)?.slice(0, 4).join(', ');
      const entry = `- ${path}${syms ? `\n  symboles: ${syms}` : ''}${deps ? `\n  utilisé par: ${deps}` : ''}`;
      if (used + entry.length > MAX_HINTS_CHARS) break;
      lines.push(entry);
      used += entry.length + 1;
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

// ============================================================================
// MÉMOIRE PROJET (ANZAR.md)
// ============================================================================

/**
 * Instructions du projet au format standard AGENTS.md (agents.md, Linux Foundation) :
 * les mêmes que lisent Codex, Cursor, Copilot… CLAUDE.md sert de repli.
 */
export const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'];
const MAX_INSTRUCTIONS_CHARS = 8_000;

async function readCapped(path: string, max: number, label: string): Promise<string> {
  if (!(await fileSystemService.exists(path).catch(() => false))) return '';
  const content = (await fileSystemService.readFile(path).catch(() => '')).trim();
  return content.length > max ? `${content.slice(0, max)}\n… [${label} tronqué]` : content;
}

/** Instructions du projet (AGENTS.md, sinon CLAUDE.md) puis mémoire ANZAR (ANZAR.md). */
export async function loadProjectMemory(projectRoot: string): Promise<string> {
  try {
    const root = projectRoot.replace(/[\\/]+$/, '');
    let instructions = '';
    for (const name of INSTRUCTION_FILES) {
      const text = await readCapped(`${root}/${name}`, MAX_INSTRUCTIONS_CHARS, name);
      if (text) { instructions = `## Instructions du projet (${name})\n${text}`; break; }
    }
    const memory = await readCapped(`${root}/${MEMORY_FILENAME}`, MAX_MEMORY_CHARS, 'mémoire');
    return [instructions, memory ? `## Mémoire d'ANZAR (${MEMORY_FILENAME})\n${memory}` : ''].filter(Boolean).join('\n\n');
  } catch {
    return '';
  }
}

/**
 * Ajoute une entrée à la mémoire projet (utilisé par l'outil `remember`).
 * Crée ANZAR.md si absent, avec un en-tête explicatif.
 */
export async function appendProjectMemory(
  projectRoot: string,
  category: string,
  note: string
): Promise<void> {
  const path = `${projectRoot.replace(/[\\/]+$/, '')}/${MEMORY_FILENAME}`;
  const exists = await fileSystemService.exists(path);

  const header = `# Mémoire du projet — ANZAR

Ce fichier est la mémoire persistante de l'agent ANZAR pour ce projet
(conventions, décisions d'architecture, leçons apprises). Il est lu au
début de chaque session. Modifiable à la main.
`;

  const date = new Date().toISOString().slice(0, 10);
  const entry = `\n## [${category}] ${date}\n${note.trim()}\n`;

  const current = exists ? await fileSystemService.readFile(path) : header;
  await fileSystemService.writeFile(path, current + entry);
}

// ============================================================================
// POINT D'ENTRÉE
// ============================================================================

/**
 * Construit le contexte complet de l'agent pour une session.
 * Ne throw jamais : en cas d'échec d'indexation, renvoie un contexte minimal.
 */
const INDEX_CACHE_MS = 2 * 60 * 1000;
const indexCache = new Map<string, {
  at: number;
  files: Record<string, string>;
  index: ReturnType<typeof codeIndexer.indexProject>;
}>();

export async function buildAgentContext(
  projectRoot: string,
  task: string
): Promise<AgentProjectContext> {
  const start = Date.now();

  const memory = await loadProjectMemory(projectRoot);

  try {
    // Index réutilisé 2 minutes : relire tout le projet à chaque message retardait
    // le démarrage de l'agent sur les gros dossiers. La carte n'est qu'un repère.
    const cached = indexCache.get(projectRoot);
    let files: Record<string, string>;
    let index: ReturnType<typeof codeIndexer.indexProject>;
    if (cached && Date.now() - cached.at < INDEX_CACHE_MS) {
      ({ files, index } = cached);
    } else {
      files = await readProjectAsRecord(projectRoot);
      index = codeIndexer.indexProject(files);
      indexCache.set(projectRoot, { at: Date.now(), files, index });
    }
    return {
      codeMap: buildCodeMap(index),
      taskHints: buildTaskHints(index, files, task),
      memory,
      stats: {
        totalFiles: index.stats.totalFiles,
        totalSymbols: index.stats.totalSymbols,
        indexMs: Date.now() - start,
      },
    };
  } catch {
    return {
      codeMap: '',
      taskHints: '',
      memory,
      stats: { totalFiles: 0, totalSymbols: 0, indexMs: Date.now() - start },
    };
  }
}
