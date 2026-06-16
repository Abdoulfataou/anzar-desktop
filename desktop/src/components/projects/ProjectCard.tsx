/**
 * ProjectCard - Carte de projet dans la grille
 * Affiche statut, fichiers, progression et actions
 */
import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Project } from '@/types';
import {
  MoreVertical, Copy, Trash2, Edit2, FolderOpen,
  FileCode, Clock,
} from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useProjectStore } from '@/stores/projectStore';
import AgentProgress from './AgentProgress';
import { useConfirmModal } from '@/components/ui/ConfirmModal';

interface ProjectCardProps {
  project: Project;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  planning: { label: 'Planification', color: 'bg-accent-warning/15 text-accent-warning' },
  generating: { label: 'Génération', color: 'bg-accent-info/15 text-accent-info' },
  testing: { label: 'Tests', color: 'bg-accent-secondary/15 text-accent-secondary' },
  complete: { label: 'Terminé', color: 'bg-accent-success/15 text-accent-success' },
  error: { label: 'Erreur', color: 'bg-accent-error/15 text-accent-error' },
};

const ProjectCard: React.FC<ProjectCardProps> = ({ project }) => {
  const navigate = useNavigate();
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(project.name);
  const { confirm, ConfirmDialog } = useConfirmModal();

  const isImported = project.metadata?.imported === true;
  const status = statusConfig[project.status] || statusConfig.planning;

  const handleRename = () => {
    if (newName.trim()) {
      updateProject(project.id, { name: newName.trim() });
      setIsRenaming(false);
    }
  };

  const handleDelete = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const ok = await confirm({
      title: 'Supprimer le projet',
      message: `Supprimer « ${project.name} » ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (ok) deleteProject(project.id);
  };

  const progressPercent =
    project.status === 'complete' ? 100 :
    project.status === 'error' ? 0 :
    project.status === 'generating' ? 60 :
    project.status === 'testing' ? 85 :
    20;

  return (
    <>
    {ConfirmDialog}
    <div
      onClick={() => navigate(`/projects/${project.id}`)}
      className="group relative rounded-xl border border-border-subtle bg-surface-default hover:bg-surface-hover hover:border-border-medium transition-all duration-200 overflow-hidden card-hover cursor-pointer">
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            {isRenaming ? (
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') { setNewName(project.name); setIsRenaming(false); }
                }}
                className="w-full bg-bg-tertiary border border-border-medium rounded-lg px-2 py-1 text-sm text-text-primary font-semibold focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            ) : (
              <h3 className="text-sm font-semibold text-text-primary truncate">{project.name}</h3>
            )}
          </div>

          {/* Context menu */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
              className="p-1 rounded-lg hover:bg-bg-tertiary transition-colors opacity-0 group-hover:opacity-100"
            >
              <MoreVertical size={14} className="text-text-muted" />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-40 bg-bg-secondary border border-border-subtle rounded-xl shadow-lg z-50 overflow-hidden py-1">
                  <button
                    onClick={() => { setIsRenaming(true); setShowMenu(false); }}
                    className="w-full px-3 py-2 text-left text-xs text-text-primary hover:bg-surface-hover flex items-center gap-2"
                  >
                    <Edit2 size={12} /> Renommer
                  </button>
                  <button
                    onClick={() => { setShowMenu(false); }}
                    className="w-full px-3 py-2 text-left text-xs text-text-primary hover:bg-surface-hover flex items-center gap-2"
                  >
                    <Copy size={12} /> Exporter
                  </button>
                  <button
                    onClick={() => { handleDelete(); setShowMenu(false); }}
                    className="w-full px-3 py-2 text-left text-xs text-accent-error hover:bg-accent-error/10 flex items-center gap-2"
                  >
                    <Trash2 size={12} /> Supprimer
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Status + import badge */}
        <div className="flex items-center gap-2 mb-2">
          <span className={cn('px-2 py-0.5 rounded-lg text-[11px] font-semibold', status.color)}>
            {status.label}
          </span>
          {isImported && (
            <span className="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-bg-tertiary text-text-muted flex items-center gap-1">
              <FolderOpen size={10} /> Importé
            </span>
          )}
        </div>

        {/* Description */}
        {project.description && (
          <p className="text-xs text-text-muted line-clamp-2 mb-3">{project.description}</p>
        )}

        {/* Progress */}
        <div className="h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent-primary to-accent-secondary transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Agent progress if generating */}
      {project.status === 'generating' && (
        <div className="px-4 pb-3 border-t border-border-subtle pt-3">
          <AgentProgress projectId={project.id} />
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-border-subtle flex items-center justify-between text-[11px] text-text-muted">
        <span className="flex items-center gap-1">
          <FileCode size={11} />
          {project.files.length} fichier{project.files.length !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={11} />
          {formatRelativeTime(new Date(project.createdAt))}
        </span>
      </div>
    </div>
    </>
  );
};

export default ProjectCard;
