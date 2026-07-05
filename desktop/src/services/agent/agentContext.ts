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

const MAX_CODE_MAP_CHARS = 9_000;
const MAX_HINTS_CHARS = 4_000;
const MAX_MEMORY_CHARS = 8_000;
const MAX_INDEXED_FILES = 400;
const MAX_FILE_SIZE_TO_INDEX = 120_000;

// ============================================================================
// LECTURE DU PROJET
// ============================================================================

async function readProjectAsRecord(projectRoot: string): Promise<Record<string, string>> {
  const files = await fileSystemService.readProjectFiles(projectRoot, 6);
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

  // Fichiers triés par importance (hubs du graphe de dépendances d'abord)
  const ranked = [...index.files.entries()].sort((a, b) => {
    const ra = (index.reverseDependencies.get(a[0])?.length || 0) + a[1].exports.length;
    const rb = (index.reverseDependencies.get(b[0])?.length || 0) + b[1].exports.length;
    return rb - ra;
  });

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
    const { relevantFiles } = codeIndexer.buildSmartContext(index, task, files, 20_000);
    if (relevantFiles.length === 0) return '';

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

export async function loadProjectMemory(projectRoot: string): Promise<string> {
  try {
    const path = `${projectRoot.replace(/[\\/]+$/, '')}/${MEMORY_FILENAME}`;
    if (!(await fileSystemService.exists(path))) return '';
    const content = await fileSystemService.readFile(path);
    return content.length > MAX_MEMORY_CHARS
      ? content.slice(0, MAX_MEMORY_CHARS) + '\n… [mémoire tronquée]'
      : content;
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
export async function buildAgentContext(
  projectRoot: string,
  task: string
): Promise<AgentProjectContext> {
  const start = Date.now();

  const memory = await loadProjectMemory(projectRoot);

  try {
    const files = await readProjectAsRecord(projectRoot);
    const index = codeIndexer.indexProject(files);
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
