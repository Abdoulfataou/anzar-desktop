/**
 * WelcomePage — Accueil public prompt-first (style ZCode).
 *
 * Un seul champ, aucune décision à prendre : l'utilisateur décrit ce qu'il
 * veut (question ou projet), se connecte, et atterrit dans le shell agent.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, FolderOpen } from 'lucide-react';
import TitleBar from '@/components/layout/TitleBar';
import { savePendingPrompt } from '@/lib/pendingPrompt';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  'App de gestion de stock avec React',
  'Explique-moi les hooks React',
  'API REST FastAPI + PostgreSQL',
  'Corrige une erreur dans mon code',
];

export default function WelcomePage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');

  const submit = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    savePendingPrompt({ mode: 'build', prompt: trimmed });
    navigate('/login');
  };

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      <TitleBar />
      <main className="flex-1 min-h-0 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-xl flex flex-col items-center">
          <h1 className="text-2xl sm:text-3xl font-semibold text-text-primary mb-2 tracking-[-0.015em]">
            Que veux-tu construire ?
          </h1>
          <p className="text-sm text-text-secondary mb-6">
            Décris ton idée ou ta question — ANZAR agit avec ses outils.
          </p>

          {/* Composer unique */}
          <div
            className={cn(
              'w-full rounded-xl bg-surface-default border border-border-medium p-3 transition-all',
              'focus-within:border-border-strong focus-within:ring-4 focus-within:ring-accent-soft'
            )}
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder="Décris ton app, ta question, ton bug…"
              rows={3}
              autoFocus
              className="w-full bg-transparent text-[14px] leading-6 text-text-primary placeholder-text-muted resize-none focus:outline-none"
              style={{ maxHeight: 180 }}
            />
            <div className="flex items-center justify-end">
              <button
                onClick={submit}
                disabled={!prompt.trim()}
                className={cn(
                  'p-2 rounded-lg transition-all',
                  prompt.trim()
                    ? 'gradient-bg hover:opacity-90 active:scale-95'
                    : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                )}
                title="Envoyer"
              >
                <ArrowUp size={15} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {/* Suggestions */}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setPrompt(s)}
                className="h-8 px-3 rounded-full border border-border-subtle text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                {s}
              </button>
            ))}
          </div>

          <p className="mt-8 text-[11px] text-text-muted flex items-center gap-1.5">
            <FolderOpen size={12} />
            Payez à l'usage en FCFA. Sans abonnement. <span className="text-credit font-medium">1 000 FCFA offerts</span> pour démarrer.
          </p>
        </div>
      </main>
    </div>
  );
}
