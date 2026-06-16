/**
 * useFeatureChat — Hook partagé pour la boucle chat des features autonomes.
 *
 * Remplace le code dupliqué entre StudentAssistant et FeatureAssistant.
 * Gère : messages, envoi AI, streaming progressif, offline guard, retry, erreurs.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { AIModel, type Message, type ChatAttachment } from '@/types';
import { aiRouter } from '@/services/router';
import { aiService } from '@/services/ai/ai';

interface UseFeatureChatOptions {
  /** Optional system prompt to prepend to conversations */
  systemPrompt?: string;
}

export function useFeatureChat(options?: UseFeatureChatOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Auto-scroll on new messages ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Offline detection ──
  const [isOnline, setIsOnline] = useState(() => globalThis.navigator?.onLine ?? true);
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    globalThis.addEventListener?.('online', onOnline);
    globalThis.addEventListener?.('offline', onOffline);
    return () => {
      globalThis.removeEventListener?.('online', onOnline);
      globalThis.removeEventListener?.('offline', onOffline);
    };
  }, []);

  // ── Pending retry state ──
  const pendingRetryRef = useRef<{
    content: string;
    attachments?: ChatAttachment[];
    assistantMsgId: string;
    attempts: number;
  } | null>(null);

  // ── Send message ──
  const sendMessage = useCallback(async (
    content: string,
    attachments?: ChatAttachment[],
    retryOpts?: { assistantMsgId: string },
  ) => {
    if (isLoading) return;
    if (!content.trim() && (!attachments || attachments.length === 0)) return;

    // ── Offline guard ──
    if (!isOnline) {
      const offlineMsgId = `msg_${Date.now() + 1}`;
      if (!retryOpts) {
        // Add user message + offline error
        setMessages(prev => [
          ...prev,
          {
            id: `msg_${Date.now()}`,
            content: content || 'Analyse les pièces jointes.',
            role: 'user',
            timestamp: Date.now(),
            model: 'fast' as AIModel,
            attachments,
          },
          {
            id: offlineMsgId,
            content: 'Hors ligne — connecte-toi à internet pour continuer. Réessai automatique dès la reconnexion.',
            role: 'assistant',
            timestamp: Date.now(),
            model: 'fast' as AIModel,
            isError: true,
          },
        ]);
      }
      // Store for auto-retry
      pendingRetryRef.current = {
        content,
        attachments,
        assistantMsgId: retryOpts?.assistantMsgId || offlineMsgId,
        attempts: (pendingRetryRef.current?.attempts || 0) + 1,
      };
      return;
    }

    setIsLoading(true);

    // ── User message (skip on retry) ──
    const userMsg: Message = {
      id: `msg_${Date.now()}`,
      content: content || 'Analyse les pièces jointes.',
      role: 'user',
      timestamp: Date.now(),
      model: 'fast' as AIModel,
      attachments,
    };

    const assistantMsgId = retryOpts?.assistantMsgId || `msg_${Date.now() + 1}`;

    if (!retryOpts) {
      setMessages(prev => [
        ...prev,
        userMsg,
        {
          id: assistantMsgId,
          content: '',
          role: 'assistant',
          timestamp: Date.now(),
          model: 'fast' as AIModel,
        },
      ]);
    } else {
      // On retry, update existing error message to loading state
      setMessages(prev =>
        prev.map(m => m.id === assistantMsgId
          ? { ...m, content: '', isError: undefined }
          : m
        )
      );
    }

    try {
      // Build messages for API (include full history)
      const historyMsgs = retryOpts
        ? messages // Use existing messages array
        : messages.concat(userMsg);

      const rawMessages = historyMsgs.map(m => ({
        role: m.role,
        content: m.content,
      }));

      // Prepend system prompt if provided
      if (options?.systemPrompt) {
        rawMessages.unshift({ role: 'system', content: options.systemPrompt });
      }

      const apiMessages = aiRouter.prepareMessages(rawMessages as any);
      const modelId = aiService.resolveModel('deepseek', 'fast' as AIModel);

      const resp = await aiService.smartChat(apiMessages as any, {
        model: modelId,
        temperature: 0.7,
      });

      const fullContent = resp?.choices?.[0]?.message?.content || '';

      if (!fullContent.trim()) {
        setMessages(prev =>
          prev.map(m => m.id === assistantMsgId
            ? { ...m, content: "Désolé, je n'ai pas pu générer de réponse. Réessaie." }
            : m
          )
        );
      } else {
        // Progressive streaming rendering
        const chunkSize = 80;
        for (let i = 0; i < fullContent.length; i += chunkSize) {
          const rendered = fullContent.slice(0, i + chunkSize);
          setMessages(prev =>
            prev.map(m => m.id === assistantMsgId ? { ...m, content: rendered } : m)
          );
          if (i % (chunkSize * 6) === 0) await new Promise(r => setTimeout(r, 0));
        }
        // Ensure final content is complete
        setMessages(prev =>
          prev.map(m => m.id === assistantMsgId ? { ...m, content: fullContent } : m)
        );
      }

      // Clear pending retry on success
      pendingRetryRef.current = null;

    } catch (err: any) {
      const errMsg = err.message || 'Connexion perdue';
      const isNetworkErr = /hors ligne|failed to fetch|network|timeout|connexion/i.test(errMsg);

      setMessages(prev =>
        prev.map(m => m.id === assistantMsgId
          ? {
              ...m,
              content: m.content || (isNetworkErr
                ? 'Problème de connexion. Réessai automatique dès que possible.'
                : `Erreur: ${errMsg}`),
              isError: true,
            }
          : m
        )
      );

      // Store for auto-retry on network errors
      if (isNetworkErr) {
        const prev = pendingRetryRef.current;
        const attempts = prev?.content === content ? prev.attempts : 0;
        if (attempts < 3) {
          pendingRetryRef.current = { content, attachments, assistantMsgId, attempts: attempts + 1 };
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, isOnline, options?.systemPrompt]);

  // ── Auto-retry on reconnection ──
  useEffect(() => {
    if (!isOnline) return;
    if (!pendingRetryRef.current) return;
    if (isLoading) return;
    if (pendingRetryRef.current.attempts >= 3) return;

    const { content, attachments, assistantMsgId } = pendingRetryRef.current;
    sendMessage(content, attachments, { assistantMsgId });
  }, [isOnline, isLoading, sendMessage]);

  return {
    messages,
    setMessages,
    isLoading,
    isOnline,
    sendMessage,
    messagesEndRef,
  };
}
