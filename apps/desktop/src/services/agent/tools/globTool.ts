/**
 * Outil `glob` : trouve des fichiers par motif de chemin, sans lire leur contenu.
 *
 * Le convertisseur glob → RegExp est pur et testé : `*` reste dans un segment,
 * `**` traverse les dossiers, `?` remplace un caractère et `{a,b}` propose des
 * alternatives simples. Aucune dépendance externe.
 */
import type { FileNode } from '@/types/file-project';
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { resolvePath } from './shared';
import type { ToolExecutionContext, ToolResult } from './types';

export const DEFAULT_GLOB_LIMIT = 100;
export const MAX_GLOB_LIMIT = 500;
/** Profondeur de lecture : assez pour un projet courant, sans crawl infini. */
export const GLOB_TREE_DEPTH = 8;

const escapeRegExp = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Convertit un motif glob en source RegExp ancrée.
 * `**\/` accepte zéro dossier (donc `**\/*.ts` trouve aussi `a.ts` à la racine).
 */
export function globToRegExpSource(pattern: string): string {
  const src = String(pattern ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '*') {
      if (src[i + 1] === '*') {
        while (src[i + 1] === '*') i++;
        if (src[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '{') {
      const end = src.indexOf('}', i + 1);
      if (end === -1) {
        out += '\\{';
        continue;
      }
      const alternatives = src.slice(i + 1, end).split(',');
      out += `(?:${alternatives.map((part) => globToRegExpSource(part)).join('|')})`;
      i = end;
    } else {
      out += escapeRegExp(ch);
    }
  }
  return out;
}

/** Motif glob classique → RegExp ancrée (sensible à la casse, comme un shell). */
export function globToRegExp(pattern: string): RegExp {
  return new RegExp(`^${globToRegExpSource(pattern)}$`);
}

/** Aplatit une arborescence de fichiers en chemins absolus (fichiers seulement). */
export function flattenFilePaths(nodes: FileNode[]): string[] {
  const paths: string[] = [];
  const walk = (list: FileNode[]) => {
    for (const node of list || []) {
      if (node.type === 'file') paths.push(node.path);
      else if (Array.isArray(node.children)) walk(node.children);
    }
  };
  walk(nodes);
  return paths;
}

/** Segments utiles d'un chemin relatif : ni vides, ni `.`. */
function cleanRelative(path: string): string {
  return String(path ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg && seg !== '.')
    .join('/');
}

/**
 * Chemin affiché, relatif à la racine du projet.
 * On repart du dossier interrogé puis on préfixe `path` : un dossier canonisé
 * (lien symbolique) reste ainsi présenté avec le chemin demandé par l'agent.
 */
export function projectRelativePath(projectRoot: string, searchRoot: string, pathArg: string, absPath: string): string {
  const root = searchRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const project = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const abs = absPath.replace(/\\/g, '/');
  if (!abs.startsWith(`${root}/`)) {
    // Arborescence déjà exprimée depuis la racine (service qui canonise le dossier) :
    // on ne préfixe pas deux fois le chemin demandé.
    if (project && abs.startsWith(`${project}/`)) return cleanRelative(abs.slice(project.length + 1));
    return cleanRelative(abs);
  }
  const rel = cleanRelative(abs.slice(root.length + 1));
  const prefix = cleanRelative(pathArg);
  if (!prefix || prefix === '.') return rel;
  return rel ? `${prefix}/${rel}` : prefix;
}

export async function execGlob(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const pattern = String(args.pattern ?? '').trim();
  if (!pattern) {
    return { output: 'Erreur: indique un motif glob, par exemple « **/*.ts » ou « src/*.tsx ».', isError: true };
  }

  const requestedPath = typeof args.path === 'string' && args.path.trim() ? args.path : '.';
  const requestedLimit = Number(args.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), MAX_GLOB_LIMIT)
    : DEFAULT_GLOB_LIMIT;

  let regex: RegExp;
  try {
    regex = globToRegExp(pattern);
  } catch {
    return { output: `Erreur: motif glob invalide: ${pattern}. Vérifie les accolades, par exemple « src/**/*.{ts,tsx} ».`, isError: true };
  }

  let absRoot: string;
  try {
    absRoot = await resolvePath(ctx.projectRoot, requestedPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { output: `Erreur glob: chemin refusé (${msg}). Utilise un dossier relatif au projet.`, isError: true };
  }

  let tree: FileNode[];
  try {
    tree = await fileSystemService.readDirectoryTree(absRoot, GLOB_TREE_DEPTH, { throwOnError: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      output: `Erreur glob: impossible de lire « ${requestedPath} » (${msg}). Vérifie que le dossier existe et reste dans le projet.`,
      isError: true,
    };
  }

  const matches = flattenFilePaths(tree)
    .map((abs) => ({
      rel: projectRelativePath(ctx.projectRoot, absRoot, requestedPath, abs),
      searchRel: projectRelativePath(ctx.projectRoot, absRoot, '.', abs),
    }))
    // Motif exprimé depuis la racine du projet (« src/*.ts ») ou depuis le dossier
    // demandé (« *.ts » avec path: "src") : les deux usages sont acceptés.
    .filter(({ rel, searchRel }) => regex.test(rel) || (searchRel !== rel && regex.test(searchRel)))
    .map(({ rel }) => rel)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (matches.length === 0) {
    return {
      output: `Aucun fichier ne correspond à « ${pattern} » dans « ${requestedPath} » ; vérifie le motif ou le dossier.`,
    };
  }

  const shown = matches.slice(0, limit);
  const hidden = matches.length - shown.length;
  const suffix = hidden > 0
    ? `\n… ${hidden} autres fichiers (augmente limit ou précise path)`
    : '';
  return { output: shown.join('\n') + suffix };
}
