/**
 * LintResolver — Détecte et structure les erreurs de compilation/lint
 * depuis la sortie terminal brute.
 *
 * Inspiré de TRAE SOLO qui feed automatiquement les diagnostics
 * au LLM pour auto-correction ciblée.
 *
 * Supporte:
 *  - TypeScript (tsc)
 *  - ESLint / Vite
 *  - Python (SyntaxError, ImportError, ModuleNotFoundError, etc.)
 *  - Node.js runtime errors
 *  - Erreurs génériques (file:line pattern)
 */

// ============================================================================
// TYPES
// ============================================================================

export type ErrorSeverity = 'error' | 'warning';

export interface LintError {
  /** Chemin du fichier concerné */
  file: string;
  /** Numéro de ligne (1-based), undefined si pas détectable */
  line?: number;
  /** Numéro de colonne (1-based) */
  column?: number;
  /** Code d'erreur (TS2345, E0001, etc.) */
  code?: string;
  /** Message d'erreur */
  message: string;
  /** Sévérité */
  severity: ErrorSeverity;
  /** Source du diagnostic (tsc, eslint, python, node, generic) */
  source: string;
}

export interface LintResult {
  /** Toutes les erreurs détectées */
  errors: LintError[];
  /** Nombre d'erreurs */
  errorCount: number;
  /** Nombre de warnings */
  warningCount: number;
  /** Fichiers uniques avec des erreurs */
  affectedFiles: string[];
  /** Résumé compact pour le prompt AI */
  summary: string;
}

// ============================================================================
// PARSERS — un par source de diagnostic
// ============================================================================

/**
 * TypeScript compiler errors (tsc)
 * Format: src/file.ts(12,5): error TS2345: Argument of type...
 * Ou:     src/file.ts:12:5 - error TS2345: Argument of type...
 */
function parseTscErrors(output: string): LintError[] {
  const errors: LintError[] = [];

  // Pattern 1: file(line,col): error TSxxxx: message
  const pattern1 = /([^\s(]+)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern1.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2]),
      column: parseInt(match[3]),
      severity: match[4] as ErrorSeverity,
      code: match[5],
      message: match[6].trim(),
      source: 'tsc',
    });
  }

  // Pattern 2: file:line:col - error TSxxxx: message
  const pattern2 = /([^\s:]+):(\d+):(\d+)\s*-\s*(error|warning)\s+(TS\d+):\s*(.+)/g;
  while ((match = pattern2.exec(output)) !== null) {
    // Avoid duplicates
    const dup = errors.some(e => e.file === match![1] && e.line === parseInt(match![2]) && e.code === match![5]);
    if (!dup) {
      errors.push({
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        severity: match[4] as ErrorSeverity,
        code: match[5],
        message: match[6].trim(),
        source: 'tsc',
      });
    }
  }

  return errors;
}

/**
 * ESLint errors
 * Format: /path/to/file.ts
 *           12:5  error  message  rule-name
 */
function parseEslintErrors(output: string): LintError[] {
  const errors: LintError[] = [];

  // ESLint compact format: file:line:col: message [severity/rule]
  const compactPattern = /([^\s:]+\.[a-z]{1,4}):(\d+):(\d+):\s*(.+?)\s*\[(error|warning)\/([\w-/]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = compactPattern.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2]),
      column: parseInt(match[3]),
      message: match[4].trim(),
      severity: match[5] as ErrorSeverity,
      code: match[6],
      source: 'eslint',
    });
  }

  // ESLint stylish format (multiline):
  // First find file headers, then parse indented errors
  const lines = output.split('\n');
  let currentFile = '';
  for (const line of lines) {
    // File header (absolute or relative path, no leading whitespace)
    const fileMatch = line.match(/^(\/[^\s]+\.[a-z]{1,4}|[a-zA-Z][^\s]*\.[a-z]{1,4})$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }
    // Error line:  12:5  error  msg  rule-name
    if (currentFile) {
      const errMatch = line.match(/^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}([\w-/@]+)\s*$/);
      if (errMatch) {
        errors.push({
          file: currentFile,
          line: parseInt(errMatch[1]),
          column: parseInt(errMatch[2]),
          severity: errMatch[3] as ErrorSeverity,
          message: errMatch[4].trim(),
          code: errMatch[5],
          source: 'eslint',
        });
      }
    }
  }

  return errors;
}

/**
 * Vite/Rollup build errors
 * Format: [vite] error: ... file.ts:12:5
 * Or:     ERROR in ./src/file.ts 12:5
 */
function parseViteErrors(output: string): LintError[] {
  const errors: LintError[] = [];

  // Vite error with file location
  const vitePattern = /(?:\[vite\]|ERROR)\s*(?:in\s+)?([^\s:]+\.[a-z]{1,4})[:\s]+(\d+):(\d+)[\s\S]*?(?:error|Error):\s*(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = vitePattern.exec(output)) !== null) {
    errors.push({
      file: match[1].replace(/^\.\//, ''),
      line: parseInt(match[2]),
      column: parseInt(match[3]),
      message: match[4].trim(),
      severity: 'error',
      source: 'vite',
    });
  }

  // Vite "x]" format: [plugin:name] file.ts:12:5 error message
  const pluginPattern = /\[plugin:[^\]]+\]\s+([^\s:]+\.[a-z]{1,4}):(\d+):(\d+)\s*\n?\s*(.+)/g;
  while ((match = pluginPattern.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2]),
      column: parseInt(match[3]),
      message: match[4].trim(),
      severity: 'error',
      source: 'vite',
    });
  }

  return errors;
}

/**
 * Python errors
 * Format: File "path/to/file.py", line 12
 *           SyntaxError: ...
 * Or:     ModuleNotFoundError: No module named 'xxx'
 */
function parsePythonErrors(output: string): LintError[] {
  const errors: LintError[] = [];

  // Traceback pattern: File "xxx", line N
  const tbPattern = /File "([^"]+)", line (\d+)(?:, in (\w+))?\s*\n\s*.*?\n\s*((?:SyntaxError|IndentationError|TabError|NameError|TypeError|ValueError|AttributeError|ImportError|ModuleNotFoundError|KeyError|IndexError|FileNotFoundError|RuntimeError|ZeroDivisionError|RecursionError|StopIteration|AssertionError|OSError|IOError|PermissionError):\s*.+)/g;
  let match: RegExpExecArray | null;
  while ((match = tbPattern.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2]),
      message: match[4].trim(),
      severity: 'error',
      source: 'python',
    });
  }

  // Simpler: just "File "xxx", line N" followed eventually by an Error
  const simplePattern = /File "([^"]+)", line (\d+)/g;
  while ((match = simplePattern.exec(output)) !== null) {
    const dup = errors.some(e => e.file === match![1] && e.line === parseInt(match![2]));
    if (!dup) {
      // Look ahead for error message
      const after = output.slice(match.index + match[0].length, match.index + match[0].length + 500);
      const errMatch = after.match(/(\w+Error|Exception):\s*(.+)/);
      if (errMatch) {
        errors.push({
          file: match[1],
          line: parseInt(match[2]),
          message: `${errMatch[1]}: ${errMatch[2].trim()}`,
          severity: 'error',
          source: 'python',
        });
      }
    }
  }

  // ModuleNotFoundError without file reference
  const modulePattern = /ModuleNotFoundError:\s*No module named '([^']+)'/g;
  while ((match = modulePattern.exec(output)) !== null) {
    const dup = errors.some(e => e.message.includes(match![1]));
    if (!dup) {
      errors.push({
        file: '<unknown>',
        message: `ModuleNotFoundError: No module named '${match[1]}'`,
        severity: 'error',
        source: 'python',
      });
    }
  }

  return errors;
}

/**
 * Node.js runtime errors
 * Format: /path/file.js:12
 *         ReferenceError: xxx is not defined
 */
function parseNodeErrors(output: string): LintError[] {
  const errors: LintError[] = [];

  const pattern = /(?:at\s+.+\s+\()?([^\s:(]+\.[jt]sx?):(\d+)(?::(\d+))?\)?[\s\S]*?(ReferenceError|TypeError|SyntaxError|RangeError|Error):\s*(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    const dup = errors.some(e => e.file === match![1] && e.line === parseInt(match![2]));
    if (!dup) {
      errors.push({
        file: match[1],
        line: parseInt(match[2]),
        column: match[3] ? parseInt(match[3]) : undefined,
        message: `${match[4]}: ${match[5].trim()}`,
        severity: 'error',
        source: 'node',
      });
    }
  }

  return errors;
}

/**
 * Generic fallback — any "file:line" pattern with error-like text
 */
function parseGenericErrors(output: string): LintError[] {
  const errors: LintError[] = [];

  // file.ext:line:col: error/Error: message
  const pattern = /([a-zA-Z][\w./\\-]*\.[a-z]{1,4}):(\d+)(?::(\d+))?:?\s*(?:error|Error|ERROR)[\s:]+(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2]),
      column: match[3] ? parseInt(match[3]) : undefined,
      message: match[4].trim(),
      severity: 'error',
      source: 'generic',
    });
  }

  return errors;
}

// ============================================================================
// MAIN SERVICE
// ============================================================================

class LintResolverService {
  /**
   * Parse une sortie terminal et extrait toutes les erreurs structurées.
   */
  parse(terminalOutput: string): LintResult {
    // Run all parsers
    const allErrors: LintError[] = [
      ...parseTscErrors(terminalOutput),
      ...parseEslintErrors(terminalOutput),
      ...parseViteErrors(terminalOutput),
      ...parsePythonErrors(terminalOutput),
      ...parseNodeErrors(terminalOutput),
      ...parseGenericErrors(terminalOutput),
    ];

    // Deduplicate by file+line+message
    const seen = new Set<string>();
    const unique: LintError[] = [];
    for (const err of allErrors) {
      const key = `${err.file}:${err.line || 0}:${err.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(err);
      }
    }

    // Sort: errors first, then by file, then by line
    unique.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      return (a.line || 0) - (b.line || 0);
    });

    const errorCount = unique.filter(e => e.severity === 'error').length;
    const warningCount = unique.filter(e => e.severity === 'warning').length;
    const affectedFiles = Array.from(new Set(unique.map(e => e.file).filter(f => f !== '<unknown>')));

    return {
      errors: unique,
      errorCount,
      warningCount,
      affectedFiles,
      summary: this.buildSummary(unique, affectedFiles),
    };
  }

  /**
   * Construit un résumé compact des erreurs pour injection dans le prompt AI.
   * Format optimisé pour que l'IA comprenne rapidement quoi corriger.
   */
  private buildSummary(errors: LintError[], affectedFiles: string[]): string {
    if (errors.length === 0) return '';

    const lines: string[] = [
      `📋 ${errors.length} erreur(s) détectée(s) dans ${affectedFiles.length} fichier(s):`,
      '',
    ];

    // Group by file
    const byFile = new Map<string, LintError[]>();
    for (const err of errors) {
      const list = byFile.get(err.file) || [];
      list.push(err);
      byFile.set(err.file, list);
    }

    for (const [file, fileErrors] of Array.from(byFile.entries())) {
      lines.push(`── ${file} ──`);
      for (const err of fileErrors.slice(0, 10)) { // Max 10 per file
        const loc = err.line ? `L${err.line}${err.column ? `:${err.column}` : ''}` : '?';
        const code = err.code ? ` [${err.code}]` : '';
        lines.push(`  ${loc}: ${err.message}${code}`);
      }
      if (fileErrors.length > 10) {
        lines.push(`  ... et ${fileErrors.length - 10} autres erreurs`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Génère un prompt de fix ciblé pour l'IA, avec les fichiers affectés
   * et les erreurs structurées. Demande un output en search/replace.
   */
  buildFixPrompt(result: LintResult, attempt: number, maxAttempts: number, command: string): string {
    const parts: string[] = [
      `🔧 LINT AUTO-FIX (tentative ${attempt}/${maxAttempts})`,
      '',
      `La commande \`${command}\` a produit des erreurs.`,
      '',
      result.summary,
      '',
      'INSTRUCTIONS:',
      '1. Corrige CHAQUE erreur listée ci-dessus',
      '2. Pour chaque correction, retourne le FICHIER COMPLET corrigé',
      '3. Ne modifie RIEN d\'autre que ce qui cause les erreurs',
      '4. Si une erreur est un import manquant, ajoute-le',
      '5. Si une erreur est un type incorrect, corrige le type',
      '6. Si c\'est un module manquant, ajoute-le aux dépendances',
    ];

    return parts.join('\n');
  }
}

export const lintResolver = new LintResolverService();
