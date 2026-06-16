/**
 * FeatureAssistant — Composant autonome réutilisable pour les features simples.
 *
 * Utilisé par: Analyser des données, Recherche intelligente, Rédiger un document.
 * Même pattern que StudentAssistant : propre chat, propre historique, propre UI.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  ArrowLeft, Send, Loader2, Paperclip, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type ChatAttachment } from '@/types';
import { useFeatureChat } from '@/hooks/useFeatureChat';
import MessageList from '@/components/chat/MessageList';

// ============================================================================
// TYPES
// ============================================================================

export interface FeatureOption {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  prompt: string;
  opensFileDialog?: boolean;
  tag?: string;
}

export interface FeatureConfig {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  iconColor: string;
  options: FeatureOption[];
}

interface FeatureAssistantProps {
  config: FeatureConfig;
  onClose: () => void;
}

// ============================================================================
// SUGGESTION CHIPS — replaces the old blocking FeatureMenu
// ============================================================================

const SuggestionChips: React.FC<{
  config: FeatureConfig;
  onSelect: (option: FeatureOption) => void;
}> = ({ config, onSelect }) => {
  const TitleIcon = config.icon;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-6">
      {/* Compact header */}
      <div className={cn(
        'w-11 h-11 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-sm mb-3',
        config.iconColor
      )}>
        <TitleIcon size={22} className="text-white" />
      </div>
      <h2 className="text-base font-semibold text-text-primary mb-1">{config.title}</h2>
      <p className="text-xs text-text-muted mb-5">Tape directement ou choisis une suggestion :</p>

      {/* Suggestion chips — inline, pas bloquant */}
      <div className="flex flex-wrap justify-center gap-2 max-w-lg">
        {config.options.map(option => (
          <button
            key={option.id}
            onClick={() => onSelect(option)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium',
              'bg-surface-default border border-border-subtle',
              'text-text-secondary hover:text-text-primary',
              'hover:bg-surface-hover hover:border-accent-primary/20',
              'transition-all duration-200',
            )}
          >
            {option.title}
          </button>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// CHAT INPUT
// ============================================================================

const FeatureChatInput: React.FC<{
  onSend: (content: string, attachments?: ChatAttachment[]) => void;
  isLoading: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}> = ({ onSend, isLoading, placeholder, autoFocus }) => {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setInput('');
    setAttachments([]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newAttachments: ChatAttachment[] = [];
    Array.from(files).forEach(file => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const kindMap: Record<string, ChatAttachment['kind']> = {
        pdf: 'pdf', docx: 'docx', pptx: 'pptx', xlsx: 'xlsx',
        csv: 'csv', tsv: 'tsv', txt: 'text',
        png: 'image', jpg: 'image', jpeg: 'image', webp: 'image',
      };
      const reader = new FileReader();
      reader.onload = () => {
        newAttachments.push({
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          name: file.name,
          kind: kindMap[ext] || 'text',
          sizeBytes: file.size,
          excerpt: reader.result as string,
        });
        if (newAttachments.length === files.length) {
          setAttachments(prev => [...prev, ...newAttachments]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  return (
    <div className="px-4 py-3 border-t border-border-subtle bg-bg-primary">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map(att => (
            <div key={att.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-secondary text-xs text-text-secondary">
              <Paperclip size={10} />
              <span className="truncate max-w-[120px]">{att.name}</span>
              <button onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))} className="hover:text-accent-error">
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all"
        >
          <Paperclip size={18} />
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange}
          accept=".pdf,.doc,.docx,.pptx,.txt,.csv,.xlsx,.jpg,.jpeg,.png,.webp" />
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          placeholder={placeholder || 'Pose ta question...'}
          rows={1}
          className={cn(
            'flex-1 resize-none rounded-xl px-4 py-2.5 text-sm',
            'bg-bg-secondary border border-border-subtle text-text-primary',
            'placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent-primary',
            'max-h-32'
          )}
        />
        <button
          onClick={handleSubmit}
          disabled={isLoading || (!input.trim() && attachments.length === 0)}
          className={cn(
            'p-2.5 rounded-xl transition-all',
            isLoading
              ? 'bg-accent-error/10 text-accent-error'
              : 'gradient-bg text-white hover:opacity-90 disabled:opacity-50'
          )}
        >
          {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const FeatureAssistant: React.FC<FeatureAssistantProps> = ({ config, onClose }) => {
  const { messages, setMessages, isLoading, sendMessage, messagesEndRef } = useFeatureChat();
  const [selectedOption, setSelectedOption] = useState<FeatureOption | null>(null);

  const handleSend = useCallback((content: string, attachments?: ChatAttachment[]) => {
    sendMessage(content, attachments);
  }, [sendMessage]);

  const handleOptionSelect = useCallback((option: FeatureOption) => {
    setSelectedOption(option);

    if (option.opensFileDialog && option.prompt) {
      // For file-based options, trigger compose with attachments event
      window.dispatchEvent(new CustomEvent('feature-assistant:compose-with-file', {
        detail: { prompt: option.prompt },
      }));
      return;
    }

    if (option.prompt) {
      handleSend(option.prompt);
    }
  }, [handleSend]);

  // Listen for file compose event
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.prompt) {
        handleSend(detail.prompt);
      }
    };
    window.addEventListener('feature-assistant:compose-with-file', handler);
    return () => window.removeEventListener('feature-assistant:compose-with-file', handler);
  }, [handleSend]);

  const TitleIcon = config.icon;
  const showSuggestions = messages.length === 0 && !selectedOption;

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle flex-shrink-0">
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-all"
        >
          <ArrowLeft size={18} />
        </button>
        <div className={cn(
          'w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center',
          config.iconColor
        )}>
          <TitleIcon size={16} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-text-primary">{config.title}</h2>
          <p className="text-[10px] text-text-muted">
            {selectedOption ? selectedOption.title : config.subtitle}
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => { setMessages([]); setSelectedOption(null); }}
            className="text-xs text-text-muted hover:text-accent-primary px-2 py-1 rounded-lg hover:bg-surface-hover transition-all"
          >
            Nouveau
          </button>
        )}
      </div>

      {/* Content — suggestions inline OU messages, jamais de menu bloquant */}
      {showSuggestions ? (
        <SuggestionChips config={config} onSelect={handleOptionSelect} />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <MessageList
            messages={messages}
            isLoading={isLoading}
          />
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input — TOUJOURS visible, l'utilisateur peut taper immédiatement */}
      <FeatureChatInput
        onSend={handleSend}
        isLoading={isLoading}
        placeholder={selectedOption
          ? `Continuer avec ${selectedOption.title}...`
          : `Tape ta demande pour ${config.title.toLowerCase()}...`
        }
        autoFocus
      />
    </div>
  );
};

export default FeatureAssistant;
