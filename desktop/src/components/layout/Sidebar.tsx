/**
 * Sidebar ANZAR — structure agent IDE.
 * Navigation (Nouvelle tâche / Rechercher / Automatisations / Skills)
 * puis Projets → tâches imbriquées, puis tâches hors projet, puis compte.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  SquarePen, Search, CalendarClock, Wand2, Folder, FolderOpen, FolderPlus,
  Hash, Settings, Sun, Moon, Trash2, Plus, X, PanelLeftClose, PanelLeft, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/stores/themeStore';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAccountStore } from '@/stores/accountStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useConfirmModal } from '@/components/ui/ConfirmModal';
import { openWorkspaceFolder } from '@/lib/openWorkspace';
import type { Conversation } from '@/types';

/** Âge compact : now, 5m, 3h, 76d */
function age(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

type ViewMode = 'group' | 'project';

export default function Sidebar({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(true);
  const [mode, setMode] = useState<ViewMode>('project');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const { effectiveTheme, toggleTheme } = useThemeStore();
  const isDark = effectiveTheme === 'dark';

  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const isGenerating = useChatStore((s) => s.isGenerating);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const createConversation = useChatStore((s) => s.createConversation);
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const user = useAccountStore((s) => s.user);
  const credits = useAccountStore((s) => s.credits);
  const model = useSettingsStore((s) => s.settings.model);
  const { confirm, ConfirmDialog } = useConfirmModal();

  const goHome = () => { if (location.pathname !== '/') navigate('/'); };

  /** Nouvelle tâche, rattachée au projet donné (ou hors projet). */
  const newTask = (projectId: string | null) => {
    setActiveProject(projectId);
    const conv = createConversation(undefined, model);
    if (projectId) {
      useChatStore.setState((s) => ({
        conversations: s.conversations.map((c) => (c.id === conv.id ? { ...c, projectId } : c)),
      }));
    }
    goHome();
  };

  const selectTask = (c: Conversation) => {
    setActiveConversation(c.id);
    setActiveProject(c.projectId && projects.some((p) => p.id === c.projectId) ? c.projectId : null);
    goHome();
  };

  const selectProject = (projectId: string) => {
    const latest = conversations
      .filter((c) => c.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (latest) selectTask(latest);
    else newTask(projectId);
  };

  const removeTask = async (c: Conversation) => {
    const ok = await confirm({
      title: 'Supprimer la tâche',
      message: `Supprimer « ${c.title || 'Sans titre'} » ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (ok) deleteConversation(c.id);
  };

  const removeProject = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Retirer le projet',
      message: `Retirer « ${name} » de la liste ? Les fichiers sur le disque ne sont pas touchés.`,
      confirmLabel: 'Retirer',
      variant: 'danger',
    });
    if (ok) deleteProject(id);
  };

  /** Supprime d'un coup une liste de tâches (après confirmation). */
  const removeTasks = async (list: Conversation[], label: string) => {
    if (list.length === 0) return;
    const ok = await confirm({
      title: 'Supprimer les tâches',
      message: `Supprimer ${list.length} tâche${list.length > 1 ? 's' : ''} (${label}) ? Leur historique est effacé du disque, c'est irréversible. Tes projets et tes fichiers ne sont pas touchés.`,
      confirmLabel: `Supprimer ${list.length} tâche${list.length > 1 ? 's' : ''}`,
      variant: 'danger',
    });
    if (!ok) return;
    const ids = new Set(list.map((c) => c.id));
    useChatStore.setState((st) => ({
      conversations: st.conversations.filter((c) => !ids.has(c.id)),
      activeConversationId: st.activeConversationId && ids.has(st.activeConversationId) ? null : st.activeConversationId,
    }));
  };

  const finishRename = () => {
    if (editingId && editingName.trim()) renameConversation(editingId, editingName.trim());
    setEditingId(null);
  };

  const q = query.trim().toLowerCase();
  const sorted = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations]
  );
  const visible = q ? sorted.filter((c) => (c.title || '').toLowerCase().includes(q)) : sorted;
  const projectIds = new Set(projects.map((p) => p.id));
  const looseTasks = visible.filter((c) => !c.projectId || !projectIds.has(c.projectId));
  const sortedProjects = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
  const shownProjects = q
    ? sortedProjects.filter(
        (p) => p.name.toLowerCase().includes(q) || visible.some((c) => c.projectId === p.id)
      )
    : sortedProjects;

  /**
   * Ligne de tâche, sur le modèle de TaskListItem de ZCode : emplacement d'état
   * à gauche (agent au travail, erreur), titre, bilan +/− des fichiers modifiés.
   */
  const renderTask = (c: Conversation, nested = false) => {
    const active = c.id === activeConversationId;
    const running = active && isGenerating;
    const last = c.messages[c.messages.length - 1];
    const failed = !running && last?.role === 'assistant' && !!last.isError;
    let added = 0;
    let removed = 0;
    for (const m of c.messages) {
      if (m.changesUndone || !m.fileChanges) continue;
      for (const f of m.fileChanges) { added += f.added; removed += f.removed; }
    }
    return (
      <div
        key={c.id}
        className={cn(
          'group flex items-center gap-2 h-8 rounded-lg pr-1 cursor-pointer transition-colors',
          nested ? 'pl-6' : 'pl-2.5',
          active ? 'bg-selected' : 'hover:bg-hover-fill'
        )}
        onClick={() => selectTask(c)}
        onDoubleClick={() => { setEditingId(c.id); setEditingName(c.title || ''); }}
      >
        {/* Emplacement d'état (vide quand rien à signaler) */}
        <span className="flex size-4 flex-shrink-0 items-center justify-center" aria-hidden>
          {running ? (
            <Loader2 size={14} className="animate-spin text-text-secondary" />
          ) : failed ? (
            <span className="size-1.5 rounded-full bg-accent-error" />
          ) : null}
        </span>
        {editingId === c.id ? (
          <input
            autoFocus
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={finishRename}
            onKeyDown={(e) => { if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') setEditingId(null); }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-transparent text-ui-base text-text-primary outline-none border-b border-border-medium"
          />
        ) : (
          <span className={cn('flex-1 min-w-0 truncate text-ui-base', active ? 'text-text-primary' : 'text-text-secondary')}>
            {c.title || 'Sans titre'}
          </span>
        )}
        {(added > 0 || removed > 0) && (
          <span className="flex-shrink-0 text-ui-sm tabular-nums group-hover:hidden">
            {added > 0 && <span className="text-diff-added">+{added}</span>}
            {removed > 0 && <span className="ml-1 text-diff-removed">-{removed}</span>}
          </span>
        )}
        <span className="flex-shrink-0 text-ui-sm text-text-muted tabular-nums group-hover:hidden">{age(c.updatedAt)}</span>
        <button
          onClick={(e) => { e.stopPropagation(); void removeTask(c); }}
          className="hidden group-hover:flex size-6 items-center justify-center rounded-md text-text-muted hover:text-accent-error hover:bg-hover-fill"
          title="Supprimer"
        >
          <Trash2 size={13} />
        </button>
      </div>
    );
  };

  const NavRow = ({
    icon: Icon, label, hint, onClick, disabled,
  }: { icon: typeof Search; label: string; hint?: string; onClick?: () => void; disabled?: boolean }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={!expanded ? label : undefined}
      className={cn(
        'w-full flex items-center gap-2 h-8 rounded-lg text-ui-base transition-colors',
        expanded ? 'px-2.5' : 'justify-center',
        disabled
          ? 'text-text-muted cursor-default'
          : 'text-text-primary hover:bg-surface-hover'
      )}
    >
      <Icon size={16} className="flex-shrink-0 text-text-secondary" />
      {expanded && <span className="flex-1 text-left truncate">{label}</span>}
      {expanded && hint && <span className="text-ui-xs text-text-muted">{hint}</span>}
    </button>
  );

  return (
    <>
      {ConfirmDialog}
      <aside
        className={cn(
          'h-full flex flex-col bg-transparent overflow-hidden',
          'transition-[width] duration-200',
          className
        )}
        style={{ width: expanded ? 264 : 52 }}
      >
        {/* ── Navigation ── */}
        <div className="p-2 space-y-0.5 flex-shrink-0">
          <NavRow icon={expanded ? PanelLeftClose : PanelLeft} label="Replier" onClick={() => setExpanded(!expanded)} />
          <NavRow icon={SquarePen} label="Nouvelle tâche" hint="⌘N" onClick={() => newTask(activeProjectId)} />
          <NavRow
            icon={Search}
            label="Rechercher"
            onClick={() => { setExpanded(true); setSearching((v) => !v); setQuery(''); }}
          />
          <NavRow icon={CalendarClock} label="Automatisations" hint="bientôt" disabled />
          <NavRow icon={Wand2} label="Skills" hint="bientôt" disabled />
        </div>

        {expanded && searching && (
          <div className="px-3 pb-2 flex-shrink-0">
            <div className="flex items-center gap-2 h-8 px-2 rounded-lg bg-bg-tertiary border border-border-subtle">
              <Search size={13} className="text-text-muted" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrer projets et tâches…"
                className="flex-1 min-w-0 bg-transparent text-ui-caption text-text-primary placeholder:text-text-muted outline-none"
              />
              <button onClick={() => { setSearching(false); setQuery(''); }} className="text-text-muted hover:text-text-primary">
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {expanded ? (
          <>
            {/* ── Bascule Groupe / Projet ── */}
            <div className="px-3 pb-2 flex items-center gap-1 flex-shrink-0">
              <div className="flex items-center p-0.5 rounded-lg bg-bg-tertiary">
                {([['group', 'Groupe', Hash], ['project', 'Projet', Folder]] as const).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    onClick={() => setMode(id)}
                    className={cn(
                      'flex items-center gap-1.5 h-7 px-2.5 rounded-md text-ui-caption transition-colors',
                      mode === id
                        ? 'bg-bg-primary text-text-primary shadow-sm'
                        : 'text-text-muted hover:text-text-secondary'
                    )}
                  >
                    <Icon size={12} />
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <button
                onClick={() => void openWorkspaceFolder().then((id) => id && selectProject(id))}
                className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover"
                title="Ouvrir un dossier"
              >
                <FolderPlus size={14} />
              </button>
            </div>

            {/* ── Listes ── */}
            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
              {mode === 'project' ? (
                <>
                  <p className="px-2 pt-2 pb-1 text-ui-sm text-text-muted">Projets</p>
                  {shownProjects.length === 0 && (
                    <p className="px-2 py-1.5 text-ui-caption text-text-muted">Aucun projet</p>
                  )}
                  {shownProjects.map((p) => {
                    const tasks = visible.filter((c) => c.projectId === p.id);
                    const active = p.id === activeProjectId;
                    return (
                      <div key={p.id}>
                        <div
                          onClick={() => selectProject(p.id)}
                          title={(p.metadata?.localPath as string | undefined) || p.name}
                          className={cn(
                            'group flex items-center gap-2 h-8 pl-2.5 pr-1.5 rounded-lg cursor-pointer transition-colors',
                            active ? 'text-text-primary' : 'text-text-secondary',
                            'hover:bg-hover-fill'
                          )}
                        >
                          {active ? <FolderOpen size={16} className="flex-shrink-0" /> : <Folder size={16} className="flex-shrink-0" />}
                          <span className="flex-1 min-w-0 truncate text-ui-base">{p.name}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); newTask(p.id); }}
                            className="hidden group-hover:block p-0.5 rounded text-text-muted hover:text-text-primary"
                            title="Nouvelle tâche dans ce projet"
                          >
                            <Plus size={13} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); void removeProject(p.id, p.name); }}
                            className="hidden group-hover:block p-0.5 rounded text-text-muted hover:text-accent-error"
                            title="Retirer de la liste"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        {tasks.map((c) => renderTask(c, true))}
                      </div>
                    );
                  })}

                  <div className="flex items-center px-2 pt-4 pb-1">
                    <p className="flex-1 text-ui-sm text-text-muted">Tâches</p>
                    {looseTasks.length > 0 && (
                      <button
                        onClick={() => void removeTasks(looseTasks, 'hors projet')}
                        className="text-ui-sm text-text-muted hover:text-accent-error transition-colors"
                      >
                        Tout supprimer
                      </button>
                    )}
                  </div>
                  {looseTasks.length === 0 ? (
                    <p className="px-2 py-1.5 text-ui-caption text-text-muted">Aucune tâche</p>
                  ) : (
                    looseTasks.map((c) => renderTask(c))
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center px-2 pt-2 pb-1">
                    <p className="flex-1 text-ui-sm text-text-muted">Toutes les tâches</p>
                    {visible.length > 0 && (
                      <button
                        onClick={() => void removeTasks(visible, 'toutes')}
                        className="text-ui-sm text-text-muted hover:text-accent-error transition-colors"
                      >
                        Tout supprimer
                      </button>
                    )}
                  </div>
                  {visible.length === 0 ? (
                    <p className="px-2 py-1.5 text-ui-caption text-text-muted">Aucune tâche</p>
                  ) : (
                    visible.map((c) => renderTask(c))
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1" />
        )}

        {/* ── Compte ── */}
        <div className={cn('flex items-center gap-2 p-2.5 flex-shrink-0', !expanded && 'flex-col')}>
          <button
            onClick={() => navigate('/settings')}
            className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
            title="Compte et paramètres"
          >
            <span className="w-8 h-8 rounded-full bg-credit-soft text-credit flex items-center justify-center text-ui-base font-semibold flex-shrink-0">
              {(user?.name || 'A').charAt(0).toUpperCase()}
            </span>
            {expanded && (
              <span className="min-w-0">
                <span className="block text-ui-base text-text-primary truncate">{user?.name || 'Compte'}</span>
                <span className={cn('block text-ui-sm font-mono tabular-nums', credits.remaining > 0 ? 'text-text-muted' : 'text-accent-error')}>
                  {Math.round(credits.remaining).toLocaleString('fr-FR')} FCFA
                </span>
              </span>
            )}
          </button>
          <button onClick={toggleTheme} className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover" title={isDark ? 'Mode clair' : 'Mode sombre'}>
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button onClick={() => navigate('/settings')} className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover" title="Paramètres">
            <Settings size={15} />
          </button>
        </div>
      </aside>
    </>
  );
}
