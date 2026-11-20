/**
 * Outils fichiers : lecture, écriture, édition, suppression, liste, recherche, diagnostics.
 */
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { diagnoseChange, diagnoseFile, formatDiagnostics, languageOf, warmUp } from '@/services/lsp/manager';
import { useSettingsStore } from '@/stores/settingsStore';
import { IGNORED_DIRS, MAX_COMMAND_OUTPUT_CHARS, MAX_FILE_READ_CHARS, MAX_LIST_ENTRIES, MAX_SEARCH_RESULTS, isTextFile, resolvePath, resolveWritePath, truncate } from './shared';
import { ToolExecutionContext, ToolResult } from './types';

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

export async function execGetDiagnostics(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  if (!diagnosticsEnabled()) return { output: 'Diagnostics désactivés dans les Paramètres. Utilise run_command (build, lint) pour vérifier.', isError: true };
  const paths: string[] = (Array.isArray(args.paths) ? args.paths : [args.paths]).filter((p: any) => typeof p === 'string' && p.trim()).slice(0, 8);
  if (!paths.length) return { output: 'Erreur: indique au moins un fichier dans paths.', isError: true };
  const parts: string[] = [];
  for (const path of paths) {
    if (!languageOf(path)) { parts.push(`${path} : langage non pris en charge (TypeScript, JavaScript, Python).`); continue; }
    const text = await fileSystemService.readFile(await resolvePath(ctx.projectRoot, path)).catch(() => null);
    if (text === null) { parts.push(`${path} : fichier introuvable.`); continue; }
    // Demande explicite : on laisse au serveur le temps de démarrer s'il ne tourne pas encore
    const d = await diagnoseFile(ctx.projectRoot, path, text, { waitMs: 25_000 }).catch(() => null);
    parts.push(d ? `${path}\n${formatDiagnostics(d)}` : `${path} : diagnostics indisponibles (serveur en démarrage ou Node.js absent). Vérifie avec run_command.`);
  }
  return { output: parts.join('\n\n') };
}

export async function execReadFile(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const abs = await resolvePath(ctx.projectRoot, args.path);
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

export async function execWriteFile(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const abs = await resolveWritePath(ctx.projectRoot, args.path);
  const existed = await fileSystemService.exists(abs);
  const before = existed && languageOf(String(args.path || '')) ? await fileSystemService.readFile(abs).catch(() => null) : null;
  await fileSystemService.writeFile(abs, args.content ?? '');
  ctx.onFileChanged?.(args.path, args.content ?? '', existed ? 'edit' : 'create');
  const out = `OK — ${existed ? 'fichier remplacé' : 'fichier créé'}: ${args.path} (${(args.content ?? '').length} caractères)`;
  return { output: await withDiagnostics(out, ctx, args.path, before, args.content ?? '') };
}

export async function execEditFile(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const abs = await resolveWritePath(ctx.projectRoot, args.path);
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

export async function execDeleteFile(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const abs = await resolveWritePath(ctx.projectRoot, args.path);
  await fileSystemService.deleteFile(abs);
  ctx.onFileChanged?.(args.path, '', 'delete');
  return { output: `OK — supprimé: ${args.path}` };
}

export async function execListDir(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const abs = await resolvePath(ctx.projectRoot, args.path);
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

export async function execSearchFiles(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const { regex, note } = compileSearchPattern(args.pattern);

  const rootAbs = await resolvePath(ctx.projectRoot, args.path);
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
