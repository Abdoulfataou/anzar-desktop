'use client';

import React, { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import StreamingDots from './StreamingDots';
import ActivityTimeline, { InlineActivity } from './ActivityTimeline';

interface Message {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: Date;
  reasoning?: string[];
  model?: 'fast' | 'thinking';
  isError?: boolean;
  isStreaming?: boolean;
  thinking?: string;
  activitySessionId?: string;
}

interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
  selectedProjectId?: string | null;
  selectedProjectPath?: string;
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

export default function MessageList({ messages, isLoading = false, selectedProjectId = null, selectedProjectPath }: MessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer && lastMessageRef.current) {
      lastMessageRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, isLoading]);

  // Group messages by date
  const groupedMessages = messages.reduce((acc, msg) => {
    const dateKey = msg.timestamp.toDateString();
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(msg);
    return acc;
  }, {} as Record<string, Message[]>);

  const sortedDates = Object.keys(groupedMessages).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto px-4 sm:px-6 py-8 space-y-6 max-w-4xl mx-auto w-full"
    >
      {sortedDates.map((dateKey) => (
        <div key={dateKey}>
          {/* Date separator */}
          {messages.length > 0 && (
            <div className="flex items-center gap-3 mb-6 px-4">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--color-border-subtle)] dark:via-[#2a2a2a] to-transparent" />
              <span className="text-xs text-[var(--color-text-secondary)] dark:text-gray-500 whitespace-nowrap">
                {getDateSeparator(new Date(dateKey))}
              </span>
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--color-border-subtle)] dark:via-[#2a2a2a] to-transparent" />
            </div>
          )}

          {/* Messages for this date */}
          <div className="space-y-4">
            {groupedMessages[dateKey].map((message, idx) => (
              <div
                key={message.id}
                ref={idx === groupedMessages[dateKey].length - 1 ? lastMessageRef : null}
                className="animate-in fade-in slide-in-from-bottom-2 duration-300"
              >
                {/* Activity Timeline — shown above AI messages that have a session */}
                {message.type === 'ai' && message.activitySessionId && (
                  <div className="px-4 mb-2 ml-10">
                    {message.isStreaming ? (
                      <InlineActivity sessionId={message.activitySessionId} />
                    ) : (
                      <ActivityTimeline sessionId={message.activitySessionId} compact={false} />
                    )}
                  </div>
                )}
                <MessageBubble message={message} selectedProjectId={selectedProjectId} selectedProjectPath={selectedProjectPath} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Loading indicator — show StreamingDots only when no activity session exists yet */}
      {isLoading && messages.length > 0 && !messages[messages.length - 1]?.activitySessionId && (
        <div className="flex justify-start">
          <div className="animate-in fade-in duration-300">
            <StreamingDots variant="thinking" />
          </div>
        </div>
      )}

      {/* Spacer to prevent bottom overlap */}
      <div ref={lastMessageRef} className="h-4" />
    </div>
  );
}
