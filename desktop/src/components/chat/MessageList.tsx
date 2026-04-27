'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
  const isNearBottomRef = useRef(true);
  const [visibleCount, setVisibleCount] = useState(200);
  const prevMessageCountRef = useRef(messages.length);
  const lastRenderIdRef = useRef<string | null>(null);

  // --- Windowing: render only last N messages by default (grand public + perf) ---
  const hasHidden = messages.length > visibleCount;
  const visibleMessages = useMemo(() => {
    if (!hasHidden) return messages;
    return messages.slice(messages.length - visibleCount);
  }, [messages, visibleCount, hasHidden]);

  const handleShowMore = () => {
    setVisibleCount((n) => Math.min(messages.length, n + 200));
    // Quand on charge l'historique, on évite l'auto-scroll.
    isNearBottomRef.current = false;
  };

  // Track whether user is near the bottom (avoid forcing scroll when reading older messages)
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 160;
  };

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

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => {
      const item = items[index];
      if (!item) return 120;
      return item.type === 'sep' ? 52 : 140;
    },
    overscan: 10,
  });

  // Auto-scroll to bottom only if user is near bottom and a new message arrived
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const prevCount = prevMessageCountRef.current;
    const nextCount = messages.length;
    prevMessageCountRef.current = nextCount;

    // If we loaded older messages (count increased but we're not near bottom), do nothing.
    // If a new message appended and user is near bottom, scroll.
    const lastId = messages[messages.length - 1]?.id ?? null;
    const didAppend = nextCount >= prevCount && lastId !== lastRenderIdRef.current;
    lastRenderIdRef.current = lastId;

    if (didAppend && isNearBottomRef.current) {
      const lastIndex = items.length - 1;
      if (lastIndex >= 0) {
        // smooth scrolling on huge lists can be janky
        rowVirtualizer.scrollToIndex(lastIndex, { align: 'end', behavior: nextCount < 120 ? 'smooth' : 'auto' });
      }
    }
  }, [messages, isLoading]);

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 sm:px-6 py-8 max-w-4xl mx-auto w-full"
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

      <div
        style={{
          height: rowVirtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          if (!item) return null;
          return (
            <div
              key={item.key}
              ref={rowVirtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="space-y-2"
            >
              {item.type === 'sep' ? (
                <div className="flex items-center gap-3 mb-2 px-4">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--color-border-subtle)] dark:via-[#2a2a2a] to-transparent" />
                  <span className="text-xs text-[var(--color-text-secondary)] dark:text-gray-500 whitespace-nowrap">
                    {item.label}
                  </span>
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--color-border-subtle)] dark:via-[#2a2a2a] to-transparent" />
                </div>
              ) : (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-200">
                  {/* Activity Timeline — shown above AI messages that have a session */}
                  {item.message.role === 'assistant' && item.message.activitySessionId && (
                    <div className="px-4 mb-2 ml-10">
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
          );
        })}
      </div>

      {/* Loading indicator — show StreamingDots only when no activity session exists yet */}
      {isLoading && visibleMessages.length > 0 && !visibleMessages[visibleMessages.length - 1]?.activitySessionId && (
        <div className="flex justify-start mt-3">
          <div className="animate-in fade-in duration-300">
            <StreamingDots variant="thinking" />
          </div>
        </div>
      )}
    </div>
  );
}
