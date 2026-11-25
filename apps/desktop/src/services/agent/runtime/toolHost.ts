/**
 * Hôte d'outils d'un tour de conversation.
 *
 * Deux responsabilités, sorties de l'adaptateur pour être lisibles et testables :
 * - composer la liste d'outils envoyée au modèle selon le mode, le projet et les skills ;
 * - exécuter un appel d'outil : décision d'approbation, garde des commandes, connecteurs
 *   MCP, outils spéciaux (ask_user, load_skill, propose_plan), journal.
 *
 * Aucune dépendance à React ni aux stores : l'état mutable du tour et les effets d'UI
 * sont fournis par l'appelant (`ToolRunContext`).
 */
import type { Message, TimelineItem, ToolCall, ToolEvent } from '@/types';
import type { PermissionMode } from '../policy/permissions';
import type { AgentToolOutcome } from '../engine/agentSession';
import { approvalDecision } from '../policy/toolPolicy';
import { type ExternalSource } from '../policy/untrusted';
import { executeGenericTool } from '../tools/toolExecution';
import { summarizeArgs, toolDelta, toolFilePath } from '../tools/toolDisplay';
import { patchTouchedPaths, isProtectedPatchPath } from '../tools/patchTool';
import { askUser, loadSkill, parsePlan } from '../tools/specialTools';
import { type AgentQuestion, type QuestionAnswer } from '../tools/questions';
import { snapshotBeforeChange, type Snapshots } from '../tools/fileChanges';
import { isMcpTool, mcpNeedsApproval, mcpToolRef } from '@/services/mcp/manager';
import { commandTitle, isEnvironmentFailure, reportError } from '@/services/infra/errorReports';
import type { Skill } from '@/services/skills';
import { recordSessionEvent } from './sessionStore';
import type { ApprovalRequest, ApprovalOutcome } from './turnTypes';

/** Taille maximale d'une sortie d'outil conservée pour l'affichage. */
const MAX_TOOL_OUTPUT_DISPLAY = 600;

/** Outils qui écrivent sur le disque (déclenchent la vérification au task_done). */
const WRITE_TOOLS = ['write_file', 'edit_file', 'apply_patch', 'delete_file', 'spawn_agent', 'send_message'];
/** Outils susceptibles de modifier le projet : leurs commandes comptent dans la carte. */
const MUTATING_TOOLS = new Set([...WRITE_TOOLS, 'run_command', 'bash', 'start_dev_server']);

// ============================================================================
// ÉVÉNEMENT D'OUTIL (affichage)
// ============================================================================

/** Événement d'affichage d'un appel d'outil, dans l'état « en cours ». */
export function toolEventFor(call: ToolCall): ToolEvent {
  let args: Record<string, any> = {};
  try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* garde */ }
  return {
    id: call.id,
    name: call.function.name,
    argsSummary: summarizeArgs(call.function.name, args),
    filePath: toolFilePath(call.function.name, args),
    status: 'running',
  };
}

// ============================================================================
// EXÉCUTION
// ============================================================================

/** État mutable partagé entre l'hôte d'outils et la boucle du tour. */
export interface TurnToolState {
  /** Captures d'écran produites pendant l'étape (injectées après le lot d'outils). */
  stepImages: { label: string; dataUrl: string }[];
  /** Un task_done (ou un plan) a été émis dans le lot courant. */
  doneInBatch: boolean;
  /** Écritures réussies : déclenchent la vérification au task_done. */
  filesWritten: number;
  /** Un plan a été proposé (mode plan). */
  planProposed: boolean;
  /** État de départ du tour déjà figé par git (avant la première commande ou écriture). */
  gitBaseline?: boolean;
}

export interface ToolRunContext {
  convId: string;
  /** Identité de l'agent principal ; les sous-agents ont la leur. */
  agentId: string;
  /** Dossier où l'agent peut agir (projet ou espace ANZAR). */
  agentRoot: string | null;
  /** Projet ouvert, s'il y en a un. */
  workspacePath: string | null;
  mode: PermissionMode;
  background: boolean;
  personalSpace: boolean;
  signal: AbortSignal;
  skills: Skill[];
  events: ToolEvent[];
  toolEvents: Map<string, ToolEvent>;
  timeline: TimelineItem[];
  /** Contenus externes (web, connecteurs) lus pendant cette demande. */
  externalSources: ExternalSource[];
  /** Versions des fichiers avant modification (annulation + carte « fichiers modifiés »). */
  snapshots: Snapshots;
  turn: TurnToolState;
  flush: (liveText?: string) => void;
  /** Pose une demande d'accord et attend la réponse de l'utilisateur. */
  requestApproval: (request: ApprovalRequest) => Promise<ApprovalOutcome>;
  /** Pose des questions et attend les réponses (null = l'utilisateur passe). */
  requestAnswers: (callId: string, questions: AgentQuestion[]) => Promise<QuestionAnswer[] | null>;
  updateMessage: (id: string, patch: Partial<Message>) => void;
  assistantId: string;
  /** Mode Auto : un échec d'outil peut faire monter le modèle d'un cran. */
  onToolFailure?: () => void;
  /** Coût produit par l'outil (explorateurs, recherche web) : ajouté au coût du tour. */
  onToolCost?: (costFCFA: number) => void;
  /** Enveloppe de budget pour un sous-agent (fraction du budget restant). */
  childBudget?: (share: number, capFcfa?: number) => import('../engine/budget').BudgetLedger;
  onFileChanged?: (relativePath: string, action: 'create' | 'edit' | 'delete') => void;
  /**
   * Juste avant la première écriture du tour : capture de l'état de vérification du projet.
   * Un échec ici ne doit jamais empêcher l'écriture.
   */
  beforeFirstWrite?: () => Promise<void>;
  /** Avant la première commande ou écriture du tour : point de départ des changements. */
  beforeFirstChange?: () => Promise<void>;
}

/** Texte de refus adapté à l'issue fermée de l'accord. */
function approvalRefusal(outcome: ApprovalOutcome, subject = "l'action"): string {
  switch (outcome) {
    case 'rejected':
      return `L'utilisateur a refusé ${subject}. N'insiste pas : propose une autre approche ou demande-lui ce qu'il préfère.`;
    case 'cancelled':
      return `La demande d'accord pour ${subject} a été annulée avant la décision. Ne la relance pas à l'identique ; demande à l'utilisateur.`;
    case 'unavailable':
      return `Aucun canal d'accord n'est disponible pour ${subject} (personne ne peut répondre). Signale-le dans ta réponse au lieu de réessayer.`;
    case 'allowed-once':
      return '';
  }
}

/** Demande un accord et normalise un éventuel échec de canal en `unavailable`. */
async function askApproval(
  ctx: Pick<ToolRunContext, 'requestApproval'>,
  request: ApprovalRequest,
): Promise<ApprovalOutcome> {
  try {
    return await ctx.requestApproval(request);
  } catch {
    return 'unavailable';
  }
}

/**
 * Exécute un appel d'outil du modèle et renvoie le résultat à réinjecter.
 * Ne lève jamais : toute erreur d'exécution devient un résultat `isError` lisible par l'agent.
 */
export async function runToolCall(call: ToolCall, ctx: ToolRunContext): Promise<AgentToolOutcome> {
  const ev = ctx.toolEvents.get(call.id);
  if (!ev) return { output: `Outil inconnu : ${call.function.name}`, isError: true };

  let args: Record<string, any> = {};
  try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* garde */ }

  // Élévation à usage unique demandée par le modèle après un refus d'isolation.
  // Elle ne contourne jamais la politique statique (pré-contrôle ci-dessus) : elle ne
  // fait que désactiver Seatbelt pour CET appel, après accord explicite hors Full.
  const wantsEscalation = (call.function.name === 'bash' || call.function.name === 'run_command')
    && args.sandbox_permissions === 'danger-full-access';
  let escalated = false;
  if (wantsEscalation) {
    const justification = String(args.justification || '').trim();
    if (!justification) {
      return {
        output: "Élévation refusée : ajoute une justification d'une phrase expliquant pourquoi cette commande a besoin d'un accès complet.",
        isError: true,
      };
    }
    if (ctx.background) {
      return {
        output: "Élévation refusée : personne ne peut l'approuver pendant une automatisation. Signale-le dans ta réponse.",
        isError: true,
      };
    }
    // Politique « never » (auto) : refus déterministe, sans carte, comme dans Harness.
    if (ctx.mode === 'auto') {
      return {
        output: "Élévation refusée : ce mode n'ouvre aucune demande d'accord. Cette commande reste limitée au projet ; explique ce qui manque à l'utilisateur.",
        isError: true,
      };
    }
    if (ctx.mode !== 'full') {
      const outcome = await askApproval(ctx, {
        id: call.id,
        name: call.function.name,
        summary: ev.argsSummary,
        reason: `Élévation demandée pour cette commande : ${justification}. Elle peut aussi installer ou exécuter du code ; vérifie ce qu'elle fait avant d'autoriser.`,
        detail: String(args.command || ''),
      });
      if (outcome !== 'allowed-once') {
        return {
          output: approvalRefusal(outcome, "l'élévation de cette commande"),
          isError: true,
        };
      }
    }
    escalated = true;
  }

  // Connecteur MCP : lecture déclarée par le serveur, ou action à faire valider
  const mcpRef = isMcpTool(call.function.name) ? mcpToolRef(call.function.name) : undefined;
  const mcpReadOnly = !!mcpRef?.tool.annotations?.readOnlyHint;
  const mcpAsk = !!mcpRef && mcpNeedsApproval(ctx.mode, mcpRef);

  // Décision d'approbation (module pur, testé)
  const decision = approvalDecision({
    mode: ctx.mode,
    tool: call.function.name,
    mcpReadOnly,
    mcpAsk,
    mcpName: mcpRef?.serverName,
    background: ctx.background,
    mcpAction: !!mcpRef && !mcpReadOnly,
  });
  let allowed = decision.allowed;
  const refusal = decision.refusal ?? "Refusé par l'utilisateur. N'insiste pas : propose une autre approche ou demande-lui ce qu'il préfère.";
  if (decision.ask && !escalated) {
    const outcome = await askApproval(ctx, {
      id: call.id,
      name: call.function.name,
      summary: ev.argsSummary,
    });
    allowed = outcome === 'allowed-once';
    if (!allowed) {
      const output = approvalRefusal(outcome);
      ev.status = 'error';
      ev.output = output.slice(0, MAX_TOOL_OUTPUT_DISPLAY);
      ctx.flush();
      return { output, isError: true };
    }
  }
  // Point de départ des changements du tour : avant la première commande ou écriture, car
  // `npm install` peut modifier package.json avant que l'agent n'écrive quoi que ce soit.
  if (allowed && ctx.agentRoot && !ctx.turn.gitBaseline && MUTATING_TOOLS.has(call.function.name)) {
    ctx.turn.gitBaseline = true;
    await ctx.beforeFirstChange?.().catch(() => undefined);
  }

  // Original mémorisé avant toute modification (carte « fichiers modifiés »)
  if (allowed && ctx.agentRoot && WRITE_TOOLS.includes(call.function.name)) {
    // Référence de vérification : ce qui était déjà cassé avant que l'agent n'écrive.
    if (ctx.turn.filesWritten === 0) await ctx.beforeFirstWrite?.().catch(() => {});
    // Un patch touche plusieurs fichiers et n'a pas d'argument `path` : on mémorise
    // chaque chemin cité (sources, cibles de déplacement) avant l'application.
    const directPath = args.path || args.file_path;
    const patchPaths = call.function.name === 'apply_patch' && typeof args.patch === 'string'
      ? patchTouchedPaths(args.patch).filter((path) => !isProtectedPatchPath(path))
      : [];
    const writePaths = [...new Set([...(directPath ? [String(directPath)] : []), ...patchPaths])];
    for (const rel of writePaths) {
      await snapshotBeforeChange(ctx.snapshots, ctx.agentRoot, rel);
    }
  }

  // Questions à l'utilisateur : l'agent attend ses réponses
  if (call.function.name === 'ask_user') {
    const result = await askUser(args, {
      background: ctx.background,
      onQuestions: (questions, summary) => {
        ev.argsSummary = summary;
        ctx.flush();
      },
      requestAnswers: (questions) => ctx.requestAnswers(call.id, questions),
    });
    ev.status = result.isError ? 'error' : 'ok';
    ev.output = result.output.slice(0, MAX_TOOL_OUTPUT_DISPLAY);
    ctx.flush();
    return { output: result.output, isError: result.isError };
  }

  // Skill : instructions lues côté app, renvoyées à l'agent
  if (call.function.name === 'load_skill') {
    const result = await loadSkill(args, ctx.skills);
    ev.status = result.isError ? 'error' : 'ok';
    ev.output = result.output.slice(0, MAX_TOOL_OUTPUT_DISPLAY);
    ctx.flush();
    return { output: result.output, isError: result.isError };
  }

  // Plan soumis : affiché dans l'onglet « Plan », l'agent s'arrête et attend la validation
  if (call.function.name === 'propose_plan' && allowed) {
    const plan = parsePlan(args);
    ctx.updateMessage(ctx.assistantId, { plan: { title: plan.title, markdown: plan.markdown, status: 'pending' } });
    ev.status = 'ok';
    ev.argsSummary = plan.title;
    ctx.flush();
    ctx.turn.doneInBatch = true;
    ctx.turn.planProposed = true;
    return { output: plan.output, stop: 'plan' };
  }

  const runTool = () => executeGenericTool(call, args, {
    agentRoot: ctx.agentRoot,
    workspacePath: ctx.workspacePath,
    signal: ctx.signal,
    permissionMode: ctx.mode,
    childBudget: ctx.childBudget,
    escalated,
    convId: ctx.convId,
    agentId: ctx.agentId,
    onFileChanged: (rel, action) => { if (ctx.workspacePath) ctx.onFileChanged?.(rel, action); },
    onSubagentProgress: call.function.name === 'spawn_subagents'
      ? (progress) => { ev.subagents = progress; ctx.flush(''); }
      : undefined,
  });
  let result: {
    output: string;
    isError?: boolean;
    failed?: boolean;
    isDone?: boolean;
    costFCFA?: number;
    images?: { label: string; dataUrl: string }[];
    media?: ToolEvent['media'];
    external?: ExternalSource;
  } = !allowed
    ? { output: refusal, isError: true }
    : await runTool();

  // Suivi des erreurs : échec qui peut venir d'ANZAR (environnement, isolation),
  // pas une erreur du code du projet. Envoi nettoyé, par lots, coupable dans les Paramètres.
  if (allowed && (call.function.name === 'run_command' || call.function.name === 'bash') && result.isError && !ctx.signal.aborted) {
    const out = result.output || '';
    const code = Number(/exit_code:\s*(-?\d+)/.exec(out)?.[1]);
    const exit = Number.isFinite(code) ? code : undefined;
    if (isEnvironmentFailure(out, exit)) {
      reportError({ kind: 'command', title: commandTitle(String(args.command || ''), exit), detail: out.split('\n').slice(-40).join('\n') });
    }
  }

  if (result.external) ctx.externalSources.push(result.external);
  // Recherche et lecture web : facturées à part par le serveur, ajoutées au coût de la réponse
  if (result.costFCFA) ctx.onToolCost?.(result.costFCFA);

  const delta = toolDelta(call.function.name, args, result.isError);
  if (delta) ev.delta = delta;

  ev.status = result.isError || result.failed ? 'error' : 'ok';
  if (!result.isError && result.media) ev.media = result.media;
  // Mode Auto : quatre échecs d'outils dans la même demande → un cran au-dessus (deux fois au plus)
  if (allowed && result.isError) ctx.onToolFailure?.();
  recordSessionEvent(ctx.convId, { type: 'tool', name: call.function.name, isError: !!result.isError, output: (result.output || '').slice(0, 300) });
  ev.output = (result.output || '').slice(0, MAX_TOOL_OUTPUT_DISPLAY);
  ctx.flush();

  if (allowed && !result.isError && WRITE_TOOLS.includes(call.function.name)) ctx.turn.filesWritten++;
  if (result.isDone) ctx.turn.doneInBatch = true;
  return {
    output: result.output || '(vide)',
    isError: result.isError,
    failed: result.failed,
    isDone: result.isDone,
    images: result.images,
    media: result.media,
  };
}
