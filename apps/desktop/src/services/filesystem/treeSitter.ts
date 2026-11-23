/**
 * Analyse syntaxique réelle (tree-sitter, WASM) pour la carte du code.
 *
 * Les grammaires sont des assets (`public/wasm/`) chargés **paresseusement**, seulement pour
 * les langages présents dans le projet. Si un WASM manque ou refuse de se charger, l'appel
 * renvoie null et `codeIndexer` garde son extraction regex : l'agent ne perd jamais sa carte.
 *
 * Le module est sans I/O propre : le runtime et les grammaires passent par un chargeur
 * injectable (fetch en production, `fs` dans les tests).
 */
import { Language, Parser, type Node as SyntaxNode } from 'web-tree-sitter';
import type { CodeSymbol, SymbolKind } from './codeIndexer';

type LangId = 'typescript' | 'tsx' | 'javascript' | 'python';

const LANGUAGE_FILES: Record<LangId, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
};

export type WasmLoader = (file: string) => Promise<ArrayBuffer | Uint8Array>;

export interface TreeSitterOptions {
  /** Chargeur des grammaires (défaut : fetch depuis `/wasm/<fichier>`). */
  load?: WasmLoader;
  /** Chemin/URL du runtime `tree-sitter.wasm` (défaut : `/wasm/tree-sitter.wasm`). */
  runtimePath?: string;
}

const parsers = new Map<LangId, Parser>();
const requested = new Set<LangId>();
let runtimeReady = false;
let options: TreeSitterOptions = {};

const defaultLoader: WasmLoader = async (file) => {
  const res = await fetch(`/wasm/${file}`);
  if (!res.ok) throw new Error(`grammaire introuvable : ${file} (${res.status})`);
  return res.arrayBuffer();
};

/** Langage tree-sitter d'un chemin, ou null si non pris en charge. */
export function languageFor(path: string): LangId | null {
  if (/\.(tsx|jsx)$/i.test(path)) return 'tsx';
  if (/\.ts$/i.test(path)) return 'typescript';
  if (/\.(js|mjs|cjs)$/i.test(path)) return 'javascript';
  if (/\.py$/i.test(path)) return 'python';
  return null;
}

/** Langages nécessaires pour un ensemble de fichiers (pour ne charger que ceux-là). */
export function neededLanguages(files: Iterable<string>): LangId[] {
  const out = new Set<LangId>();
  for (const path of files) {
    const lang = languageFor(path);
    if (lang) out.add(lang);
  }
  return [...out];
}

async function loadLanguage(id: LangId): Promise<void> {
  if (parsers.has(id)) return;
  const load = options.load ?? defaultLoader;
  const data = await load(LANGUAGE_FILES[id]);
  const language = await Language.load(data instanceof Uint8Array ? data : new Uint8Array(data));
  const parser = new Parser();
  parser.setLanguage(language);
  parsers.set(id, parser);
  requested.add(id);
}

/**
 * Charge le runtime et les grammaires utiles au projet. Renvoie false (sans lever) si
 * tree-sitter n'est pas disponible : l'indexeur garde alors son extraction regex.
 */
export async function prepareTreeSitter(
  files: Iterable<string>,
  opts: TreeSitterOptions = {},
): Promise<boolean> {
  try {
    if (!runtimeReady) {
      options = opts;
      await Parser.init({ locateFile: () => opts.runtimePath || '/wasm/tree-sitter.wasm' });
      runtimeReady = true;
    }
    const needed = neededLanguages(files);
    if (!needed.length) return true;
    // Une grammaire à la fois : des chargements WASM simultanés se mélangent dans l'éditeur de
    // liens de web-tree-sitter (« bad export type for 'tree_sitter_python_…' », vu sous Node 20).
    for (const id of needed) {
      await loadLanguage(id).catch(() => undefined);
    }
    return needed.every((id) => parsers.has(id));
  } catch {
    return false;
  }
}

/** L'analyse syntaxique est-elle disponible pour ce chemin ? */
export function treeSitterAvailable(path: string): boolean {
  const lang = languageFor(path);
  return !!lang && parsers.has(lang);
}

export const isTreeSitterReady = (): boolean => runtimeReady;

/** Nombre de grammaires chargées (diagnostic/tests). */
export const loadedLanguages = (): LangId[] => [...parsers.keys()];

// ============================================================================
// SYMBOLES
// ============================================================================

/** Type de nœud → catégorie de symbole affichée dans la carte. */
const KIND_BY_TYPE: Record<string, SymbolKind> = {
  function_declaration: 'function',
  generator_function_declaration: 'function',
  function_definition: 'function',
  class_declaration: 'class',
  class_definition: 'class',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  enum_declaration: 'enum',
  lexical_declaration: 'const',
  variable_declaration: 'const',
};

/** Enfants nommés non nuls (les types de web-tree-sitter autorisent null). */
function children(node: SyntaxNode): SyntaxNode[] {
  return node.namedChildren.filter((c): c is SyntaxNode => !!c);
}

function declaredName(node: SyntaxNode): string | null {
  const own = node.childForFieldName('name');
  if (own) return own.text;
  // `const a = …, b = …` : on prend le premier déclarateur nommé.
  const declarator = children(node).find((c) => c.type === 'variable_declarator');
  const name = declarator?.childForFieldName('name');
  return name ? name.text : null;
}

function classify(name: string, kind: SymbolKind, path: string): SymbolKind {
  if (kind !== 'function') return kind;
  if (/^use[A-Z]/.test(name)) return 'hook';
  if (/\.(tsx|jsx)$/i.test(path) && /^[A-Z]/.test(name)) return 'component';
  return kind;
}

function processNode(node: SyntaxNode, path: string, exported: boolean, out: CodeSymbol[]): void {
  if (node.type === 'export_statement') {
    const declaration = node.childForFieldName('declaration');
    if (declaration) processNode(declaration, path, true, out);
    else for (const child of children(node)) processNode(child, path, true, out);
    return;
  }
  if (node.type === 'decorated_definition') {
    for (const child of children(node)) processNode(child, path, exported, out);
    return;
  }
  const kind = KIND_BY_TYPE[node.type];
  if (!kind) return;
  const name = declaredName(node);
  if (!name) return;
  out.push({
    name,
    kind: classify(name, kind, path),
    line: node.startPosition.row + 1,
    exported,
  });
}

/**
 * Symboles d'un fichier via tree-sitter. `null` si la grammaire n'est pas chargée :
 * l'appelant garde son extraction regex.
 */
export function treeSitterSymbols(path: string, content: string): CodeSymbol[] | null {
  const lang = languageFor(path);
  const parser = lang ? parsers.get(lang) : null;
  if (!parser) return null;
  const tree = parser.parse(content);
  if (!tree) return null;
  try {
    const out: CodeSymbol[] = [];
    for (const child of children(tree.rootNode)) processNode(child, path, false, out);
    return out;
  } finally {
    tree.delete();
  }
}

/** Réinitialise l'état (tests uniquement). */
export function resetTreeSitter(): void {
  parsers.clear();
  requested.clear();
  runtimeReady = false;
  options = {};
}
