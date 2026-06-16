/**
 * WelcomeScreen — Écran d'accueil ANZAR (vibecoding uniquement)
 *
 * 2 actions principales : Générer un projet / Importer un dossier
 * Quick-start prompts orientés code.
 */
import React from 'react';
import { Code2, FolderOpen, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WelcomeScreenProps {
  onImportFolder: () => void;
  onShowProjectWizard: () => void;
  onQuickStart: (prompt: string) => void;
}

const QUICK_STARTS = [
  'Crée une app de gestion de stock avec React',
  'Crée un dashboard analytics avec Next.js et Tailwind',
  'Écris un script Python pour automatiser mes tâches',
  'Crée une API REST avec FastAPI et PostgreSQL',
  'Crée un portfolio responsive avec animations',
  'Crée un clone de Trello avec drag & drop',
];

export default function WelcomeScreen({
  onImportFolder,
  onShowProjectWizard,
  onQuickStart,
}: WelcomeScreenProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 overflow-y-auto py-8">
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
          Décris ton app, ANZAR la code de A à Z. Itère, corrige, déploie.
        </p>
      </div>

      {/* ── Action cards — 2 colonnes ── */}
      <div className="grid grid-cols-2 gap-4 w-full max-w-lg mb-8">
        <button
          onClick={onShowProjectWizard}
          className={cn(
            'group p-5 rounded-xl border border-border-subtle',
            'bg-surface-default hover:bg-surface-hover',
            'transition-all duration-200 text-left',
            'hover:border-accent-primary/30 hover:shadow-md',
          )}
        >
          <div className={cn(
            'w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500',
            'flex items-center justify-center mb-3',
            'group-hover:scale-105 transition-transform duration-200 shadow-sm',
          )}>
            <Code2 size={20} className="text-white" />
          </div>
          <p className="text-sm font-semibold text-text-primary mb-1">
            Générer un projet
          </p>
          <p className="text-xs text-text-muted leading-relaxed">
            Décris ton idée, choisis le type et ANZAR code tout pour toi.
          </p>
        </button>

        <button
          onClick={onImportFolder}
          className={cn(
            'group p-5 rounded-xl border border-border-subtle',
            'bg-surface-default hover:bg-surface-hover',
            'transition-all duration-200 text-left',
            'hover:border-accent-primary/30 hover:shadow-md',
          )}
        >
          <div className={cn(
            'w-10 h-10 rounded-lg bg-gradient-to-br from-slate-500 to-gray-600',
            'flex items-center justify-center mb-3',
            'group-hover:scale-105 transition-transform duration-200 shadow-sm',
          )}>
            <FolderOpen size={20} className="text-white" />
          </div>
          <p className="text-sm font-semibold text-text-primary mb-1">
            Importer un dossier
          </p>
          <p className="text-xs text-text-muted leading-relaxed">
            Ouvre un projet existant pour le modifier ou l'améliorer.
          </p>
        </button>
      </div>

      {/* ── Quick start suggestions ── */}
      <div className="flex flex-wrap justify-center gap-2 w-full max-w-lg">
        {QUICK_STARTS.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => onQuickStart(prompt)}
            className={cn(
              'px-3 py-1.5 rounded-full text-[11px]',
              'bg-surface-default border border-border-subtle',
              'text-text-secondary hover:text-text-primary',
              'hover:bg-surface-hover hover:border-accent-primary/20',
              'transition-all duration-200',
            )}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
