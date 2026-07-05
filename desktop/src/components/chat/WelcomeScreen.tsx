/**
 * WelcomeScreen — Hub d'accueil ANZAR (redesign 2026)
 *
 * Deux modes EXPLICITES (fini la détection d'intention qui devine) :
 *  - Créer   : décris ton app → plan → studio → projet vérifié
 *  - Discuter: question, aide, debug — conversation classique
 *
 * Design : hero centré, segmented control, un seul champ, suggestions
 * par mode. Zéro modal, zéro wizard.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp, FolderOpen, Loader2, Hammer, MessageSquare, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

type HomeMode = 'build' | 'chat';

interface WelcomeScreenProps {
  /** Mode Créer : lance le pipeline plan → studio */
  onGenerate: (prompt: string) => void;
  /** Mode Discuter : envoie un message chat classique */
  onChat?: (prompt: string) => void;
  onImportFolder: () => void;
  isLoading?: boolean;
}

// ============================================================================
// SUGGESTIONS PAR MODE
// ============================================================================

const BUILD_STARTS = [
  'App de gestion de stock avec React',
  'Dashboard analytics Next.js + Tailwind',
  'API REST FastAPI + PostgreSQL',
  'Portfolio responsive avec animations',
  'Clone Trello avec drag & drop',
  'Bot Discord en Python',
];

const CHAT_STARTS = [
  'Explique-moi les hooks React',
  'Comment déboguer une erreur CORS ?',
  'Compare PostgreSQL et MongoDB',
  'Aide-moi à choisir ma stack',
];

// ============================================================================
// COMPOSANT
// ============================================================================

export default function WelcomeScreen({
  onGenerate,
  onChat,
  onImportFolder,
  isLoading = false,
}: WelcomeScreenProps) {
  const [mode, setMode] = useState<HomeMode>('build');
  const [prompt, setPrompt] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus (aussi au changement de mode) + auto-resize
  useEffect(() => {
    textareaRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [prompt]);

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed || isLoading) return;
    if (mode === 'build') {
      onGenerate(trimmed);
    } else {
      (onChat ?? onGenerate)(trimmed);
    }
  }, [prompt, isLoading, mode, onGenerate, onChat]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const suggestions = mode === 'build' ? BUILD_STARTS : CHAT_STARTS;
  const canSubmit = prompt.trim().length > 0 && !isLoading;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 overflow-y-auto py-8">
      <div className="w-full max-w-2xl flex flex-col items-center">

        {/* ── Hero ── */}
        <div className="text-center mb-7">
          <div className="relative inline-block mb-5">
            <div className="w-14 h-14 rounded-2xl gradient-bg flex items-center justify-center animate-float shadow-lg">
              <Wand2 className="w-7 h-7 text-white" />
            </div>
            <div className="absolute inset-0 w-14 h-14 rounded-2xl gradient-bg opacity-25 blur-xl" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-text-primary mb-2">
            {mode === 'build' ? (
              <>Imagine. <span className="gradient-text">ANZAR</span> construit.</>
            ) : (
              <>Parle. <span className="gradient-text">ANZAR</span> répond.</>
            )}
          </h1>
          <p className="text-sm text-text-secondary max-w-sm mx-auto">
            {mode === 'build'
              ? 'Décris ton app — ANZAR planifie, code, vérifie et corrige jusqu’au résultat.'
              : 'Questions, debug, conseils techniques — une conversation classique.'}
          </p>
        </div>

        {/* ── Sélecteur de mode (explicite — plus de devinette d'intention) ── */}
        <div className="mb-4 p-1 rounded-xl bg-bg-tertiary border border-border-subtle flex items-center gap-1">
          <button
            onClick={() => setMode('build')}
            className={cn(
              'flex items-center gap-2 px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all',
              mode === 'build'
                ? 'gradient-bg text-white shadow'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            <Hammer size={14} />
            Créer un projet
          </button>
          <button
            onClick={() => setMode('chat')}
            className={cn(
              'flex items-center gap-2 px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all',
              mode === 'chat'
                ? 'gradient-bg text-white shadow'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            <MessageSquare size={14} />
            Discuter
          </button>
        </div>

        {/* ── Champ principal ── */}
        <div
          className={cn(
            'w-full max-w-lg relative rounded-2xl border bg-bg-secondary transition-all duration-200',
            'focus-within:border-accent-primary/50 focus-within:shadow-lg focus-within:shadow-accent-primary/5',
            canSubmit ? 'border-accent-primary/30' : 'border-border-subtle'
          )}
        >
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === 'build'
                ? 'Décris ton app : fonctionnalités, style, technos si tu en as…'
                : 'Pose ta question…'
            }
            rows={2}
            disabled={isLoading}
            className="w-full px-4 pt-3.5 pb-12 bg-transparent text-[14px] text-text-primary placeholder-text-muted resize-none focus:outline-none disabled:opacity-50 rounded-2xl"
            style={{ minHeight: '76px' }}
          />
          <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between">
            {mode === 'build' ? (
              <button
                onClick={onImportFolder}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                <FolderOpen size={14} />
                Importer un projet existant
              </button>
            ) : (
              <span />
            )}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                'p-2 rounded-xl transition-all',
                canSubmit
                  ? 'gradient-bg text-white hover:opacity-90 shadow'
                  : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
              )}
            >
              {isLoading ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          </div>
        </div>

        {/* ── Suggestions ── */}
        <div className="mt-5 flex flex-wrap justify-center gap-2 max-w-lg">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => {
                setPrompt(s);
                textareaRef.current?.focus();
              }}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-full text-[12px] text-text-secondary bg-bg-tertiary hover:bg-surface-hover hover:text-text-primary transition-colors border border-border-subtle"
            >
              {s}
            </button>
          ))}
        </div>

        {/* ── Pied ── */}
        <p className="mt-8 text-[11px] text-text-muted/70">
          {mode === 'build'
            ? 'Plan → Génération → Vérification automatique → Itération dans le studio'
            : 'Entrée pour envoyer · Maj+Entrée pour une nouvelle ligne'}
        </p>
      </div>
    </div>
  );
}
