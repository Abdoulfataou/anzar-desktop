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
  FolderOpen, FolderTree, FileText, Terminal as TerminalIcon, Eye, RefreshCw, Loader2, Plus, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { terminalService, onDevServerUrl } from '@/services/terminal';
import StudioFileTree from '@/components/vibecoding/StudioFileTree';
import StudioEditor from '@/components/vibecoding/StudioEditor';
import StudioPreview from '@/components/vibecoding/StudioPreview';
import type { StudioFile } from '@/types/studio';
import { OPEN_FILE_EVENT } from '@/services/agent/fileChanges';

interface WorkspacePanelProps {
  workspacePath: string | null;
  /** Incrémenté à chaque modification de fichier par l'agent → reload */
  refreshKey: number;
  /** Fichier à ouvrir automatiquement (chemin relatif) */
  focusFile?: string | null;
  onOpenFolder: () => void;
}

/** Onglets ouverts : l'explorateur est fixe, le reste s'ouvre et se ferme à la demande. */
type PanelTab =
  | { id: 'files'; kind: 'files' }
  | { id: 'terminal'; kind: 'terminal' }
  | { id: 'preview'; kind: 'preview' }
  | { id: string; kind: 'file'; path: string };

const FILES_TAB: PanelTab = { id: 'files', kind: 'files' };

export default function WorkspacePanel({ workspacePath, refreshKey, focusFile, onOpenFolder }: WorkspacePanelProps) {
  const [tabs, setTabs] = useState<PanelTab[]>([FILES_TAB]);
  const [activeId, setActiveId] = useState<string>('files');
  const [showAdd, setShowAdd] = useState(false);
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
  const [termLines, setTermLines] = useState<string[]>([]);
  const [termInput, setTermInput] = useState('');
  const [termBusy, setTermBusy] = useState(false);
  const termBottomRef = useRef<HTMLDivElement>(null);

  // ── Chargement du dossier ──
  const loadWorkspace = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const projectFiles = await fileSystemService.readProjectFiles(workspacePath, 8);
      const map = new Map<string, StudioFile>();
      for (const f of projectFiles) {
        map.set(f.path, { path: f.path, content: f.content, language: f.language, status: 'done' });
      }
      setFiles(map);
    } catch (e) {
      console.error('Workspace load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace, refreshKey]);

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
    setTermLines((l) => [...l, `$ ${cmd}`]);
    setTermBusy(true);
    try {
      const out = await terminalService.runCommand(cmd, { cwd: workspacePath });
      setTermLines((l) => [...l, ...(out || '(pas de sortie)').split('\n').slice(-200)].slice(-400));
    } catch (e: any) {
      setTermLines((l) => [...l, `✗ ${e?.message || 'commande refusée (allowlist)'}`]);
    } finally {
      setTermBusy(false);
      requestAnimationFrame(() => termBottomRef.current?.scrollIntoView({ block: 'end' }));
    }
  }, [termInput, workspacePath, termBusy]);

  const filesList = useMemo(() => Array.from(files.values()).sort((a, b) => a.path.localeCompare(b.path)), [files]);

  // ── Aucun workspace : état vide ──
  if (!workspacePath) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-primary">
        <div className="text-center max-w-xs">
          <FolderOpen size={32} className="mx-auto mb-3 text-text-muted/40" />
          <p className="text-sm text-text-secondary mb-1">Aucun dossier ouvert</p>
          <p className="text-xs text-text-muted mb-4">
            Ouvre un dossier pour que l'agent puisse lire, modifier et exécuter ton code.
          </p>
          <button
            onClick={onOpenFolder}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-primary-btn text-primary-btn-fg transition-all hover:opacity-90 active:scale-[0.98]"
          >
            <FolderOpen size={14} />
            Ouvrir un dossier
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-primary">
      {/* ── Barre d'onglets ── */}
      <div className="flex items-center h-11 px-2 gap-1 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
          {tabs.map((t) => {
            const label =
              t.kind === 'files' ? 'Fichiers' : t.kind === 'terminal' ? 'Terminal' : t.kind === 'preview' ? 'Aperçu' : t.path.split('/').pop();
            const Icon = t.kind === 'files' ? FolderTree : t.kind === 'terminal' ? TerminalIcon : t.kind === 'preview' ? Eye : FileText;
            const isActive = t.id === active.id;
            return (
              <div
                key={t.id}
                onClick={() => setActiveId(t.id)}
                title={t.kind === 'file' ? t.path : undefined}
                className={cn(
                  'group flex items-center gap-1.5 h-8 pl-2.5 rounded-lg text-[12.5px] cursor-pointer flex-shrink-0 max-w-[180px] transition-colors',
                  t.kind === 'files' ? 'pr-2.5' : 'pr-1',
                  isActive
                    ? 'bg-bg-tertiary text-text-primary border border-border-medium'
                    : 'text-text-muted hover:text-text-secondary border border-transparent'
                )}
              >
                <Icon size={13} className="flex-shrink-0" />
                <span className="truncate">{label}</span>
                {t.kind !== 'files' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
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
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            title="Ouvrir un onglet"
          >
            <Plus size={14} />
          </button>
          {showAdd && (
            <div className="absolute top-full left-0 mt-1 w-44 p-1 rounded-xl border border-border-medium bg-surface-elevated shadow-lg z-50">
              <button
                onClick={() => openTab({ id: 'terminal', kind: 'terminal' })}
                className="w-full flex items-center gap-2 h-8 px-2 rounded-lg text-[13px] text-text-primary hover:bg-surface-hover"
              >
                <TerminalIcon size={13} /> Terminal
              </button>
              <button
                onClick={() => openTab({ id: 'preview', kind: 'preview' })}
                className="w-full flex items-center gap-2 h-8 px-2 rounded-lg text-[13px] text-text-primary hover:bg-surface-hover"
              >
                <Eye size={13} /> Aperçu
              </button>
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1 flex-shrink-0">
          {loading && <Loader2 size={12} className="animate-spin text-text-muted" />}
          <button
            onClick={() => void loadWorkspace()}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            title="Rafraîchir le dossier"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* ── Contenu ── */}
      <div className="flex-1 min-h-0 flex">
        {/* Explorateur (pleine largeur) : un clic ouvre le fichier dans son onglet */}
        {active.kind === 'files' && (
          <div className="flex-1 min-w-0 overflow-hidden">
            <StudioFileTree files={filesList} selectedFile={null} onSelectFile={openFile} />
          </div>
        )}

        {/* Fichier ouvert */}
        {active.kind === 'file' && (
          <div className="flex-1 min-w-0 overflow-hidden">
            {files.has(active.path) ? (
              <StudioEditor
                files={filesList}
                selectedFile={active.path}
                onSelectFile={openFile}
                onFileChange={(p, c) => { void handleFileChange(p, c); }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-text-muted text-[12.5px]">
                Ce fichier n'existe plus sur le disque.
              </div>
            )}
          </div>
        )}

        {/* Terminal */}
        {active.kind === 'terminal' && (
          <div className="flex-1 flex flex-col min-h-0 font-mono text-[11.5px]">
            <div className="flex-1 overflow-y-auto px-3 py-2 leading-relaxed">
              {termLines.length === 0 && (
                <p className="text-text-muted/60">Terminal — les commandes s'exécutent dans {workspacePath.split('/').pop()} (allowlist : node, npm, git, python…).</p>
              )}
              {termLines.map((l, i) => (
                <pre key={i} className={cn('whitespace-pre-wrap break-all', l.startsWith('$') ? 'text-accent-primary' : l.startsWith('✗') ? 'text-accent-error' : 'text-text-secondary')}>
                  {l}
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
                placeholder="npm install…"
                disabled={termBusy}
                className="flex-1 bg-transparent text-text-primary placeholder-text-muted/50 focus:outline-none disabled:opacity-50"
              />
              {termBusy && <Loader2 size={12} className="animate-spin text-text-muted" />}
            </div>
          </div>
        )}

        {/* Preview */}
        {active.kind === 'preview' && (
          <div className="flex-1 min-h-0">
            <StudioPreview previewUrl={previewUrl} onOpenExternal={() => window.open(previewUrl || '', '_blank')} />
          </div>
        )}
      </div>
    </div>
  );
}
