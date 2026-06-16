/**
 * WelcomeScreen — Écran d'accueil ANZAR
 *
 * Grille 2×3 aérée avec routing par ID (plus de string matching).
 * Quick-start prompts en pills sous la grille.
 */
import React from 'react';
import {
  Code2, BarChart3, GraduationCap, Globe, FileText,
  Wand2, FolderOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ──
export type ActiveFeature = null | 'student' | 'data' | 'search' | 'document';

type FeatureAction =
  | { type: 'feature'; feature: ActiveFeature }
  | { type: 'wizard' }
  | { type: 'import' };

interface FeatureCard {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  action: FeatureAction;
}

interface WelcomeScreenProps {
  onSetActiveFeature: (feature: ActiveFeature) => void;
  onImportFolder: () => void;
  onShowProjectWizard: () => void;
  onQuickStart: (prompt: string) => void;
}

/* ===== Feature Cards — routing par ID, plus de string matching ===== */
const FEATURES: FeatureCard[] = [
  {
    id: 'generate',
    title: 'Générer un projet',
    description: 'Décris ton idée, choisis le type et ANZAR code tout pour toi — de zéro.',
    icon: Code2,
    color: 'from-violet-500 to-indigo-500',
    action: { type: 'wizard' },
  },
  {
    id: 'import',
    title: 'Importer un dossier',
    description: 'Ouvre un projet existant pour le modifier, l\'auditer ou l\'améliorer.',
    icon: FolderOpen,
    color: 'from-slate-500 to-gray-600',
    action: { type: 'import' },
  },
  {
    id: 'student',
    title: 'Assistant Étudiant',
    description: 'Mémoires, rapports, exposés, révisions — plan, rédaction, correction.',
    icon: GraduationCap,
    color: 'from-pink-500 to-rose-500',
    action: { type: 'feature', feature: 'student' },
  },
  {
    id: 'data',
    title: 'Analyser des données',
    description: 'Importe tes fichiers CSV/Excel — graphiques et insights instantanés.',
    icon: BarChart3,
    color: 'from-emerald-500 to-teal-500',
    action: { type: 'feature', feature: 'data' },
  },
  {
    id: 'search',
    title: 'Recherche intelligente',
    description: 'Pose ta question, ANZAR cherche sur le web et synthétise avec sources.',
    icon: Globe,
    color: 'from-blue-500 to-cyan-500',
    action: { type: 'feature', feature: 'search' },
  },
  {
    id: 'document',
    title: 'Rédiger un document',
    description: 'Emails, rapports, lettres, CV — clairs, structurés, prêts à envoyer.',
    icon: FileText,
    color: 'from-orange-500 to-amber-500',
    action: { type: 'feature', feature: 'document' },
  },
];

/* ===== Suggested Prompts (quick start) ===== */
const QUICK_STARTS = [
  'Crée une app de gestion de stock avec React',
  'Corrige et reformule mon mémoire',
  'Recherche les tendances en IA',
  'Génère un plan pour mon rapport de stage',
  'Écris un script Python pour automatiser mes tâches',
  'Prépare un exposé sur les énergies renouvelables',
];

export default function WelcomeScreen({
  onSetActiveFeature,
  onImportFolder,
  onShowProjectWizard,
  onQuickStart,
}: WelcomeScreenProps) {

  const handleCardClick = (card: FeatureCard) => {
    switch (card.action.type) {
      case 'wizard':
        onShowProjectWizard();
        break;
      case 'import':
        onImportFolder();
        break;
      case 'feature':
        onSetActiveFeature(card.action.feature);
        break;
    }
  };

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
          Ton assistant IA qui transforme chaque idée en réalité.
        </p>
      </div>

      {/* ── Feature cards — grille 2×3 aérée ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-2xl mb-8">
        {FEATURES.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              onClick={() => handleCardClick(card)}
              className={cn(
                'group p-4 rounded-xl border border-border-subtle',
                'bg-surface-default hover:bg-surface-hover',
                'transition-all duration-200 text-left',
                'hover:border-accent-primary/30 hover:shadow-md',
              )}
            >
              <div className={cn(
                'w-9 h-9 rounded-lg bg-gradient-to-br flex items-center justify-center mb-2.5',
                'group-hover:scale-105 transition-transform duration-200 shadow-sm',
                card.color,
              )}>
                <Icon size={18} className="text-white" />
              </div>
              <p className="text-[13px] font-semibold text-text-primary mb-0.5">
                {card.title}
              </p>
              <p className="text-[11px] text-text-muted leading-relaxed line-clamp-2">
                {card.description}
              </p>
            </button>
          );
        })}
      </div>

      {/* ── Quick start suggestions ── */}
      <div className="flex flex-wrap justify-center gap-2 w-full max-w-2xl">
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
