/**
 * CodeIndexer — Code Knowledge Graph léger pour ANZAR.
 *
 * Parse les fichiers du projet pour extraire :
 *   - Symboles : fonctions, classes, interfaces, types, constantes, composants React
 *   - Imports / Exports : graphe de dépendances entre fichiers
 *   - Structure : résumé compact du projet pour l'IA
 *
 * Inspiré du CKG de TRAE SOLO (ByteDance) mais sans embeddings —
 * on utilise du parsing regex rapide côté frontend.
 *
 * Usage :
 *   const index = codeIndexer.indexProject(files);
 *   const context = codeIndexer.buildSmartContext(index, userMessage, maxTokens);
 */

// ============================================================================
// TYPES
// ============================================================================

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'const'
  | 'variable'
  | 'component'
  | 'hook'
  | 'route'
  | 'middleware';

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  /** Line number (1-based) where the symbol starts */
  line: number;
  /** Whether it's exported */
  exported: boolean;
  /** JSDoc or comment above the symbol (first line only) */
  doc?: string;
  /** Parameters for functions/hooks (signature) */
  params?: string;
  /** Return type if found */
  returnType?: string;
}

export interface FileImport {
  /** What is imported (names or '*') */
  names: string[];
  /** Where it comes from (relative path or package name) */
  source: string;
  /** Is it a relative import? */
  isRelative: boolean;
  /** Type-only import? */
  isTypeOnly: boolean;
}

export interface FileExport {
  /** Exported names (or 'default') */
  names: string[];
  /** Re-export source if any */
  source?: string;
}

export interface FileIndex {
  /** Relative path */
  path: string;
  /** Detected language */
  language: string;
  /** File size in chars */
  size: number;
  /** Extracted symbols */
  symbols: CodeSymbol[];
  /** Import statements */
  imports: FileImport[];
  /** Export statements */
  exports: FileExport[];
  /** Brief description (from top comment or first JSDoc) */
  description?: string;
  /** Number of lines */
  lineCount: number;
}

export interface DependencyEdge {
  from: string; // importer file path
  to: string;   // imported file path (resolved)
}

export interface ProjectIndex {
  /** Indexed files */
  files: Map<string, FileIndex>;
  /** Dependency graph edges */
  dependencies: DependencyEdge[];
  /** Reverse dependencies (who imports this file) */
  reverseDependencies: Map<string, string[]>;
  /** Project-level stats */
  stats: {
    totalFiles: number;
    totalSymbols: number;
    totalLines: number;
    languages: Record<string, number>;
    topLevelPackages: string[];
  };
  /** Timestamp */
  indexedAt: number;
}

// ============================================================================
// LANGUAGE DETECTION
// ============================================================================

const LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', swift: 'swift', dart: 'dart',
  php: 'php', cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c',
  css: 'css', scss: 'css', html: 'html', vue: 'vue', svelte: 'svelte',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  md: 'markdown', sql: 'sql', graphql: 'graphql', prisma: 'prisma',
  sh: 'shell', bash: 'shell', dockerfile: 'dockerfile',
};

function getLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const name = path.split('/').pop()?.toLowerCase() || '';
  if (name === 'dockerfile') return 'dockerfile';
  return LANG_MAP[ext] || 'other';
}

// ============================================================================
// SYMBOL EXTRACTION — per language
// ============================================================================

/**
 * Extract symbols from TypeScript/JavaScript files.
 * Uses regex patterns — not a full AST parser, but handles 95% of common patterns.
 */
function extractTS(content: string, path: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = content.split('\n');
  const isTSX = path.endsWith('.tsx') || path.endsWith('.jsx');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNum = i + 1;
    const isExported = trimmed.startsWith('export ');
    const clean = isExported ? trimmed.replace(/^export\s+(default\s+)?/, '') : trimmed;

    // Get doc from previous line
    const prevLine = i > 0 ? lines[i - 1]?.trim() : '';
    const doc = prevLine?.startsWith('/**') || prevLine?.startsWith('//') || prevLine?.startsWith('*')
      ? prevLine.replace(/^\/\*\*\s*|\*\/\s*$|^\/\/\s*|^\*\s*/g, '').trim()
      : undefined;

    // ── Functions ──
    let m = clean.match(/^(?:async\s+)?function\s+(\w+)\s*(\([^)]*\))/);
    if (m) {
      symbols.push({ name: m[1], kind: 'function', line: lineNum, exported: isExported, params: m[2], doc });
      continue;
    }

    // ── Arrow / const functions ──
    m = clean.match(/^(?:const|let|var)\s+(\w+)\s*(?::\s*\w[^=]*)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*(?:=>|:\s*\w)/);
    if (m) {
      const name = m[1];
      // Detect React components (PascalCase + TSX file)
      const isPascal = /^[A-Z]/.test(name);
      // Detect hooks (useXxx)
      const isHook = /^use[A-Z]/.test(name);

      if (isHook) {
        symbols.push({ name, kind: 'hook', line: lineNum, exported: isExported, doc });
      } else if (isPascal && isTSX) {
        symbols.push({ name, kind: 'component', line: lineNum, exported: isExported, doc });
      } else {
        symbols.push({ name, kind: 'function', line: lineNum, exported: isExported, doc });
      }
      continue;
    }

    // ── Classes ──
    m = clean.match(/^class\s+(\w+)/);
    if (m) {
      symbols.push({ name: m[1], kind: 'class', line: lineNum, exported: isExported, doc });
      continue;
    }

    // ── Interfaces ──
    m = clean.match(/^interface\s+(\w+)/);
    if (m) {
      symbols.push({ name: m[1], kind: 'interface', line: lineNum, exported: isExported, doc });
      continue;
    }

    // ── Types ──
    m = clean.match(/^type\s+(\w+)\s*[=<]/);
    if (m) {
      symbols.push({ name: m[1], kind: 'type', line: lineNum, exported: isExported, doc });
      continue;
    }

    // ── Enums ──
    m = clean.match(/^enum\s+(\w+)/);
    if (m) {
      symbols.push({ name: m[1], kind: 'enum', line: lineNum, exported: isExported, doc });
      continue;
    }

    // ── Important constants (UPPER_CASE or complex objects) ──
    m = clean.match(/^const\s+([A-Z_][A-Z0-9_]+)\s*[=:]/);
    if (m) {
      symbols.push({ name: m[1], kind: 'const', line: lineNum, exported: isExported, doc });
      continue;
    }

    // ── React functional components (function declaration) ──
    m = clean.match(/^(?:async\s+)?function\s+([A-Z]\w+)\s*\(/);
    if (m && isTSX) {
      // Already caught by function regex above, but mark as component
      const existing = symbols.find(s => s.name === m![1] && s.line === lineNum);
      if (existing) existing.kind = 'component';
    }
  }

  return symbols;
}

/**
 * Extract symbols from Python files.
 */
function extractPython(content: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNum = i + 1;
    const isTopLevel = !line.startsWith(' ') && !line.startsWith('\t');

    // Doc from previous line
    const prevLine = i > 0 ? lines[i - 1]?.trim() : '';
    const doc = prevLine?.startsWith('#') ? prevLine.replace(/^#\s*/, '').trim() : undefined;

    // ── Functions ──
    let m = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
    if (m && isTopLevel) {
      const name = m[1];
      const kind: SymbolKind = name.startsWith('__') ? 'function' : 'function';
      symbols.push({ name, kind, line: lineNum, exported: !name.startsWith('_'), params: `(${m[2]})`, doc });
      continue;
    }

    // ── Classes ──
    m = trimmed.match(/^class\s+(\w+)/);
    if (m && isTopLevel) {
      symbols.push({ name: m[1], kind: 'class', line: lineNum, exported: !m[1].startsWith('_'), doc });
      continue;
    }

    // ── Route decorators (FastAPI / Flask) ──
    m = trimmed.match(/^@(?:app|router)\.\s*(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/);
    if (m) {
      const nextLine = i + 1 < lines.length ? lines[i + 1]?.trim() : '';
      const fnMatch = nextLine?.match(/^(?:async\s+)?def\s+(\w+)/);
      if (fnMatch) {
        symbols.push({
          name: fnMatch[1],
          kind: 'route',
          line: lineNum + 1,
          exported: true,
          doc: `${m[1].toUpperCase()} ${m[2]}`,
        });
      }
    }

    // ── Top-level constants ──
    m = trimmed.match(/^([A-Z_][A-Z0-9_]+)\s*=/);
    if (m && isTopLevel) {
      symbols.push({ name: m[1], kind: 'const', line: lineNum, exported: true, doc });
    }
  }

  return symbols;
}

/**
 * Generic fallback — extract obvious patterns from any language.
 */
function extractGeneric(content: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    // Functions in various langs
    let m = line.match(/^(?:pub\s+)?(?:fn|func|fun|def)\s+(\w+)\s*\(/);
    if (m) {
      symbols.push({ name: m[1], kind: 'function', line: lineNum, exported: line.startsWith('pub') });
      continue;
    }

    // Structs/classes
    m = line.match(/^(?:pub\s+)?(?:struct|class|data class)\s+(\w+)/);
    if (m) {
      symbols.push({ name: m[1], kind: 'class', line: lineNum, exported: line.startsWith('pub') });
    }
  }

  return symbols;
}

// ============================================================================
// IMPORT / EXPORT EXTRACTION
// ============================================================================

function extractImports(content: string, language: string): FileImport[] {
  const imports: FileImport[] = [];

  if (language === 'typescript' || language === 'javascript') {
    // ES imports: import { X } from 'y' / import X from 'y' / import * as X from 'y'
    const importRegex = /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\*\s+as\s+\w+)|(\w+)(?:\s*,\s*\{([^}]+)\})?)\s+from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = importRegex.exec(content)) !== null) {
      const names: string[] = [];
      if (m[1]) names.push(...m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean));
      if (m[2]) names.push(m[2].trim());
      if (m[3]) names.push(m[3]);
      if (m[4]) names.push(...m[4].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean));

      const source = m[5];
      imports.push({
        names,
        source,
        isRelative: source.startsWith('.') || source.startsWith('@/'),
        isTypeOnly: m[0].includes('import type'),
      });
    }

    // require() calls
    const requireRegex = /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = requireRegex.exec(content)) !== null) {
      const names = m[1]
        ? m[1].split(',').map(s => s.trim()).filter(Boolean)
        : [m[2]];
      imports.push({ names, source: m[3], isRelative: m[3].startsWith('.'), isTypeOnly: false });
    }
  }

  if (language === 'python') {
    // from X import Y, Z
    const fromImportRegex = /^from\s+(\S+)\s+import\s+(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = fromImportRegex.exec(content)) !== null) {
      const names = m[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      const source = m[1];
      imports.push({ names, source, isRelative: source.startsWith('.'), isTypeOnly: false });
    }
    // import X
    const importRegex = /^import\s+(\S+)(?:\s+as\s+\w+)?$/gm;
    while ((m = importRegex.exec(content)) !== null) {
      imports.push({ names: [m[1]], source: m[1], isRelative: m[1].startsWith('.'), isTypeOnly: false });
    }
  }

  return imports;
}

function extractExports(content: string, language: string): FileExport[] {
  const exports: FileExport[] = [];

  if (language === 'typescript' || language === 'javascript') {
    // export default
    if (/export\s+default\s+/.test(content)) {
      exports.push({ names: ['default'] });
    }

    // export { X, Y } from '...'
    const reExportRegex = /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = reExportRegex.exec(content)) !== null) {
      const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      exports.push({ names, source: m[2] });
    }

    // Named exports (export const/function/class/etc)
    const namedExportRegex = /export\s+(?:const|let|var|function|class|interface|type|enum|async\s+function)\s+(\w+)/g;
    while ((m = namedExportRegex.exec(content)) !== null) {
      exports.push({ names: [m[1]] });
    }
  }

  return exports;
}

// ============================================================================
// FILE DESCRIPTION EXTRACTION
// ============================================================================

function extractDescription(content: string): string | undefined {
  const lines = content.split('\n');
  // Look for top-level JSDoc or comment block
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i].trim();
    if (line.startsWith('/**')) {
      // Multi-line JSDoc — grab first meaningful line
      for (let j = i; j < Math.min(lines.length, i + 5); j++) {
        const docLine = lines[j].trim().replace(/^\/\*\*\s*|\*\/\s*$|^\*\s*/g, '').trim();
        if (docLine.length > 10 && !docLine.startsWith('@')) return docLine;
      }
    }
    if (line.startsWith('//') && !line.startsWith('///') && !line.startsWith('//!')) {
      const comment = line.replace(/^\/\/\s*/, '').trim();
      if (comment.length > 10) return comment;
    }
    // Python docstrings
    if (line.startsWith('"""') || line.startsWith("'''")) {
      const doc = line.replace(/^["']{3}\s*/, '').replace(/["']{3}\s*$/, '').trim();
      if (doc.length > 10) return doc;
      if (i + 1 < lines.length) {
        return lines[i + 1].trim().replace(/["']{3}\s*$/, '').trim() || undefined;
      }
    }
    // Python comments
    if (line.startsWith('#') && !line.startsWith('#!')) {
      const comment = line.replace(/^#\s*/, '').trim();
      if (comment.length > 10) return comment;
    }
  }
  return undefined;
}

// ============================================================================
// IMPORT RESOLUTION — resolve relative imports to file paths
// ============================================================================

function resolveImportPath(
  importSource: string,
  importerPath: string,
  allPaths: Set<string>,
): string | null {
  if (!importSource.startsWith('.') && !importSource.startsWith('@/')) return null;

  // Handle @/ alias → src/
  let resolved = importSource;
  if (resolved.startsWith('@/')) {
    resolved = 'src/' + resolved.slice(2);
  } else {
    // Relative path resolution
    const importerDir = importerPath.substring(0, importerPath.lastIndexOf('/'));
    const parts = importerDir.split('/');
    for (const segment of resolved.split('/')) {
      if (segment === '..') parts.pop();
      else if (segment !== '.') parts.push(segment);
    }
    resolved = parts.join('/');
  }

  // Try extensions
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '.py'];
  for (const ext of extensions) {
    if (allPaths.has(resolved + ext)) return resolved + ext;
  }
  return null;
}

// ============================================================================
// MAIN INDEXER
// ============================================================================

class CodeIndexerService {
  /**
   * Index all project files and build the knowledge graph.
   */
  indexProject(files: Record<string, string>): ProjectIndex {
    const fileIndexMap = new Map<string, FileIndex>();
    const allPaths = new Set(Object.keys(files));
    const langCounts: Record<string, number> = {};
    const packages = new Set<string>();
    let totalSymbols = 0;
    let totalLines = 0;

    // ── Phase 1: Index each file ──
    for (const [path, content] of Object.entries(files)) {
      const language = getLang(path);
      const lineCount = content.split('\n').length;
      totalLines += lineCount;

      // Extract symbols based on language
      let symbols: CodeSymbol[];
      if (language === 'typescript' || language === 'javascript') {
        symbols = extractTS(content, path);
      } else if (language === 'python') {
        symbols = extractPython(content);
      } else if (['go', 'rust', 'java', 'kotlin', 'dart', 'swift'].includes(language)) {
        symbols = extractGeneric(content);
      } else {
        symbols = [];
      }

      const imports = extractImports(content, language);
      const exports = extractExports(content, language);
      const description = extractDescription(content);

      // Collect external packages
      for (const imp of imports) {
        if (!imp.isRelative) packages.add(imp.source.split('/')[0]);
      }

      totalSymbols += symbols.length;
      langCounts[language] = (langCounts[language] || 0) + 1;

      fileIndexMap.set(path, {
        path,
        language,
        size: content.length,
        symbols,
        imports,
        exports,
        description,
        lineCount,
      });
    }

    // ── Phase 2: Build dependency graph ──
    const dependencies: DependencyEdge[] = [];
    const reverseDeps = new Map<string, string[]>();

    for (const [path, fileIdx] of fileIndexMap) {
      for (const imp of fileIdx.imports) {
        const resolvedPath = resolveImportPath(imp.source, path, allPaths);
        if (resolvedPath) {
          dependencies.push({ from: path, to: resolvedPath });

          if (!reverseDeps.has(resolvedPath)) reverseDeps.set(resolvedPath, []);
          reverseDeps.get(resolvedPath)!.push(path);
        }
      }
    }

    return {
      files: fileIndexMap,
      dependencies,
      reverseDependencies: reverseDeps,
      stats: {
        totalFiles: fileIndexMap.size,
        totalSymbols,
        totalLines,
        languages: langCounts,
        topLevelPackages: [...packages].sort(),
      },
      indexedAt: Date.now(),
    };
  }

  // ==========================================================================
  // SMART CONTEXT — build the best context for the AI given a user message
  // ==========================================================================

  /**
   * Build an intelligent context string for the AI based on:
   * 1. The user's message (keyword matching)
   * 2. The dependency graph (include related files)
   * 3. File importance (more exports = more important)
   *
   * Returns a compact representation that fits within maxChars.
   */
  buildSmartContext(
    index: ProjectIndex,
    userMessage: string,
    currentFiles: Record<string, string>,
    maxChars: number = 80000,
  ): { context: string; relevantFiles: string[]; projectMap: string } {
    // ── 1. Score each file by relevance ──
    const scores = new Map<string, number>();
    const msgLower = userMessage.toLowerCase();
    const msgWords = msgLower.split(/\s+/).filter(w => w.length > 2);

    for (const [path, fileIdx] of index.files) {
      let score = 0;

      // Path mention in message
      const fileName = path.split('/').pop()?.replace(/\.\w+$/, '').toLowerCase() || '';
      if (msgLower.includes(fileName) && fileName.length > 2) score += 50;

      // Symbol name mention in message
      for (const sym of fileIdx.symbols) {
        const symLower = sym.name.toLowerCase();
        if (msgLower.includes(symLower) && symLower.length > 2) score += 30;
        // Partial match for camelCase
        const symWords = symLower.replace(/([A-Z])/g, ' $1').toLowerCase().split(/\s+/);
        for (const w of msgWords) {
          if (symWords.some(sw => sw.includes(w) || w.includes(sw))) score += 5;
        }
      }

      // Description match
      if (fileIdx.description) {
        const descLower = fileIdx.description.toLowerCase();
        for (const w of msgWords) {
          if (descLower.includes(w)) score += 10;
        }
      }

      // Keyword matching for common intents
      if (msgLower.includes('style') || msgLower.includes('css') || msgLower.includes('design')) {
        if (fileIdx.language === 'css' || path.includes('style') || path.includes('theme')) score += 20;
      }
      if (msgLower.includes('route') || msgLower.includes('api') || msgLower.includes('endpoint')) {
        if (fileIdx.symbols.some(s => s.kind === 'route') || path.includes('route')) score += 20;
      }
      if (msgLower.includes('composant') || msgLower.includes('component') || msgLower.includes('bouton') || msgLower.includes('button')) {
        if (fileIdx.symbols.some(s => s.kind === 'component')) score += 15;
      }

      // Importance: more exports + more reverse deps = hub file
      const reverseDepsCount = index.reverseDependencies.get(path)?.length || 0;
      score += reverseDepsCount * 3;
      score += fileIdx.exports.length * 2;

      // Penalty for very large files (they eat context)
      if (fileIdx.size > 10000) score -= 5;
      if (fileIdx.size > 20000) score -= 10;

      // Penalty for config/json files
      if (fileIdx.language === 'json' || fileIdx.language === 'yaml') score -= 15;

      scores.set(path, score);
    }

    // ── 2. Rank and select files ──
    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1]);

    // Always include files directly mentioned or with high scores
    const selectedPaths: string[] = [];
    let usedChars = 0;
    const projectMapLines: string[] = [];

    // First pass: high-relevance files (score > 10) get full content
    for (const [path, score] of ranked) {
      if (score <= 0) continue;
      const content = currentFiles[path];
      if (!content) continue;

      // Include related files (dependencies and reverse deps)
      if (score >= 20) {
        // Add direct dependencies
        for (const dep of index.dependencies) {
          if (dep.from === path && !selectedPaths.includes(dep.to)) {
            const depContent = currentFiles[dep.to];
            if (depContent && usedChars + depContent.length < maxChars * 0.8) {
              selectedPaths.push(dep.to);
              usedChars += depContent.length;
            }
          }
        }
        // Add reverse dependencies (files that import this one)
        const revDeps = index.reverseDependencies.get(path) || [];
        for (const rdPath of revDeps) {
          if (!selectedPaths.includes(rdPath)) {
            const rdContent = currentFiles[rdPath];
            if (rdContent && usedChars + rdContent.length < maxChars * 0.6) {
              selectedPaths.push(rdPath);
              usedChars += rdContent.length;
            }
          }
        }
      }

      if (!selectedPaths.includes(path) && usedChars + content.length < maxChars) {
        selectedPaths.push(path);
        usedChars += content.length;
      }
    }

    // If nothing scored high, include all files that fit
    if (selectedPaths.length === 0) {
      for (const [path] of ranked) {
        const content = currentFiles[path];
        if (!content) continue;
        if (usedChars + content.length < maxChars) {
          selectedPaths.push(path);
          usedChars += content.length;
        }
      }
    }

    // ── 3. Build project map (compact overview of ALL files) ──
    for (const [path, fileIdx] of index.files) {
      const syms = fileIdx.symbols
        .filter(s => s.exported || s.kind === 'component' || s.kind === 'route')
        .map(s => {
          const prefix = s.kind === 'component' ? '⚛' :
            s.kind === 'route' ? '⟶' :
            s.kind === 'hook' ? '⟳' :
            s.kind === 'class' ? '◆' :
            s.kind === 'interface' || s.kind === 'type' ? '◇' :
            s.kind === 'function' ? 'ƒ' : '•';
          return `${prefix}${s.name}`;
        });

      const desc = fileIdx.description ? ` — ${fileIdx.description.substring(0, 60)}` : '';
      const deps = index.reverseDependencies.get(path)?.length || 0;
      const depsStr = deps > 0 ? ` [${deps} importers]` : '';

      projectMapLines.push(
        `${path} (${fileIdx.lineCount}L)${desc}${depsStr}${syms.length > 0 ? '\n  ' + syms.join(', ') : ''}`
      );
    }

    // ── 4. Build final context string ──
    const contextParts: string[] = [];
    contextParts.push(`=== PROJET: ${index.stats.totalFiles} fichiers, ${index.stats.totalLines} lignes ===`);
    contextParts.push(`Langages: ${Object.entries(index.stats.languages).map(([l, c]) => `${l}(${c})`).join(', ')}`);
    contextParts.push(`Packages: ${index.stats.topLevelPackages.slice(0, 20).join(', ')}`);
    contextParts.push('');

    // Include full content of selected files
    for (const path of selectedPaths) {
      const content = currentFiles[path];
      if (!content) continue;
      contextParts.push(`--- ${path} ---`);
      contextParts.push(content);
      contextParts.push('');
    }

    return {
      context: contextParts.join('\n'),
      relevantFiles: selectedPaths,
      projectMap: projectMapLines.join('\n'),
    };
  }

  /**
   * Generate a compact project map string — useful as a permanent context header
   * for the AI so it always knows what the project looks like.
   */
  generateProjectMap(index: ProjectIndex): string {
    const lines: string[] = [
      `# Project Map (${index.stats.totalFiles} files, ${index.stats.totalLines} lines)`,
      `Languages: ${Object.entries(index.stats.languages).map(([l, c]) => `${l}(${c})`).join(', ')}`,
      '',
    ];

    // Group by directory
    const dirs = new Map<string, FileIndex[]>();
    for (const [, fileIdx] of index.files) {
      const dir = fileIdx.path.substring(0, fileIdx.path.lastIndexOf('/')) || '.';
      if (!dirs.has(dir)) dirs.set(dir, []);
      dirs.get(dir)!.push(fileIdx);
    }

    for (const [dir, fileIdxs] of [...dirs.entries()].sort()) {
      lines.push(`## ${dir}/`);
      for (const f of fileIdxs) {
        const exported = f.symbols.filter(s => s.exported);
        const syms = exported.map(s => s.name).join(', ');
        const desc = f.description ? ` — ${f.description.substring(0, 50)}` : '';
        const fileName = f.path.split('/').pop() || f.path;
        lines.push(`  ${fileName} (${f.lineCount}L)${desc}${syms ? ' [' + syms + ']' : ''}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Find files affected by a change to a given file.
   * Returns the chain of dependents up to `depth` levels.
   */
  findAffectedFiles(index: ProjectIndex, changedFile: string, depth: number = 2): string[] {
    const affected = new Set<string>();
    const queue = [changedFile];
    let currentDepth = 0;

    while (queue.length > 0 && currentDepth < depth) {
      const nextQueue: string[] = [];
      for (const file of queue) {
        const importers = index.reverseDependencies.get(file) || [];
        for (const importer of importers) {
          if (!affected.has(importer) && importer !== changedFile) {
            affected.add(importer);
            nextQueue.push(importer);
          }
        }
      }
      queue.length = 0;
      queue.push(...nextQueue);
      currentDepth++;
    }

    return [...affected];
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const codeIndexer = new CodeIndexerService();
