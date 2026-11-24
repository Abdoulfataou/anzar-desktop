/**
 * Outil `bash` : un vrai shell, confiné par l'isolation du système (Seatbelt sur macOS).
 *
 * Il remplace `run_command` pour les tâches qui demandent un enchaînement (`&&`, pipes,
 * redirections), un `cd` local à la commande, ou un travail en arrière-plan. La frontière
 * n'est pas une liste blanche de programmes : c'est le bac à sable du système, appliqué
 * par Rust (`tool_spawn` avec `shell: true`). Sur une machine sans isolation disponible,
 * l'outil n'est pas proposé et Rust refuse de lancer un shell nu.
 *
 * Adapté de `packages/shell/tool-bash` de DeepSeek Harness (MIT) : description du contrat,
 * marqueurs de résultat, promotion en arrière-plan. Voir THIRD_PARTY_NOTICES.
 */
import { terminalService } from '@/services/runtime/terminal';
import { COMMAND_TIMEOUT_MS, MAX_COMMAND_OUTPUT_CHARS, resolvePath, truncate } from './shared';
import type { ToolExecutionContext, ToolResult } from './types';

/** Durée maximale d'une commande au premier plan (le shell peut demander moins). */
const MAX_TIMEOUT_MS = 600_000;
/** Sortie initiale rendue pour un travail lancé en arrière-plan. */
const BACKGROUND_SNAPSHOT_CHARS = 4_000;

/** Le shell confiné n'a de sens que là où l'isolation système existe (macOS aujourd'hui). */
export function confinedShellAvailable(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = `${navigator.platform || ''} ${navigator.userAgent || ''}`;
  return /Mac|Darwin|Linux|X11/i.test(platform);
}

function clampTimeout(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return COMMAND_TIMEOUT_MS;
  return Math.min(Math.max(1_000, Math.floor(n)), MAX_TIMEOUT_MS);
}

/** Rendu commun d'une commande terminée : la même forme que `run_command`, sans ambiguïté. */
function renderFinished(result: {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}, workdir: string): string {
  const parts = [
    `cwd: ${workdir}`,
    `exit_code: ${result.exitCode} (${result.durationMs}ms)`,
    result.stdout ? `stdout:\n${truncate(result.stdout, MAX_COMMAND_OUTPUT_CHARS, 'stdout')}` : '',
    result.stderr ? `[stderr]\n${truncate(result.stderr, MAX_COMMAND_OUTPUT_CHARS, 'stderr')}` : '',
  ].filter(Boolean);
  if (!result.stdout && !result.stderr) parts.push('(aucune sortie)');
  return parts.join('\n\n');
}

/** Rendu d'un travail en arrière-plan : identifiant, état, sortie déjà produite. */
function renderJob(job: { status: string; exitCode?: number; output: string }, jobId: string): string {
  const tail = job.output.length > BACKGROUND_SNAPSHOT_CHARS
    ? `… [${job.output.length - BACKGROUND_SNAPSHOT_CHARS} caractères avant, utilise job_output]\n${job.output.slice(-BACKGROUND_SNAPSHOT_CHARS)}`
    : job.output;
  const status = job.status === 'running'
    ? 'en cours'
    : `terminé (code ${job.exitCode ?? 'inconnu'})`;
  return [
    `job_id: ${jobId}`,
    `état: ${status}`,
    tail ? `sortie:\n${tail}` : '(aucune sortie pour le moment)',
    job.status === 'running'
      ? 'Le travail continue en arrière-plan. Utilise job_output avec cet identifiant pour lire la suite, job_kill pour l’arrêter.'
      : 'Le travail est terminé : la sortie ci-dessus est complète.',
  ].join('\n\n');
}

export async function execBash(args: Record<string, any>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const command = String(args.command || '').trim();
  if (!command) return { output: 'Erreur: commande vide.', isError: true };
  if (command.length > 20_000) return { output: 'Erreur: commande trop longue (max 20 000 caractères).', isError: true };

  // `workdir` est relatif au projet ; le shell démarre dans ce dossier pour cette commande.
  const workdirArg = typeof args.workdir === 'string' && args.workdir.trim() ? args.workdir.trim() : '.';
  let cwd: string;
  try {
    cwd = await resolvePath(ctx.projectRoot, workdirArg);
  } catch (e: any) {
    return { output: `Erreur: dossier de travail invalide (${e?.message || e}).`, isError: true };
  }
  const timeout = clampTimeout(args.timeoutMs);

  if (args.run_in_background === true) {
    const jobId = await terminalService.runShell(command, { cwd });
    // Laisse au processus le temps de produire ses premières lignes (ou d'échouer au lancement).
    await new Promise<void>((r) => setTimeout(r, 250));
    const job = terminalService.getJob(jobId);
    if (!job) return { output: `Erreur: le travail ${jobId} n'a pas pu être lancé.`, isError: true };
    return { output: renderJob(job, jobId), isError: job.status === 'failed' };
  }

  const result = await terminalService.execShell(command, { cwd, timeout, signal: ctx.signal });
  if (result.ran === false) {
    return {
      output: `La commande n'a pas été exécutée (refus ou lancement impossible).\n${result.stderr || '(sans détail)'}`,
      isError: true,
    };
  }
  return { output: renderFinished(result, workdirArg), isError: result.denied === true };
}

export async function execJobOutput(args: Record<string, any>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const id = String(args.job_id || args.id || '').trim();
  if (!id) return { output: 'Erreur: indique job_id (l’identifiant rendu par bash).', isError: true };
  const waitMs = Math.min(Math.max(0, Number(args.wait_ms) || 0), 300_000);
  const job = await terminalService.waitForJob(id, waitMs, ctx.signal);
  if (!job) return { output: `Erreur: travail inconnu « ${id} ».`, isError: true };
  return { output: renderJob(job, id), isError: job.status === 'failed' };
}

export async function execJobKill(args: Record<string, any>): Promise<ToolResult> {
  const id = String(args.job_id || args.id || '').trim();
  if (!id) return { output: 'Erreur: indique job_id (l’identifiant rendu par bash).', isError: true };
  const ok = await terminalService.killProcess(id);
  return ok
    ? { output: `Travail ${id} arrêté.` }
    : { output: `Travail ${id} introuvable ou déjà terminé.`, isError: true };
}
