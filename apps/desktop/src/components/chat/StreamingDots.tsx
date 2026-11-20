'use client';

import React from 'react';
import { Brain, Search, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StreamingDotsProps {
  variant?: 'thinking' | 'searching' | 'default';
  className?: string;
}

export default function StreamingDots({ variant = 'default', className }: StreamingDotsProps) {
  const config = {
    thinking: { icon: Brain, text: 'ANZAR réfléchit...', color: 'text-accent-secondary' },
    searching: { icon: Search, text: 'Recherche en cours...', color: 'text-accent-info' },
    default: { icon: Sparkles, text: 'Génération...', color: 'text-accent-primary' },
  }[variant];

  const Icon = config.icon;

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3 rounded-2xl rounded-tl-md',
      'bg-surface-default border border-border-subtle',
      'max-w-xs message-enter',
      className
    )}>
      {/* Animated icon */}
      <div className={cn('animate-pulse-glow rounded-lg p-1.5', config.color)}>
        <Icon size={16} />
      </div>

      {/* Text + dots */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-secondary">{config.text}</span>
        <div className="typing-indicator">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
