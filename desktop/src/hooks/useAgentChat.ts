/**
 * useAgentChat — LE chat ANZAR (style ZCode).
 *
 * Une seule boucle : l'utilisateur parle, l'agent agit avec ses outils
 * (read_file, edit_file, run_command…) en streaming, jusqu'à réponse finale.
 * Plus aucune détection d'intention, plus d'injection de dossier en bloc :
 * l'agent lit les fichiers À LA DEMANDE via ses outils.
 *
 * Réutilise tels quels : aiService.chatStream, AGENT_TOOLS + executeToolCall
 * (sécurité Tauri allowlist + anti-traversal), buildAgentSystemPrompt/context,
 * usageStore (débit FCFA), chatStore (persistance conversation).
 */
import { useCallback, useRef, useState } from 'react';
import { aiService } from '@/services/ai/ai';
import { AGENT_TOOLS, executeToolCall } from '@/services/agent/agentTools';
import { buildAgentSystemPrompt, type AgentPromptContext } from '@/services/agent/agentPrompts';
import { buildAgentContext } from '@/services/agent/agentContext';
import { useChatStore } from '@/stores/chatStore';
import { useUsageStore } from '@/stores/usageStore';
import { refreshCredits } from '@/lib/credits';
import type { AIModel, APIMessage, ChatAttachment, Message, ToolCall } from '@/types';

/** Qui décide avant que l'agent agisse. */
export type PermissionMode = 'ask' | 'auto' | 'plan' | 'full';

/** Demande d'accord en attente (modes « ask » et « auto »). */
export interface ApprovalRequest {
  id: string;
  name: string;
  summary: string;
}

const EDIT_TOOLS = new Set(['write_file', 'edit_file', 'delete_file', 'remember']);
const COMMAND_TOOLS = new Set(['run_command', 'spawn_subagents']);
const READ_ONLY_TOOLS = new Set(['read_file', 'list_dir', 'search_files']);

function needsApproval(mode: PermissionMode, tool: string): boolean {
  if (mode === 'ask') return EDIT_TOOLS.has(tool) || COMMAND_TOOLS.has(tool);
  if (mode === 'auto') return COMMAND_TOOLS.has(tool);
  return false;
}

const PLAN_MODE_PROMPT = `

# MODE PLAN (actif)
Tu ne peux RIEN modifier ni exécuter : seuls read_file, list_dir et search_files sont disponibles.
Explore ce qu'il faut, puis réponds avec un plan d'action numéroté et concret (fichiers concernés, changements prévus, vérifications).
Termine en demandant à l'utilisateur de valider le plan.`;

/** Événement d'outil affichable dans le message (rendu ZCode). */
export interface ToolEvent {
  id: string;
  name: string;
  /** Argument principal lisible : chemin, commande, requête… */
  argsSummary: string;
  status: 'running' | 'ok' | 'error';
  /** Sortie tronquée pour affichage */
  output?: string;
  /** Delta de lignes pour edit_file/write_file : [ajoutées, supprimées] */
  delta?: [number, number];
}

const MAX_STEPS = 40;
const MAX_TOOL_OUTPUT_DISPLAY = 600;
// Le contenu joint est renvoyé au modèle à CHAQUE étape : on le borne pour maîtriser le coût.
const MAX_ATTACHMENT_CHARS = 40_000;
const MAX_ATTACHMENTS_TOTAL_CHARS = 100_000;

/** Ajoute le contenu des pièces jointes au message envoyé au modèle. */
function withAttachments(content: string, attachments: ChatAttachment[]): string {
  if (attachments.length === 0) return content;
  let budget = MAX_ATTACHMENTS_TOTAL_CHARS;
  const blocks = attachments.map((a) => {
    const label = `[${a.ref}] ${a.name} (${a.kind})`;
    if (a.kind === 'image') {
      return `${label}\n(Image jointe : son contenu visuel n'est pas lisible ici. Dis-le à l'utilisateur si sa demande en dépend.)`;
    }
    const full = (a.excerpt || '').trim();
    if (!full) return `${label}\n(Contenu illisible ou vide.)`;
    const take = Math.max(0, Math.min(full.length, MAX_ATTACHMENT_CHARS, budget));
    budget -= take;
    if (take === 0) return `${label}\n(Non inclus : limite de taille des pièces jointes atteinte.)`;
    const cut = take < full.length;
    return `${label}\n\`\`\`\n${full.slice(0, take)}\n\`\`\`${cut ? `\n(Tronqué : ${take.toLocaleString('fr-FR')} caractères sur ${full.length.toLocaleString('fr-FR')}. Préviens l'utilisateur si la suite est nécessaire.)` : ''}`;
  });
  return `${content}\n\n# Pièces jointes\n\n${blocks.join('\n\n')}`;
}

function summarizeArgs(name: string, args: Record<string, any>): string {
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'delete_file':
      return args.path || args.file_path || '';
    case 'list_dir':
      return args.path || '.';
    case 'search_files':
      return args.query || args.pattern || '';
    case 'run_command':
      return args.command || '';
    case 'spawn_subagents':
      return (args.tasks || []).length ? `${(args.tasks || []).length} sous-tâches` : '';
    case 'remember':
      return String(args.content || '').slice(0, 80);
    case 'task_done':
      return String(args.summary || '').slice(0, 100);
    default:
      return JSON.stringify(args).slice(0, 100);
  }
}

/** Assemble les tool_calls fragmentés du stream (pattern agentLoop). */
class Assembler {
  private calls = new Map<number, ToolCall>();
  add(fragments: Partial<ToolCall>[] = []) {
    for (const frag of fragments) {
      const index = (frag as any).index ?? 0;
      let call = this.calls.get(index);
      if (!call) {
        call = { id: frag.id || `call_${Date.now()}_${index}`, type: 'function', function: { name: '', arguments: '' } };
        this.calls.set(index, call);
      }
      if (frag.id) call.id = frag.id;
      if (frag.function?.name) call.function.name += frag.function.name;
      if (frag.function?.arguments) call.function.arguments += frag.function.arguments;
    }
  }
  finish(): ToolCall[] {
    return [...this.calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
  }
  get hasCalls() { return this.calls.size > 0; }
}

interface UseAgentChatParams {
  workspacePath: string | null;
  workspaceName?: string;
  model: AIModel;
  /** Mode de permission (défaut : accès complet). */
  permissionMode?: PermissionMode;
  /** Appelé quand un outil modifie un fichier (refresh explorateur/éditeur). */
  onFileChanged?: (relativePath: string, action: 'create' | 'edit' | 'delete') => void;
}

export function useAgentChat({ workspacePath, workspaceName, model, permissionMode = 'full', onFileChanged }: UseAgentChatParams) {
  const [isGenerating, setIsGenerating] = useState(false);
  // Le mode peut changer pendant que l'agent travaille : on lit toujours la valeur courante.
  const modeRef = useRef(permissionMode);
  modeRef.current = permissionMode;
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const approvalResolver = useRef<((ok: boolean) => void) | null>(null);

  const resolveApproval = useCallback((ok: boolean) => {
    approvalResolver.current?.(ok);
    approvalResolver.current = null;
    setApproval(null);
  }, []);
  const abortRef = useRef<AbortController | null>(null);
  // Historique API complet de la conversation (tool exchanges inclus), par conversation
  const apiHistoryRef = useRef<APIMessage[]>([]);
  const activeConvRef = useRef<string | null>(null);

  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const createConversation = useChatStore((s) => s.createConversation);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const setStoreGenerating = useChatStore((s) => s.setIsGenerating);
  const addUsage = useUsageStore((s) => s.addRecordAndDeduct);
  const addUsageRecord = useUsageStore((s) => s.addRecord);

  const ensureConversation = useCallback((): string => {
    if (activeConversationId) return activeConversationId;
    return createConversation(undefined, model).id;
  }, [activeConversationId, createConversation, model]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    resolveApproval(false);
  }, [resolveApproval]);

  const sendMessage = useCallback(async (content: string, rawAttachments: ChatAttachment[] = []) => {
    if (!content.trim() || isGenerating) return;
    const attachments = rawAttachments.slice(0, 8).map((a, i) => ({ ...a, ref: a.ref || String.fromCharCode(65 + i) }));
    const apiContent = withAttachments(content, attachments);
    const convId = ensureConversation();

    // Reset de l'historique API si on change de conversation
    if (activeConvRef.current !== convId) {
      apiHistoryRef.current = [];
      activeConvRef.current = convId;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setStoreGenerating(true);

    const userMsg: Message = {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      content,
      timestamp: Date.now(),
      // Affichage : nom et type seulement (le contenu part au modèle, pas dans l'historique local)
      attachments: attachments.length
        ? attachments.map(({ excerpt: _excerpt, ...rest }) => rest)
        : undefined,
    };
    addMessage(userMsg);

    const assistantId = `msg_${Date.now()}_a`;
    addMessage({
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      model,
      isStreaming: true,
      toolEvents: [],
    });

    let accContent = '';
    let accReasoning = '';
    const events: ToolEvent[] = [];
    let promptTokens = 0;
    let completionTokens = 0;
    const t0 = Date.now();
    // Solde serveur avant la tâche : la différence à la fin = coût réel facturé.
    const balanceBefore = await refreshCredits();
    const priceIn = model === 'thinking' ? 400 : 250;
    const priceOut = model === 'thinking' ? 900 : 500;
    const historyTokens = () =>
      Math.ceil(apiHistoryRef.current.reduce((n, m) => n + (m.content?.length || 0) + JSON.stringify(m.tool_calls || []).length, 0) / 4);

    const flush = () => {
      updateMessage(assistantId, {
        content: accContent,
        reasoning: accReasoning ? [accReasoning] : undefined,
        isStreaming: true,
        toolEvents: [...events],
      });
    };

    try {
      // ── System prompt : agent si workspace, chat simple sinon ──
      let system: APIMessage;
      if (workspacePath) {
        const ctx = await buildAgentContext(workspacePath, content).catch(() => null);
        const promptCtx: AgentPromptContext = {
          projectName: workspaceName || workspacePath.split('/').pop() || 'projet',
          projectRoot: workspacePath,
          codeMap: ctx?.codeMap,
          taskHints: ctx?.taskHints,
          memory: ctx?.memory,
          platform: navigator.platform.toLowerCase().includes('win') ? 'windows' : 'macos',
        };
        system = {
          role: 'system',
          content: buildAgentSystemPrompt(promptCtx) + (modeRef.current === 'plan' ? PLAN_MODE_PROMPT : ''),
        };
      } else {
        system = {
          role: 'system',
          content:
            'Tu es ANZAR, assistant de développement. Réponds en français, clair et direct. ' +
            "Aucun dossier de travail n'est ouvert : si l'utilisateur demande à créer ou modifier un projet, " +
            "propose-lui d'ouvrir un dossier (bouton « Ouvrir un dossier ») pour que tu puisses agir avec tes outils.",
        };
      }

      if (apiHistoryRef.current.length === 0) {
        // Reprise d'une conversation existante (redémarrage, changement de tâche) :
        // on redonne à l'agent les échanges texte précédents.
        const prior = (useChatStore.getState().conversations.find((c) => c.id === convId)?.messages || [])
          .filter((m) => m.id !== userMsg.id && m.id !== assistantId)
          .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
          .slice(-12)
          .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }) as APIMessage);
        apiHistoryRef.current.push(system, ...prior);
      } else {
        apiHistoryRef.current[0] = system;
      }
      apiHistoryRef.current.push({ role: 'user', content: apiContent });

      let answered = false;

      // ── Boucle agent ──
      for (let step = 0; step < MAX_STEPS; step++) {
        if (controller.signal.aborted) break;

        const assembler = new Assembler();
        let stepContent = '';
        let stepFinish: string | null = null;

        // Chaque étape renvoie tout l'historique au modèle : on le compte à chaque fois.
        promptTokens += historyTokens();
        const tools = !workspacePath
          ? undefined
          : modeRef.current === 'plan'
            ? AGENT_TOOLS.filter((t) => READ_ONLY_TOOLS.has(t.function.name))
            : AGENT_TOOLS;

        const stream = aiService.chatStream(apiHistoryRef.current, {
          model,
          tools,
          signal: controller.signal,
        });

        try {
          for await (const delta of stream) {
            if (delta.content) stepContent += delta.content;
            if (delta.reasoning_content) accReasoning += delta.reasoning_content;
            if (delta.tool_calls) assembler.add(delta.tool_calls);
            if (delta.finish_reason) stepFinish = delta.finish_reason;
          }
        } catch (e: any) {
          if (controller.signal.aborted) break;
          throw e;
        }

        // Le texte de chaque étape s'accumule (les étapes tool-only sont vides)
        if (stepContent) {
          accContent += (accContent ? '\n\n' : '') + stepContent;
          flush();
        }
        completionTokens += Math.ceil((stepContent.length + JSON.stringify(assembler.finish()).length) / 4);
        // Le serveur vient de facturer cette étape : on rafraîchit la pilule de solde.
        void refreshCredits();

        // ── Pas de tool calls → réponse finale ──
        if (!assembler.hasCalls) { answered = true; break; }

        // ── Exécution des outils ──
        const toolCalls = assembler.finish();
        apiHistoryRef.current.push({
          role: 'assistant',
          content: stepContent || null,
          tool_calls: toolCalls,
        });

        for (const call of toolCalls) {
          if (controller.signal.aborted) break;
          let args: Record<string, any> = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* garde */ }

          const ev: ToolEvent = {
            id: call.id,
            name: call.function.name,
            argsSummary: summarizeArgs(call.function.name, args),
            status: 'running',
          };
          events.push(ev);
          flush();

          // Accord de l'utilisateur selon le mode de permission
          let allowed = true;
          if (modeRef.current === 'plan' && !READ_ONLY_TOOLS.has(call.function.name) && call.function.name !== 'task_done') {
            allowed = false;
          } else if (needsApproval(modeRef.current, call.function.name)) {
            allowed = await new Promise<boolean>((resolve) => {
              approvalResolver.current = resolve;
              setApproval({ id: call.id, name: call.function.name, summary: ev.argsSummary });
            });
          }

          const result = !allowed
            ? { output: "Refusé par l'utilisateur. N'insiste pas : propose une autre approche ou demande-lui ce qu'il préfère.", isError: true }
            : workspacePath
            ? await executeToolCall(call, {
                projectRoot: workspacePath,
                signal: controller.signal,
                onFileChanged: (rel, _c, action) => onFileChanged?.(rel, action),
              })
            : { output: 'Aucun dossier de travail ouvert.', isError: true };

          // Delta de lignes pour les edits
          if (['write_file', 'edit_file'].includes(call.function.name)) {
            const body = typeof result.output === 'string' ? result.output : '';
            const m = body.match(/\+(\d+)(?:\s*\/\s*−(\d+)|\s*-\s*(\d+))?/);
            ev.delta = m ? [parseInt(m[1]), parseInt(m[2] || m[3] || '0')] : undefined;
          }

          ev.status = result.isError ? 'error' : 'ok';
          ev.output = (result.output || '').slice(0, MAX_TOOL_OUTPUT_DISPLAY);
          flush();

          apiHistoryRef.current.push({
            role: 'tool',
            tool_call_id: call.id,
            content: result.output || '(vide)',
          });

          // task_done → son résumé EST la réponse finale
          if (result.isDone) {
            const summary = String(result.output || '').trim();
            if (summary && !accContent.includes(summary)) {
              accContent += (accContent ? '\n\n' : '') + summary;
            }
            answered = true;
            flush();
            break;
          }
        }
        if (answered) break;

        // Le contenu final remplace l'accumulation d'étapes intermédiaires vides
        if (stepContent && step < MAX_STEPS - 1) {
          // l'étape suivante produira la suite (réponse ou nouveaux outils)
        }
      }

      // ── Limite d'étapes atteinte sans réponse → synthèse forcée, sans outils ──
      if (!answered && !controller.signal.aborted) {
        promptTokens += historyTokens();
        apiHistoryRef.current.push({
          role: 'user',
          content:
            "Limite d'étapes atteinte. N'utilise plus aucun outil. Donne maintenant ta réponse finale complète, " +
            "en français, à partir de ce que tu as déjà lu. Si le travail est incomplet, dis précisément ce qui reste.",
        });
        let finalText = '';
        for await (const delta of aiService.chatStream(apiHistoryRef.current, { model, signal: controller.signal })) {
          if (delta.content) {
            finalText += delta.content;
            updateMessage(assistantId, {
              content: accContent + (accContent ? '\n\n' : '') + finalText,
              isStreaming: true,
              toolEvents: [...events],
            });
          }
        }
        if (finalText) accContent += (accContent ? '\n\n' : '') + finalText;
        completionTokens += Math.ceil(finalText.length / 4);
      }

      // ── Finalisation ──
      // Réponse finale dans l'historique API
      apiHistoryRef.current.push({ role: 'assistant', content: accContent });

      // ── Coût réel : différence de solde serveur (le backend facture chaque appel) ──
      const estimate = Math.round((promptTokens / 1_000_000) * priceIn + (completionTokens / 1_000_000) * priceOut);
      await new Promise((r) => setTimeout(r, 600)); // laisse le serveur enregistrer le dernier appel
      const balanceAfter = await refreshCredits();
      const fromServer = balanceBefore !== null && balanceAfter !== null;
      const costFCFA = fromServer ? Math.max(0, Math.round((balanceBefore - balanceAfter) * 100) / 100) : estimate;

      updateMessage(assistantId, {
        content: accContent,
        reasoning: accReasoning ? [accReasoning] : undefined,
        isStreaming: false,
        tokens: { prompt: promptTokens, completion: completionTokens },
        costFCFA,
        toolEvents: [...events],
      });

      const record = {
        provider: 'deepseek' as const,
        model,
        taskType: 'agent_chat',
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        costUSD: Math.round((costFCFA / 615) * 10000) / 10000,
        costFCFA,
        wasFallback: false,
        timestamp: Date.now(),
        durationMs: Date.now() - t0,
      };
      // Solde déjà synchronisé depuis le serveur → on journalise sans redébiter.
      if (fromServer) addUsageRecord(record);
      else addUsage(record);
    } catch (e: any) {
      const aborted = controller.signal.aborted;
      updateMessage(assistantId, {
        content: aborted
          ? (accContent ? `${accContent}\n\n_(interrompu)_` : '_(génération interrompue)_')
          : `${accContent ? accContent + '\n\n' : ''}**Erreur** — ${e?.message || 'service indisponible'}. L'agent s'est arrêté avant de répondre ; renvoie ton message pour reprendre.`,
        isStreaming: false,
        isError: !aborted,
        toolEvents: [...events],
      });
    } finally {
      setIsGenerating(false);
      setStoreGenerating(false);
      abortRef.current = null;
      approvalResolver.current = null;
      setApproval(null);
      void refreshCredits();
    }
  }, [isGenerating, ensureConversation, addMessage, updateMessage, setStoreGenerating, model, workspacePath, workspaceName, onFileChanged, addUsage, addUsageRecord]);

  return { sendMessage, stop, isGenerating, approval, resolveApproval };
}
