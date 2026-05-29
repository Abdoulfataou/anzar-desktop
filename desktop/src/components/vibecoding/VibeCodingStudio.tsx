/**
 * VibeCodingStudio — Le cœur du vibecoding dans ANZAR.
 *
 * Layout 3 panneaux :
 *   ┌─────────────┬───────────────────────┬───────────────┐
 *   │  FileTree    │     Code Editor       │   Chat        │
 *   │  (240px)     │     (flexible)        │   (360px)     │
 *   │             │     + tabs + live      │   itératif    │
 *   └─────────────┴───────────────────────┴───────────────┘
 *
 * S'affiche inline dans le chat quand une génération démarre.
 * Reste ouvert pour l'itération après la génération.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  X, Maximize2, Minimize2, Play, Square,
  Loader2, CheckCircle2, AlertCircle,
  FolderOpen, Sparkles, ChevronDown, Package, Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProjectFile } from '@/types';
import { PlanResult, StepEvent, FileEvent, AgentsEvent, AgentUpdate } from '@/services/projectGeneration';

import StudioFileTree from './StudioFileTree';
import StudioEditor from './StudioEditor';
import StudioChat from './StudioChat';
import PlanReview from './PlanReview';
import { terminalService } from '@/services/terminal';

// ============================================================================
// TYPES
// ============================================================================

export type StudioPhase = 'planning' | 'reviewing' | 'generating' | 'iterating' | 'error';

export interface StudioFile {
  path: string;
  content: string;
  language: string;
  status: 'pending' | 'generating' | 'done' | 'modified';
  /** Contenu avant la dernière itération (pour la vue diff) */
  previousContent?: string;
}

export interface VibeCodingStudioProps {
  /** ID du projet dans le store */
  projectId: string;
  /** Nom du projet */
  projectName: string;
  /** Phase actuelle */
  phase: StudioPhase;
  /** Plan reçu du backend */
  plan: PlanResult | null;
  /** Fichiers générés (mis à jour en temps réel) */
  files: Map<string, StudioFile>;
  /** Agents statut */
  agents: AgentUpdate[];
  /** Étapes de génération en cours */
  currentStep: StepEvent | null;
  /** Callback pour valider le plan et lancer la génération */
  onExecutePlan: () => void;
  /** Callback pour envoyer un message d'itération */
  onIterate: (message: string, fileFocus?: string) => Promise<void>;
  /** Callback pour édition manuelle d'un fichier */
  onFileChange?: (path: string, newContent: string) => void;
  /** Callback pour revenir à la version précédente d'un fichier */
  onFileRevert?: (path: string) => void;
  /** Est-ce qu'une itération est en cours */
  isIterating?: boolean;
  /** Résultat de la dernière itération */
  lastIterationResult?: { success: boolean; modifiedFiles: string[]; error?: string } | null;
  /** Callback pour annuler la génération */
  onCancel: () => void;
  /** Callback pour fermer le studio */
  onClose: () => void;
  /** Fichier en cours de génération */
  activeGeneratingFile?: string;
  /** Message d'erreur */
  errorMessage?: string;
  /** Chemin local du projet (pour Install/Run) */
  projectPath?: string;
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

const VibeCodingStudio: React.FC<VibeCodingStudioProps> = ({
  projectId,
  projectName,
  phase,
  plan,
  files,
  agents,
  currentStep,
  onExecutePlan,
  onIterate,
  onFileChange,
  onFileRevert,
  onCancel,
  onClose,
  activeGeneratingFile,
  errorMessage,
  isIterating: isIteratingProp,
  lastIterationResult,
  projectPath,
}) => {
  // ── State local ──
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showFileTree, setShowFileTree] = useState(true);
  const [showChat, setShowChat] = useState(true);
  const [installStatus, setInstallStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');

  // ── Install / Run handlers ──
  const handleInstall = useCallback(async () => {
    if (!projectPath || installStatus === 'running') return;
    setInstallStatus('running');
    try {
      await terminalService.installDependencies(projectPath);
      setInstallStatus('done');
    } catch {
      setInstallStatus('error');
    }
  }, [projectPath, installStatus]);

  const handleRun = useCallback(async () => {
    if (!projectPath || runStatus === 'running') return;
    setRunStatus('running');
    try {
      await terminalService.runDevServer(projectPath);
      setRunStatus('done');
    } catch {
      setRunStatus('error');
    }
  }, [projectPath, runStatus]);

  // ── Fichiers triés pour le file tree ──
  const filesList = useMemo(() => {
    return Array.from(files.values()).sort((a, b) => a.path.localeCompare(b.path));
  }, [files]);

  // ── Auto-select le fichier en cours de génération ──
  useEffect(() => {
    if (activeGeneratingFile && phase === 'generating') {
      setSelectedFile(activeGeneratingFile);
    }
  }, [activeGeneratingFile, phase]);

  // ── Auto-select premier fichier quand la génération est finie ──
  useEffect(() => {
    if (phase === 'iterating' && !selectedFile && filesList.length > 0) {
      setSelectedFile(filesList[0].path);
    }
  }, [phase, selectedFile, filesList]);

  // ── Fichier sélectionné ──
  const currentFile = selectedFile ? files.get(selectedFile) || null : null;

  // ── Progression globale ──
  const progress = useMemo(() => {
    if (phase === 'planning') return 10;
    if (phase === 'reviewing') return 20;
    if (phase === 'iterating') return 100;
    if (phase === 'error') return 0;

    // Pendant la génération, calculer depuis les fichiers
    const total = plan?.files?.length || 0;
    if (total === 0) return 30;
    const done = filesList.filter(f => f.status === 'done').length;
    return Math.round(20 + (done / total) * 80);
  }, [phase, plan, filesList]);

  // ── Status bar text ──
  const statusText = useMemo(() => {
    switch (phase) {
      case 'planning': return 'Analyse et planification...';
      case 'reviewing': return `Plan prêt — ${plan?.files?.length || 0} fichiers à générer`;
      case 'generating': {
        const done = filesList.filter(f => f.status === 'done').length;
        const total = plan?.files?.length || filesList.length;
        const current = currentStep?.label || activeGeneratingFile || '';
        return `Génération ${done}/${total} — ${current}`;
      }
      case 'iterating': return `${filesList.length} fichiers — Prêt pour les modifications`;
      case 'error': return errorMessage || 'Une erreur est survenue';
      default: return '';
    }
  }, [phase, plan, filesList, currentStep, activeGeneratingFile, errorMessage]);

  // ── Callback sélection fichier ──
  const handleSelectFile = useCallback((path: string) => {
    setSelectedFile(path);
  }, []);

  return (
    <div
      className={cn(
        'flex flex-col bg-bg-primary border border-border-subtle rounded-xl overflow-hidden transition-all duration-300',
        isMaximized ? 'fixed inset-0 z-50 rounded-none' : 'h-[700px]'
      )}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-bg-secondary/50 border-b border-border-subtle flex-shrink-0">
        {/* Left: project info */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent-primary flex-shrink-0" />
            <span className="text-sm font-semibold text-text-primary truncate max-w-[200px]">
              {projectName}
            </span>
          </div>

          {/* Phase badge */}
          <div className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium',
            phase === 'planning' && 'bg-blue-500/15 text-blue-400',
            phase === 'reviewing' && 'bg-amber-500/15 text-amber-400',
            phase === 'generating' && 'bg-accent-primary/15 text-accent-primary',
            phase === 'iterating' && 'bg-emerald-500/15 text-emerald-400',
            phase === 'error' && 'bg-red-500/15 text-red-400',
          )}>
            {phase === 'planning' && <Loader2 size={12} className="animate-spin" />}
            {phase === 'reviewing' && <Play size={12} />}
            {phase === 'generating' && <Loader2 size={12} className="animate-spin" />}
            {phase === 'iterating' && <CheckCircle2 size={12} />}
            {phase === 'error' && <AlertCircle size={12} />}
            {phase === 'planning' && 'Planification'}
            {phase === 'reviewing' && 'Prêt à générer'}
            {phase === 'generating' && 'Génération'}
            {phase === 'iterating' && 'Studio'}
            {phase === 'error' && 'Erreur'}
          </div>
        </div>

        {/* Center: progress bar */}
        <div className="flex-1 mx-6 max-w-sm">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  phase === 'error' ? 'bg-red-500' : 'bg-gradient-to-r from-accent-primary to-accent-secondary'
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[11px] text-text-muted font-medium w-8 text-right">
              {progress}%
            </span>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1">
          {phase === 'generating' && (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Square size={12} />
              Arrêter
            </button>
          )}
          {phase === 'iterating' && projectPath && (
            <>
              <button
                onClick={handleInstall}
                disabled={installStatus === 'running'}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors',
                  installStatus === 'running' && 'text-amber-400 bg-amber-500/10',
                  installStatus === 'done' && 'text-emerald-400 bg-emerald-500/10',
                  installStatus === 'error' && 'text-red-400 bg-red-500/10',
                  installStatus === 'idle' && 'text-text-secondary hover:bg-surface-hover',
                )}
                title="Installer les dépendances"
              >
                {installStatus === 'running' ? <Loader2 size={12} className="animate-spin" /> : <Package size={12} />}
                Install
              </button>
              <button
                onClick={handleRun}
                disabled={runStatus === 'running'}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors',
                  runStatus === 'running' && 'text-emerald-400 bg-emerald-500/10',
                  runStatus === 'idle' && 'text-text-secondary hover:bg-surface-hover',
                  runStatus === 'error' && 'text-red-400 bg-red-500/10',
                )}
                title="Lancer le serveur de développement"
              >
                {runStatus === 'running' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                Run
              </button>
            </>
          )}
          <button
            onClick={() => setShowFileTree(!showFileTree)}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              showFileTree ? 'text-accent-primary bg-accent-primary/10' : 'text-text-muted hover:bg-surface-hover'
            )}
            title="Fichiers"
          >
            <FolderOpen size={16} />
          </button>
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1.5 rounded-lg text-text-muted hover:bg-surface-hover transition-colors"
            title={isMaximized ? 'Réduire' : 'Agrandir'}
          >
            {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:bg-red-500/10 hover:text-red-400 transition-colors"
            title="Fermer"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Status bar ── */}
      <div className="flex items-center px-4 py-1.5 bg-bg-secondary/30 border-b border-border-subtle text-[11px] text-text-muted flex-shrink-0">
        {(phase === 'planning' || phase === 'generating') && (
          <Loader2 size={10} className="animate-spin mr-2 text-accent-primary" />
        )}
        <span className="truncate">{statusText}</span>

        {/* Agent indicators */}
        {agents.length > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            {agents.map(a => (
              <div key={a.name} className="flex items-center gap-1">
                <div className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  a.status === 'done' && 'bg-emerald-400',
                  a.status === 'running' && 'bg-accent-primary animate-pulse',
                  a.status === 'pending' && 'bg-text-muted/30',
                  a.status === 'error' && 'bg-red-400',
                )} />
                <span className="capitalize">{a.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Corps principal ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Phase reviewing : PlanReview plein écran ── */}
        {phase === 'reviewing' && plan && (
          <PlanReview
            plan={plan}
            onExecute={onExecutePlan}
            onCancel={onClose}
          />
        )}

        {/* ── Phases generating / iterating : layout 3 panneaux ── */}
        {(phase === 'generating' || phase === 'iterating' || phase === 'error') && (
          <>
            {/* File Tree */}
            {showFileTree && (
              <div className="w-[240px] flex-shrink-0 border-r border-border-subtle overflow-hidden">
                <StudioFileTree
                  files={filesList}
                  selectedFile={selectedFile}
                  activeGeneratingFile={activeGeneratingFile}
                  onSelectFile={handleSelectFile}
                />
              </div>
            )}

            {/* Editor */}
            <div className="flex-1 min-w-0 overflow-hidden">
              {currentFile ? (
                <StudioEditor
                  files={filesList}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectFile}
                  isGenerating={phase === 'generating'}
                  onFileChange={onFileChange}
                  onFileRevert={onFileRevert}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-text-muted">
                  <div className="text-center">
                    {phase === 'generating' ? (
                      <>
                        <Loader2 size={32} className="mx-auto mb-3 animate-spin text-accent-primary" />
                        <p className="text-sm font-medium text-text-primary mb-1">
                          Génération en cours...
                        </p>
                        <p className="text-xs text-text-muted">
                          Les fichiers apparaîtront ici au fur et à mesure
                        </p>
                      </>
                    ) : (
                      <>
                        <FolderOpen size={32} className="mx-auto mb-3 opacity-30" />
                        <p className="text-sm">Sélectionne un fichier pour l'éditer</p>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Chat */}
            {showChat && (
              <div className="w-[360px] flex-shrink-0 border-l border-border-subtle overflow-hidden">
                <StudioChat
                  projectId={projectId}
                  projectName={projectName}
                  phase={phase}
                  files={filesList}
                  agents={agents}
                  currentStep={currentStep}
                  onIterate={onIterate}
                  selectedFile={selectedFile}
                  errorMessage={errorMessage}
                  isIteratingExternal={isIteratingProp}
                  lastIterationResult={lastIterationResult}
                />
              </div>
            )}
          </>
        )}

        {/* ── Phase planning : loader central ── */}
        {phase === 'planning' && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="relative mx-auto w-16 h-16 mb-4">
                <div className="absolute inset-0 rounded-full border-2 border-accent-primary/20" />
                <div className="absolute inset-0 rounded-full border-2 border-accent-primary border-t-transparent animate-spin" />
                <Sparkles size={20} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-accent-primary" />
              </div>
              <p className="text-sm font-medium text-text-primary mb-1">
                Analyse de ta demande...
              </p>
              <p className="text-xs text-text-muted">
                L'IA planifie l'architecture et la structure du projet
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VibeCodingStudio;
