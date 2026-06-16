/**
 * StudentAssistant — Composant autonome pour l'Assistant Étudiant.
 *
 * Séparé de ChatView pour éviter le mélange de features.
 * Possède son propre historique de conversation et son propre menu.
 * Pattern identique au VibeCodingStudio : composant autonome avec chat dédié.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  GraduationCap, BookOpen, PenTool, Layout, Presentation,
  ListChecks, BookMarked, Quote, BrainCircuit, ClipboardCheck,
  Shield, Languages, Layers, Dumbbell,
  ArrowLeft, Send, Loader2, Paperclip, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type ChatAttachment } from '@/types';
import { STUDENT_PROMPTS, SKILL_PROMPTS } from '@/services/student/studentPrompts';
import { useFeatureChat } from '@/hooks/useFeatureChat';
import MessageList from '@/components/chat/MessageList';

// ============================================================================
// TYPES
// ============================================================================

interface StudentAssistantProps {
  onClose: () => void;
}

interface SubOption {
  id: string;
  label: string;
  description: string;
  emoji: string;
  prompt: string;
}

interface StudentOption {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  prompt: string;
  tag?: string;
  category?: string;
  opensFileDialog?: boolean;
  subOptions?: SubOption[];
}

// ============================================================================
// STUDENT CATEGORIES & OPTIONS
// ============================================================================

const STUDENT_CATEGORIES = [
  { id: 'all', label: 'Tout', emoji: '' },
  { id: 'redaction', label: 'Redaction', emoji: '' },
  { id: 'correction', label: 'Correction', emoji: '' },
  { id: 'revision', label: 'Revision', emoji: '' },
  { id: 'outils', label: 'Outils', emoji: '' },
];

const STUDENT_OPTIONS: StudentOption[] = [
  // --- Redaction ---
  {
    id: 'memoire', title: 'Memoire',
    description: 'Plan, redaction chapitre par chapitre, biblio',
    icon: BookOpen, color: 'from-pink-500 to-rose-500',
    tag: 'Populaire', category: 'redaction',
    prompt: STUDENT_PROMPTS.memoire,
  },
  {
    id: 'rapport', title: 'Rapport de stage',
    description: 'Page de garde, structure pro, conclusion',
    icon: PenTool, color: 'from-violet-500 to-purple-500',
    category: 'redaction', prompt: STUDENT_PROMPTS.rapport,
  },
  {
    id: 'plan', title: 'Plan detaille',
    description: 'Numerotation academique, objectifs, pages',
    icon: Layout, color: 'from-blue-500 to-indigo-500',
    category: 'redaction', prompt: STUDENT_PROMPTS.plan,
  },
  {
    id: 'expose', title: 'Expose / Oral',
    description: 'Slides, notes orales, export PowerPoint',
    icon: Presentation, color: 'from-teal-500 to-cyan-500',
    category: 'redaction', prompt: STUDENT_PROMPTS.expose,
  },
  // --- Correction ---
  {
    id: 'correction', title: 'Corriger / Reformuler',
    description: 'Langue, style ou correction complete',
    icon: ListChecks, color: 'from-emerald-500 to-green-500',
    tag: 'Upload', category: 'correction',
    prompt: '', opensFileDialog: true,
    subOptions: [
      { id: 'correction_langue', label: 'Correction langue', description: 'Orthographe, grammaire, ponctuation', emoji: '', prompt: STUDENT_PROMPTS.correction_langue },
      { id: 'correction_reformulation', label: 'Reformulation', description: 'Style, fluidite, phrases elegantes', emoji: '', prompt: STUDENT_PROMPTS.correction_reformulation },
      { id: 'correction_academique', label: 'Forme academique', description: 'Registre soutenu, transitions', emoji: '', prompt: STUDENT_PROMPTS.correction_academique },
      { id: 'correction_tout', label: 'Tout corriger', description: 'Langue + style + structure (recommande)', emoji: '', prompt: STUDENT_PROMPTS.correction_tout },
    ],
  },
  {
    id: 'evaluer', title: 'Mode Professeur',
    description: 'Note /20, grille, conseils',
    icon: ClipboardCheck, color: 'from-red-500 to-rose-600',
    tag: 'Upload', category: 'correction',
    prompt: STUDENT_PROMPTS.evaluer, opensFileDialog: true,
  },
  {
    id: 'anti_plagiat', title: 'Anti-Plagiat',
    description: 'Detection + reformulation auto',
    icon: Shield, color: 'from-red-500 to-orange-500',
    category: 'correction',
    prompt: SKILL_PROMPTS.anti_plagiat, opensFileDialog: true,
  },
  // --- Revision ---
  {
    id: 'explique_document', title: 'Explique-moi ce document',
    description: 'PDF, Word, PowerPoint, livre, memoire',
    icon: GraduationCap, color: 'from-indigo-500 to-violet-500',
    tag: 'Upload', category: 'revision',
    prompt: STUDENT_PROMPTS.explique_document, opensFileDialog: true,
  },
  {
    id: 'resume', title: 'Resume de cours',
    description: 'Fiche de revision, definitions, formules',
    icon: BookMarked, color: 'from-amber-500 to-yellow-500',
    tag: 'Upload', category: 'revision',
    prompt: STUDENT_PROMPTS.resume, opensFileDialog: true,
  },
  {
    id: 'quiz', title: 'Quiz de revision',
    description: 'QCM interactif avec corrections',
    icon: BrainCircuit, color: 'from-fuchsia-500 to-pink-500',
    category: 'revision',
    prompt: STUDENT_PROMPTS.quiz, opensFileDialog: true,
  },
  {
    id: 'flashcards', title: 'Flashcards',
    description: 'Cartes recto-verso, mode Anki',
    icon: Layers, color: 'from-cyan-500 to-blue-500',
    category: 'revision',
    prompt: SKILL_PROMPTS.flashcards, opensFileDialog: true,
  },
  {
    id: 'exercices', title: 'Exercices',
    description: 'QCM, vrai/faux, cas pratiques',
    icon: Dumbbell, color: 'from-purple-500 to-fuchsia-500',
    category: 'revision',
    prompt: SKILL_PROMPTS.generateur_exercices, opensFileDialog: true,
  },
  // --- Outils ---
  {
    id: 'citations', title: 'Citations / Biblio',
    description: 'APA, MLA, Chicago, Harvard, IEEE',
    icon: Quote, color: 'from-orange-500 to-red-500',
    category: 'outils', prompt: STUDENT_PROMPTS.citations,
  },
  {
    id: 'traducteur', title: 'Traducteur',
    description: 'FR, EN, AR -- registre academique',
    icon: Languages, color: 'from-green-500 to-teal-500',
    category: 'outils',
    prompt: SKILL_PROMPTS.traducteur_academique, opensFileDialog: true,
  },
];

// ============================================================================
// MENU SCREEN
// ============================================================================

const StudentMenu: React.FC<{
  onSelect: (option: StudentOption, subPrompt?: string) => void;
}> = ({ onSelect }) => {
  const [activeCategory, setActiveCategory] = useState('all');
  const [expandedOption, setExpandedOption] = useState<string | null>(null);

  const filtered = activeCategory === 'all'
    ? STUDENT_OPTIONS
    : STUDENT_OPTIONS.filter(o => o.category === activeCategory);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div className="text-center mb-4">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center shadow-lg mb-3">
          <GraduationCap size={28} className="text-white" />
        </div>
        <h2 className="text-lg font-bold text-text-primary">Assistant Etudiant</h2>
        <p className="text-xs text-text-muted mt-1">Choisis ce dont tu as besoin</p>
      </div>

      {/* Category pills */}
      <div className="flex justify-center gap-2 flex-wrap">
        {STUDENT_CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              activeCategory === cat.id
                ? 'bg-accent-primary/10 text-accent-primary'
                : 'bg-bg-secondary text-text-muted hover:text-text-primary'
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Options grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-w-2xl mx-auto">
        {filtered.map(option => {
          const Icon = option.icon;
          const isExpanded = expandedOption === option.id && option.subOptions;

          return (
            <div key={option.id} className="relative">
              <button
                onClick={() => {
                  if (option.subOptions) {
                    setExpandedOption(expandedOption === option.id ? null : option.id);
                  } else {
                    onSelect(option);
                  }
                }}
                className={cn(
                  'w-full p-3 rounded-xl border border-border-subtle text-left',
                  'hover:bg-surface-hover hover:border-accent-primary/20 transition-all',
                  'group',
                )}
              >
                <div className="flex items-start gap-2.5">
                  <div className={cn(
                    'w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0',
                    option.color
                  )}>
                    <Icon size={16} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-text-primary group-hover:text-accent-primary truncate">
                        {option.title}
                      </span>
                      {option.tag && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent-primary/10 text-accent-primary flex-shrink-0">
                          {option.tag}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-text-muted leading-tight mt-0.5 line-clamp-2">
                      {option.description}
                    </p>
                  </div>
                </div>
              </button>

              {/* Sub-options dropdown */}
              {isExpanded && option.subOptions && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-surface-default border border-border-subtle rounded-xl shadow-lg overflow-hidden">
                  {option.subOptions.map(sub => (
                    <button
                      key={sub.id}
                      onClick={() => {
                        setExpandedOption(null);
                        onSelect(option, sub.prompt);
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-surface-hover transition-colors border-b border-border-subtle last:border-0"
                    >
                      <span className="text-xs font-medium text-text-primary">{sub.label}</span>
                      <p className="text-[10px] text-text-muted">{sub.description}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// CHAT INPUT (simplified, student-specific)
// ============================================================================

const StudentChatInput: React.FC<{
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
      {/* Attachments preview */}
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

const StudentAssistant: React.FC<StudentAssistantProps> = ({ onClose }) => {
  const { messages, setMessages, isLoading, sendMessage, messagesEndRef } = useFeatureChat();
  const [selectedOption, setSelectedOption] = useState<StudentOption | null>(null);

  const handleSend = useCallback((content: string, attachments?: ChatAttachment[]) => {
    sendMessage(content, attachments);
  }, [sendMessage]);

  const handleOptionSelect = useCallback((option: StudentOption, subPrompt?: string) => {
    setSelectedOption(option);
    const prompt = subPrompt || option.prompt;

    if (option.opensFileDialog && prompt) {
      // Trigger file dialog, then send with prompt
      window.dispatchEvent(new CustomEvent('student-assistant:compose-with-file', {
        detail: { prompt },
      }));
      return;
    }

    if (prompt) {
      handleSend(prompt);
    }
  }, [handleSend]);

  // Listen for file compose event
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.prompt) {
        // We need to open a file dialog — for now just start with the prompt
        handleSend(detail.prompt);
      }
    };
    window.addEventListener('student-assistant:compose-with-file', handler);
    return () => window.removeEventListener('student-assistant:compose-with-file', handler);
  }, [handleSend]);

  const showMenu = messages.length === 0 && !selectedOption;

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
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center">
          <GraduationCap size={16} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-text-primary">Assistant Etudiant</h2>
          <p className="text-[10px] text-text-muted">
            {selectedOption ? selectedOption.title : 'Choisis une fonctionnalite'}
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

      {/* Content */}
      {showMenu ? (
        <StudentMenu onSelect={handleOptionSelect} />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <MessageList
            messages={messages}
            isLoading={isLoading}
          />
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input (shown after first interaction) */}
      {!showMenu && (
        <StudentChatInput
          onSend={handleSend}
          isLoading={isLoading}
          placeholder={selectedOption
            ? `Continuer avec ${selectedOption.title}...`
            : 'Pose ta question...'
          }
          autoFocus
        />
      )}
    </div>
  );
};

export default StudentAssistant;
