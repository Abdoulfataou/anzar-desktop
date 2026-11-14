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
import type { AIModel, APIMessage, Message, ToolCall } from '@/types';

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

const MAX_STEPS = 30;
const MAX_TOOL_OUTPUT_DISPLAY = 600;

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
  /** Appelé quand un outil modifie un fichier (refresh explorateur/éditeur). */
  onFileChanged?: (relativePath: string, action: 'create' | 'edit' | 'delete') => void;
}

export function useAgentChat({ workspacePath, workspaceName, model, onFileChanged }: UseAgentChatParams) {
  const [isGenerating, setIsGenerating] = useState(false);
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

  const ensureConversation = useCallback((): string => {
    if (activeConversationId) return activeConversationId;
    return createConversation(undefined, model).id;
  }, [activeConversationId, createConversation, model]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isGenerating) return;
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
        system = { role: 'system', content: buildAgentSystemPrompt(promptCtx) };
      } else {
        system = {
          role: 'system',
          content:
            'Tu es ANZAR, assistant de développement. Réponds en français, clair et direct. ' +
            "Aucun dossier de travail n'est ouvert : si l'utilisateur demande à créer ou modifier un projet, " +
            "propose-lui d'ouvrir un dossier (bouton « Ouvrir un dossier ») pour que tu puisses agir avec tes outils.",
        };
      }

      apiHistoryRef.current.push(system, { role: 'user', content });

      // ── Boucle agent ──
      for (let step = 0; step < MAX_STEPS; step++) {
        if (controller.signal.aborted) break;

        const assembler = new Assembler();
        let stepContent = '';
        let stepFinish: string | null = null;

        const stream = aiService.chatStream(apiHistoryRef.current, {
          model,
          tools: workspacePath ? AGENT_TOOLS : undefined,
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
          accContent += stepContent;
          flush();
        }

        // ── Pas de tool calls → réponse finale ──
        if (!assembler.hasCalls) break;

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

          const result = workspacePath
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

          // task_done → fin de session
          if (result.isDone) {
            controller.abort();
            break;
          }
        }

        // Le contenu final remplace l'accumulation d'étapes intermédiaires vides
        if (stepContent && step < MAX_STEPS - 1) {
          // l'étape suivante produira la suite (réponse ou nouveaux outils)
        }
      }

      // ── Finalisation ──
      promptTokens = Math.ceil(apiHistoryRef.current.reduce((s, m) => s + (m.content?.length || 0) + JSON.stringify(m.tool_calls || []).length, 0) / 4);
      completionTokens = Math.ceil(accContent.length / 4);

      // Réponse finale dans l'historique API
      apiHistoryRef.current.push({ role: 'assistant', content: accContent });

      updateMessage(assistantId, {
        content: accContent,
        reasoning: accReasoning ? [accReasoning] : undefined,
        isStreaming: false,
        tokens: { prompt: promptTokens, completion: completionTokens },
        toolEvents: [...events],
      });

      // Coût FCFA (pricing de vente : 250 F/1M in, 500 F/1M out ; thinking 400/900)
      const priceIn = model === 'thinking' ? 400 : 250;
      const priceOut = model === 'thinking' ? 900 : 500;
      const costFCFA = Math.round(
        (promptTokens / 1_000_000) * priceIn + (completionTokens / 1_000_000) * priceOut
      );
      addUsage({
        provider: 'deepseek',
        model,
        taskType: 'agent_chat',
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        costUSD: Math.round((costFCFA / 615) * 10000) / 10000,
        costFCFA,
        wasFallback: false,
        timestamp: Date.now(),
        durationMs: Date.now() - t0,
      });
    } catch (e: any) {
      const aborted = controller.signal.aborted;
      updateMessage(assistantId, {
        content: accContent || (aborted ? '_(génération interrompue)_' : `**Erreur** — ${e?.message || 'service indisponible'}`),
        isStreaming: false,
        isError: !aborted && !accContent,
        toolEvents: [...events],
      });
    } finally {
      setIsGenerating(false);
      setStoreGenerating(false);
      abortRef.current = null;
    }
  }, [isGenerating, ensureConversation, addMessage, updateMessage, setStoreGenerating, model, workspacePath, workspaceName, onFileChanged, addUsage]);

  return { sendMessage, stop, isGenerating };
}
