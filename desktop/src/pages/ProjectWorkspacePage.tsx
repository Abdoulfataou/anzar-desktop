/**
 * ProjectWorkspacePage - Vue workspace complète d'un projet
 * Layout 3 panneaux : Explorateur | Éditeur | Chat IA
 * Similaire à Cursor, Trae Solo, Claude Cowork
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen,
  FileCode, FolderOpen, Plus,
  Terminal as TerminalIcon, Play, Package, AlertTriangle,
  Loader2, Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/stores/projectStore';
import { ProjectFile } from '@/types';
import { FileNode } from '@/types/file-project';
import FileExplorer from '@/components/projects/FileExplorer';
import CodeEditor from '@/components/projects/CodeEditor';
import ProjectChat from '@/components/projects/ProjectChat';
import AgentProgress from '@/components/projects/AgentProgress';
import TerminalPanel from '@/components/terminal/Terminal';
import { terminalService } from '@/services/terminal';
import { diagnosticService, DiagnosticReport, DiagnosticSolution } from '@/services/diagnostic';
import RunPanel from '@/components/runs/RunPanel';
import { runService } from '@/services/runService';
import { useChangeStore } from '@/stores/changeStore';
import { useSettingsStore } from '@/stores/settingsStore';

/* ===== Convert ProjectFile[] to FileNode[] tree ===== */
function buildFileTree(files: ProjectFile[]): FileNode[] {
  const root: FileNode[] = [];
  const dirMap = new Map<string, FileNode>();

  // Sort files so directories come first
  const sorted = [...files].sort((a, b) => {
    const aDepth = a.path.split('/').length;
    const bDepth = b.path.split('/').length;
    return aDepth - bDepth;
  });

  for (const file of sorted) {
    const parts = file.path.split('/');
    const fileName = parts.pop()!;
    const dirPath = parts.join('/');

    // Create intermediate directories
    let currentPath = '';
    for (const part of parts) {
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!dirMap.has(currentPath)) {
        const dirNode: FileNode = {
          id: `dir-${currentPath}`,
          name: part,
          path: currentPath,
          type: 'directory',
          children: [],
        };
        dirMap.set(currentPath, dirNode);

        if (parentPath && dirMap.has(parentPath)) {
          dirMap.get(parentPath)!.children!.push(dirNode);
        } else if (!parentPath) {
          root.push(dirNode);
        }
      }
    }

    // Create file node
    const ext = fileName.split('.').pop() || '';
    const fileNode: FileNode = {
      id: `file-${file.path}`,
      name: fileName,
      path: file.path,
      type: 'file',
      extension: ext,
      size: file.size || file.content.length,
      content: file.content,
    };

    if (dirPath && dirMap.has(dirPath)) {
      dirMap.get(dirPath)!.children!.push(fileNode);
    } else {
      root.push(fileNode);
    }
  }

  return root;
}

/* ===== Tab Component ===== */
function EditorTab({
  file,
  isActive,
  hasChanges,
  onClick,
  onClose,
}: {
  file: ProjectFile;
  isActive: boolean;
  hasChanges: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}) {
  const fileName = file.path.split('/').pop() || file.path;
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3 py-2 text-xs font-medium border-r border-border-subtle transition-colors group min-w-0 max-w-[180px]',
        isActive
          ? 'bg-bg-primary text-text-primary border-b-2 border-b-accent-primary'
          : 'bg-bg-secondary/50 text-text-muted hover:text-text-primary hover:bg-bg-primary/50'
      )}
    >
      <FileCode size={12} className={cn(isActive ? 'text-accent-primary' : 'text-text-muted')} />
      <span className="truncate">{fileName}</span>
      {hasChanges && (
        <span className="w-2 h-2 rounded-full bg-accent-warning flex-shrink-0" />
      )}
      <span
        onClick={onClose}
        className="ml-1 p-0.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
      >
        ×
      </span>
    </button>
  );
}

/* ===== Empty Editor State ===== */
function EmptyEditorState({ projectName }: { projectName: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <div className="w-16 h-16 rounded-2xl gradient-bg flex items-center justify-center mb-4 shadow-lg opacity-60">
        <FileCode size={28} className="text-white" />
      </div>
      <h3 className="text-base font-semibold text-text-primary mb-1">{projectName}</h3>
      <p className="text-sm text-text-muted max-w-[280px]">
        Sélectionne un fichier dans l'explorateur pour commencer à coder.
      </p>
    </div>
  );
}

/* ===== New File Modal ===== */
function NewFileModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (path: string, content: string) => void;
}) {
  const [filePath, setFilePath] = useState('');

  const handleCreate = () => {
    if (!filePath.trim()) return;
    const ext = filePath.split('.').pop() || 'txt';
    const langMap: Record<string, string> = {
      ts: '// Nouveau fichier TypeScript\n',
      tsx: '// Nouveau composant React\nimport React from \'react\';\n\n',
      js: '// Nouveau fichier JavaScript\n',
      jsx: '// Nouveau composant React\nimport React from \'react\';\n\n',
      py: '# Nouveau fichier Python\n',
      css: '/* Nouveau fichier CSS */\n',
      html: '<!DOCTYPE html>\n<html>\n<head>\n  <title></title>\n</head>\n<body>\n  \n</body>\n</html>\n',
      json: '{\n  \n}\n',
      md: '# Nouveau document\n\n',
    };
    const content = langMap[ext] || '';
    onCreate(filePath.trim(), content);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm mx-4 animate-scale-in">
        <div className="rounded-xl border border-border-medium bg-bg-secondary/95 backdrop-blur-xl shadow-2xl p-5">
          <h3 className="text-sm font-semibold text-text-primary mb-3">Nouveau fichier</h3>
          <input
            autoFocus
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') onClose(); }}
            placeholder="Ex: src/components/Header.tsx"
            className="w-full px-3 py-2.5 rounded-lg text-sm bg-bg-tertiary border border-border-subtle text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-lg text-xs font-medium text-text-secondary hover:bg-surface-hover transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleCreate}
              disabled={!filePath.trim()}
              className={cn(
                'px-4 py-2 rounded-lg text-xs font-medium transition-all',
                filePath.trim()
                  ? 'gradient-bg text-white hover:opacity-90'
                  : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
              )}
            >
              Créer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== Main Workspace ===== */
const ProjectWorkspacePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const projects = useProjectStore((s) => s.projects);
  const updateFile = useProjectStore((s) => s.updateFile);
  const addFile = useProjectStore((s) => s.addFile);
  const updateProject = useProjectStore((s) => s.updateProject);
  const developerMode = useSettingsStore((s) => s.settings.developerMode);

  const project = useMemo(
    () => projects.find((p) => p.id === id) || null,
    [projects, id]
  );

  // Panel visibility
  const [showExplorer, setShowExplorer] = useState(true);
  const [showChat, setShowChat] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);

  // Editor state
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set());
  const [showNewFile, setShowNewFile] = useState(false);

  // Terminal & Diagnostics
  const [isRunning, setIsRunning] = useState(false);
  const [diagnosticReport, setDiagnosticReport] = useState<DiagnosticReport | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Project path (from metadata for imported projects)
  const projectPath = project?.metadata?.localPath as string | undefined;

  // Start diagnostic monitoring when terminal opens
  useEffect(() => {
    if (showTerminal) {
      diagnosticService.startMonitoring();
    }
    return () => diagnosticService.stopMonitoring();
  }, [showTerminal]);

  // Track running processes
  useEffect(() => {
    const unsub = terminalService.onEvent((event) => {
      if (event.type === 'process-start') setIsRunning(true);
      if (event.type === 'process-end' || event.type === 'process-error') {
        setIsRunning(terminalService.getRunningProcesses().length > 0);
      }
    });
    return unsub;
  }, []);

  // Quick actions for toolbar
  const handleRunProject = useCallback(async () => {
    if (!project || !projectPath) return;
    setShowTerminal(true);
    await runService.executeAction({ projectId: project.id, projectPath, actionId: 'dev' });
  }, [project, projectPath]);

  const handleInstallDeps = useCallback(async () => {
    if (!project || !projectPath) return;
    setShowTerminal(true);
    await runService.executeAction({ projectId: project.id, projectPath, actionId: 'install' });
  }, [project, projectPath]);

  const handleDiagnose = useCallback(async () => {
    setIsAnalyzing(true);
    const allOutput = terminalService.getAllOutput()
      .map((o) => o.content)
      .join('\n');

    const report = await diagnosticService.analyzeErrors(allOutput, {
      projectPath,
    });
    setDiagnosticReport(report);
    setIsAnalyzing(false);
  }, [projectPath]);

  const handleApplyFix = useCallback(async (solution: DiagnosticSolution) => {
    setShowTerminal(true);
    await diagnosticService.applyFix(solution, projectPath);
  }, [projectPath]);

  // File tree
  const fileTree = useMemo(
    () => (project ? buildFileTree(project.files) : []),
    [project]
  );

  // Active file content
  const activeFile = useMemo(
    () => project?.files.find((f) => f.path === activeFilePath) || null,
    [project, activeFilePath]
  );

  // Handle file selection from explorer
  const handleSelectFile = useCallback((node: FileNode) => {
    if (node.type === 'directory') return;

    if (!openFiles.includes(node.path)) {
      setOpenFiles((prev) => [...prev, node.path]);
    }
    setActiveFilePath(node.path);
  }, [openFiles]);

  // Handle tab close
  const handleCloseTab = useCallback((e: React.MouseEvent, filePath: string) => {
    e.stopPropagation();
    setOpenFiles((prev) => {
      const updated = prev.filter((p) => p !== filePath);
      if (activeFilePath === filePath) {
        setActiveFilePath(updated.length > 0 ? updated[updated.length - 1] : null);
      }
      return updated;
    });
    setModifiedFiles((prev) => {
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
  }, [activeFilePath]);

  // Handle file save
  const handleSave = useCallback((content: string) => {
    if (!id || !activeFilePath) return;
    updateFile(id, activeFilePath, {
      content,
      size: content.length,
      updatedAt: Date.now(),
    });
    setModifiedFiles((prev) => {
      const next = new Set(prev);
      next.delete(activeFilePath);
      return next;
    });
  }, [id, activeFilePath, updateFile]);

  // Handle file change (mark as modified)
  const handleChange = useCallback((content: string) => {
    if (activeFilePath) {
      setModifiedFiles((prev) => new Set(prev).add(activeFilePath));
    }
  }, [activeFilePath]);

  // Handle new file creation
  const handleCreateFile = useCallback((path: string, content: string) => {
    if (!id) return;
    const ext = path.split('.').pop() || '';
    addFile(id, {
      path,
      content,
      language: ext,
      size: content.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setOpenFiles((prev) => [...prev, path]);
    setActiveFilePath(path);
  }, [id, addFile]);

  // Apply code from chat
  const handleApplyCode = useCallback((code: string, filePath: string) => {
    if (!id) return;
    // A-mode (public): ne pas écrire sur disque sans preview/apply.
    useChangeStore.getState().queue(
      id,
      `Chat: appliquer code → ${filePath}`,
      [{ type: 'edit', path: filePath, content: code }]
    );
  }, [id, updateFile]);

  // Redirect if project not found
  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <p className="text-text-muted mb-4">Projet introuvable</p>
        <button
          onClick={() => navigate('/projects')}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium gradient-bg text-white hover:opacity-90 transition-all"
        >
          <ArrowLeft size={14} />
          Retour aux projets
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary overflow-hidden">
      {/* Workspace header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-bg-secondary/30 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/projects')}
            className="p-1.5 rounded-lg text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
            title="Retour aux projets"
          >
            <ArrowLeft size={16} />
          </button>

          <div className="flex items-center gap-2">
            <FolderOpen size={14} className="text-accent-secondary" />
            <h2 className="text-sm font-semibold text-text-primary truncate max-w-[200px]">
              {project.name}
            </h2>
          </div>

          {/* Status badge */}
          <span className={cn(
            'px-2 py-0.5 rounded-lg text-[10px] font-semibold',
            project.status === 'complete' ? 'bg-accent-success/15 text-accent-success' :
            project.status === 'generating' ? 'bg-accent-info/15 text-accent-info' :
            project.status === 'error' ? 'bg-accent-error/15 text-accent-error' :
            project.status === 'testing' ? 'bg-accent-secondary/15 text-accent-secondary' :
            'bg-accent-warning/15 text-accent-warning'
          )}>
            {project.status === 'complete' ? 'Terminé' :
             project.status === 'generating' ? 'Génération' :
             project.status === 'error' ? 'Erreur' :
             project.status === 'testing' ? 'Tests' : 'Planification'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowNewFile(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors"
            title="Nouveau fichier"
          >
            <Plus size={14} />
            Fichier
          </button>

          <div className="w-px h-5 bg-border-subtle mx-1" />

          {/* Run / Install / Diagnose — only for imported projects with path */}
          {projectPath && (
            <>
              <button
                onClick={handleRunProject}
                disabled={isRunning}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  isRunning
                    ? 'bg-accent-success/10 text-accent-success'
                    : 'text-accent-success hover:bg-accent-success/10'
                )}
                title="Lancer le projet"
              >
                {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                Run
              </button>

              <button
                onClick={handleInstallDeps}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-accent-primary hover:bg-accent-primary/10 transition-colors"
                title="Installer les dépendances"
              >
                <Package size={13} />
                Install
              </button>

              <button
                onClick={handleDiagnose}
                disabled={isAnalyzing}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  diagnosticReport && diagnosticReport.errors.length > 0
                    ? 'text-accent-error bg-accent-error/10'
                    : isAnalyzing
                    ? 'text-accent-warning bg-accent-warning/10'
                    : 'text-accent-warning hover:bg-accent-warning/10'
                )}
                title="Diagnostiquer les erreurs"
              >
                {isAnalyzing ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />}
                Fix
                {diagnosticReport && diagnosticReport.errors.length > 0 && (
                  <span className="ml-0.5 w-4 h-4 rounded-full bg-accent-error text-white text-[9px] flex items-center justify-center font-bold">
                    {diagnosticReport.errors.length}
                  </span>
                )}
              </button>

              <div className="w-px h-5 bg-border-subtle mx-1" />
            </>
          )}

          {/* Terminal toggle (mode dev uniquement) */}
          {developerMode && (
            <button
              onClick={() => setShowTerminal(!showTerminal)}
              className={cn(
                'p-1.5 rounded-lg transition-colors',
                showTerminal ? 'text-accent-primary bg-accent-primary/10' : 'text-text-muted hover:bg-surface-hover'
              )}
              title={showTerminal ? 'Masquer le terminal' : 'Afficher le terminal'}
            >
              <TerminalIcon size={16} />
            </button>
          )}

          <button
            onClick={() => setShowExplorer(!showExplorer)}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              showExplorer ? 'text-accent-primary bg-accent-primary/10' : 'text-text-muted hover:bg-surface-hover'
            )}
            title={showExplorer ? 'Masquer l\'explorateur' : 'Afficher l\'explorateur'}
          >
            {showExplorer ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>

          <button
            onClick={() => setShowChat(!showChat)}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              showChat ? 'text-accent-primary bg-accent-primary/10' : 'text-text-muted hover:bg-surface-hover'
            )}
            title={showChat ? 'Masquer le chat' : 'Afficher le chat'}
          >
            {showChat ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </div>
      </div>

      {/* Agent progress bar (when generating) */}
      {project.status === 'generating' && (
        <div className="px-4 py-2 border-b border-border-subtle bg-accent-info/5">
          <AgentProgress projectId={project.id} />
        </div>
      )}

      {/* Runs panel (timeline + actions) */}
      <RunPanel
        projectId={project.id}
        projectPath={projectPath}
        onOpenTerminal={() => setShowTerminal(true)}
      />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: File Explorer */}
        {showExplorer && (
          <div className="w-64 flex-shrink-0 overflow-hidden">
            <FileExplorer
              files={fileTree}
              onSelectFile={handleSelectFile}
              selectedFilePath={activeFilePath || undefined}
            />
          </div>
        )}

        {/* Center: Editor */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Tabs */}
          {openFiles.length > 0 && (
            <div className="flex items-center bg-bg-secondary/50 border-b border-border-subtle overflow-x-auto flex-shrink-0 scrollbar-thin">
              {openFiles.map((filePath) => {
                const file = project.files.find((f) => f.path === filePath);
                if (!file) return null;
                return (
                  <EditorTab
                    key={filePath}
                    file={file}
                    isActive={filePath === activeFilePath}
                    hasChanges={modifiedFiles.has(filePath)}
                    onClick={() => setActiveFilePath(filePath)}
                    onClose={(e) => handleCloseTab(e, filePath)}
                  />
                );
              })}
            </div>
          )}

          {/* Editor content */}
          <div className="flex-1 overflow-hidden">
            {activeFile ? (
              <CodeEditor
                key={activeFile.path}
                filePath={activeFile.path}
                content={activeFile.content}
                language={activeFile.language}
                onSave={handleSave}
                onChange={handleChange}
              />
            ) : (
              <EmptyEditorState projectName={project.name} />
            )}
          </div>

          {/* Diagnostic report panel (above terminal) */}
          {diagnosticReport && diagnosticReport.errors.length > 0 && (
            <div className="border-t border-border-subtle bg-bg-secondary/50 px-4 py-2 flex-shrink-0 max-h-[120px] overflow-y-auto">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={12} className="text-accent-error" />
                  <span className="text-xs font-semibold text-text-primary">
                    {diagnosticReport.errors.length} erreur(s) détectée(s)
                  </span>
                </div>
                <button
                  onClick={() => setDiagnosticReport(null)}
                  className="text-[10px] text-text-muted hover:text-text-primary transition-colors"
                >
                  Fermer
                </button>
              </div>
              <p className="text-[11px] text-text-secondary mb-2">{diagnosticReport.summary}</p>
              <div className="space-y-1">
                {diagnosticReport.solutions.slice(0, 5).map((sol) => (
                  <div
                    key={sol.id}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-bg-tertiary/50 border border-border-subtle"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-text-primary truncate">{sol.title}</p>
                      <p className="text-[10px] text-text-muted truncate">{sol.description}</p>
                    </div>
                    {sol.autoFixable && (
                      <button
                        onClick={() => handleApplyFix(sol)}
                        className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium gradient-bg text-white hover:opacity-90 transition-opacity"
                      >
                        <Wrench size={10} />
                        Fix
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Terminal panel (mode dev uniquement) */}
          {developerMode && showTerminal && (
            <TerminalPanel
              projectPath={projectPath}
              onClose={() => setShowTerminal(false)}
            />
          )}
        </div>

        {/* Right: Chat IA */}
        {showChat && (
          <div className="w-80 flex-shrink-0 overflow-hidden">
            <ProjectChat
              projectId={project.id}
              projectName={project.name}
              currentFile={activeFilePath || undefined}
              currentFileContent={activeFile?.content}
              onApplyCode={handleApplyCode}
            />
          </div>
        )}
      </div>

      {/* New file modal */}
      {showNewFile && (
        <NewFileModal
          onClose={() => setShowNewFile(false)}
          onCreate={handleCreateFile}
        />
      )}
    </div>
  );
};

export default ProjectWorkspacePage;
