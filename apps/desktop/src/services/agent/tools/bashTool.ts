/**
 * Outils `bash` (macOS) et `powershell` (Windows) : un vrai shell. bash est confiné par
 * l'isolation du système (Seatbelt) ; powershell, sans isolation sous Windows, ne part
 * qu'en Accès complet ou après accord (voir execPowerShell).
 *
 * Il remplace `run_command` pour les tâches qui demandent un enchaînement (`&&`, pipes,
 * redirections), un `cd` local à la commande, ou un travail en arrière-plan. La frontière
 * n'est pas une liste blanche de programmes : c'est le bac à sable du système, appliqué
 * par Rust (`tool_spawn` avec `shell: true`). Sur une machine sans isolation disponible,
 * l'outil n'est pas proposé. En Accès complet, l'utilisateur a explicitement retiré
 * l'isolation : le shell tourne alors sans profil, et le prompt le lui rappelle.
 *
 * Adapté de `packages/shell/tool-bash` de DeepSeek Harness (MIT) : description du contrat,
 * marqueurs de résultat, promotion en arrière-plan. Voir THIRD_PARTY_NOTICES.
 */
import { terminalService } from '@/services/runtime/terminal';
import { COMMAND_TIMEOUT_MS, MAX_COMMAND_OUTPUT_CHARS, resolvePath, truncate } from './shared';
import type { ToolExecutionContext, ToolResult } from './types';
import { backgroundedNotice, neverEndingCommand, stillRunningAdvice, timeoutAdvice } from './commandHints';
import { unconfinedCommandRefusal } from '../policy/isolation';

/** Durée maximale d'une commande au premier plan (le shell peut demander moins). */
const MAX_TIMEOUT_MS = 600_000;
/** Sortie initiale rendue pour un travail lancé en arrière-plan. */
const BACKGROUND_SNAPSHOT_CHARS = 4_000;

/** Le shell confiné n'a de sens que là où l'isolation système existe (macOS aujourd'hui). */
export function confinedShellAvailable(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = `${navigator.platform || ''} ${navigator.userAgent || ''}`;
  // Rust ne confine réellement que sous macOS (`sandbox::available`).
  return /Mac|Darwin/i.test(platform);
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
  timedOut?: boolean;
}, workdir: string, timeoutMs: number, command = ''): string {
  const parts = [
    `cwd: ${workdir}`,
    `exit_code: ${result.exitCode} (${result.durationMs}ms)`,
    result.timedOut
      ? timeoutAdvice({ command, timeoutMs, output: `${result.stdout}\n${result.stderr}`, backgroundAvailable: true })
      : '',
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

export function execBash(args: Record<string, any>, ctx: ToolExecutionContext): Promise<ToolResult> {
  return execShellLine(args, ctx, { maxChars: 20_000, unconfined: false });
}

/**
 * Outil `powershell` (Windows) : même contrat que bash — premier plan qui rend la main au
 * délai, arrière-plan, job_output, job_kill. Windows n'ayant pas encore d'isolation des
 * commandes, la règle « fail closed » s'applique d'abord : hors Accès complet, la commande
 * ne part qu'après l'accord de l'utilisateur (élévation), et jamais en mode sans accord.
 */
export async function execPowerShell(args: Record<string, any>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const refusal = unconfinedCommandRefusal(ctx.permissionMode, ctx.escalated === true);
  if (refusal) return { output: refusal, isError: true };
  return execShellLine(args, ctx, { maxChars: 10_000, unconfined: ctx.permissionMode === 'full' });
}

async function execShellLine(
  args: Record<string, any>,
  ctx: ToolExecutionContext,
  opts: { maxChars: number; unconfined: boolean },
): Promise<ToolResult> {
  const command = String(args.command || '').trim();
  if (!command) return { output: 'Erreur: commande vide.', isError: true };
  if (command.length > opts.maxChars) {
    return { output: `Erreur: commande trop longue (max ${opts.maxChars.toLocaleString('fr-FR')} caractères). Mets le travail dans un script du projet avec write_file, puis lance-le.`, isError: true };
  }
  const unconfined = opts.unconfined;
  // `workdir` est relatif au projet ; le shell démarre dans ce dossier pour cette commande.
  const workdirArg = typeof args.workdir === 'string' && args.workdir.trim() ? args.workdir.trim() : '.';
  let cwd: string;
  try {
    cwd = await resolvePath(ctx.projectRoot, workdirArg);
  } catch (e: any) {
    return { output: `Erreur: dossier de travail invalide (${e?.message || e}).`, isError: true };
  }
  const timeout = clampTimeout(args.timeoutMs);

  const escalated = ctx.escalated === true;
  const escalationReason = String(args.justification || '');

  // Serveur, mode surveillance, tail -f : au premier plan, la commande bloquerait jusqu'au
  // délai. Elle part d'office en arrière-plan, et l'agent garde la main.
  const endless = args.run_in_background === true ? null : neverEndingCommand(command);

  if (args.run_in_background === true || endless) {
    const jobId = await terminalService.runShell(command, { cwd, escalated, escalationReason, unconfined });
    // Bouton Stop : un travail lancé par ce tour ne doit pas survivre à l'annulation.
    const onAbort = () => { void terminalService.killProcess(jobId); };
    if (ctx.signal?.aborted) onAbort();
    else ctx.signal?.addEventListener('abort', onAbort, { once: true });
    // Laisse au processus le temps de produire ses premières lignes (ou d'échouer au lancement).
    await new Promise<void>((r) => setTimeout(r, 250));
    const job = terminalService.getJob(jobId);
    if (!job) return { output: `Erreur: le travail ${jobId} n'a pas pu être lancé.`, isError: true };
    const rendered = renderJob(job, jobId);
    return {
      output: endless ? `${backgroundedNotice(endless)}\n\n${rendered}` : rendered,
      isError: job.status === 'failed',
      failed: job.status === 'failed',
    };
  }

  // Au délai, la commande n'est pas tuée : elle continue en arrière-plan et l'agent reprend
  // la main avec son identifiant (comme Codex et Claude Code). Un build légitime de
  // plusieurs minutes n'est jamais perdu ; une commande bloquée s'arrête avec job_kill.
  const run = await terminalService.execShellYield(command, { cwd, yieldMs: timeout, signal: ctx.signal, escalated, escalationReason, unconfined });
  if (run.kind === 'running') {
    noteJobOutput(run.jobId, run.output);
    return {
      output: stillRunningAdvice({ command, seconds: Math.round(timeout / 1000), output: run.output, jobId: run.jobId }),
    };
  }
  const result = run.result;
  if (result.ran === false) {
    return {
      output: `La commande n'a pas été exécutée (refus ou lancement impossible).\n${result.stderr || '(sans détail)'}`,
      isError: true,
    };
  }
  return {
    output: renderFinished(result, workdirArg, timeout, command),
    isError: result.denied === true,
    failed: result.exitCode !== 0,
  };
}

/**
 * Dernière sortie vue par l'agent pour chaque travail : permet de dire « rien de nouveau
 * depuis N s », le signal le plus net d'une commande bloquée.
 */
const lastSeen = new Map<string, { length: number; at: number }>();
function noteJobOutput(id: string, output: string): void {
  const prev = lastSeen.get(id);
  if (!prev || prev.length !== output.length) lastSeen.set(id, { length: output.length, at: Date.now() });
}

/** Sans wait_ms, job_output attend lui-même un peu : moins d'allers-retours avec le modèle. */
export const DEFAULT_JOB_WAIT_MS = 30_000;

export async function execJobOutput(args: Record<string, any>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const id = String(args.job_id || args.id || '').trim();
  if (!id) return { output: 'Erreur: indique job_id (l’identifiant rendu par la commande).', isError: true };
  const requested = Number(args.wait_ms);
  const waitMs = Math.min(Math.max(0, Number.isFinite(requested) && args.wait_ms !== undefined ? requested : DEFAULT_JOB_WAIT_MS), 300_000);
  const job = await terminalService.waitForJob(id, waitMs, ctx.signal);
  if (!job) return { output: `Erreur: travail inconnu « ${id} ».`, isError: true };
  const before = lastSeen.get(id);
  const silentFor = job.status === 'running' && before && before.length === job.output.length
    ? Math.round((Date.now() - before.at) / 1000)
    : 0;
  noteJobOutput(id, job.output);
  if (job.status !== 'running') lastSeen.delete(id);
  const stalled = silentFor >= 20
    ? `[aucune nouvelle sortie depuis ${silentFor} s] Si cette commande devait produire quelque chose ou se terminer, elle est probablement bloquée : arrête-la (job_kill) et cherche pourquoi plutôt que d'attendre encore.\n\n`
    : '';
  return { output: stalled + renderJob(job, id), isError: job.status === 'failed', failed: job.status === 'failed' };
}

export async function execJobKill(args: Record<string, any>): Promise<ToolResult> {
  const id = String(args.job_id || args.id || '').trim();
  if (!id) return { output: 'Erreur: indique job_id (l’identifiant rendu par la commande).', isError: true };
  const ok = await terminalService.killProcess(id);
  return ok
    ? { output: `Travail ${id} arrêté.` }
    : { output: `Travail ${id} introuvable ou déjà terminé.`, isError: true };
}
