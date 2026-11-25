/**
 * Outil `apply_patch` : applique un patch multi-fichiers au format Codex
 * (« *** Begin Patch » … « *** End Patch »).
 *
 * Le patch est d'abord entièrement parsé, validé et simulé en mémoire : si un chemin
 * est interdit, si un fichier manque ou si un contexte est introuvable/ambigu, RIEN
 * n'est écrit. L'application sur disque ne commence qu'ensuite ; un échec en cours
 * d'écriture restaure les contenus d'origine (rollback au mieux).
 */
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { isProtectedWritePath, resolveWritePath } from './shared';
import type { ToolExecutionContext, ToolResult } from './types';

export const MAX_PATCH_CHARS = 200_000;

// ============================================================================
// TYPES
// ============================================================================

export interface PatchHunk {
  /** Ligne du `@@` dans le patch (1-indexée), pour les erreurs. */
  line: number;
  /** Contexte + lignes supprimées : le bloc à retrouver exactement une fois. */
  oldLines: string[];
  /** Contexte + lignes ajoutées : le bloc qui remplace l'ancien. */
  newLines: string[];
}

export interface PatchSection {
  kind: 'add' | 'update' | 'delete';
  path: string;
  /** `*** Move to:` (Update seulement). */
  moveTo?: string;
  /** Ligne de l'en-tête de section (1-indexée). */
  line: number;
  hunks: PatchHunk[];
  /** Lignes ajoutées d'un Add File (sans le préfixe « + »). */
  addedLines: string[];
  added: number;
  removed: number;
}

export class PatchError extends Error {
  line?: number;

  constructor(message: string, line?: number) {
    super(message);
    this.name = 'PatchError';
    this.line = line;
  }
}

interface FileState {
  abs: string;
  /** Contenu courant simulé (null = absent). */
  content: string | null;
  /** Contenu sur disque avant le patch (null = absent), pour le rollback. */
  original: string | null;
}

type PatchOperation =
  | { kind: 'write'; rel: string; abs: string; content: string; sectionLine: number }
  | { kind: 'delete'; rel: string; abs: string; sectionLine: number }
  | {
    kind: 'move';
    rel: string;
    abs: string;
    fromBefore: string;
    content: string;
    toRel: string;
    toAbs: string;
    sectionLine: number;
  };

interface PlannedChange {
  rel: string;
  content: string;
  action: 'create' | 'edit' | 'delete';
}

interface PatchPlan {
  originals: Map<string, { abs: string; content: string | null }>;
  operations: PatchOperation[];
  changes: Map<string, PlannedChange>;
}

// ============================================================================
// PARSING (pur, testable)
// ============================================================================

const formatLine = (line: string) => {
  const short = line.length > 80 ? `${line.slice(0, 77)}...` : line;
  return `« ${short} »`;
};

/** Parse un patch complet. Lève PatchError avec le numéro de ligne dès la première anomalie. */
export function parsePatch(patch: string): PatchSection[] {
  if (typeof patch !== 'string' || !patch.trim()) {
    throw new PatchError('patch vide : commence par « *** Begin Patch ».', 1);
  }
  const lines = patch.replace(/\r\n?/g, '\n').split('\n');
  let index = 0;
  while (index < lines.length && lines[index].trim() === '') index++;
  if (index >= lines.length || lines[index].trim() !== '*** Begin Patch') {
    throw new PatchError('le patch doit commencer par « *** Begin Patch ».', index + 1);
  }
  const sections: PatchSection[] = [];
  let current: PatchSection | null = null;
  let currentHunk: PatchHunk | null = null;
  let ended = false;

  const finishHunk = () => {
    if (!currentHunk) return;
    if (currentHunk.oldLines.length === 0) {
      throw new PatchError(
        'hunk sans contexte ni suppression : ajoute au moins une ligne de contexte (préfixe espace) pour indiquer où modifier.',
        currentHunk.line,
      );
    }
    current!.hunks.push(currentHunk);
    currentHunk = null;
  };

  const finishSection = () => {
    finishHunk();
    if (!current) return;
    if (current.kind === 'update' && current.hunks.length === 0) {
      throw new PatchError(
        'Update File sans hunk : ajoute au moins un bloc « @@ » (contexte, suppressions, ajouts).',
        current.line,
      );
    }
    sections.push(current);
    current = null;
  };

  const createSection = (kind: PatchSection['kind'], path: string, line: number): PatchSection => {
    finishSection();
    return { kind, path: path.trim(), line, hunks: [], addedLines: [], added: 0, removed: 0 };
  };

  for (index++; index < lines.length; index++) {
    const line = lines[index];
    const lineNo = index + 1;
    // Les marqueurs de section commencent en colonne 0 : une ligne de contexte qui
    // contient « *** … » (préfixée par un espace) reste du contenu de hunk.
    const marker = line.startsWith('***') ? line.trimEnd() : '';

    if (marker === '*** End Patch') {
      finishSection();
      for (let rest = index + 1; rest < lines.length; rest++) {
        if (lines[rest].trim()) {
          throw new PatchError('contenu après « *** End Patch » : un seul patch par appel.', rest + 1);
        }
      }
      ended = true;
      break;
    }

    if (marker.startsWith('*** Add File:')) {
      current = createSection('add', marker.slice('*** Add File:'.length), lineNo);
      continue;
    }
    if (marker.startsWith('*** Update File:')) {
      current = createSection('update', marker.slice('*** Update File:'.length), lineNo);
      continue;
    }
    if (marker.startsWith('*** Delete File:')) {
      current = createSection('delete', marker.slice('*** Delete File:'.length), lineNo);
      continue;
    }
    if (marker.startsWith('*** Begin Patch')) {
      throw new PatchError('« *** Begin Patch » ne peut apparaître qu’au début du patch.', lineNo);
    }
    if (marker.startsWith('*** Move to:')) {
      if (!current || current.kind !== 'update') {
        throw new PatchError('« *** Move to: » doit suivre un en-tête « *** Update File: ».', lineNo);
      }
      if (current.moveTo) {
        throw new PatchError('un seul « *** Move to: » par fichier.', lineNo);
      }
      if (current.hunks.length > 0 || currentHunk) {
        throw new PatchError('« *** Move to: » doit être placé juste après « *** Update File: », avant les hunks.', lineNo);
      }
      current.moveTo = marker.slice('*** Move to:'.length).trim();
      continue;
    }

    if (line.startsWith('@@')) {
      if (!current || current.kind !== 'update') {
        throw new PatchError('un hunk « @@ » doit appartenir à une section « *** Update File: ».', lineNo);
      }
      finishHunk();
      currentHunk = { line: lineNo, oldLines: [], newLines: [] };
      continue;
    }

    // Ligne vide : séparateur toléré entre hunks et sections.
    if (line === '') {
      finishHunk();
      continue;
    }

    if (!current) {
      throw new PatchError('ligne hors section : commence par « *** Add File: », « *** Update File: » ou « *** Delete File: ».', lineNo);
    }

    if (current.kind === 'add') {
      if (!line.startsWith('+')) {
        throw new PatchError(`dans Add File, chaque ligne de contenu doit commencer par « + » (reçu ${formatLine(line)}).`, lineNo);
      }
      current.addedLines.push(line.slice(1));
      current.added++;
      continue;
    }

    if (current.kind === 'delete') {
      throw new PatchError('Delete File n’accepte pas de contenu : retire cette ligne.', lineNo);
    }

    // Update : lignes de hunk
    if (!currentHunk) {
      throw new PatchError('ligne hors hunk : ajoute un en-tête « @@ » avant les lignes de contenu.', lineNo);
    }
    const prefix = line[0];
    if (prefix === ' ') {
      currentHunk.oldLines.push(line.slice(1));
      currentHunk.newLines.push(line.slice(1));
    } else if (prefix === '-') {
      currentHunk.oldLines.push(line.slice(1));
      current.removed++;
    } else if (prefix === '+') {
      currentHunk.newLines.push(line.slice(1));
      current.added++;
    } else {
      throw new PatchError(
        `préfixe de ligne inattendu (attendu «  » pour le contexte, « - » pour supprimer, « + » pour ajouter) : ${formatLine(line)}.`,
        lineNo,
      );
    }
  }

  if (!ended) {
    let last = lines.length;
    while (last > 0 && lines[last - 1].trim() === '') last--;
    throw new PatchError('patch incomplet : termine par « *** End Patch ».', Math.max(last, 1));
  }
  if (sections.length === 0) {
    throw new PatchError('aucune section dans le patch (Add File, Update File ou Delete File).', 1);
  }
  for (const section of sections) {
    if (!section.path) {
      throw new PatchError('chemin vide dans l’en-tête de section.', section.line);
    }
    if (section.moveTo !== undefined && !section.moveTo) {
      throw new PatchError('chemin vide après « *** Move to: ».', section.line);
    }
  }
  return sections;
}

/** Chemins cités par un patch (sources, cibles et déplacements), sans validation. */
export function patchTouchedPaths(patch: string): string[] {
  const paths = new Set<string>();
  for (const raw of String(patch ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const match = /^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/.exec(line)
      ?? /^\*\*\* Move to:\s*(.+)$/.exec(line);
    const value = match?.[1]?.trim();
    if (value) paths.add(value);
  }
  return [...paths];
}

// ============================================================================
// CHEMINS ET PROTECTIONS
// ============================================================================

function cleanRelative(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg && seg !== '.')
    .join('/');
}

/** Harness n'a pas de liste de chemins interdits : le patch suit la frontière du projet. */
export function isProtectedPatchPath(_relPath: string): boolean {
  return false;
}

/** Valide un chemin du patch : relatif au projet, sans « .. », sans fichier protégé. */
export function validatePatchPath(raw: string, line: number): string {
  const value = String(raw ?? '').trim();
  if (!value) throw new PatchError('chemin vide.', line);
  const normalized = value.replace(/\\/g, '/');
  if (/^(?:\/|~|[a-zA-Z]:)/.test(normalized)) {
    throw new PatchError(`chemin absolu interdit (relatif au projet uniquement) : ${value}`, line);
  }
  if (normalized.split('/').some((seg) => seg === '..')) {
    throw new PatchError(`chemin interdit (sortie du projet) : ${value}`, line);
  }
  const clean = cleanRelative(normalized);
  if (!clean) throw new PatchError(`chemin invalide : ${value}`, line);
  if (isProtectedPatchPath(clean)) {
    throw new PatchError(`écriture interdite (fichier ou dossier protégé) : ${value}`, line);
  }
  return clean;
}

// ============================================================================
// APPLICATION DES HUNKS (pure, testable)
// ============================================================================

/** Applique les hunks dans l'ordre au contenu courant ; exige un contexte unique. */
export function applyHunks(content: string, hunks: PatchHunk[], relPath: string): string {
  // Le patch est en LF (CRLF normalisé au parsing) ; un fichier Windows garde ses CRLF.
  const crlf = content.includes('\r\n');
  let current = crlf ? content.replace(/\r\n/g, '\n') : content;
  for (let i = 0; i < hunks.length; i++) {
    current = applyOneHunk(current, hunks[i], relPath, i + 1);
  }
  return crlf ? current.replace(/\n/g, '\r\n') : current;
}

function applyOneHunk(content: string, hunk: PatchHunk, relPath: string, hunkIndex: number): string {
  const lines = content.split('\n');
  const oldLines = hunk.oldLines;
  if (oldLines.length === 0) {
    throw new PatchError(
      `fichier ${relPath}, hunk ${hunkIndex} : hunk sans contexte ni suppression, impossible de savoir où insérer.`,
      hunk.line,
    );
  }
  const positions: number[] = [];
  for (let start = 0; start + oldLines.length <= lines.length; start++) {
    let matches = true;
    for (let offset = 0; offset < oldLines.length; offset++) {
      if (lines[start + offset] !== oldLines[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) positions.push(start);
  }

  if (positions.length === 0) {
    throw new PatchError(
      `fichier ${relPath}, hunk ${hunkIndex} : contexte introuvable. Relis le fichier (read_file), le contexte a changé.`,
      hunk.line,
    );
  }
  if (positions.length > 1) {
    throw new PatchError(
      `fichier ${relPath}, hunk ${hunkIndex} : contexte ambigu (${positions.length} occurrences). Ajoute des lignes de contexte pour le rendre unique.`,
      hunk.line,
    );
  }

  const start = positions[0];
  return [
    ...lines.slice(0, start),
    ...hunk.newLines,
    ...lines.slice(start + oldLines.length),
  ].join('\n');
}

// ============================================================================
// PLANIFICATION ET ÉCRITURE
// ============================================================================

async function planPatch(sections: PatchSection[], ctx: ToolExecutionContext): Promise<PatchPlan> {
  const states = new Map<string, FileState>();
  const operations: PatchOperation[] = [];
  const changes = new Map<string, PlannedChange>();

  const getState = async (rel: string, line: number): Promise<FileState> => {
    const known = states.get(rel);
    if (known) return known;
    let abs: string;
    try {
      abs = await resolveWritePath(ctx.projectRoot, rel);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new PatchError(`fichier ${rel} : ${message}`, line);
    }
    const exists = await fileSystemService.exists(abs);
    const content = exists ? await fileSystemService.readFile(abs) : null;
    const state: FileState = { abs, content, original: content };
    states.set(rel, state);
    return state;
  };

  for (const section of sections) {
    const rel = validatePatchPath(section.path, section.line);

    if (section.kind === 'add') {
      const state = await getState(rel, section.line);
      if (state.content !== null) {
        throw new PatchError(`Add File impossible : « ${rel} » existe déjà. Utilise « *** Update File: ».`, section.line);
      }
      const content = section.addedLines.join('\n');
      state.content = content;
      operations.push({ kind: 'write', rel, abs: state.abs, content, sectionLine: section.line });
      changes.set(rel, { rel, content, action: 'create' });
      continue;
    }

    if (section.kind === 'delete') {
      const state = await getState(rel, section.line);
      if (state.content === null) {
        throw new PatchError(`Delete File impossible : « ${rel} » est introuvable.`, section.line);
      }
      section.removed = state.content === ''
        ? 0
        : state.content.replace(/\n$/, '').split('\n').length;
      state.content = null;
      operations.push({ kind: 'delete', rel, abs: state.abs, sectionLine: section.line });
      changes.set(rel, { rel, content: '', action: 'delete' });
      continue;
    }

    // Update
    if (section.hunks.length === 0) {
      throw new PatchError(`Update File sans hunk pour « ${rel} ».`, section.line);
    }
    const state = await getState(rel, section.line);
    if (state.content === null) {
      throw new PatchError(`Update File impossible : « ${rel} » est introuvable.`, section.line);
    }
    const before = state.content;
    const updated = applyHunks(before, section.hunks, rel);
    // Un fichier créé plus tôt dans ce même patch reste une création pour l'UI.
    const action = state.original === null ? 'create' : 'edit';

    const moveTo = section.moveTo?.trim();
    if (!moveTo) {
      state.content = updated;
      operations.push({ kind: 'write', rel, abs: state.abs, content: updated, sectionLine: section.line });
      changes.set(rel, { rel, content: updated, action });
      continue;
    }

    const toRel = validatePatchPath(moveTo, section.line);
    if (toRel === rel) {
      state.content = updated;
      operations.push({ kind: 'write', rel, abs: state.abs, content: updated, sectionLine: section.line });
      changes.set(rel, { rel, content: updated, action });
      continue;
    }
    const target = await getState(toRel, section.line);
    if (target.content !== null) {
      throw new PatchError(`Move impossible : « ${toRel} » existe déjà.`, section.line);
    }
    target.content = updated;
    state.content = null;
    operations.push({
      kind: 'move',
      rel,
      abs: state.abs,
      fromBefore: before,
      content: updated,
      toRel,
      toAbs: target.abs,
      sectionLine: section.line,
    });
    changes.set(rel, { rel, content: '', action: 'delete' });
    changes.set(toRel, { rel: toRel, content: updated, action: 'create' });
  }

  const originals = new Map<string, { abs: string; content: string | null }>();
  for (const [rel, state] of states) originals.set(rel, { abs: state.abs, content: state.original });
  return { originals, operations, changes };
}

/** Restaure les fichiers touchés dans l'ordre inverse. Ne lève jamais. */
async function rollback(
  originals: PatchPlan['originals'],
  only?: Set<string>,
): Promise<{ restored: number; failed: number }> {
  let restored = 0;
  let failed = 0;
  const entries = [...originals.entries()].reverse();
  for (const [rel, entry] of entries) {
    if (only && !only.has(rel)) continue;
    try {
      if (entry.content === null) {
        if (await fileSystemService.exists(entry.abs)) await fileSystemService.deleteFile(entry.abs);
      } else {
        await fileSystemService.writeFile(entry.abs, entry.content);
      }
      restored++;
    } catch {
      // Rollback au mieux : on continue avec les autres fichiers.
      failed++;
    }
  }
  return { restored, failed };
}

function rollbackNotice(result: { restored: number; failed: number }): string {
  const plural = result.restored > 1 ? 's' : '';
  if (result.failed === 0) {
    return `Aucune modification conservée (${result.restored} fichier${plural} restauré${plural}).`;
  }
  return `Rollback partiel : ${result.restored} fichier${plural} restauré${plural}, `
    + `${result.failed} fichier${result.failed > 1 ? 's' : ''} non restauré${result.failed > 1 ? 's' : ''} : vérifie ces fichiers.`;
}

async function executePlan(
  plan: PatchPlan,
  sections: PatchSection[],
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  // Fichiers réellement tentés : le rollback ne touche pas aux fichiers des opérations
  // qui n'ont pas encore été exécutées.
  const touched = new Set<string>();
  for (const operation of plan.operations) {
    touched.add(operation.rel);
    if (operation.kind === 'move') touched.add(operation.toRel);
    if (ctx.signal?.aborted) {
      const restored = await rollback(plan.originals, touched);
      return {
        output: `Session annulée : patch non appliqué. ${rollbackNotice(restored)}`,
        isError: true,
      };
    }
    try {
      if (operation.kind === 'write') {
        await fileSystemService.writeFile(operation.abs, operation.content);
      } else if (operation.kind === 'delete') {
        await fileSystemService.deleteFile(operation.abs);
      } else {
        // Move : le contenu des hunks est d'abord écrit à l'ancien chemin, puis renommé.
        if (operation.content !== operation.fromBefore) {
          await fileSystemService.writeFile(operation.abs, operation.content);
        }
        const parent = operation.toAbs.slice(0, operation.toAbs.lastIndexOf('/'));
        if (parent) await fileSystemService.createDirectory(parent);
        try {
          await fileSystemService.renameFile(operation.abs, operation.toAbs);
        } catch {
          // Repli si rename n'est pas disponible : écrire la cible puis supprimer la source.
          await fileSystemService.writeFile(operation.toAbs, operation.content);
          await fileSystemService.deleteFile(operation.abs);
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const restored = await rollback(plan.originals, touched);
      return {
        output: `Erreur apply_patch (ligne ${operation.sectionLine}, ${operation.rel}) : ${message}. ${rollbackNotice(restored)}`,
        isError: true,
      };
    }
  }

  for (const change of plan.changes.values()) {
    // L'UI ne doit jamais faire échouer un patch déjà écrit sur le disque.
    try {
      ctx.onFileChanged?.(change.rel, change.content, change.action);
    } catch {
      // Affichage seulement : le patch reste appliqué.
    }
  }

  const added = sections.reduce((sum, section) => sum + section.added, 0);
  const removed = sections.reduce((sum, section) => sum + section.removed, 0);
  const count = new Set(sections.map((section) => cleanRelative(section.path))).size;
  const lines = [`OK — ${count} fichier${count > 1 ? 's' : ''} : +${added} −${removed}`];
  for (const section of sections) {
    const rel = cleanRelative(section.path);
    const move = section.moveTo ? cleanRelative(section.moveTo) : '';
    if (move) lines.push(`R ${rel} → ${move}`);
    else lines.push(`${section.kind === 'add' ? 'A' : section.kind === 'delete' ? 'D' : 'M'} ${rel}`);
  }
  return { output: lines.join('\n') };
}

function formatError(error: unknown): string {
  if (error instanceof PatchError) {
    return `Erreur apply_patch${error.line !== undefined ? ` (ligne ${error.line})` : ''} : ${error.message}`;
  }
  return `Erreur apply_patch : ${error instanceof Error ? error.message : String(error)}`;
}

export async function execApplyPatch(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const patch = typeof args.patch === 'string' ? args.patch : '';
  if (!patch.trim()) {
    return { output: 'Erreur: fournis un patch entre « *** Begin Patch » et « *** End Patch ».', isError: true };
  }
  if (patch.length > MAX_PATCH_CHARS) {
    return {
      output: `Erreur: patch trop long (${patch.length} caractères, ${MAX_PATCH_CHARS} au plus). Découpe-le en plusieurs appels.`,
      isError: true,
    };
  }

  let sections: PatchSection[];
  let plan: PatchPlan;
  try {
    sections = parsePatch(patch);
    plan = await planPatch(sections, ctx);
  } catch (error) {
    return { output: formatError(error), isError: true };
  }

  try {
    return await executePlan(plan, sections, ctx);
  } catch (error) {
    return { output: formatError(error), isError: true };
  }
}
