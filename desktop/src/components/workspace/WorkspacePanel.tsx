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
  FolderOpen, FileCode, Terminal as TerminalIcon, Eye, RefreshCw, Loader2, Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { terminalService, onDevServerUrl } from '@/services/terminal';
import StudioFileTree from '@/components/vibecoding/StudioFileTree';
import StudioEditor from '@/components/vibecoding/StudioEditor';
import StudioPreview from '@/components/vibecoding/StudioPreview';
import type { StudioFile } from '@/types/studio';

interface WorkspacePanelProps {
  workspacePath: string | null;
  /** Incrémenté à chaque modification de fichier par l'agent → reload */
  refreshKey: number;
  /** Fichier à ouvrir automatiquement (chemin relatif) */
  focusFile?: string | null;
  onOpenFolder: () => void;
}

type Tab = 'files' | 'terminal' | 'preview';

export default function WorkspacePanel({ workspacePath, refreshKey, focusFile, onOpenFolder }: WorkspacePanelProps) {
  const [tab, setTab] = useState<Tab>('files');
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<Map<string, StudioFile>>(new Map());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
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
  useEffect(() => onDevServerUrl((url) => { setPreviewUrl(url); setTab('preview'); }), []);

  // ── Fichier touché par l'agent → ouverture auto ──
  useEffect(() => {
    if (focusFile && files.has(focusFile)) {
      setSelectedFile(focusFile);
      setTab('files');
    }
  }, [focusFile, files]);

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
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium gradient-bg transition-all hover:opacity-90 active:scale-[0.98]"
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
      <div className="flex items-center px-2 pt-1.5 gap-0.5 border-b border-border-subtle bg-bg-secondary/30 flex-shrink-0">
        {([
          ['files', 'Explorateur', <FileCode size={12} key="i" />],
          ['terminal', 'Terminal', <TerminalIcon size={12} key="i" />],
          ['preview', 'Preview', <Eye size={12} key="i" />],
        ] as const).map(([id, label, icon]) => (
          <button
            key={id}
            onClick={() => setTab(id as Tab)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-[11px] font-semibold transition-all',
              tab === id
                ? 'bg-surface-default text-text-primary border border-b-0 border-border-subtle'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            {icon}
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 pr-1 pb-1">
          {loading && <Loader2 size={12} className="animate-spin text-text-muted" />}
          <button
            onClick={() => void loadWorkspace()}
            className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            title="Rafraîchir le dossier"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* ── Contenu ── */}
      <div className="flex-1 min-h-0 flex">
        {/* Explorateur + éditeur côte à côte */}
        {tab === 'files' && (
          <>
            <div className="w-[220px] flex-shrink-0 border-r border-border-subtle overflow-hidden">
              <StudioFileTree
                files={filesList}
                selectedFile={selectedFile}
                onSelectFile={setSelectedFile}
              />
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              {selectedFile && files.has(selectedFile) ? (
                <StudioEditor
                  files={filesList}
                  selectedFile={selectedFile}
                  onSelectFile={setSelectedFile}
                  onFileChange={(p, c) => { void handleFileChange(p, c); }}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-text-muted text-xs">
                  Sélectionne un fichier dans l'explorateur
                </div>
              )}
            </div>
          </>
        )}

        {/* Terminal */}
        {tab === 'terminal' && (
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
        {tab === 'preview' && (
          <div className="flex-1 min-h-0">
            <StudioPreview previewUrl={previewUrl} onOpenExternal={() => window.open(previewUrl || '', '_blank')} />
          </div>
        )}
      </div>
    </div>
  );
}
