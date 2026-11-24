/**
 * AgentVerifier — Vérification automatique du projet (Phase 2)
 *
 * Détecte le type de projet et exécute les vérifications adaptées
 * (lint, typecheck, build, tests) via terminalService (allowlist).
 *
 * Utilisé par agentLoop pour "gater" task_done : l'agent ne peut pas
 * déclarer la tâche terminée tant que la vérification échoue.
 */

import { fileSystemService } from '@/services/filesystem/fileSystem';
import { terminalService } from '@/services/runtime/terminal';
import { collectRelatedTests, planVerification } from './targeted';

// ============================================================================
// TYPES
// ============================================================================

export interface VerifyCommand {
  label: string;      // 'lint', 'build', 'test', 'cargo check'…
  command: string;    // commande complète
}

export interface VerifyCommandResult {
  label: string;
  command: string;
  passed: boolean;
  /** True si la commande n'a pas pu être exécutée (allowlist, outil absent) */
  skipped: boolean;
  exitCode: number;
  output: string;     // stdout+stderr tronqués
  durationMs: number;
}

export interface VerifyReport {
  /** True si toutes les commandes exécutées sont passées (les skipped ne comptent pas) */
  passed: boolean;
  /** Aucune vérification applicable (projet statique, etc.) */
  nothingToVerify: boolean;
  results: VerifyCommandResult[];
  /** Résumé compact à réinjecter au modèle en cas d'échec */
  failureSummary: string;
  /** Décisions de la vérification ciblée (affichées à l'utilisateur, pas au modèle). */
  notes?: string[];
  /** Commandes écartées par le ciblage, avec leur raison. */
  skippedCommands?: { label: string; reason: string }[];
}

const MAX_OUTPUT_CHARS = 8_000;
const COMMAND_TIMEOUT_MS = 180_000;
const NPM_DEFAULT_TEST = 'echo "Error: no test specified" && exit 1';

// ============================================================================
// DÉTECTION
// ============================================================================

async function readJsonSafe(path: string): Promise<any | null> {
  try {
    const raw = await fileSystemService.readFile(path);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Détecte les commandes de vérification adaptées au projet.
 * Ordre : rapide → lent (lint avant build avant tests).
 */
export async function detectVerifyCommands(projectRoot: string): Promise<VerifyCommand[]> {
  const root = projectRoot.replace(/[\\/]+$/, '');
  const commands: VerifyCommand[] = [];

  // ─── Node / JS / TS ───
  const pkg = await readJsonSafe(`${root}/package.json`);
  if (pkg) {
    const scripts: Record<string, string> = pkg.scripts || {};

    if (scripts.lint) commands.push({ label: 'lint', command: 'npm run lint' });
    if (scripts.typecheck) commands.push({ label: 'typecheck', command: 'npm run typecheck' });
    if (scripts.build) commands.push({ label: 'build', command: 'npm run build' });
    if (scripts.test && scripts.test !== NPM_DEFAULT_TEST) {
      commands.push({ label: 'test', command: 'npm test' });
    }
    // Projet Node sans aucun script → au minimum un check de syntaxe du point d'entrée
    if (commands.length === 0 && typeof pkg.main === 'string' && /\.[cm]?js$/.test(pkg.main)) {
      commands.push({ label: 'syntax', command: `node --check ${pkg.main}` });
    }
    return commands;
  }

  // ─── Rust ───
  if (await fileSystemService.exists(`${root}/Cargo.toml`)) {
    commands.push({ label: 'cargo check', command: 'cargo check' });
    return commands;
  }

  // ─── Python ───
  const hasPy =
    (await fileSystemService.exists(`${root}/requirements.txt`)) ||
    (await fileSystemService.exists(`${root}/pyproject.toml`)) ||
    (await fileSystemService.exists(`${root}/main.py`)) ||
    (await fileSystemService.exists(`${root}/app.py`));
  if (hasPy) {
    // Compilation syntaxique de tous les .py (rapide, sans exécuter le code)
    commands.push({ label: 'py-compile', command: 'python -m compileall -q .' });
    return commands;
  }

  // ─── Statique (HTML/CSS/JS sans tooling) : rien à vérifier automatiquement ───
  return commands;
}

// ============================================================================
// EXÉCUTION
// ============================================================================

function truncateOutput(stdout: string, stderr: string): string {
  const merged = [stderr, stdout].filter(Boolean).join('\n').trim();
  if (merged.length <= MAX_OUTPUT_CHARS) return merged;
  // Les erreurs utiles sont souvent à la fin (résumés tsc/eslint) ET au début — on garde les deux
  const head = merged.slice(0, MAX_OUTPUT_CHARS / 2);
  const tail = merged.slice(-MAX_OUTPUT_CHARS / 2);
  return `${head}\n… [sortie tronquée] …\n${tail}`;
}

export async function runVerification(
  projectRoot: string,
  options: {
    signal?: AbortSignal;
    /** Callback par commande (UI temps réel) */
    onCommandStart?: (cmd: VerifyCommand) => void;
    onCommandResult?: (result: VerifyCommandResult) => void;
    /**
     * Accord avant chaque commande (garde des scripts modifiés par l'agent).
     * false → commande non exécutée, comptée comme « skipped ».
     */
    approve?: (cmd: VerifyCommand) => Promise<boolean>;
    /**
     * Fichiers modifiés par l'agent pendant le tour : ils permettent de restreindre lint et
     * tests. Vide ou absent = vérification complète (référence, ou aucun suivi).
     */
    changedFiles?: string[];
    /** Commande écartée par le ciblage (affichage). */
    onPlanSkipped?: (label: string, reason: string) => void;
  } = {}
): Promise<VerifyReport> {
  const commands = await detectVerifyCommands(projectRoot);

  if (commands.length === 0) {
    return {
      passed: true,
      nothingToVerify: true,
      results: [],
      failureSummary: '',
    };
  }

  // Ciblage : seules les commandes concernées par les fichiers modifiés sont conservées.
  const root = projectRoot.replace(/[\\/]+$/, '');
  const changedFiles = options.changedFiles || [];
  const pkg = changedFiles.length ? await readJsonSafe(`${root}/package.json`) : null;
  const scripts: Record<string, string> = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {};
  const relatedTests = changedFiles.length
    ? await collectRelatedTests(changedFiles, (rel) => fileSystemService.exists(`${root}/${rel}`))
    : [];
  const plan = planVerification(commands, { scripts, changedFiles, relatedTests });
  for (const skipped of plan.skipped) options.onPlanSkipped?.(skipped.label, skipped.reason);

  if (plan.commands.length === 0) {
    return {
      passed: true,
      nothingToVerify: true,
      results: [],
      failureSummary: '',
      notes: plan.notes,
      skippedCommands: plan.skipped,
    };
  }

  const results: VerifyCommandResult[] = [];

  for (const cmd of plan.commands) {
    if (options.signal?.aborted) break;
    options.onCommandStart?.(cmd);

    if (options.approve && !(await options.approve(cmd).catch(() => false))) {
      const refused: VerifyCommandResult = {
        label: cmd.label,
        command: cmd.command,
        passed: false,
        skipped: true,
        exitCode: -1,
        output: "Non exécutée : la commande lance du code modifié par l'agent et n'a pas été autorisée.",
        durationMs: 0,
      };
      results.push(refused);
      options.onCommandResult?.(refused);
      continue;
    }

    const r = await terminalService.exec(cmd.command, {
      cwd: projectRoot,
      timeout: COMMAND_TIMEOUT_MS,
      silent: true,
      signal: options.signal,
    });
    if (options.signal?.aborted) break;

    // Commande bloquée par l'allowlist ou outil absent → skipped (ne fait pas échouer)
    const blocked = r.stderr.startsWith('⛔') || /command not found|introuvable|not recognized/i.test(r.stderr);

    const result: VerifyCommandResult = {
      label: cmd.label,
      command: cmd.command,
      passed: r.success,
      skipped: blocked,
      exitCode: r.exitCode,
      output: truncateOutput(r.stdout, r.stderr),
      durationMs: r.durationMs,
    };
    results.push(result);
    options.onCommandResult?.(result);

    // install échoué → inutile de continuer (tout le reste échouera)
    if (cmd.label === 'install' && !r.success && !blocked) break;
  }

  const executed = results.filter(r => !r.skipped);
  const failed = executed.filter(r => !r.passed);
  const passed = failed.length === 0;

  const failureSummary = passed
    ? ''
    : failed
        .map(f => `### ${f.label} — \`${f.command}\` (exit ${f.exitCode})\n${f.output}`)
        .join('\n\n');

  return {
    passed,
    nothingToVerify: executed.length === 0,
    results,
    failureSummary,
    notes: plan.notes,
    skippedCommands: plan.skipped,
  };
}
