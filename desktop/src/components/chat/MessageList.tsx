'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import MessageBubble from './MessageBubble';
import StreamingDots from './StreamingDots';
import ActivityTimeline, { InlineActivity } from './ActivityTimeline';
import type { Message } from '@/types';

interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
  selectedProjectId?: string | null;
  selectedProjectPath?: string;
  onRegenerateMessage?: (assistantMessageId: string) => void;
}

const getDateSeparator = (date: Date): string => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Aujourd\'hui';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Hier';
  } else {
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
};

export default function MessageList({ messages, isLoading = false, selectedProjectId = null, selectedProjectPath, onRegenerateMessage }: MessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [visibleCount, setVisibleCount] = useState(200);
  const prevMessageCountRef = useRef(messages.length);

  // --- Windowing: render only last N messages by default ---
  const hasHidden = messages.length > visibleCount;
  const visibleMessages = useMemo(() => {
    if (!hasHidden) return messages;
    return messages.slice(messages.length - visibleCount);
  }, [messages, visibleCount, hasHidden]);

  const handleShowMore = () => {
    setVisibleCount((n) => Math.min(messages.length, n + 200));
    isNearBottomRef.current = false;
  };

  // Track whether user is near the bottom
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 160;
  };

  // Group messages by date
  type ListItem =
    | { type: 'sep'; key: string; label: string }
    | { type: 'msg'; key: string; message: Message };

  const items: ListItem[] = useMemo(() => {
    if (visibleMessages.length === 0) return [];
    const grouped = visibleMessages.reduce((acc, msg) => {
      const dateKey = new Date(msg.timestamp).toDateString();
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(msg);
      return acc;
    }, {} as Record<string, Message[]>);

    const dates = Object.keys(grouped).sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime()
    );

    const out: ListItem[] = [];
    for (const dateKey of dates) {
      out.push({ type: 'sep', key: `sep:${dateKey}`, label: getDateSeparator(new Date(dateKey)) });
      for (const m of grouped[dateKey]) out.push({ type: 'msg', key: `msg:${m.id}`, message: m });
    }
    return out;
  }, [visibleMessages]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    const nextCount = messages.length;
    prevMessageCountRef.current = nextCount;

    if (nextCount > prevCount && isNearBottomRef.current) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: nextCount < 120 ? 'smooth' : 'auto' });
      });
    }
  }, [messages.length, isLoading]);

  // Also scroll when streaming content changes
  useEffect(() => {
    if (isNearBottomRef.current) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      });
    }
  }, [visibleMessages[visibleMessages.length - 1]?.content]);

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-8 max-w-4xl mx-auto w-full"
    >
      {hasHidden && (
        <div className="flex justify-center mb-4">
          <button
            onClick={handleShowMore}
            className="text-xs px-3 py-1.5 rounded-full border border-border-subtle bg-surface-default hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-colors"
          >
            Afficher les messages précédents ({messages.length - visibleMessages.length})
          </button>
        </div>
      )}

      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.key}>
            {item.type === 'sep' ? (
              <div className="flex items-center gap-3 my-4 px-4">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border-subtle to-transparent" />
                <span className="text-xs text-text-secondary whitespace-nowrap">
                  {item.label}
                </span>
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border-subtle to-transparent" />
              </div>
            ) : (
              <div>
                {/* Activity Timeline — shown above AI messages that have a session */}
                {item.message.role === 'assistant' && item.message.activitySessionId && (
                  <div className="mb-2 ml-10 px-4">
                    {item.message.isStreaming ? (
                      <InlineActivity sessionId={item.message.activitySessionId} />
                    ) : (
                      <ActivityTimeline sessionId={item.message.activitySessionId} compact={false} />
                    )}
                  </div>
                )}
                <MessageBubble
                  message={item.message}
                  onRegenerate={item.message.role === 'assistant' ? () => onRegenerateMessage?.(item.message.id) : undefined}
                  selectedProjectId={selectedProjectId}
                  selectedProjectPath={selectedProjectPath}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Loading indicator */}
      {isLoading && visibleMessages.length > 0 && !visibleMessages[visibleMessages.length - 1]?.activitySessionId && (
        <div className="flex justify-start mt-3">
          <div className="animate-in fade-in duration-300">
            <StreamingDots variant="thinking" />
          </div>
        </div>
      )}

      {/* Scroll anchor */}
      <div ref={bottomRef} className="h-1" />
    </div>
  );
}
