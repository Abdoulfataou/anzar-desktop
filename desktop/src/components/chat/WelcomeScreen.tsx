/**
 * WelcomeScreen — Écran d'accueil ANZAR (vibecoding)
 *
 * Design simplifié : un textarea central pour décrire son app,
 * des suggestions rapides cliquables, et un lien d'import discret.
 * Zéro wizard, zéro modal. L'IA déduit le type et les technos.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp, FolderOpen, Wand2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WelcomeScreenProps {
  onGenerate: (prompt: string) => void;
  onImportFolder: () => void;
  isLoading?: boolean;
}

const QUICK_STARTS = [
  'App de gestion de stock avec React',
  'Dashboard analytics Next.js + Tailwind',
  'API REST FastAPI + PostgreSQL',
  'Portfolio responsive avec animations',
  'Clone Trello avec drag & drop',
  'Bot Discord en Python',
];

export default function WelcomeScreen({
  onGenerate,
  onImportFolder,
  isLoading = false,
}: WelcomeScreenProps) {
  const [prompt, setPrompt] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus le textarea
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [prompt]);

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed || isLoading) return;
    onGenerate(trimmed);
  }, [prompt, isLoading, onGenerate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleQuickStart = useCallback(
    (text: string) => {
      if (isLoading) return;
      onGenerate(text);
    },
    [isLoading, onGenerate],
  );

  const canSubmit = prompt.trim().length > 0 && !isLoading;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 overflow-y-auto py-8">
      {/* ── Hero ── */}
      <div className="text-center mb-8 max-w-xl">
        <div className="relative inline-block mb-5">
          <div className="w-14 h-14 rounded-2xl gradient-bg flex items-center justify-center animate-float shadow-lg">
            <Wand2 className="w-7 h-7 text-white" />
          </div>
          <div className="absolute inset-0 w-14 h-14 rounded-2xl gradient-bg opacity-25 blur-xl" />
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-text-primary mb-2">
          Imagine. <span className="gradient-text">ANZAR</span> construit.
        </h1>
        <p className="text-sm text-text-secondary max-w-sm mx-auto">
          Décris ton app en une phrase, ANZAR la code de A à Z.
        </p>
      </div>

      {/* ── Input principal ── */}
      <div className="w-full max-w-lg mb-6">
        <div
          className={cn(
            'relative rounded-2xl border bg-bg-secondary transition-all duration-200',
            'focus-within:border-accent-primary/50 focus-within:shadow-lg focus-within:shadow-accent-primary/5',
            canSubmit ? 'border-accent-primary/30' : 'border-border-subtle',
          )}
        >
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ex : Une app de gestion de stock pour une boutique, avec suivi des produits et alertes de rupture..."
            rows={3}
            disabled={isLoading}
            className={cn(
              'w-full px-4 pt-4 pb-12 rounded-2xl text-sm bg-transparent',
              'text-text-primary placeholder-text-muted/60',
              'focus:outline-none resize-none',
              'disabled:opacity-50',
            )}
          />
          {/* Barre du bas dans le textarea */}
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
            <p className="text-[10px] text-text-muted/50 pl-2">
              Shift+Enter pour un retour à la ligne
            </p>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all',
                canSubmit
                  ? 'gradient-bg text-white hover:opacity-90 shadow-md hover:shadow-lg'
                  : 'bg-bg-tertiary text-text-muted cursor-not-allowed',
              )}
            >
              {isLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ArrowUp size={14} />
              )}
              {isLoading ? 'Génération...' : 'Générer'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Quick starts ── */}
      <div className="flex flex-wrap justify-center gap-2 w-full max-w-lg mb-8">
        {QUICK_STARTS.map((text, idx) => (
          <button
            key={idx}
            onClick={() => handleQuickStart(text)}
            disabled={isLoading}
            className={cn(
              'px-3 py-1.5 rounded-full text-[11px]',
              'bg-surface-default border border-border-subtle',
              'text-text-secondary hover:text-text-primary',
              'hover:bg-surface-hover hover:border-accent-primary/20',
              'transition-all duration-200',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            {text}
          </button>
        ))}
      </div>

      {/* ── Lien import discret ── */}
      <button
        onClick={onImportFolder}
        disabled={isLoading}
        className={cn(
          'flex items-center gap-2 text-xs text-text-muted',
          'hover:text-text-secondary transition-colors',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
      >
        <FolderOpen size={14} />
        <span>ou importer un projet existant</span>
      </button>
    </div>
  );
}
