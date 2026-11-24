/**
 * Hôte d'outils d'un tour de conversation.
 *
 * Deux responsabilités, sorties de l'adaptateur pour être lisibles et testables :
 * - composer la liste d'outils envoyée au modèle selon le mode, le projet et les skills ;
 * - exécuter un appel d'outil : décision d'approbation, garde des commandes, connecteurs
 *   MCP, outils spéciaux (ask_user, load_skill, propose_plan), reprise réseau, journal.
 *
 * Aucune dépendance à React ni aux stores : l'état mutable du tour et les effets d'UI
 * sont fournis par l'appelant (`ToolRunContext`).
 */
import type { Message, TimelineItem, ToolCall, ToolEvent } from '@/types';
import type { PermissionMode } from '../policy/permissions';
import type { AgentToolOutcome } from '../engine/agentSession';
import { approvalDecision } from '../policy/toolPolicy';
import { commandRisk, noteAgentWrite } from '../policy/commandGuard';
import { externalReason, type ExternalSource } from '../policy/untrusted';
import { executeGenericTool } from '../tools/toolExecution';
import { summarizeArgs, toolDelta, toolFilePath } from '../tools/toolDisplay';
import { askUser, loadSkill, parsePlan } from '../tools/specialTools';
import { type AgentQuestion, type QuestionAnswer } from '../tools/questions';
import { detectDevCommand } from '../tools/devServer';
import { snapshotBeforeChange, type Snapshots } from '../tools/fileChanges';
import { isMcpTool, mcpNeedsApproval, mcpToolRef } from '@/services/mcp/manager';
import { NETWORK_BLOCKED_TAG, NETWORK_BYPASS_TAG, NETWORK_UNREACHABLE_TAG, terminalService } from '@/services/runtime/terminal';
import { commandTitle, isEnvironmentFailure, reportError } from '@/services/infra/errorReports';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Skill } from '@/services/skills';
import { recordSessionEvent } from './sessionStore';
import type { ApprovalRequest } from './turnTypes';

/** Taille maximale d'une sortie d'outil conservée pour l'affichage. */
const MAX_TOOL_OUTPUT_DISPLAY = 600;

/** Outils qui écrivent sur le disque (déclenchent la vérification au task_done). */
const WRITE_TOOLS = ['write_file', 'edit_file', 'delete_file'];
/** Outils susceptibles de modifier le projet : leurs commandes comptent dans la carte. */
const MUTATING_TOOLS = new Set([...WRITE_TOOLS, 'run_command', 'start_dev_server']);

/** Outils dont l'exécution passe par une commande (risque calculé par commandGuard). */
const COMMAND_LIKE = ['run_command', 'spawn_subagents', 'start_dev_server'];

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
  /** Dossier où l'agent peut agir (projet ou espace ANZAR). */
  agentRoot: string | null;
  /** Projet ouvert, s'il y en a un. */
  workspacePath: string | null;
  mode: PermissionMode;
  background: boolean;
  personalSpace: boolean;
  /** L'utilisateur a déjà autorisé le code de l'agent dans cette conversation. */
  trusted: boolean;
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
  requestApproval: (request: ApprovalRequest) => Promise<boolean>;
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
  /** Mémorise que l'utilisateur a autorisé le code de l'agent dans cette conversation. */
  onTrustConversation: () => void;
  /**
   * Juste avant la première écriture du tour : capture de l'état de vérification du projet.
   * Un échec ici ne doit jamais empêcher l'écriture.
   */
  beforeFirstWrite?: () => Promise<void>;
  /** Avant la première commande ou écriture du tour : point de départ des changements. */
  beforeFirstChange?: () => Promise<void>;
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

  // Commande qui exécute du code écrit par l'agent, installation, script npm sensible :
  // accord demandé hors « Accès complet » (garde S3, voir approvalDecision)
  const riskCommand = call.function.name === 'run_command'
    ? String(args.command || '')
    : call.function.name === 'start_dev_server' && ctx.workspacePath
    ? String(args.command || (await detectDevCommand(ctx.workspacePath).catch(() => null)) || '')
    : '';
  const risk = riskCommand && ctx.agentRoot && ctx.mode !== 'plan'
    ? await commandRisk(ctx.convId, ctx.agentRoot, riskCommand, {
      trustedPrograms: useSettingsStore.getState().settings.trustedPrograms || [],
    }).catch(() => null)
    : null;

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
    risk,
    personalSpace: ctx.personalSpace,
    trusted: ctx.trusted,
    mcpAction: !!mcpRef && !mcpReadOnly,
    external: ctx.externalSources.length ? { suspicious: ctx.externalSources.some((x) => x.suspicious) } : null,
  });
  const afterExternal = ctx.externalSources.length > 0
    && (COMMAND_LIKE.includes(call.function.name) || (!!mcpRef && !mcpReadOnly));
  let allowed = decision.allowed;
  const refusal = decision.refusal ?? "Refusé par l'utilisateur. N'insiste pas : propose une autre approche ou demande-lui ce qu'il préfère.";
  if (decision.ask) {
    const scope = ctx.personalSpace && risk ? "Autoriser vaut pour toute cette conversation dans l'espace ANZAR." : undefined;
    const reason = [risk?.reason, afterExternal ? externalReason(ctx.externalSources) : '']
      .filter(Boolean).join(' ; ') || undefined;
    allowed = await ctx.requestApproval({
      id: call.id,
      name: call.function.name,
      summary: ev.argsSummary,
      reason,
      detail: risk?.detail,
      scope,
      trustProgram: risk?.unknownProgram,
    });
    if (allowed && ctx.personalSpace && risk) ctx.onTrustConversation();
  }
  // Installation acceptée : Rust ne la lance qu'avec cet accord (usage unique)
  if (allowed && risk && call.function.name === 'run_command') terminalService.grantInstall(riskCommand);

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
    await noteAgentWrite(ctx.convId, ctx.agentRoot, args.path || args.file_path).catch(() => {});
    await snapshotBeforeChange(ctx.snapshots, ctx.agentRoot, args.path || args.file_path);
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
    onFileChanged: (rel, action) => { if (ctx.workspacePath) ctx.onFileChanged?.(rel, action); },
    onSubagentProgress: call.function.name === 'spawn_subagents'
      ? (progress) => { ev.subagents = progress; ctx.flush(''); }
      : undefined,
  });
  let result: {
    output: string;
    isError?: boolean;
    isDone?: boolean;
    costFCFA?: number;
    images?: { label: string; dataUrl: string }[];
    media?: ToolEvent['media'];
    external?: ExternalSource;
  } = !allowed
    ? { output: refusal, isError: true }
    : await runTool();

  // Réseau coupé par l'isolation : on demande ici, sans passer par les Paramètres,
  // puis on relance la commande une fois avec internet.
  if (allowed && !ctx.background && call.function.name === 'run_command' && result.isError
    && (result.output || '').includes(NETWORK_BLOCKED_TAG) && !ctx.signal.aborted) {
    const command = String(args.command || '');
    // « Accès complet » accepté : internet accordé sans demander.
    const ok = ctx.mode === 'full' || await ctx.requestApproval({
      id: call.id,
      name: call.function.name,
      summary: ev.argsSummary,
      reason: "cette commande a besoin d'internet. Autoriser son accès réseau (cette commande uniquement, jusqu'à la fermeture d'ANZAR) ?",
      detail: command,
    });
    if (ok) {
      terminalService.grantNetwork(command);
      // L'accord d'installation est à usage unique : la relance en a encore besoin.
      if (risk) terminalService.grantInstall(riskCommand);
      result = await runTool();
    } else {
      result = { ...result, output: `${result.output}\nL'utilisateur a refusé l'accès internet pour cette commande. Ne contourne pas : fais sans, ou explique-lui ce qui manque.` };
    }
  }

  // Diagnostic réseau automatique (Rust) : traité ici, sans rien demander à l'utilisateur.
  // - l'outil ignore le relais (Dart/Flutter, certains SDK) : relance une fois sans relais,
  //   ce que Rust n'accepte que pour une commande à qui il donne déjà internet ;
  // - hôte injoignable (connexion instable) : nouvel essai après une courte pause.
  if (allowed && call.function.name === 'run_command' && result.isError && !ctx.signal.aborted) {
    const command = String(args.command || '');
    const out = result.output || '';
    const bypass = out.includes(NETWORK_BYPASS_TAG);
    if (bypass || out.includes(NETWORK_UNREACHABLE_TAG)) {
      if (bypass) terminalService.grantDirect(command);
      else {
        await new Promise<void>((r) => {
          const t = setTimeout(r, 3000);
          ctx.signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
        });
      }
      if (risk) terminalService.grantInstall(riskCommand);
      if (!ctx.signal.aborted) {
        const retry = await runTool();
        result = retry.isError
          ? { ...retry, output: `${retry.output}\n[ANZAR] Nouvel essai automatique déjà fait. Si c'est encore le réseau, dis-le simplement à l'utilisateur (connexion internet) au lieu de chercher un contournement.` }
          : retry;
      }
    }
  }

  // Suivi des erreurs : échec qui peut venir d'ANZAR (environnement, réseau, isolation),
  // pas une erreur du code du projet. Envoi nettoyé, par lots, coupable dans les Paramètres.
  if (allowed && call.function.name === 'run_command' && result.isError && !ctx.signal.aborted) {
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

  ev.status = result.isError ? 'error' : 'ok';
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
    isDone: result.isDone,
    images: result.images,
    media: result.media,
  };
}
