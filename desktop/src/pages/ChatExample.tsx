/**
 * Chat Example Page
 * Demonstrates complete integration of the Chat module
 * Shows how to use ChatView with store integration and API calls
 */

'use client';

import React, { useEffect } from 'react';
import ChatView from '@/components/chat/ChatView';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';

export default function ChatExample() {
  const { createConversation, activeConversationId } = useChatStore();

  // Initialize a new conversation on mount if needed
  useEffect(() => {
    if (!activeConversationId) {
      createConversation('New Conversation', 'fast');
    }
  }, [activeConversationId, createConversation]);

  return (
    <div className="h-full w-full">
      <ChatView showWelcome={true} />
    </div>
  );
}

/**
 * Advanced Chat Page with Full Integration Example
 * Shows how to integrate with AI backend, streaming, and custom hooks
 */
export function AdvancedChatExample() {
  const {
    createConversation,
    activeConversationId,
    addMessage,
    setIsGenerating,
    appendStreamingContent,
    finalizeStreamingMessage,
  } = useChatStore();

  useEffect(() => {
    if (!activeConversationId) {
      createConversation('Advanced Chat', 'fast');
    }
  }, [activeConversationId, createConversation]);

  const handleChatMessage = async (content: string) => {
    // Add user message
    addMessage({
      id: `msg_${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    });

    setIsGenerating(true);

    try {
      // Call ANZAR backend API with streaming
      const BACKEND = useSettingsStore.getState().getBackendUrl();
      const response = await fetch(`${BACKEND}/api/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'fast',
          messages: [
            {
              role: 'user',
              content: content,
            },
          ],
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);

            if (dataStr === '[DONE]') {
              continue;
            }

            try {
              const json = JSON.parse(dataStr);
              const delta = json.choices[0]?.delta?.content;

              if (delta) {
                appendStreamingContent(delta);
              }
            } catch (err) {
              console.error('Failed to parse streaming response:', err);
            }
          }
        }
      }

      // Finalize the message
      finalizeStreamingMessage();
    } catch (error) {
      console.error('Chat error:', error);

      // Add error message
      addMessage({
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: `Une erreur s'est produite: ${error instanceof Error ? error.message : 'Erreur inconnue'}`,
        timestamp: Date.now(),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="h-full w-full">
      <ChatView showWelcome={!activeConversationId} />
    </div>
  );
}

/**
 * Testing Example - Demonstrates all chat features
 */
export function ChatTestingPage() {
  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg-primary)] dark:bg-[#0a0a0a]">
      {/* Header for testing */}
      <div className="border-b border-[var(--color-border-subtle)] dark:border-[#2a2a2a] p-4">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)] dark:text-white">
          Chat Module - Testing Page
        </h1>
      </div>

      {/* Chat view */}
      <div className="flex-1 overflow-hidden">
        <ChatView showWelcome={true} />
      </div>
    </div>
  );
}
