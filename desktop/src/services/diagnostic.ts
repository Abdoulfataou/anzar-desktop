/**
 * DiagnosticService — Analyse intelligente des erreurs et résolution automatique
 *
 * Ce service :
 * 1. Parse les sorties terminal (stdout/stderr) pour détecter les erreurs
 * 2. Classifie les types d'erreurs (dépendance manquante, syntaxe, port, permission...)
 * 3. Envoie le contexte à l'IA (DeepSeek) pour obtenir une explication + solution
 * 4. Propose des actions automatiques (installer un package, corriger un fichier, etc.)
 */

import { aiRouter } from './router';
import { getSystemPrompt } from './prompts';
import { terminalService, ProcessOutput } from './terminal';

// ============================================================================
// TYPES
// ============================================================================

export type ErrorCategory =
  | 'missing_dependency'    // Module/package not found
  | 'syntax_error'          // Code syntax error
  | 'type_error'            // TypeScript/type error
  | 'port_conflict'         // Port already in use
  | 'permission_denied'     // File/directory permission
  | 'file_not_found'        // File or module path missing
  | 'build_error'           // Build/compilation failed
  | 'runtime_error'         // Runtime crash
  | 'network_error'         // Connection/fetch failed
  | 'config_error'          // Config/env misconfiguration
  | 'version_mismatch'      // Incompatible versions
  | 'unknown';

export interface DiagnosticError {
  id: string;
  category: ErrorCategory;
  severity: 'error' | 'warning' | 'info';
  rawMessage: string;
  parsedInfo: {
    file?: string;
    line?: number;
    column?: number;
    moduleName?: string;
    expectedVersion?: string;
    port?: number;
  };
  timestamp: number;
}

export interface DiagnosticSolution {
  id: string;
  errorId: string;
  title: string;
  description: string;
  confidence: number; // 0-1
  autoFixable: boolean;
  fixAction?: {
    type: 'command' | 'edit_file' | 'install_package' | 'config_change';
    command?: string;
    filePath?: string;
    content?: string;
    packageName?: string;
    packageManager?: 'npm' | 'pip' | 'cargo';
  };
  aiExplanation?: string;
}

export interface DiagnosticReport {
  errors: DiagnosticError[];
  solutions: DiagnosticSolution[];
  summary: string;
  generatedAt: number;
}

// ============================================================================
// ERROR PATTERNS
// ============================================================================

interface ErrorPattern {
  regex: RegExp;
  category: ErrorCategory;
  severity: 'error' | 'warning';
  extract: (match: RegExpMatchArray) => DiagnosticError['parsedInfo'];
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // ─── Missing Dependencies ───
  {
    regex: /Cannot find module ['"](.+?)['"]/i,
    category: 'missing_dependency',
    severity: 'error',
    extract: (m) => ({ moduleName: m[1] }),
  },
  {
    regex: /Module not found.*['"](.+?)['"]/i,
    category: 'missing_dependency',
    severity: 'error',
    extract: (m) => ({ moduleName: m[1] }),
  },
  {
    regex: /ModuleNotFoundError: No module named ['"](.+?)['"]/i,
    category: 'missing_dependency',
    severity: 'error',
    extract: (m) => ({ moduleName: m[1] }),
  },
  {
    regex: /npm ERR! missing:.*?(\S+)@/i,
    category: 'missing_dependency',
    severity: 'error',
    extract: (m) => ({ moduleName: m[1] }),
  },
  {
    regex: /error\[E0432\]: unresolved import `(.+?)`/i,
    category: 'missing_dependency',
    severity: 'error',
    extract: (m) => ({ moduleName: m[1] }),
  },

  // ─── Syntax Errors ───
  {
    regex: /SyntaxError:\s*(.+?)(?:\s+\((\d+):(\d+)\))?/i,
    category: 'syntax_error',
    severity: 'error',
    extract: (m) => ({ line: m[2] ? parseInt(m[2]) : undefined, column: m[3] ? parseInt(m[3]) : undefined }),
  },
  {
    regex: /Parsing error:\s*(.+?)(?:\s+at\s+(.+?):(\d+):(\d+))?/i,
    category: 'syntax_error',
    severity: 'error',
    extract: (m) => ({ file: m[2], line: m[3] ? parseInt(m[3]) : undefined, column: m[4] ? parseInt(m[4]) : undefined }),
  },

  // ─── Type Errors ───
  {
    regex: /(?:TS|Type)Error:\s*(.+?)(?:\s+at\s+(.+?):(\d+))?/i,
    category: 'type_error',
    severity: 'error',
    extract: (m) => ({ file: m[2], line: m[3] ? parseInt(m[3]) : undefined }),
  },
  {
    regex: /error TS(\d+):\s*(.+?)(?:\s+in\s+(.+?)\((\d+),(\d+)\))?/i,
    category: 'type_error',
    severity: 'error',
    extract: (m) => ({ file: m[3], line: m[4] ? parseInt(m[4]) : undefined, column: m[5] ? parseInt(m[5]) : undefined }),
  },

  // ─── Port Conflicts ───
  {
    regex: /(?:EADDRINUSE|address already in use).*?(?::(\d+))?/i,
    category: 'port_conflict',
    severity: 'error',
    extract: (m) => ({ port: m[1] ? parseInt(m[1]) : undefined }),
  },
  {
    regex: /Port (\d+) is already in use/i,
    category: 'port_conflict',
    severity: 'error',
    extract: (m) => ({ port: parseInt(m[1]) }),
  },

  // ─── Permission Errors ───
  {
    regex: /(?:EACCES|Permission denied|EPERM).*?['"]?(.+?)['"]?$/i,
    category: 'permission_denied',
    severity: 'error',
    extract: (m) => ({ file: m[1] }),
  },

  // ─── File Not Found ───
  {
    regex: /(?:ENOENT|no such file or directory).*?['"]?(.+?)['"]?$/i,
    category: 'file_not_found',
    severity: 'error',
    extract: (m) => ({ file: m[1] }),
  },

  // ─── Build Errors ───
  {
    regex: /(?:Build failed|Compilation failed|ERROR in|Failed to compile)/i,
    category: 'build_error',
    severity: 'error',
    extract: () => ({}),
  },
  {
    regex: /error\[E\d+\]:\s*(.+)/i,
    category: 'build_error',
    severity: 'error',
    extract: () => ({}),
  },

  // ─── Network Errors ───
  {
    regex: /(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|network error)/i,
    category: 'network_error',
    severity: 'error',
    extract: () => ({}),
  },

  // ─── Version Mismatch ───
  {
    regex: /(?:version|peer dep).*?requires.*?(\d+\.\d+)/i,
    category: 'version_mismatch',
    severity: 'warning',
    extract: (m) => ({ expectedVersion: m[1] }),
  },

  // ─── Config Errors ───
  {
    regex: /(?:Config|Configuration) error|(?:env|environment) (?:variable|var).*(?:not set|missing|undefined)/i,
    category: 'config_error',
    severity: 'error',
    extract: () => ({}),
  },
];

// ============================================================================
// DIAGNOSTIC SERVICE
// ============================================================================

class DiagnosticService {
  private detectedErrors: Map<string, DiagnosticError> = new Map();
  private solutions: Map<string, DiagnosticSolution> = new Map();
  private isMonitoring = false;
  private unsubscribe: (() => void) | null = null;

  /**
   * Start monitoring terminal output for errors
   */
  startMonitoring(): void {
    if (this.isMonitoring) return;
    this.isMonitoring = true;

    this.unsubscribe = terminalService.onEvent((event) => {
      if (event.type === 'output') {
        const { data } = event;
        if (data.type === 'stderr' || data.type === 'error') {
          this.analyzeOutput(data);
        }
        // Also check stdout for error patterns (some tools output errors to stdout)
        if (data.type === 'stdout' && this.looksLikeError(data.content)) {
          this.analyzeOutput(data);
        }
      }
    });
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    this.isMonitoring = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Analyze a single output line for errors
   */
  private analyzeOutput(output: ProcessOutput): void {
    for (const pattern of ERROR_PATTERNS) {
      const match = output.content.match(pattern.regex);
      if (match) {
        const error: DiagnosticError = {
          id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          category: pattern.category,
          severity: pattern.severity,
          rawMessage: output.content,
          parsedInfo: pattern.extract(match),
          timestamp: output.timestamp,
        };

        // Avoid duplicates (same category + same module/file within 5s)
        const isDuplicate = Array.from(this.detectedErrors.values()).some(
          (e) =>
            e.category === error.category &&
            e.parsedInfo.moduleName === error.parsedInfo.moduleName &&
            e.parsedInfo.file === error.parsedInfo.file &&
            error.timestamp - e.timestamp < 5000
        );

        if (!isDuplicate) {
          this.detectedErrors.set(error.id, error);
        }
        break; // Stop at first match
      }
    }
  }

  /**
   * Check if stdout content looks like an error
   */
  private looksLikeError(content: string): boolean {
    const errorSignals = [
      /\berror\b/i,
      /\bfailed\b/i,
      /\bERR!\b/,
      /\bFATAL\b/,
      /\bpanic\b/i,
      /\bException\b/,
    ];
    return errorSignals.some((r) => r.test(content));
  }

  /**
   * Analyze all collected terminal output and generate a diagnostic report
   */
  async analyzeErrors(
    terminalOutput: string,
    options: {
      projectPath?: string;
      packageJson?: string;
      relevantFileContent?: string;
    } = {}
  ): Promise<DiagnosticReport> {
    // 1. Parse errors from terminal output
    const errors: DiagnosticError[] = [];
    const lines = terminalOutput.split('\n');

    for (const line of lines) {
      for (const pattern of ERROR_PATTERNS) {
        const match = line.match(pattern.regex);
        if (match) {
          errors.push({
            id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            category: pattern.category,
            severity: pattern.severity,
            rawMessage: line,
            parsedInfo: pattern.extract(match),
            timestamp: Date.now(),
          });
          break;
        }
      }
    }

    // 2. Generate quick fixes for known patterns
    const quickSolutions = this.generateQuickFixes(errors);

    // 3. Ask AI for deeper analysis
    let aiSolutions: DiagnosticSolution[] = [];
    let summary = '';

    if (errors.length > 0) {
      try {
        const aiResult = await this.askAIForDiagnosis(errors, terminalOutput, options);
        aiSolutions = aiResult.solutions;
        summary = aiResult.summary;
      } catch {
        summary = `${errors.length} erreur(s) détectée(s). L'analyse IA n'est pas disponible.`;
      }
    } else {
      summary = 'Aucune erreur détectée dans la sortie terminal.';
    }

    // Merge quick fixes + AI solutions (deduplicate)
    const allSolutions = [...quickSolutions, ...aiSolutions];
    const uniqueSolutions = allSolutions.filter(
      (s, i) =>
        allSolutions.findIndex(
          (s2) => s2.title === s.title && s2.errorId === s.errorId
        ) === i
    );

    return {
      errors,
      solutions: uniqueSolutions,
      summary,
      generatedAt: Date.now(),
    };
  }

  /**
   * Generate quick fixes from known error patterns (no AI needed)
   */
  private generateQuickFixes(errors: DiagnosticError[]): DiagnosticSolution[] {
    const solutions: DiagnosticSolution[] = [];

    for (const error of errors) {
      switch (error.category) {
        case 'missing_dependency': {
          const pkg = error.parsedInfo.moduleName;
          if (pkg) {
            // Determine package manager
            const isScoped = pkg.startsWith('@');
            const baseName = pkg.split('/')[isScoped ? 1 : 0] || pkg;

            solutions.push({
              id: `fix-${error.id}`,
              errorId: error.id,
              title: `Installer ${pkg}`,
              description: `Le module "${pkg}" est manquant. Installer via npm.`,
              confidence: 0.9,
              autoFixable: true,
              fixAction: {
                type: 'install_package',
                packageName: pkg,
                packageManager: 'npm',
                command: `npm install ${pkg}`,
              },
            });
          }
          break;
        }

        case 'port_conflict': {
          const port = error.parsedInfo.port;
          solutions.push({
            id: `fix-${error.id}`,
            errorId: error.id,
            title: `Libérer le port ${port || ''}`,
            description: `Le port ${port || 'utilisé'} est déjà occupé. Tuer le processus ou changer de port.`,
            confidence: 0.85,
            autoFixable: true,
            fixAction: {
              type: 'command',
              command: port
                ? `lsof -ti:${port} | xargs kill -9 2>/dev/null; echo "Port ${port} libéré"`
                : 'echo "Identifie le port en conflit"',
            },
          });
          break;
        }

        case 'permission_denied': {
          const file = error.parsedInfo.file;
          solutions.push({
            id: `fix-${error.id}`,
            errorId: error.id,
            title: 'Corriger les permissions',
            description: `Permission refusée${file ? ` pour "${file}"` : ''}. Appliquer les droits nécessaires.`,
            confidence: 0.7,
            autoFixable: true,
            fixAction: {
              type: 'command',
              command: file ? `chmod -R 755 "${file}"` : 'echo "Fichier non identifié"',
            },
          });
          break;
        }

        case 'file_not_found': {
          const file = error.parsedInfo.file;
          solutions.push({
            id: `fix-${error.id}`,
            errorId: error.id,
            title: `Fichier introuvable`,
            description: `Le fichier "${file || 'inconnu'}" n'existe pas. Vérifier le chemin ou le recréer.`,
            confidence: 0.6,
            autoFixable: false,
          });
          break;
        }

        case 'syntax_error':
        case 'type_error': {
          const loc = error.parsedInfo;
          solutions.push({
            id: `fix-${error.id}`,
            errorId: error.id,
            title: `Corriger l'erreur ${error.category === 'syntax_error' ? 'de syntaxe' : 'de type'}`,
            description: loc.file
              ? `Erreur dans ${loc.file}${loc.line ? `:${loc.line}` : ''}`
              : error.rawMessage.slice(0, 120),
            confidence: 0.5,
            autoFixable: false, // Need AI for this
          });
          break;
        }
      }
    }

    return solutions;
  }

  /**
   * Ask DeepSeek AI to analyze errors and propose solutions
   */
  private async askAIForDiagnosis(
    errors: DiagnosticError[],
    terminalOutput: string,
    options: { projectPath?: string; packageJson?: string; relevantFileContent?: string }
  ): Promise<{ solutions: DiagnosticSolution[]; summary: string }> {
    const errorSummary = errors
      .map((e) => `[${e.category}] ${e.rawMessage}`)
      .join('\n');

    const context = [
      `Erreurs détectées:\n${errorSummary}`,
      options.packageJson ? `\npackage.json:\n${options.packageJson}` : '',
      options.relevantFileContent ? `\nFichier concerné:\n${options.relevantFileContent.slice(0, 4000)}` : '',
      `\nSortie terminal (dernières lignes):\n${terminalOutput.slice(-3000)}`,
    ].join('\n');

    const prompt = `Tu es un expert en debugging. Analyse ces erreurs et donne des solutions concrètes.

${context}

Réponds UNIQUEMENT en JSON valide avec ce format exact:
{
  "summary": "Résumé court du problème principal",
  "solutions": [
    {
      "title": "Titre de la solution",
      "description": "Explication claire",
      "command": "commande shell à exécuter (ou null)",
      "confidence": 0.9
    }
  ]
}`;

    const messages = aiRouter.prepareMessages(
      [
        { role: 'system', content: getSystemPrompt('code_review') },
        { role: 'user', content: prompt },
      ],
      'code_review'
    );

    let fullResponse = '';
    for await (const delta of aiRouter.chatStream(messages, {
      model: 'fast',
      enableFallback: true,
    })) {
      if (delta.content) fullResponse += delta.content;
    }

    // Parse JSON from response
    try {
      // Extract JSON block
      const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { solutions: [], summary: fullResponse.slice(0, 200) };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const aiSolutions: DiagnosticSolution[] = (parsed.solutions || []).map(
        (s: any, i: number) => ({
          id: `ai-fix-${Date.now()}-${i}`,
          errorId: errors[0]?.id || 'unknown',
          title: s.title || 'Solution IA',
          description: s.description || '',
          confidence: typeof s.confidence === 'number' ? s.confidence : 0.7,
          autoFixable: !!s.command,
          fixAction: s.command
            ? { type: 'command' as const, command: s.command }
            : undefined,
          aiExplanation: s.description,
        })
      );

      return {
        solutions: aiSolutions,
        summary: parsed.summary || `${errors.length} erreur(s) analysée(s)`,
      };
    } catch {
      return {
        solutions: [],
        summary: fullResponse.slice(0, 200),
      };
    }
  }

  /**
   * Execute a diagnostic fix automatically
   */
  async applyFix(
    solution: DiagnosticSolution,
    projectPath?: string
  ): Promise<string | null> {
    if (!solution.fixAction) return null;

    switch (solution.fixAction.type) {
      case 'command':
        if (solution.fixAction.command) {
          return terminalService.runCommand(solution.fixAction.command, {
            cwd: projectPath,
          });
        }
        break;

      case 'install_package':
        if (solution.fixAction.packageName) {
          return terminalService.installPackage(
            solution.fixAction.packageName,
            solution.fixAction.packageManager || 'npm',
            { cwd: projectPath }
          );
        }
        break;
    }

    return null;
  }

  // ─── Accessors ───

  getDetectedErrors(): DiagnosticError[] {
    return Array.from(this.detectedErrors.values()).sort(
      (a, b) => b.timestamp - a.timestamp
    );
  }

  clearErrors(): void {
    this.detectedErrors.clear();
    this.solutions.clear();
  }

  getErrorCount(): number {
    return this.detectedErrors.size;
  }

  getErrorsByCategory(category: ErrorCategory): DiagnosticError[] {
    return this.getDetectedErrors().filter((e) => e.category === category);
  }
}

// Singleton
export const diagnosticService = new DiagnosticService();
