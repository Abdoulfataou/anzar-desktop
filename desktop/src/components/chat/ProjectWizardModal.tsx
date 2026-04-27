/**
 * ProjectWizardModal — Wizard de creation de projet ANZAR
 * Collecte: type de projet, nom, description, technos
 * Genere un prompt professionnel pour le pipeline multi-agents
 */
import React, { useState, useCallback } from 'react';
import {
  X, Globe, Server, Smartphone, Terminal, Layout,
  ShoppingCart, Database, Gamepad2, FileCode,
  ChevronRight, Sparkles, ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* ===== Types de projets ===== */
const PROJECT_TYPES = [
  {
    id: 'web_app',
    title: 'Application Web',
    description: 'Site ou application web interactive',
    icon: Globe,
    color: 'from-blue-500 to-cyan-500',
    examples: 'Dashboard, SaaS, portail, plateforme',
    defaultTechs: ['React', 'TypeScript', 'Tailwind CSS'],
  },
  {
    id: 'api_backend',
    title: 'API / Backend',
    description: 'Serveur, API REST ou microservice',
    icon: Server,
    color: 'from-green-500 to-emerald-500',
    examples: 'API REST, GraphQL, microservice',
    defaultTechs: ['Python', 'FastAPI', 'SQLite'],
  },
  {
    id: 'mobile',
    title: 'Application Mobile',
    description: 'App mobile cross-platform',
    icon: Smartphone,
    color: 'from-purple-500 to-violet-500',
    examples: 'App iOS/Android, PWA',
    defaultTechs: ['React Native', 'TypeScript'],
  },
  {
    id: 'fullstack',
    title: 'Full-Stack',
    description: 'Frontend + Backend complet',
    icon: Layout,
    color: 'from-orange-500 to-amber-500',
    examples: 'App complete avec auth, BDD, API',
    defaultTechs: ['React', 'Node.js', 'PostgreSQL'],
  },
  {
    id: 'ecommerce',
    title: 'E-Commerce',
    description: 'Boutique en ligne, marketplace',
    icon: ShoppingCart,
    color: 'from-pink-500 to-rose-500',
    examples: 'Boutique, marketplace, panier',
    defaultTechs: ['React', 'Node.js', 'Stripe'],
  },
  {
    id: 'script',
    title: 'Script / Outil',
    description: 'Automatisation, CLI, scraping',
    icon: Terminal,
    color: 'from-slate-500 to-gray-600',
    examples: 'Bot, scraper, CLI tool, cron',
    defaultTechs: ['Python'],
  },
  {
    id: 'data',
    title: 'Data / IA',
    description: 'Analyse de donnees, ML, dashboard data',
    icon: Database,
    color: 'from-teal-500 to-cyan-600',
    examples: 'Pipeline data, dashboard analytics, ML',
    defaultTechs: ['Python', 'Pandas', 'SQLite'],
  },
  {
    id: 'game',
    title: 'Jeu',
    description: 'Jeu web, mobile ou desktop',
    icon: Gamepad2,
    color: 'from-red-500 to-orange-500',
    examples: 'Jeu 2D, quiz, puzzle, arcade',
    defaultTechs: ['JavaScript', 'Canvas', 'HTML5'],
  },
  {
    id: 'other',
    title: 'Autre',
    description: 'Projet personnalise',
    icon: FileCode,
    color: 'from-indigo-500 to-blue-600',
    examples: 'Extension, plugin, librairie...',
    defaultTechs: [],
  },
];

/* ===== Technos populaires ===== */
const POPULAR_TECHS = [
  'React', 'Vue.js', 'Next.js', 'Angular', 'Svelte',
  'TypeScript', 'JavaScript', 'Python', 'Node.js', 'Go',
  'FastAPI', 'Express', 'Django', 'Flask', 'NestJS',
  'Tailwind CSS', 'Bootstrap', 'Material UI',
  'PostgreSQL', 'MySQL', 'SQLite', 'MongoDB', 'Firebase',
  'Docker', 'Redis', 'Stripe', 'JWT', 'OAuth',
  'React Native', 'Flutter', 'Electron',
];

interface ProjectWizardModalProps {
  onClose: () => void;
  onGenerate: (prompt: string, projectName: string) => void;
}

type WizardStep = 'type' | 'details';

export default function ProjectWizardModal({ onClose, onGenerate }: ProjectWizardModalProps) {
  const [step, setStep] = useState<WizardStep>('type');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTechs, setSelectedTechs] = useState<string[]>([]);
  const [customTech, setCustomTech] = useState('');

  const typeObj = PROJECT_TYPES.find((t) => t.id === selectedType);

  const handleSelectType = useCallback((typeId: string) => {
    setSelectedType(typeId);
    const type = PROJECT_TYPES.find((t) => t.id === typeId);
    if (type?.defaultTechs) {
      setSelectedTechs(type.defaultTechs);
    }
    setStep('details');
  }, []);

  const toggleTech = (tech: string) => {
    setSelectedTechs((prev) =>
      prev.includes(tech) ? prev.filter((t) => t !== tech) : [...prev, tech]
    );
  };

  const addCustomTech = () => {
    const t = customTech.trim();
    if (t && !selectedTechs.includes(t)) {
      setSelectedTechs((prev) => [...prev, t]);
      setCustomTech('');
    }
  };

  const buildPrompt = useCallback((): string => {
    const type = PROJECT_TYPES.find((t) => t.id === selectedType);
    const name = projectName.trim() || 'mon_projet';
    const desc = description.trim();
    const techs = selectedTechs.length > 0 ? selectedTechs.join(', ') : '';

    let prompt = `Cree un projet "${name}"`;

    if (type && type.id !== 'other') {
      prompt += ` de type ${type.title.toLowerCase()}`;
    }

    prompt += '.';

    if (desc) {
      prompt += `\n\nDescription: ${desc}`;
    }

    if (techs) {
      prompt += `\n\nTechnologies souhaitees: ${techs}.`;
    }

    // Add professional context for the AI agents
    prompt += `\n\nExigences:`;
    prompt += `\n- Structure de fichiers propre et organisee`;
    prompt += `\n- Code fonctionnel et complet (pas de placeholders)`;
    prompt += `\n- README avec instructions d'installation`;

    if (selectedType === 'web_app' || selectedType === 'fullstack' || selectedType === 'ecommerce') {
      prompt += `\n- Design responsive et moderne`;
      prompt += `\n- Composants reutilisables`;
    }

    if (selectedType === 'api_backend' || selectedType === 'fullstack') {
      prompt += `\n- Endpoints documentes`;
      prompt += `\n- Validation des donnees`;
    }

    if (selectedType === 'fullstack' || selectedType === 'ecommerce') {
      prompt += `\n- Authentification utilisateur`;
    }

    return prompt;
  }, [selectedType, projectName, description, selectedTechs]);

  const handleGenerate = () => {
    const name = projectName.trim() || typeObj?.title || 'mon_projet';
    onGenerate(buildPrompt(), name);
  };

  const canGenerate = selectedType && (projectName.trim() || description.trim());

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl mx-4 max-h-[85vh] animate-scale-in">
        <div className="rounded-2xl border border-border-medium bg-bg-secondary shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle flex-shrink-0">
            <div className="flex items-center gap-3">
              {step === 'details' && (
                <button
                  onClick={() => setStep('type')}
                  className="p-1.5 rounded-lg text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
                >
                  <ArrowLeft size={16} />
                </button>
              )}
              <div>
                <h2 className="text-base font-bold text-text-primary">
                  {step === 'type' ? 'Nouveau projet' : 'Details du projet'}
                </h2>
                <p className="text-xs text-text-muted mt-0.5">
                  {step === 'type'
                    ? 'Quel type de projet veux-tu creer ?'
                    : `${typeObj?.title || 'Projet'} — personnalise ton projet`}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {step === 'type' && (
              <div className="grid grid-cols-3 gap-3">
                {PROJECT_TYPES.map((type) => {
                  const Icon = type.icon;
                  return (
                    <button
                      key={type.id}
                      onClick={() => handleSelectType(type.id)}
                      className={cn(
                        'group p-4 rounded-xl border border-border-subtle',
                        'bg-surface-default hover:bg-surface-hover',
                        'transition-all duration-200 text-left',
                        'hover:border-accent-primary/30 hover:shadow-md',
                      )}
                    >
                      <div className={cn(
                        'w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center mb-3',
                        'group-hover:scale-110 transition-transform duration-200 shadow-sm',
                        type.color,
                      )}>
                        <Icon size={20} className="text-white" />
                      </div>
                      <p className="text-sm font-semibold text-text-primary mb-0.5">{type.title}</p>
                      <p className="text-[11px] text-text-muted leading-relaxed">{type.description}</p>
                      <p className="text-[10px] text-text-muted/60 mt-1.5 italic">{type.examples}</p>
                    </button>
                  );
                })}
              </div>
            )}

            {step === 'details' && (
              <div className="space-y-5">
                {/* Nom du projet */}
                <div>
                  <label className="block text-xs font-semibold text-text-primary mb-1.5">
                    Nom du projet *
                  </label>
                  <input
                    autoFocus
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Ex: GestStock, MonPortfolio, API-Facturation..."
                    className="w-full px-4 py-3 rounded-xl text-sm bg-bg-tertiary border border-border-subtle text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40 transition-all"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-semibold text-text-primary mb-1.5">
                    Decris ton projet
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Ex: Une application de gestion de stock pour une boutique, avec suivi des produits, des ventes et des alertes de rupture..."
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl text-sm bg-bg-tertiary border border-border-subtle text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40 resize-none transition-all"
                  />
                  <p className="text-[10px] text-text-muted/60 mt-1">
                    Plus ta description est precise, meilleur sera le resultat.
                  </p>
                </div>

                {/* Technologies */}
                <div>
                  <label className="block text-xs font-semibold text-text-primary mb-1.5">
                    Technologies
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {selectedTechs.map((tech) => (
                      <button
                        key={tech}
                        onClick={() => toggleTech(tech)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-accent-primary/15 text-accent-primary border border-accent-primary/30 hover:bg-accent-primary/25 transition-colors"
                      >
                        {tech} &times;
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {POPULAR_TECHS.filter((t) => !selectedTechs.includes(t)).slice(0, 18).map((tech) => (
                      <button
                        key={tech}
                        onClick={() => toggleTech(tech)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-bg-tertiary text-text-secondary border border-border-subtle hover:bg-surface-hover hover:text-text-primary transition-colors"
                      >
                        + {tech}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <input
                      value={customTech}
                      onChange={(e) => setCustomTech(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTech(); } }}
                      placeholder="Ajouter une autre techno..."
                      className="flex-1 px-3 py-2 rounded-lg text-xs bg-bg-tertiary border border-border-subtle text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary/40 transition-all"
                    />
                    <button
                      onClick={addCustomTech}
                      disabled={!customTech.trim()}
                      className="px-3 py-2 rounded-lg text-xs font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-40 transition-colors"
                    >
                      Ajouter
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          {step === 'details' && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-border-subtle flex-shrink-0 bg-bg-secondary/80">
              <p className="text-[11px] text-text-muted">
                {selectedTechs.length > 0 && `${selectedTechs.length} technologie(s)`}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl text-xs font-medium text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  className={cn(
                    'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
                    canGenerate
                      ? 'gradient-bg text-white hover:opacity-90 shadow-lg'
                      : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                  )}
                >
                  <Sparkles size={16} />
                  Generer le projet
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
