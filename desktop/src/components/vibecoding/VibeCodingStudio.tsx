/**
 * VibeCodingStudio — Le cœur du vibecoding dans ANZAR.
 *
 * Layout 4 panneaux (preview optionnel) :
 *   ┌──────────┬──────────────┬──────────────┬───────────┐
 *   │ FileTree │  Code Editor │ Live Preview │   Chat    │
 *   │ (240px)  │  (flexible)  │  (flexible)  │  (360px)  │
 *   │          │  + tabs      │  iframe app  │  itératif │
 *   └──────────┴──────────────┴──────────────┴───────────┘
 *
 * S'affiche inline dans le chat quand une génération démarre.
 * Reste ouvert pour l'itération après la génération.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  X, Maximize2, Minimize2, Play, Square,
  Loader2, CheckCircle2, AlertCircle,
  FolderOpen, Sparkles, ChevronDown, Package, Terminal, Rocket,
  Eye, EyeOff, ExternalLink, Undo2, GitBranch, Braces, Paintbrush, History,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProjectFile } from '@/types';
import { PlanResult, StepEvent, FileEvent, AgentsEvent, AgentUpdate } from '@/services/projectGeneration';

import StudioFileTree from './StudioFileTree';
import StudioEditor from './StudioEditor';
import StudioChat from './StudioChat';
import StudioPreview from './StudioPreview';
import PlanReview from './PlanReview';
import DesignToCodePanel from './DesignToCodePanel';
import StudioGitHistory from './StudioGitHistory';
import { terminalService, onDevServerUrl } from '@/services/terminal';
import { open as shellOpen } from '@tauri-apps/api/shell';

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
  /** Auto-fix state */
  autoFix?: {
    isRunning: boolean;
    attempt: number;
    maxAttempts: number;
    lastError: string | null;
  };
  /** Callback pour arrêter l'auto-fix */
  onStopAutoFix?: () => void;
  /** Git state */
  git?: {
    initialized: boolean;
    commitCount: number;
    canRollback: boolean;
  };
  /** Callback pour rollback (git reset --hard HEAD~1) */
  onRollback?: () => Promise<void>;
  /** CKG (Code Knowledge Graph) stats */
  ckg?: {
    indexed: boolean;
    totalSymbols: number;
    totalFiles: number;
    languages: Record<string, number>;
  };
  /** Deploy (build) state */
  deploy?: {
    status: 'idle' | 'building' | 'success' | 'error';
    output: string;
    durationMs: number;
    bundleSize: string | null;
  };
  /** Callback pour lancer le build */
  onDeploy?: () => Promise<void>;
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
  autoFix,
  onStopAutoFix,
  git,
  onRollback,
  ckg,
  deploy,
  onDeploy,
}) => {
  // ── State local ──
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showFileTree, setShowFileTree] = useState(true);
  const [showChat, setShowChat] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [showDesignToCode, setShowDesignToCode] = useState(false);
  const [showGitHistory, setShowGitHistory] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');

  // ── Écouter les URLs du dev server ──
  useEffect(() => {
    const unsub = onDevServerUrl((url) => {
      setPreviewUrl(url);
      setShowPreview(true);
    });
    return unsub;
  }, []);

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
      // Le preview s'ouvrira automatiquement via onDevServerUrl
    } catch {
      setRunStatus('error');
    }
  }, [projectPath, runStatus]);

  // ── Auto-install + auto-run après génération ──
  const autoInstallTriggeredRef = useRef(false);
  useEffect(() => {
    if (phase !== 'iterating' || !projectPath || autoInstallTriggeredRef.current) return;
    // Detect if project has package.json
    const hasPackageJson = Array.from(files.keys()).some(p => p.endsWith('package.json'));
    if (!hasPackageJson) return;

    autoInstallTriggeredRef.current = true;
    (async () => {
      // Auto install
      setInstallStatus('running');
      try {
        await terminalService.installDependencies(projectPath);
        setInstallStatus('done');
      } catch {
        setInstallStatus('error');
        return;
      }
      // Auto run dev server
      setRunStatus('running');
      try {
        await terminalService.runDevServer(projectPath);
        setRunStatus('done');
        // Preview s'ouvre automatiquement via onDevServerUrl
      } catch {
        setRunStatus('error');
      }
    })();
  }, [phase, projectPath, files]);

  // Reset auto-install flag when project changes
  useEffect(() => {
    autoInstallTriggeredRef.current = false;
  }, [projectId]);

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
              {/* Undo last iteration */}
              {git?.canRollback && onRollback && (
                <button
                  onClick={onRollback}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-orange-400 hover:bg-orange-500/10 transition-colors"
                  title="Annuler la dernière itération (git rollback)"
                >
                  <Undo2 size={12} />
                  Undo
                </button>
              )}
              {/* Git history toggle */}
              {git?.initialized && (
                <button
                  onClick={() => setShowGitHistory(!showGitHistory)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-colors',
                    showGitHistory
                      ? 'text-accent-primary bg-accent-primary/10'
                      : 'text-text-muted bg-bg-tertiary/40 hover:bg-surface-hover',
                  )}
                  title={`${git.commitCount} snapshots — ${showGitHistory ? 'Masquer' : 'Afficher'} l'historique`}
                >
                  <History size={10} />
                  {git.commitCount}
                </button>
              )}
              {ckg?.indexed && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-emerald-400/80 bg-emerald-400/10" title={`CKG: ${ckg.totalSymbols} symboles indexés dans ${ckg.totalFiles} fichiers`}>
                  <Braces size={10} />
                  {ckg.totalSymbols}
                </div>
              )}
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
              {/* Deploy button */}
              {onDeploy && (
                <button
                  onClick={onDeploy}
                  disabled={deploy?.status === 'building'}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    deploy?.status === 'building' && 'text-purple-400 bg-purple-500/10',
                    deploy?.status === 'success' && 'text-emerald-400 bg-emerald-500/10',
                    deploy?.status === 'error' && 'text-red-400 bg-red-500/10',
                    (!deploy || deploy.status === 'idle') && 'text-purple-400 hover:bg-purple-500/10',
                  )}
                  title={deploy?.status === 'success'
                    ? `Build réussi en ${(deploy.durationMs / 1000).toFixed(1)}s${deploy.bundleSize ? ` — ${deploy.bundleSize}` : ''}`
                    : 'Build de production (npm run build)'}
                >
                  {deploy?.status === 'building'
                    ? <Loader2 size={12} className="animate-spin" />
                    : deploy?.status === 'success'
                      ? <CheckCircle2 size={12} />
                      : deploy?.status === 'error'
                        ? <AlertCircle size={12} />
                        : <Rocket size={12} />}
                  Deploy
                  {deploy?.status === 'success' && deploy.durationMs > 0 && (
                    <span className="text-[10px] opacity-70">
                      {(deploy.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </button>
              )}
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
            onClick={() => setShowPreview(!showPreview)}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              showPreview ? 'text-emerald-400 bg-emerald-500/10' : 'text-text-muted hover:bg-surface-hover'
            )}
            title={showPreview ? 'Masquer le preview' : 'Afficher le preview'}
          >
            {showPreview ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
          <button
            onClick={() => { setShowDesignToCode(!showDesignToCode); if (!showDesignToCode) setShowChat(true); }}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              showDesignToCode ? 'text-purple-400 bg-purple-500/10' : 'text-text-muted hover:bg-surface-hover'
            )}
            title={showDesignToCode ? 'Masquer Design→Code' : 'Design → Code'}
          >
            <Paintbrush size={16} />
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

        {/* Auto-fix indicator */}
        {autoFix?.isRunning && (
          <div className="flex items-center gap-2 ml-3 px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 animate-pulse">
            <Loader2 size={10} className="animate-spin" />
            <span className="text-[10px] font-semibold">
              Auto-fix {autoFix.attempt}/{autoFix.maxAttempts}
            </span>
            {onStopAutoFix && (
              <button
                onClick={onStopAutoFix}
                className="ml-1 text-[9px] underline hover:text-amber-300 transition-colors"
              >
                Stop
              </button>
            )}
          </div>
        )}
        {autoFix?.lastError && !autoFix.isRunning && (
          <div className="flex items-center gap-1.5 ml-3 px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 text-[10px]">
            <AlertCircle size={10} />
            <span className="truncate max-w-[200px]">{autoFix.lastError}</span>
          </div>
        )}

        {/* Deploy status indicator */}
        {deploy?.status === 'building' && (
          <div className="flex items-center gap-1.5 ml-3 px-2.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 animate-pulse text-[10px] font-semibold">
            <Loader2 size={10} className="animate-spin" />
            Build en cours...
          </div>
        )}
        {deploy?.status === 'success' && (
          <div className="flex items-center gap-1.5 ml-3 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px]">
            <CheckCircle2 size={10} />
            Build OK — {(deploy.durationMs / 1000).toFixed(1)}s
            {deploy.bundleSize && <span className="font-semibold ml-1">{deploy.bundleSize}</span>}
          </div>
        )}
        {deploy?.status === 'error' && (
          <div className="flex items-center gap-1.5 ml-3 px-2.5 py-0.5 rounded-full bg-red-500/10 text-red-400 text-[10px]">
            <AlertCircle size={10} />
            <span className="truncate max-w-[250px]">Build échoué</span>
          </div>
        )}

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
            {showFileTree && !showGitHistory && (
              <div className="w-[240px] flex-shrink-0 border-r border-border-subtle overflow-hidden">
                <StudioFileTree
                  files={filesList}
                  selectedFile={selectedFile}
                  activeGeneratingFile={activeGeneratingFile}
                  onSelectFile={handleSelectFile}
                />
              </div>
            )}

            {/* Git History Panel */}
            {showGitHistory && projectPath && git?.initialized && (
              <div className="w-[280px] flex-shrink-0 border-r border-border-subtle overflow-hidden">
                <StudioGitHistory
                  projectPath={projectPath}
                  commitCount={git.commitCount}
                  onRollbackToCommit={onRollback ? async () => { await onRollback(); } : undefined}
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

            {/* Live Preview */}
            {showPreview && (
              <div className="flex-1 min-w-[300px] border-l border-border-subtle overflow-hidden">
                <StudioPreview
                  previewUrl={previewUrl}
                  onOpenExternal={() => {
                    if (previewUrl) shellOpen(previewUrl).catch(() => {});
                  }}
                />
              </div>
            )}

            {/* Chat / Design-to-Code */}
            {showChat && (
              <div className="w-[360px] flex-shrink-0 border-l border-border-subtle overflow-hidden">
                {showDesignToCode ? (
                  <DesignToCodePanel
                    projectId={projectId}
                    projectName={projectName}
                    existingFiles={Object.fromEntries(filesList.map(f => [f.path, f.content]))}
                    onFilesGenerated={(newFiles) => {
                      if (onFileChange) {
                        for (const [path, content] of Object.entries(newFiles)) {
                          onFileChange(path, content);
                        }
                      }
                    }}
                    onUpdate={() => {}}
                    disabled={isIteratingProp}
                  />
                ) : (
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
                )}
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
