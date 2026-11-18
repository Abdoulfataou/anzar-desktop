/**
 * WorkspacePanel — Panneau workspace du shell ANZAR (style ZCode).
 *
 * Onglets : Explorateur (file tree) · Éditeur · Terminal · Preview.
 * Le dossier est lu depuis le disque réel (fileSystemService), les éditions
 * de l'agent (write_file/edit_file) déclenchent un refresh via refreshKey,
 * et le fichier touché s'ouvre automatiquement dans l'éditeur.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderOpen, FolderTree, FileText, Terminal as TerminalIcon, Eye, RefreshCw, Loader2, Plus, X, ListChecks, GitBranch,
} from 'lucide-react';
import GitPanel, { OPEN_GIT_EVENT } from './GitPanel';
import { cn } from '@/lib/utils';
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { terminalService, onDevServerUrl } from '@/services/terminal';
import { openExternalUrl } from '@/services/infra/externalLinks';
import StudioFileTree from '@/components/vibecoding/StudioFileTree';
import StudioEditor from '@/components/vibecoding/StudioEditor';
import StudioPreview from '@/components/vibecoding/StudioPreview';
import MediaViewer, { isMediaFile } from './MediaViewer';
import type { StudioFile } from '@/types/studio';
import type { FileNode } from '@/types/file-project';
import { OPEN_FILE_EVENT } from '@/services/agent/fileChanges';
import { PlanPanel, OPEN_PLAN_EVENT } from '@/components/chat/PlanView';
import type { Message } from '@/types';

interface WorkspacePanelProps {
  workspacePath: string | null;
  /** Incrémenté à chaque modification de fichier par l'agent → reload */
  refreshKey: number;
  /** Fichier à ouvrir automatiquement (chemin relatif) */
  focusFile?: string | null;
  onOpenFolder: () => void;
  /** Dernier plan proposé dans la tâche (onglet « Plan ») */
  plan?: { messageId: string; plan: NonNullable<Message['plan']> } | null;
  /** Agent au travail : la validation du plan attend la fin */
  busy?: boolean;
  /** Liste des fichiers du projet à chaque relecture (suggestions « @ ») */
  onFileList?: (paths: string[]) => void;
  /** Fichiers modifiés par l'agent à sa dernière réponse (Git → Dernier tour) */
  lastTurnPaths?: string[];
}

/** Onglets ouverts : l'explorateur est fixe, le reste s'ouvre et se ferme à la demande. */
type PanelTab =
  | { id: 'files'; kind: 'files' }
  | { id: 'terminal'; kind: 'terminal' }
  | { id: 'preview'; kind: 'preview' }
  | { id: 'plan'; kind: 'plan' }
  | { id: 'git'; kind: 'git' }
  | { id: string; kind: 'file'; path: string };

const FILES_TAB: PanelTab = { id: 'files', kind: 'files' };

export default function WorkspacePanel({ workspacePath, refreshKey, focusFile, onOpenFolder, plan, busy, onFileList, lastTurnPaths }: WorkspacePanelProps) {
  const [tabs, setTabs] = useState<PanelTab[]>([FILES_TAB]);
  const [activeId, setActiveId] = useState<string>('files');
  const [showAdd, setShowAdd] = useState(false);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  /** Navigation clavier conforme au motif ARIA « tablist ». */
  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    const target = tabs[next];
    setActiveId(target.id);
    tabRefs.current.get(target.id)?.focus();
  };
  const active = tabs.find((t) => t.id === activeId) ?? FILES_TAB;

  const openTab = useCallback((tab: PanelTab) => {
    setTabs((prev) => (prev.some((t) => t.id === tab.id) ? prev : [...prev, tab]));
    setActiveId(tab.id);
    setShowAdd(false);
  }, []);
  const openFile = useCallback((path: string) => openTab({ id: `file:${path}`, kind: 'file', path }), [openTab]);
  const closeTab = useCallback((id: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== id));
    setActiveId((cur) => (cur === id ? 'files' : cur));
  }, []);

  // Changement de dossier → on repart de l'explorateur seul
  useEffect(() => { setTabs([FILES_TAB]); setActiveId('files'); }, [workspacePath]);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<Map<string, StudioFile>>(new Map());
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // ── Terminal ──
  // B3 : la sortie arrive via le bus d'événements du service (runCommand ne
  // renvoie qu'un processId) — on suit le process courant jusqu'à process-end.
  type TermLine = { text: string; kind: 'cmd' | 'out' | 'err' | 'sys' };
  const [termLines, setTermLines] = useState<TermLine[]>([]);
  const [termInput, setTermInput] = useState('');
  const [termBusy, setTermBusy] = useState(false);
  const [termProcId, setTermProcId] = useState<string | null>(null);
  const termProcIdRef = useRef<string | null>(null);
  const termBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = terminalService.onEvent((ev) => {
      // On n'écoute que le process lancé depuis CET onglet terminal
      if (ev.type === 'output' || ev.type === 'process-end' || ev.type === 'process-error') {
        if (ev.processId !== termProcIdRef.current) return;
        if (ev.type === 'output') {
          const kind: TermLine['kind'] =
            ev.data.type === 'stderr' || ev.data.type === 'error' ? 'err'
            : ev.data.type === 'system' || ev.data.type === 'success' ? 'sys'
            : 'out';
          setTermLines((l) => {
            const parts = ev.data.content.split('\n').filter(Boolean).slice(-50);
            return [...l, ...parts.map((text) => ({ text, kind }))].slice(-500);
          });
        } else if (ev.type === 'process-end') {
          setTermLines((l) => [...l, { text: `— processus terminé (code ${ev.exitCode}) —`, kind: 'sys' }]);
          setTermBusy(false);
          setTermProcId(null);
          termProcIdRef.current = null;
        } else if (ev.type === 'process-error') {
          setTermLines((l) => [...l, { text: `✗ ${ev.error}`, kind: 'err' }]);
          setTermBusy(false);
          setTermProcId(null);
          termProcIdRef.current = null;
        }
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => termBottomRef.current?.scrollIntoView({ block: 'end' }));
  }, [termLines]);

  // ── Chargement du dossier ──
  // Seule la LISTE des fichiers est lue (rapide, même sur un gros projet) ;
  // le contenu d'un fichier n'est lu qu'à l'ouverture de son onglet.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const listWorkspace = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const root = workspacePath.replace(/[\\/]+$/, '');
      const tree = await fileSystemService.readDirectoryTree(root, 8);
      const paths: string[] = [];
      const walk = (nodes: FileNode[]) => {
        for (const n of nodes) {
          if (n.type === 'file') paths.push(n.path.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/'));
          else if (n.children) walk(n.children);
        }
      };
      walk(tree);
      onFileList?.(paths);
      setFiles((prev) => {
        const next = new Map<string, StudioFile>();
        for (const p of paths) {
          next.set(p, prev.get(p) ?? {
            path: p, content: '', language: fileSystemService.getLanguage(p), status: 'done', loaded: false,
          });
        }
        return next;
      });
    } catch (e) {
      console.error('Workspace list failed:', e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  /** Lit un fichier ; `trackChange` garde l'ancienne version pour la vue diff. */
  const loadContent = useCallback(async (path: string, trackChange = false) => {
    if (!workspacePath) return;
    if (isMediaFile(path)) {
      // Image ou vidéo : affichée par MediaViewer, jamais lue comme du texte
      setFiles((prev) => {
        const f = prev.get(path);
        if (!f || f.loaded) return prev;
        const next = new Map(prev);
        next.set(path, { ...f, content: '', loaded: true });
        return next;
      });
      return;
    }
    let text: string;
    try {
      text = await fileSystemService.readFile(`${workspacePath.replace(/[\\/]+$/, '')}/${path}`);
    } catch {
      return; // supprimé ou illisible : la liste se mettra à jour
    }
    setFiles((prev) => {
      const f = prev.get(path);
      if (!f) return prev;
      if (f.loaded && f.content === text) return prev;
      const next = new Map(prev);
      next.set(path, {
        ...f,
        content: text,
        loaded: true,
        previousContent: trackChange && f.loaded ? f.content : f.previousContent,
      });
      return next;
    });
  }, [workspacePath]);

  /** Relit la liste puis le contenu des onglets ouverts (après une action de l'agent). */
  const refreshAll = useCallback(async () => {
    await listWorkspace();
    for (const t of tabsRef.current) {
      if (t.kind === 'file') void loadContent(t.path, true);
    }
  }, [listWorkspace, loadContent]);

  // Nouveau dossier : on repart de zéro
  useEffect(() => { setFiles(new Map()); void listWorkspace(); }, [listWorkspace]);

  // L'agent modifie souvent plusieurs fichiers d'affilée : une seule relecture par rafale
  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) { firstRefresh.current = false; return; }
    const t = setTimeout(() => void refreshAll(), 300);
    return () => clearTimeout(t);
  }, [refreshKey, refreshAll]);

  // Onglet de fichier ouvert → son contenu est lu s'il ne l'est pas encore
  useEffect(() => {
    for (const t of tabs) {
      if (t.kind === 'file' && files.has(t.path) && !files.get(t.path)!.loaded) void loadContent(t.path);
    }
  }, [tabs, files, loadContent]);

  // ── Le dev server démarre → preview ──
  useEffect(() => onDevServerUrl((url) => { setPreviewUrl(url); openTab({ id: 'preview', kind: 'preview' }); }), [openTab]);

  // ── Fichier touché par l'agent → ouverture auto ──
  useEffect(() => {
    if (!focusFile || !files.has(focusFile)) return;
    // Ouverture auto limitée à 6 onglets de fichier : une grosse tâche ne doit pas noyer la barre.
    setTabs((prev) => {
      const id = `file:${focusFile}`;
      if (prev.some((t) => t.id === id)) return prev;
      if (prev.filter((t) => t.kind === 'file').length >= 6) return prev;
      return [...prev, { id, kind: 'file', path: focusFile }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusFile, files.has(focusFile || '')]);

  // ── Plan : un nouveau plan ouvre l'onglet ; « Ouvrir » dans la conversation aussi ──
  const planKey = plan ? `${plan.messageId}:${plan.plan.status}` : null;
  useEffect(() => {
    if (plan?.plan.status === 'pending') openTab({ id: 'plan', kind: 'plan' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);
  useEffect(() => {
    const onOpen = () => openTab({ id: 'plan', kind: 'plan' });
    const onOpenGit = () => openTab({ id: 'git', kind: 'git' });
    window.addEventListener(OPEN_GIT_EVENT, onOpenGit);
    window.addEventListener(OPEN_PLAN_EVENT, onOpen);
    return () => {
      window.removeEventListener(OPEN_PLAN_EVENT, onOpen);
      window.removeEventListener(OPEN_GIT_EVENT, onOpenGit);
    };
  }, [openTab]);

  // ── Clic sur un fichier de la carte « fichiers modifiés » → ouverture explicite ──
  useEffect(() => {
    const onOpen = (e: Event) => openFile((e as CustomEvent<string>).detail);
    window.addEventListener(OPEN_FILE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_FILE_EVENT, onOpen);
  }, [openFile]);

  // ── Édition manuelle dans l'éditeur → écriture disque ──
  const handleFileChange = useCallback(async (path: string, content: string) => {
    if (!workspacePath) return;
    setFiles((prev) => {
      const next = new Map(prev);
      const f = next.get(path);
      if (f) next.set(path, { ...f, content, status: 'modified' });
      return next;
    });
    try {
      await fileSystemService.writeFile(`${workspacePath}/${path}`, content);
    } catch (e) {
      console.error('Write failed:', e);
    }
  }, [workspacePath]);

  // ── Terminal ──
  const runTerminalCommand = useCallback(async () => {
    const cmd = termInput.trim();
    if (!cmd || !workspacePath || termBusy) return;
    setTermInput('');
    setTermLines((l) => [...l, { text: `$ ${cmd}`, kind: 'cmd' as const }]);
    setTermBusy(true);
    // runCommand résout dès le spawn (il renvoie le processId) : le busy
    // s'arrête sur process-end/process-error du bus, pas sur ce await.
    const procId = await terminalService.runCommand(cmd, { cwd: workspacePath });
    termProcIdRef.current = procId;
    setTermProcId(procId);
  }, [termInput, workspacePath, termBusy]);

  const killTerminalCommand = useCallback(async () => {
    const procId = termProcIdRef.current;
    if (!procId) return;
    await terminalService.killProcess(procId).catch(() => {});
    setTermLines((l) => [...l, { text: '— processus arrêté —', kind: 'sys' as const }]);
    setTermBusy(false);
    setTermProcId(null);
    termProcIdRef.current = null;
  }, []);

  const filesList = useMemo(() => Array.from(files.values()).sort((a, b) => a.path.localeCompare(b.path)), [files]);

  // ── Aucun workspace : état vide ──
  if (!workspacePath) {
    return (
      <div className="h-full flex items-center justify-center rounded-xl border border-border-medium bg-bg-primary">
        <div className="text-center max-w-xs">
          <FolderOpen size={32} className="mx-auto mb-3 text-text-muted/40" />
          <p className="text-sm text-text-secondary mb-1">Aucun dossier ouvert</p>
          <p className="text-xs text-text-muted mb-4">
            Ouvre un dossier pour que l'agent puisse lire, modifier et exécuter ton code.
          </p>
          <button
            onClick={onOpenFolder}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-ui-base font-medium bg-primary-btn text-primary-btn-fg transition-all hover:opacity-90 active:scale-[0.98]"
          >
            <FolderOpen size={14} />
            Ouvrir un dossier
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden rounded-xl border border-border-medium bg-bg-primary">
      {/* ── Barre d'onglets ── */}
      <div className="flex items-center h-12 px-2 gap-1 border-b border-border-subtle flex-shrink-0">
        <div role="tablist" aria-label="Panneaux du workspace" className="flex items-center gap-1 min-w-0 overflow-x-auto">
          {tabs.map((t, index) => {
            const label =
              t.kind === 'files' ? 'Fichiers' : t.kind === 'terminal' ? 'Terminal' : t.kind === 'preview' ? 'Aperçu' : t.kind === 'plan' ? 'Plan' : t.kind === 'git' ? 'Git' : t.path.split('/').pop();
            const Icon = t.kind === 'files' ? FolderTree : t.kind === 'terminal' ? TerminalIcon : t.kind === 'preview' ? Eye : t.kind === 'plan' ? ListChecks : t.kind === 'git' ? GitBranch : FileText;
            const isActive = t.id === active.id;
            return (
              <div
                key={t.id}
                className={cn(
                  'group flex items-center h-8 rounded-lg text-ui-caption flex-shrink-0 max-w-[180px] transition-colors',
                  t.kind === 'files' ? 'pr-2.5' : 'pr-1',
                  isActive
                    ? 'bg-bg-tertiary text-text-primary border border-border-medium'
                    : 'text-text-muted hover:text-text-secondary border border-transparent'
                )}
              >
                <button
                  ref={(el) => { if (el) tabRefs.current.set(t.id, el); else tabRefs.current.delete(t.id); }}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveId(t.id)}
                  onKeyDown={(e) => onTabKeyDown(e, index)}
                  title={t.kind === 'file' ? t.path : undefined}
                  className="flex items-center gap-1.5 h-full pl-2.5 min-w-0"
                >
                  <Icon size={13} className="flex-shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
                {t.kind !== 'files' && (
                  <button
                    type="button"
                    onClick={() => closeTab(t.id)}
                    aria-label={`Fermer l'onglet ${label}`}
                    className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover flex-shrink-0"
                    title="Fermer"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* + : ouvrir un terminal ou l'aperçu */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowAdd((v) => !v)}
            aria-label="Ouvrir un onglet"
            aria-haspopup="menu"
            aria-expanded={showAdd}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            title="Ouvrir un onglet"
          >
            <Plus size={14} />
          </button>
          {showAdd && (
            <div role="menu" aria-label="Ouvrir un onglet" className="absolute top-full left-0 mt-1 w-44 p-1 rounded-xl border border-border-medium bg-surface-elevated shadow-lg z-50">
              <button
                onClick={() => openTab({ id: 'terminal', kind: 'terminal' })}
                role="menuitem"
                className="w-full flex items-center gap-2 h-8 px-2 rounded-lg text-ui-base text-text-primary hover:bg-surface-hover"
              >
                <TerminalIcon size={13} /> Terminal
              </button>
              <button
                onClick={() => openTab({ id: 'preview', kind: 'preview' })}
                role="menuitem"
                className="w-full flex items-center gap-2 h-8 px-2 rounded-lg text-ui-base text-text-primary hover:bg-surface-hover"
              >
                <Eye size={13} /> Aperçu
              </button>
              <button
                onClick={() => openTab({ id: 'plan', kind: 'plan' })}
                role="menuitem"
                className="w-full flex items-center gap-2 h-8 px-2 rounded-lg text-ui-base text-text-primary hover:bg-surface-hover"
              >
                <ListChecks size={13} /> Plan
              </button>
              <button
                onClick={() => openTab({ id: 'git', kind: 'git' })}
                role="menuitem"
                className="w-full flex items-center gap-2 h-8 px-2 rounded-lg text-ui-base text-text-primary hover:bg-surface-hover"
              >
                <GitBranch size={13} /> Git
              </button>
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1 flex-shrink-0">
          {loading && <Loader2 size={12} className="animate-spin text-text-muted" />}
          <button
            onClick={() => void refreshAll()}
            aria-label="Rafraîchir le dossier"
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            title="Rafraîchir le dossier"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* ── Contenu ── */}
      <div role="tabpanel" aria-label="Contenu du panneau actif" className="flex-1 min-h-0 flex">
        {/* Explorateur (pleine largeur) : un clic ouvre le fichier dans son onglet */}
        {active.kind === 'files' && (
          <div className="flex-1 min-w-0 overflow-hidden">
            <StudioFileTree files={filesList} selectedFile={null} onSelectFile={openFile} />
          </div>
        )}

        {/* Fichier ouvert */}
        {active.kind === 'file' && (
          <div className="flex-1 min-w-0 overflow-hidden">
            {files.has(active.path) && !files.get(active.path)!.loaded ? (
              <div className="flex items-center justify-center h-full text-text-muted text-ui-caption">
                <Loader2 size={14} className="animate-spin mr-2" /> Lecture du fichier…
              </div>
            ) : files.has(active.path) && isMediaFile(active.path) ? (
              <MediaViewer
                absPath={`${workspacePath.replace(/[\\/]+$/, '')}/${active.path}`}
                name={active.path.split('/').pop() || active.path}
                version={refreshKey}
              />
            ) : files.has(active.path) ? (
              <StudioEditor
                files={filesList}
                selectedFile={active.path}
                onSelectFile={openFile}
                onFileChange={(p, c) => { void handleFileChange(p, c); }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-text-muted text-ui-caption">
                Ce fichier n'existe plus sur le disque.
              </div>
            )}
          </div>
        )}

        {/* Terminal */}
        {active.kind === 'terminal' && (
          <div className="flex-1 flex flex-col min-h-0 font-mono text-ui-sm">
            <div className="flex-1 overflow-y-auto px-3 py-2 leading-relaxed">
              {termLines.length === 0 && (
                <p className="text-text-muted/60">Terminal — les commandes s'exécutent dans {workspacePath.split('/').pop()} (allowlist : node, npm, git, python…).</p>
              )}
              {termLines.map((l, i) => (
                <pre key={i} className={cn(
                  'whitespace-pre-wrap break-all',
                  l.kind === 'cmd' ? 'text-accent-primary' : l.kind === 'err' ? 'text-accent-error' : l.kind === 'sys' ? 'text-text-muted' : 'text-text-secondary'
                )}>
                  {l.text}
                </pre>
              ))}
              <div ref={termBottomRef} />
            </div>
            <div className="flex items-center gap-2 px-3 py-2 border-t border-border-subtle">
              <span className="text-accent-primary select-none">$</span>
              <input
                value={termInput}
                onChange={(e) => setTermInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void runTerminalCommand(); }}
                aria-label="Commande du terminal"
                placeholder={termBusy ? 'commande en cours…' : 'npm install…'}
                disabled={termBusy}
                className="flex-1 bg-transparent text-text-primary placeholder-text-muted/50 focus:outline-none disabled:opacity-50"
              />
              {termBusy && (
                <>
                  <Loader2 size={12} className="animate-spin text-text-muted" />
                  <button
                    onClick={() => void killTerminalCommand()}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-accent-error hover:bg-accent-error/10 transition-colors"
                    title="Arrêter le processus"
                  >
                    Stop
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Preview */}
        {active.kind === 'plan' && (
          <div className="flex-1 min-w-0 min-h-0">
            {plan ? (
              <PlanPanel messageId={plan.messageId} plan={plan.plan} disabled={busy} />
            ) : (
              <div className="flex items-center justify-center h-full text-text-muted text-ui-caption px-6 text-center">
                Aucun plan pour cette tâche. Choisis « Mode plan » dans la saisie : l'agent explore sans rien modifier et propose un plan ici.
              </div>
            )}
          </div>
        )}

        {active.kind === 'git' && <GitPanel workspacePath={workspacePath} refreshKey={refreshKey} lastTurnPaths={lastTurnPaths} onOpenFile={openFile} />}

        {active.kind === 'preview' && (
          <div className="flex-1 min-h-0">
            <StudioPreview previewUrl={previewUrl} onOpenExternal={() => { void openExternalUrl(previewUrl || '').catch(() => {}); }} />
          </div>
        )}
      </div>
    </div>
  );
}
