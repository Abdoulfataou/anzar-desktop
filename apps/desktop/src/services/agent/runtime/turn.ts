/**
 * Exécution d'un tour de conversation : préparation, boucle d'outils, replis, vérification,
 * finalisation et reprise. `agentRunner` ne garde que la session (état, accords, questions,
 * durée de vie) et délègue le tour ici via `TurnHost`.
 *
 * Ce module est le seul endroit qui connaît l'enchaînement complet d'une demande.
 */
import type {
  AIModel, APIMessage, ChatAttachment, Message, TimelineItem, ToolCall, ToolDefinition, ToolEvent,
} from '@/types';
import type { ExternalSource } from '@/services/agent/policy/untrusted';
import { DEFAULT_MAX_STEPS, runAgentEngine, type AgentStopReason } from '@/services/agent/engine/agentSession';
import { BACKGROUND_BUDGET, BudgetLedger, CHAT_BUDGET } from '@/services/agent/engine/budget';
import {
  closeDanglingToolCalls, compactHistory,
  KEEP_RECENT_TOOL_RESULTS, SOFT_LIMIT_TOKENS, STUB_CHARS, pruneToolResults,
} from '@/services/agent/engine/history';
import { CONDENSER_PROMPT, condenseHistory } from '@/services/agent/engine/condenser';
import type { PermissionMode } from '@/services/agent/policy/permissions';
import { loadSession, recordSessionEvent, saveSession } from './sessionStore';
import { loadPersonalInstructions, personalInstructionsSection } from '@/services/workspace/personalInstructions';
import { aiService, markSlowNetwork } from '@/services/ai/ai';
import { mcpAgentTools, setMcpRoots } from '@/services/mcp/manager';
import { listSkills, skillsPromptSection, type Skill } from '@/services/skills';
import { useSettingsStore } from '@/stores/settingsStore';
import { buildSessionSystemPrompt } from '@/services/agent/context/systemPrompt';
import { sandboxEnabled } from '@/services/runtime/terminal';
import { takeLiveNotifications } from '@/services/agent/subagents/live';
import { withAttachments } from '@/services/agent/context/attachments';
import { resolveAgentRoot } from '@/services/agent/context/agentRoot';
import { buildAgentContext } from '@/services/agent/context/agentContext';
import { useChatStore } from '@/stores/chatStore';
import { useUsageStore } from '@/stores/usageStore';
import { refreshCredits } from '@/lib/credits';
import { routeRequest, escalate, type Route } from '@/services/ai/autoRouter';
import type { AgentQuestion, QuestionAnswer } from '@/services/agent/tools/questions';
import {
  appendTimelineText, appendTimelineTool,
  estimateCompletionTokens, estimateHistoryTokens, snapshotTimeline,
} from '@/services/agent/engine/chatSession';
import type { Snapshots } from '@/services/agent/tools/fileChanges';
import { copyAttachmentsToWorkspace } from '@/services/workspace/attachmentFiles';
import {
  PERSONAL_SUBDIR, conversationUsesPersonalSpace, ensurePersonalSpace, personalSpaceContext,
} from '@/services/workspace/personalSpace';

import { CAPTURE_MARK, setupNewTurn } from './sessionSetup';
import { buildToolsForStep } from './toolList';
import { runToolCall, toolEventFor, type ToolRunContext, type TurnToolState } from './toolHost';
import { runExportRescue, runForcedFinalAnswer, type TurnSink } from './turnFallbacks';
import { failTurn, finishTurn } from './turnFinish';
import { startTurn } from './turnStart';
import { beginTurn } from '@/services/workspace/gitChanges';
import { createTurnVerifier } from './turnVerify';
import { estimateFcfa, newServerCost, type ServerCost } from './turnAccounting';
import type {
  AgentChatResult, TurnHost, TurnInput,
} from './turnTypes';

export type { TurnHost, TurnInput } from './turnTypes';

/** Attente avant chaque nouvelle tentative quand une étape est coupée (ms). */
const RETRY_DELAYS = [2000, 5000, 10000];

/** Une erreur de solde ou d'authentification ne se règle pas en réessayant. */
function isRetryable(e: any): boolean {
  const msg = String(e?.message || '');
  return !/cr[ée]dit|quota|solde|recharge|401|402|403|non autoris|unauthori[sz]ed|token/i.test(msg);
}

const MAX_STEPS = DEFAULT_MAX_STEPS;
const MAX_TOOL_OUTPUT_DISPLAY = 600;
/** Demande une animation ou une vidéo : l'export doit toujours être livré. */
const MOTION_DELIVERABLE = /vid[ée]o|animation|motion|\bpub\b|publicit|reel|story|format (mp4|gif)|export/i;

/** Déroule un tour complet. Renvoie `null` si un tour est déjà en cours. */
export async function runTurn(host: TurnHost, input: TurnInput): Promise<AgentChatResult | null> {
  const { content, resumeFrom } = input;
  if ((!content.trim() && !resumeFrom) || host.state.isGenerating) return null;

  // La préparation construit l'état du tour ; la suite ne fait que le faire avancer.
  const { session: s, progress: p } = await startTurn(host, input);
  const {
    convId, agentRoot, workspacePath, workspaceName, model, background, personalSpace,
    attachments, apiContent, userMsg, assistantId, controller, onFileChanged,
    budget, balanceBefore, cost, startedAt: t0, events, timeline, snapshots,
    externalSources, turn, toolEvents, skills, personal, webEnabled, mcpTools,
    verifier, flush, flushLive, appendContent, sink, persist, offBudget, callModel,
  } = s;

  const { updateMessage, setIsGenerating: setStoreGenerating } = useChatStore.getState();
  const { addRecordAndDeduct: addUsage, addRecord: addUsageRecord } = useUsageStore.getState();

    try {
      if (resumeFrom) {
        closeDanglingToolCalls(host.apiHistory);
      } else {
        // Cache DeepSeek : le début de la requête doit rester IDENTIQUE d'un appel à
        // l'autre. Le prompt système ne contient que ce qui change rarement ; la carte du
        // code, les indices de la tâche et le mode plan vont dans la demande, en fin de requête.
        const freshHistory = host.apiHistory.length === 0;
        const ctx = workspacePath
          ? await buildAgentContext(workspacePath, content).catch(() => null)
          : null;
        const isWindows = navigator.platform.toLowerCase().includes('win');
        const bundle = buildSessionSystemPrompt({
          workspacePath,
          workspaceName,
          freshHistory,
          planMode: host.mode === 'plan',
          webEnabled,
          personal,
          skillsSection: skillsPromptSection(skills),
          memory: ctx?.memory,
          codeMap: ctx?.codeMap,
          taskHints: ctx?.taskHints,
          platform: isWindows ? 'windows' : 'macos',
          personalSpaceContext: personalSpace && agentRoot ? personalSpaceContext(agentRoot) : '',
          permissionMode: host.mode,
          shellAvailable: !isWindows,
          sandboxed: sandboxEnabled(),
        });
        setupNewTurn({
          apiHistory: host.apiHistory,
          lastCallAt: host.lastCallAt,
          apiContent,
          attachments,
          priorMessages: useChatStore.getState().conversations.find((c) => c.id === convId)?.messages || [],
          userMsgId: userMsg.id,
          assistantId,
          prompt: bundle,
        });
      }

      let answered = false;

      const toolsForStep = () => buildToolsForStep({
        mode: host.mode,
        workspacePath,
        webEnabled,
        background,
        personalSpace,
        hasSkills: skills.length > 0,
        mcpTools,
      });

      // Hôte d'outils : le mode est lu à chaque appel (il peut changer en cours de tour).
      const toolCtx: ToolRunContext = {
        convId,
        agentRoot,
        workspacePath,
        get mode(): PermissionMode { return host.mode; },
        background,
        personalSpace,
        signal: controller.signal,
        skills,
        events,
        toolEvents,
        timeline,
        externalSources,
        snapshots,
        turn,
        flush,
        requestApproval: host.requestApproval,
        requestAnswers: host.requestAnswers,
        updateMessage,
        assistantId,
        onFileChanged,
        beforeFirstWrite: async () => {
          await verifier.ensureBaseline();
        },
        beforeFirstChange: async () => {
          // Référence git AVANT toute commande ou écriture (npm install peut modifier
          // package.json sans passer par un outil). En cas d'échec, la carte retombe sur
          // les snapshots.
          if (agentRoot) await beginTurn(agentRoot).catch(() => undefined);
        },
        onToolCost: (c) => {
          cost.sum += c;
          budget.charge({ fcfa: c });
          host.opts.onProgress?.({ costFCFA: cost.sum });
        },
        // Sous-agents : chacun reçoit une fraction du budget restant du tour.
        childBudget: (share, capFcfa) => budget.child(share, capFcfa),
        onToolFailure: () => {
          if (!p.route) return;
          p.toolErrors++;
          // Quatre échecs d'outils dans la même demande → un cran au-dessus (deux fois au plus)
          if (p.toolErrors >= 4 && p.escalations < 2) {
            const up = escalate(p.route, `monté après ${p.toolErrors} échecs (${p.route.reason})`);
            if (up) {
              p.route = up;
              p.escalations++;
              p.toolErrors = 0;
              updateMessage(assistantId, { autoRoute: { ...up, escalated: true } });
              host.lastRoute = up;
            }
          }
        },
      };

      // Même affichage pour la boucle principale et pour le sauvetage d'export.
      const handleToolCall = (call: ToolCall) => {
        const ev = toolEventFor(call);
        toolEvents.set(call.id, ev);
        events.push(ev);
        appendTimelineTool(timeline, ev.id);
        flush();
      };

      const historyLengthBeforeEngine = host.apiHistory.length;
      const session = await runAgentEngine({
        messages: host.apiHistory,
        tools: toolsForStep,
        maxSteps: MAX_STEPS,
        budget,
        // Le chat principal n'impose pas de plafond d'erreurs d'outils : le mode Auto escalade.
        maxConsecutiveErrors: 0,
        signal: controller.signal,
        beforeStep: async () => {
          // Les sous-agents vivants qui viennent de finir parlent au parent au début du
          // pas suivant, comme une notification de Harness.
          const childNotes = takeLiveNotifications(convId);
          if (childNotes.length > 0) {
            host.apiHistory.push({ role: 'user', content: childNotes.join('\n\n') });
          }
          // Compaction en une fois, seulement au-delà du plafond, pour garder le cache.
          if (estimateHistoryTokens(host.apiHistory) > SOFT_LIMIT_TOKENS) {
            // 1. Élaguer les vieux résultats en gardant début et fin.
            pruneToolResults(host.apiHistory, KEEP_RECENT_TOOL_RESULTS);
            // 2. Si cela ne suffit pas, réduire fortement les anciens résultats.
            if (estimateHistoryTokens(host.apiHistory) > SOFT_LIMIT_TOKENS * 0.8) {
              compactHistory(host.apiHistory, KEEP_RECENT_TOOL_RESULTS, STUB_CHARS);
            }
            // 3. En dernier recours, résumer le début du travail par le modèle.
            if (estimateHistoryTokens(host.apiHistory) > SOFT_LIMIT_TOKENS * 0.6) {
              // Encore trop long : le début du travail est résumé par le modèle (rapide, réflexion
              // courte) ; si le résumé échoue, repli sur une compaction plus forte.
              const condensed = await condenseHistory(host.apiHistory, {
                keepRecent: 12,
                summarize: async (text) => {
                  const res: any = await aiService.chat(
                    [{ role: 'system', content: CONDENSER_PROMPT }, { role: 'user', content: text }],
                    { model: 'fast', reasoningEffort: 'low', signal: controller.signal },
                  );
                  const fcfa = Number(res?.anzar?.cost_fcfa);
                  if (Number.isFinite(fcfa) && fcfa > 0) { cost.sum += fcfa; cost.reports++; budget.charge({ fcfa }); }
                  cost.calls++;
                  return String(res?.choices?.[0]?.message?.content || '');
                },
              });
              recordSessionEvent(convId, { type: 'condense', ok: condensed });
              if (!condensed) compactHistory(host.apiHistory, 2, 300);
            }
          }
          p.stepTokensIn = estimateHistoryTokens(host.apiHistory);
          p.promptTokens += p.stepTokensIn;
          budget.charge({ tokensIn: p.stepTokensIn });
        },
        stream: (messages, tools) =>
          aiService.chatStream(messages, { model: callModel(), tools, signal: controller.signal }),
        retry: {
          attempts: RETRY_DELAYS.length,
          delayMs: (attempt) => RETRY_DELAYS[attempt],
          isRetryable,
        },
        onStepStart: () => {
          p.stepContent = '';
          p.stepReasoning = '';
          p.stepCostAtStart = cost.sum;
          turn.stepImages = [];
          turn.doneInBatch = false;
        },
        onTextDelta: (text) => {
          p.stepContent += text;
          flushLive(p.stepContent);
        },
        onReasoningDelta: (text) => {
          p.stepReasoning += text;
          // Le raisonnement remonte AUSSI en direct
          flushLive(p.stepContent);
        },
        onStepEnd: ({ step, text, reasoning, toolCalls }) => {
          recordSessionEvent(convId, { type: 'step', step, text: text.length, toolCalls: toolCalls.map((c) => c.function.name) });
          p.reasoning += reasoning;
          if (text) {
            appendContent(text);
            flush();
          }
          const stepTokensOut = estimateCompletionTokens(text, toolCalls);
          p.completionTokens += stepTokensOut;
          budget.charge({ tokensOut: stepTokensOut });
          // Aucun coût serveur pour cette étape : on estime pour que le plafond FCFA reste juste.
          if (cost.sum === p.stepCostAtStart) budget.charge({ fcfa: estimateFcfa(p.stepTokensIn, stepTokensOut) });
          sink.onModelCall();
          host.opts.onProgress?.({ costFCFA: cost.sum });
          void refreshCredits();
          if (p.retryNoticeShown) {
            updateMessage(assistantId, { notice: undefined });
            p.retryNoticeShown = false;
          }
          p.stepContent = '';
          p.stepReasoning = '';
        },
        onCostDelta: (c) => sink.addModelCost(c),
        onRetry: (attempt, wait) => {
          markSlowNetwork();
          p.retryNoticeShown = true;
          updateMessage(assistantId, {
            notice: `Connexion perdue — nouvelle tentative dans ${wait / 1000} s (${attempt}/${RETRY_DELAYS.length})…`,
          });
          p.stepContent = '';
          p.stepReasoning = '';
          flush();
        },
        // ── Vérification automatique (Verify → Fix → Verify) ──
        // À la fin du tour (réponse naturelle ou task_done), si l'agent a modifié le
        // projet : lint / build / tests détectés. En cas d'échec, les erreurs sont
        // renvoyées à l'agent et le tour continue.
        shouldVerify: () => turn.filesWritten > 0 && verifier.enabled && host.mode !== 'plan',
        maxVerifyAttempts: 3,
        verify: () => verifier.verify(),
        onToolCall: handleToolCall,
        onImages: (images) => { turn.stepImages.push(...images); },
        onToolBatchEnd: () => {
          if (turn.stepImages.length && !turn.doneInBatch) {
            host.apiHistory.push({
              role: 'user',
              content: [
                { type: 'text', text: `${CAPTURE_MARK} ${turn.stepImages.map((im, i) => `${i + 1}. ${im.label}`).join(' ; ')}` },
                ...turn.stepImages.slice(0, 8).map((im) => ({ type: 'image_url' as const, image_url: { url: im.dataUrl, detail: 'auto' as const } })),
              ],
            });
          }
          turn.stepImages = [];
          persist();
        },
        executeTool: (call) => runToolCall(call, toolCtx),
      });

      p.stopReason = session.stopReason;
      if (session.stopReason === 'error') {
        throw new Error(session.errorMessage || session.summary || 'Erreur du modèle');
      }
      if (session.stopReason === 'budget_exhausted') {
        // Le plafond est un plafond : pas d'appel de synthèse supplémentaire.
        if (session.summary) appendContent(session.summary);
        answered = true;
      } else if (session.stopReason === 'loop_detected') {
        // On explique la boucle, puis la synthèse forcée (sans outil) fait le bilan.
        if (session.summary) appendContent(session.summary);
      } else if (session.stopReason === 'task_done') {
        const summary = String(session.summary || '').trim();
        if (summary && !p.content.includes(summary)) {
          appendContent(summary);
        }
        answered = true;
      } else if (session.stopReason === 'plan') {
        turn.planProposed = true;
        answered = true;
      } else if (session.stopReason === 'final_answer') {
        answered = true;
      }
      // aborted / max_steps / verify_failed : answered reste false → reprise, synthèse ou coupe.

      // Mode plan : si le modèle a écrit le plan en texte au lieu d'appeler propose_plan
      if (host.mode === 'plan' && !turn.planProposed && answered) {
        const last = [...timeline].reverse().find((t) => t.kind === 'text') as { kind: 'text'; text: string } | undefined;
        if (last && last.text.length > 200) {
          const heading = /^#{1,3}\s+(.+)$/m.exec(last.text)?.[1];
          updateMessage(assistantId, { plan: { title: (heading || 'Plan proposé').slice(0, 80), markdown: last.text, status: 'pending' } });
        }
      }

      // ── Garantie d'export : la tâche porte sur des animations/vidéos et AUCUN
      // export n'a réussi (budget brûlé en retouches) → UNE passe supplémentaire
      // où seul export_animation est permis, avant la synthèse finale. La vidéo
      // doit toujours être livrée.
      const hasExport = events.some((e) => e.name === 'export_animation' && e.status === 'ok');
      // Ce sauvetage appelle directement executeToolCall : hors Full, il contournerait
      // l'approbation de l'outil. On le réserve donc au mode Full.
      // Une boucle détectée n'est pas un budget épuisé : inutile de relancer un sauvetage d'export.
      const looped = session.stopReason === 'loop_detected';
      if (!answered && !looped && !controller.signal.aborted && host.mode === 'full' && MOTION_DELIVERABLE.test(host.userRequest || '') && !hasExport && agentRoot) {
        const rescue = await runExportRescue({
          apiHistory: host.apiHistory,
          signal: controller.signal,
          callModel,
          sink,
          // Même hôte d'outils que la boucle principale : politique, événements et budget.
          executeTool: (call, step) => runToolCall(call, toolCtx),
          onToolCall: handleToolCall,
        });
        // Conclusion écrite pendant le sauvetage : inutile de forcer une synthèse en plus.
        if (rescue.answered) answered = true;
      }

      // ── Limite d'étapes atteinte sans réponse → synthèse forcée, sans outils ──
      if (!answered && !controller.signal.aborted) {
        await runForcedFinalAnswer({ apiHistory: host.apiHistory, signal: controller.signal, callModel, sink });
      }

      // ── Finalisation ──
      return finishTurn({
        apiHistory: host.apiHistory,
        historyLengthBeforeEngine,
        assistantId,
        convId,
        agentRoot,
        events,
        timeline,
        snapshots,
        content: p.content,
        reasoning: p.reasoning,
        promptTokens: p.promptTokens,
        completionTokens: p.completionTokens,
        cost,
        balanceBefore,
        model,
        startedAt: t0,
        stopReason: p.stopReason,
        aborted: controller.signal.aborted,
        updateMessage,
        recordSessionEvent,
        persist,
        addUsage,
        addUsageRecord,
      });
    } catch (e: any) {
      return failTurn({
        apiHistory: host.apiHistory,
        assistantId,
        convId,
        agentRoot,
        events,
        timeline,
        snapshots,
        content: p.content,
        reasoning: p.reasoning,
        promptTokens: p.promptTokens,
        completionTokens: p.completionTokens,
        cost,
        balanceBefore,
        model,
        startedAt: t0,
        error: e,
        aborted: controller.signal.aborted,
        costFCFA: p.costFCFA,
        route: p.route,
        setResumeState: (state) => { host.resumeState = state; },
        updateMessage,
        recordSessionEvent,
        persist,
      });
    } finally {
      offBudget();
      host.setState({ isGenerating: false });
      if (!background) setStoreGenerating(false);
      host.abort = null;
      host.clearPending();
      void refreshCredits();
    }
}
