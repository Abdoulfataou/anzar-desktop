/**
 * Vérification d'un tour : référence prise avant la première écriture, puis contrôle ciblé.
 *
 * Encapsule les trois décisions qui rendent la vérification utilisable :
 * - **référence** : ce qui était déjà cassé avant que l'agent n'écrive (capturée une fois par
 *   projet, ciblée sur aucune modification) ;
 * - **ciblage** : lint et tests restreints aux fichiers modifiés (`verify/targeted.ts`) ;
 * - **imputabilité** : seuls les nouveaux échecs bloquent `task_done` (`verify/baseline.ts`).
 *
 * Module sans React ni store : l'affichage et les accords passent par l'hôte.
 */
import type { ToolEvent } from '@/types';
import type { ApprovalRequest } from './turnTypes';
import type { SessionEvent } from './sessionStore';
import { commandRisk } from '@/services/agent/policy/commandGuard';
import { runVerification } from '@/services/agent/verify/agentVerifier';
import {
  diffAgainstBaseline, getCachedBaseline, setCachedBaseline, summarizeVerifyDiff, toBaseline,
  type VerifyBaseline,
} from '@/services/agent/verify/baseline';

/** Taille maximale d'une sortie d'outil conservée pour l'affichage. */
const MAX_TOOL_OUTPUT_DISPLAY = 600;
/** La référence ne doit pas retarder indéfiniment la première écriture. */
const BASELINE_TIMEOUT_MS = 120_000;

export interface TurnVerifyHost {
  /** Vérification utile pour ce tour (projet ouvert + réglage « vérifier après application »). */
  enabled: boolean;
  convId: string;
  agentRoot: string | null;
  background: boolean;
  signal: AbortSignal;
  /** Déclare un événement d'affichage (commandes de vérification). */
  addEvent: (event: ToolEvent) => void;
  flush: () => void;
  requestApproval: (request: ApprovalRequest) => Promise<boolean>;
  recordSessionEvent: (conversationId: string, event: SessionEvent) => void;
  /** Fichiers modifiés par le tour (pour le ciblage). */
  changedFiles: () => string[];
}

export interface TurnVerifier {
  /** La vérification a-t-elle un sens pour ce tour (projet ouvert + réglage actif) ? */
  readonly enabled: boolean;
  /** Référence capturée avant la première écriture (mise en cache par projet). */
  ensureBaseline(): Promise<VerifyBaseline | null>;
  /** Exécute le contrôle et ne garde que les échecs imputables à l'agent. */
  verify(): Promise<{ passed: boolean; failureSummary: string }>;
}

export function createTurnVerifier(host: TurnVerifyHost): TurnVerifier {
  const { enabled } = host;
  let seq = 0;
  let baselinePromise: Promise<VerifyBaseline | null> | null = null;

  const runCommands = async (prefix: string, signal: AbortSignal = host.signal, changedFiles: string[] = []) => {
    let current: ToolEvent | null = null;
    return runVerification(host.agentRoot as string, {
      signal,
      // Ciblage : lint et tests restreints aux fichiers que l'agent vient de modifier.
      changedFiles,
      onPlanSkipped: (label, reason) => {
        host.addEvent({
          id: `verify-skip-${Date.now()}-${++seq}`,
          name: 'run_command',
          argsSummary: `Vérification ignorée · ${label}`,
          status: 'ok',
          output: reason,
        });
        host.flush();
      },
      // Une commande qui exécute du code modifié par l'agent demande un accord,
      // comme run_command ; sans personne devant l'écran, elle n'est pas lancée.
      approve: async (cmd) => {
        const risk = await commandRisk(host.convId, host.agentRoot as string, cmd.command).catch(() => null);
        if (!risk) return true;
        if (host.background) return false;
        return host.requestApproval({
          id: `verify-${Date.now()}-${++seq}`,
          name: 'run_command',
          summary: cmd.command,
          reason: risk.reason,
          detail: risk.detail,
        });
      },
      onCommandStart: (cmd) => {
        current = {
          id: `verify-${Date.now()}-${++seq}`,
          name: 'run_command',
          argsSummary: `${prefix} · ${cmd.command}`,
          status: 'running',
        };
        host.addEvent(current);
        host.flush();
      },
      onCommandResult: (r) => {
        if (!current) return;
        current.status = r.skipped || r.passed ? 'ok' : 'error';
        current.output = r.output.slice(0, MAX_TOOL_OUTPUT_DISPLAY);
        host.flush();
      },
    });
  };

  const ensureBaseline = async (): Promise<VerifyBaseline | null> => {
    if (!enabled || !host.agentRoot) return null;
    const cached = getCachedBaseline(host.agentRoot);
    if (cached) return cached;
    baselinePromise ??= (async () => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), BASELINE_TIMEOUT_MS);
      try {
        const report = await runCommands('Référence', abort.signal);
        // Référence incomplète (interrompue) : mieux vaut aucune référence qu'une fausse.
        if (abort.signal.aborted) return null;
        const snapshot = toBaseline(report, host.agentRoot as string);
        setCachedBaseline(snapshot);
        host.recordSessionEvent(host.convId, { type: 'verify', passed: report.passed });
        return snapshot;
      } finally {
        clearTimeout(timer);
      }
    })().catch(() => null).finally(() => { baselinePromise = null; });
    return baselinePromise;
  };

  return {
    enabled,
    ensureBaseline,
    verify: async () => {
      // La référence a été capturée avant la première écriture (ou est déjà en cache).
      const base = await ensureBaseline().catch(() => null);
      const report = await runCommands('Vérification', host.signal, host.changedFiles());
      const diff = diffAgainstBaseline(report, base);
      // Seuls les échecs imputables à l'agent bloquent task_done.
      const passed = diff.newFailures.length === 0;
      host.recordSessionEvent(host.convId, { type: 'verify', passed });
      return { passed, failureSummary: summarizeVerifyDiff(diff) };
    },
  };
}
