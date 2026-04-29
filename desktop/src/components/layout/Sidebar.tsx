/**
 * Sidebar ANZAR - Panneau unifié
 * Branding + Nouvelle tâche + Projets + Historique + Profil
 * Inspiré de TRAE SOLO / Claude Cowork (mais original)
 */
import { useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Plus, FolderOpen, FolderKanban, Hash, Settings,
  PanelLeftClose, PanelLeft, Sun, Moon, Trash2,
  MessageSquare, ChevronDown, ChevronRight,
  User, Download, Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import AnzarLogo from '@/components/ui/AnzarLogo';
import { useThemeStore } from '@/stores/themeStore';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAccountStore } from '@/stores/accountStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { isAllowedProjectRoot, showPathNotAllowedMessage } from '@/lib/allowedProjectRoots';

interface SidebarProps {
  className?: string;
  onNewTask?: () => void;
  onSelectProject?: (projectId: string | null) => void;
  selectedProjectId?: string | null;
}

export default function Sidebar({
  className,
  onNewTask,
  onSelectProject,
  selectedProjectId,
}: SidebarProps) {
  const [expanded, setExpanded] = useState(true);
  const [showProjects, setShowProjects] = useState(true);
  const [showHistory, setShowHistory] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useThemeStore();
  const isDark = theme === 'dark';

  const conversations = useChatStore((s) => s.conversations);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const createConversation = useChatStore((s) => s.createConversation);
  const projects = useProjectStore((s) => s.projects);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const user = useAccountStore((s) => s.user);
  const credits = useAccountStore((s) => s.credits);
  const model = useSettingsStore((s) => s.settings.model);

  // Open folder via Tauri dialog
  const handleOpenFolder = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Ajouter un projet',
      });

      if (selected && typeof selected === 'string') {
        const allowed = await isAllowedProjectRoot(selected);
        if (!allowed) {
          await showPathNotAllowedMessage();
          return;
        }

        const folderName = selected.split(/[/\\]/).pop() || 'Projet importé';
        const { createProject, updateProject } = useProjectStore.getState();
        const project = createProject(folderName, `Projet: ${selected}`, 'fast');
        updateProject(project.id, {
          status: 'complete',
          metadata: { localPath: selected, imported: true },
        });
      }
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  }, []);

  const handleNewTask = () => {
    // Nouveau chat = nouvelle conversation (source de vérité pour ChatView)
    setActiveProject(null);
    onSelectProject?.(null);
    createConversation(undefined, model);
    onNewTask?.();
    if (location.pathname !== '/') navigate('/');
  };

  const handleSelectConversation = (convId: string) => {
    setActiveConversation(convId);
    if (location.pathname !== '/') navigate('/');
  };

  const handleSelectProject = (projectId: string) => {
    const proj = projects.find((p) => p.id === projectId);
    if (proj?.status === 'error') {
      if (window.confirm('Ce projet a echoue. Veux-tu le supprimer ?')) {
        deleteProject(projectId);
        if (location.pathname === `/projects/${projectId}`) navigate('/');
      }
      return;
    }
    navigate(`/projects/${projectId}`);
  };

  // Export conversations as JSON via Tauri save dialog
  const handleExportConversations = useCallback(async () => {
    try {
      const allConversations = useChatStore.getState().exportConversations();
      if (allConversations.length === 0) return;

      const payload = JSON.stringify(
        { version: 1, exportedAt: new Date().toISOString(), conversations: allConversations },
        null,
        2
      );

      const { save } = await import('@tauri-apps/api/dialog');
      const { writeTextFile } = await import('@tauri-apps/api/fs');
      const filePath = await save({
        title: 'Exporter les conversations',
        defaultPath: `anzar-conversations-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (filePath) {
        await writeTextFile(filePath, payload);
      }
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, []);

  // Import conversations from JSON file
  const handleImportConversations = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const { readTextFile } = await import('@tauri-apps/api/fs');
      const filePath = await open({
        title: 'Importer des conversations',
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (filePath && typeof filePath === 'string') {
        const raw = await readTextFile(filePath);
        const data = JSON.parse(raw);
        const convs = Array.isArray(data) ? data : data?.conversations;
        if (Array.isArray(convs) && convs.length > 0) {
          useChatStore.getState().importConversations(convs);
        }
      }
    } catch (err) {
      console.error('Import failed:', err);
    }
  }, []);

  // Sorted data
  const recentConversations = [...conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 15);

  const sortedProjects = [...projects]
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <aside
      className={cn(
        'h-full flex flex-col border-r border-border-subtle bg-bg-secondary/50',
        'transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden',
        className
      )}
      style={{ width: expanded ? 260 : 56 }}
    >
      {/* ===== Branding ===== */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle/50">
        <div className="flex-shrink-0 shadow-md rounded-lg overflow-hidden">
          <AnzarLogo size={32} />
        </div>
        {expanded && (
          <div className="flex-1 min-w-0">
            <span className="text-sm font-bold text-text-primary tracking-wide">ANZAR</span>
            <span className="ml-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-accent-primary/15 text-accent-primary uppercase">
              Beta
            </span>
          </div>
        )}
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 rounded-lg text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors flex-shrink-0"
        >
          {expanded ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
        </button>
      </div>

      {/* ===== New Task Button ===== */}
      <div className="p-2.5">
        <button
          onClick={handleNewTask}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl',
            'bg-surface-default border border-border-subtle',
            'hover:bg-surface-hover hover:border-border-medium',
            'text-sm font-medium text-text-primary transition-all duration-200',
            'active:scale-[0.98]'
          )}
        >
          <Plus size={16} className="flex-shrink-0 text-text-muted" />
          {expanded && <span>Nouvelle tâche</span>}
          {expanded && (
            <span className="ml-auto kbd text-[10px]">⌘N</span>
          )}
        </button>
      </div>

      {/* ===== Projects Section ===== */}
      {expanded && (
        <div className="px-2.5">
          <button
            onClick={() => setShowProjects(!showProjects)}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider hover:text-text-secondary transition-colors"
          >
            {showProjects ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <FolderKanban size={12} />
            <span>Projets</span>
            <span className="ml-auto text-[10px] font-normal text-text-muted/70">{sortedProjects.length}</span>
          </button>

          {showProjects && (
            <div className="mt-1 space-y-0.5">
              {sortedProjects.length === 0 ? (
                <div className="px-3 py-4 text-center">
                  <div className="w-10 h-10 mx-auto mb-2 rounded-xl bg-accent-secondary/10 flex items-center justify-center">
                    <FolderOpen size={18} className="text-accent-secondary" />
                  </div>
                  <p className="text-[11px] font-medium text-text-secondary mb-0.5">Aucun projet</p>
                  <p className="text-[10px] text-text-muted/70 mb-2">Cree un projet via le chat ou importe un dossier</p>
                  <button
                    onClick={handleOpenFolder}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-accent-secondary/10 text-accent-secondary hover:bg-accent-secondary/20 transition-colors"
                  >
                    <Plus size={10} />
                    Importer un dossier
                  </button>
                </div>
              ) : (
                sortedProjects.map((project) => (
                  <div key={project.id} className="group flex items-center">
                    <button
                      onClick={() => handleSelectProject(project.id)}
                      className={cn(
                        'flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg min-w-0',
                        'text-xs transition-colors duration-150 text-left',
                        location.pathname === `/projects/${project.id}`
                          ? 'bg-accent-primary/10 text-accent-primary'
                          : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
                      )}
                    >
                      <FolderOpen size={13} className="flex-shrink-0 text-accent-secondary" />
                      <span className="truncate flex-1">{project.name}</span>
                      <span className={cn(
                        'w-1.5 h-1.5 rounded-full flex-shrink-0',
                        project.status === 'complete' ? 'bg-accent-success' :
                        project.status === 'generating' ? 'bg-accent-info animate-pulse' :
                        project.status === 'error' ? 'bg-accent-error' :
                        'bg-accent-warning'
                      )} />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm('Supprimer ce projet ?')) {
                          deleteProject(project.id);
                          if (location.pathname === `/projects/${project.id}`) navigate('/');
                        }
                      }}
                      className="p-1 rounded text-text-muted/30 hover:text-accent-error hover:bg-accent-error/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 mr-1"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))
              )}

              {/* Add project button */}
              <button
                onClick={handleOpenFolder}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                <Plus size={13} className="flex-shrink-0" />
                <span>Ajouter un dossier</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===== Divider ===== */}
      {expanded && <div className="mx-4 my-2 h-px bg-border-subtle" />}

      {/* ===== Conversation History ===== */}
      {expanded && (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <div className="flex items-center flex-shrink-0">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex-1 flex items-center gap-2 px-4.5 py-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider hover:text-text-secondary transition-colors"
            >
              {showHistory ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <MessageSquare size={12} />
              <span>Historique</span>
            </button>
            {conversations.length > 0 && (
              <div className="flex items-center gap-0.5 pr-2.5">
                <button
                  onClick={handleExportConversations}
                  title="Exporter les conversations"
                  className="p-1 rounded text-text-muted/50 hover:text-accent-primary hover:bg-accent-primary/10 transition-colors"
                >
                  <Download size={11} />
                </button>
                <button
                  onClick={handleImportConversations}
                  title="Importer des conversations"
                  className="p-1 rounded text-text-muted/50 hover:text-accent-primary hover:bg-accent-primary/10 transition-colors"
                >
                  <Upload size={11} />
                </button>
              </div>
            )}
          </div>

          {showHistory && (
            <div className="flex-1 overflow-y-auto px-2.5 pb-2 fade-mask-b">
              {recentConversations.length === 0 ? (
                <div className="px-3 py-4 text-center">
                  <div className="w-10 h-10 mx-auto mb-2 rounded-xl bg-accent-primary/10 flex items-center justify-center">
                    <MessageSquare size={18} className="text-accent-primary" />
                  </div>
                  <p className="text-[11px] font-medium text-text-secondary mb-0.5">Aucune conversation</p>
                  <p className="text-[10px] text-text-muted/70">Tes echanges avec ANZAR apparaitront ici</p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {recentConversations.map((conv) => (
                    <div
                      key={conv.id}
                      className="group flex items-center"
                    >
                      <button
                        onClick={() => handleSelectConversation(conv.id)}
                        className={cn(
                          'flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg',
                          'text-xs text-text-secondary hover:text-text-primary',
                          'hover:bg-surface-hover transition-colors duration-150 text-left min-w-0'
                        )}
                      >
                        <Hash size={12} className="flex-shrink-0 text-text-muted/50" />
                        <span className="truncate">{conv.title || 'Sans titre'}</span>
                      </button>
                      <button
                        onClick={() => deleteConversation(conv.id)}
                        className="p-1 rounded text-text-muted/30 hover:text-accent-error hover:bg-accent-error/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 mr-1"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Spacer if collapsed */}
      {!expanded && <div className="flex-1" />}

      {/* ===== Footer ===== */}
      <div className="border-t border-border-subtle">
        {/* User profile */}
        {expanded && user && (
          <button
            onClick={() => navigate('/settings')}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-surface-hover transition-colors text-left"
          >
            <div className="w-8 h-8 rounded-lg bg-accent-primary/15 flex items-center justify-center flex-shrink-0">
              <User size={14} className="text-accent-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-text-primary truncate">{user.name}</p>
              <div className="flex items-center gap-1.5">
                <span className={cn(
                  'text-[10px] font-medium',
                  credits.remaining > 0 ? 'text-accent-success' : 'text-accent-error'
                )}>
                  {credits.remaining.toLocaleString()} FCFA
                </span>
              </div>
            </div>
            <Settings size={14} className="text-text-muted flex-shrink-0" />
          </button>
        )}

        {/* Theme toggle + collapse (collapsed mode) */}
        {!expanded && (
          <div className="p-2 space-y-0.5">
            <button
              onClick={() => navigate('/settings')}
              className="w-full flex items-center justify-center p-2 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors relative group"
            >
              <Settings size={17} />
              <span className="absolute left-full ml-2.5 px-2.5 py-1.5 rounded-lg bg-surface-elevated border border-border-subtle text-xs text-text-primary opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-50 shadow-lg">
                Paramètres
              </span>
            </button>
            <button
              onClick={toggleTheme}
              className="w-full flex items-center justify-center p-2 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors relative group"
            >
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
              <span className="absolute left-full ml-2.5 px-2.5 py-1.5 rounded-lg bg-surface-elevated border border-border-subtle text-xs text-text-primary opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-50 shadow-lg">
                {isDark ? 'Mode clair' : 'Mode sombre'}
              </span>
            </button>
          </div>
        )}

        {/* Copyright */}
        {expanded && (
          <div className="px-4 py-2 text-center">
            <p className="text-[9px] text-text-muted/50 leading-relaxed">
              {"© "}{new Date().getFullYear()} IssalanHub · Tous droits reserves
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
