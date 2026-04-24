/**
 * ProjectsView - Vue principale des projets
 * Créer un projet depuis une description IA ou ouvrir un dossier existant
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  Plus, Search, Filter, FolderOpen, Sparkles, ArrowRight,
  FolderKanban, X, Loader2,
} from 'lucide-react';
import { useProjectStore, useSortedProjects } from '@/stores/projectStore';
import { cn, generateId } from '@/lib/utils';
import { agentService } from '@/services/agents';
import { useActivityStore } from '@/stores/activityStore';
import ProjectCard from './ProjectCard';

type SortBy = 'date' | 'status' | 'name';

/* ===== New Project Modal ===== */
function NewProjectModal({ onClose }: { onClose: () => void }) {
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const { createProject } = useProjectStore();
  const { startSession, endSession, addStep, completeStep } = useActivityStore();

  const handleCreate = async () => {
    if (!description.trim()) return;
    setIsCreating(true);

    // Create project in store with "planning" status
    const project = createProject(
      description.slice(0, 60).trim(),
      description.trim(),
      'fast'
    );

    // Start activity tracking (shown in AgentProgress)
    startSession(project.id, description.slice(0, 60));

    try {
      // 1) Plan the project via AI
      useProjectStore.getState().updateProject(project.id, { status: 'planning' });

      const understandStep = addStep(project.id, { type: 'understanding', label: 'Analyse de la demande' });
      completeStep(project.id, understandStep);

      const planStep = addStep(project.id, { type: 'planning', label: 'Planification de l\'architecture' });
      const plan = await agentService.planProject(description.trim());
      completeStep(project.id, planStep);

      // 2) Execute the project (agents generate code)
      useProjectStore.getState().updateProject(project.id, { status: 'generating' });

      let fileCounter = 0;
      for await (const statuses of agentService.executeProject(project.id, plan)) {
        const lastStatus = statuses[statuses.length - 1];
        if (lastStatus) {
          // Map agent status to activity steps
          const stepType = lastStatus.name === 'planner' ? 'planning'
            : lastStatus.name === 'coder' ? 'writing'
            : lastStatus.name === 'tester' ? 'testing'
            : lastStatus.name === 'executor' ? 'building'
            : 'running';

          addStep(project.id, {
            type: stepType as any,
            label: lastStatus.message || `${lastStatus.name}: ${lastStatus.status}`,
          });

          useProjectStore.getState().updateProject(project.id, {
            metadata: {
              ...useProjectStore.getState().projects.find((p) => p.id === project.id)?.metadata,
              agentStatus: lastStatus.message || lastStatus.status,
            },
          });
        }
      }

      // 3) Mark project as complete
      addStep(project.id, { type: 'complete', label: 'Projet généré avec succès' });
      endSession(project.id, 'done');
      useProjectStore.getState().updateProject(project.id, { status: 'complete' });

    } catch (err) {
      console.error('Project creation failed:', err);
      addStep(project.id, {
        type: 'error',
        label: err instanceof Error ? err.message : 'Échec de la création',
      });
      endSession(project.id, 'error');
      useProjectStore.getState().updateProject(project.id, {
        status: 'error',
        metadata: {
          ...useProjectStore.getState().projects.find((p) => p.id === project.id)?.metadata,
          error: err instanceof Error ? err.message : 'Échec de la création',
        },
      });
    } finally {
      setIsCreating(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg mx-4 animate-scale-in">
        <div className="rounded-2xl border border-border-medium bg-bg-secondary/95 backdrop-blur-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
                <Sparkles size={16} className="text-white" />
              </div>
              <h3 className="text-base font-semibold text-text-primary">Créer un projet</h3>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-text-secondary mb-2 block">
                Décris ton projet
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Crée une application de gestion de stock avec React, une base de données SQLite, et une interface moderne avec dashboard..."
                rows={5}
                className={cn(
                  'w-full px-4 py-3 rounded-xl text-sm',
                  'bg-bg-tertiary border border-border-subtle',
                  'text-text-primary placeholder-text-muted',
                  'focus:outline-none focus:ring-1 focus:ring-accent-primary',
                  'resize-none transition-all'
                )}
                autoFocus
              />
              <p className="text-[11px] text-text-muted mt-1.5">
                ANZAR va analyser ta description, planifier l'architecture et générer tous les fichiers du projet.
              </p>
            </div>

            <button
              onClick={handleCreate}
              disabled={!description.trim() || isCreating}
              className={cn(
                'w-full py-3 rounded-xl font-medium text-sm shadow-md transition-all flex items-center justify-center gap-2',
                description.trim() && !isCreating
                  ? 'gradient-bg text-white hover:opacity-90 active:scale-[0.98]'
                  : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
              )}
            >
              {isCreating ? (
                <><Loader2 size={16} className="animate-spin" /> Création en cours...</>
              ) : (
                <><Sparkles size={16} /> Générer le projet</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== Main View ===== */
const ProjectsView: React.FC = () => {
  const { projects, createProject } = useProjectStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);

  const handleOpenFolder = useCallback(async () => {
    try {
      // Use Tauri dialog to pick a folder
      const { open } = await import('@tauri-apps/api/dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Ouvrir un projet existant',
      });

      if (selected && typeof selected === 'string') {
        // Extract folder name from path
        const folderName = selected.split(/[/\\]/).pop() || 'Projet importé';

        // Create project entry
        const project = createProject(
          folderName,
          `Projet ouvert depuis: ${selected}`,
          'fast'
        );

        // Store the local path in metadata
        useProjectStore.getState().updateProject(project.id, {
          status: 'complete',
          metadata: { localPath: selected, imported: true },
        });

        // Load the directory tree into the project store
        await useProjectStore.getState().loadProjectFromDisk(project.id);
      }
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  }, [createProject]);

  const filteredAndSorted = useMemo(() => {
    let filtered = [...projects];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query)
      );
    }

    if (filterStatus) {
      filtered = filtered.filter((p) => p.status === filterStatus);
    }

    switch (sortBy) {
      case 'date':
        return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
      case 'name':
        return filtered.sort((a, b) => a.name.localeCompare(b.name));
      case 'status': {
        const statusOrder: Record<string, number> = {
          planning: 0, generating: 1, testing: 2, complete: 3, error: 4,
        };
        return filtered.sort(
          (a, b) => (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0)
        );
      }
      default:
        return filtered;
    }
  }, [projects, searchQuery, sortBy, filterStatus]);

  const statusOptions = [
    { value: 'planning', label: 'Planifié', color: 'text-accent-warning' },
    { value: 'generating', label: 'En cours', color: 'text-accent-info' },
    { value: 'complete', label: 'Terminé', color: 'text-accent-success' },
    { value: 'error', label: 'Erreur', color: 'text-accent-error' },
  ];

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Header */}
      <div className="flex flex-col gap-4 px-6 py-4 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-text-primary">Projets</h1>
            <p className="text-xs text-text-muted mt-0.5">Crée ou ouvre un projet pour coder avec l'IA</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Open existing folder */}
            <button
              onClick={handleOpenFolder}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium',
                'bg-bg-tertiary hover:bg-surface-hover border border-border-subtle',
                'text-text-primary transition-all duration-200'
              )}
            >
              <FolderOpen size={16} />
              Ouvrir un dossier
            </button>

            {/* Create new AI project */}
            <button
              onClick={() => setShowNewProject(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium gradient-bg text-white shadow-md hover:opacity-90 active:scale-[0.98] transition-all"
            >
              <Plus size={16} />
              Nouveau projet
            </button>
          </div>
        </div>

        {/* Search + Filters */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              placeholder="Rechercher un projet..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                'w-full pl-10 pr-4 py-2.5 rounded-xl text-sm',
                'bg-bg-tertiary border border-border-subtle',
                'text-text-primary placeholder-text-muted',
                'focus:outline-none focus:ring-1 focus:ring-accent-primary transition-all'
              )}
            />
          </div>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
              'border',
              showFilters
                ? 'bg-accent-primary/10 border-accent-primary/30 text-accent-primary'
                : 'bg-bg-tertiary border-border-subtle text-text-secondary hover:text-text-primary'
            )}
          >
            <Filter size={14} />
            Filtres
          </button>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className={cn(
              'px-3 py-2.5 rounded-xl text-sm',
              'bg-bg-tertiary border border-border-subtle',
              'text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary'
            )}
          >
            <option value="date">Récent</option>
            <option value="name">Nom</option>
            <option value="status">Statut</option>
          </select>
        </div>

        {/* Filter pills */}
        {showFilters && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterStatus(null)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                !filterStatus
                  ? 'gradient-bg text-white shadow-sm'
                  : 'bg-bg-tertiary text-text-secondary hover:bg-surface-hover'
              )}
            >
              Tous
            </button>
            {statusOptions.map((s) => (
              <button
                key={s.value}
                onClick={() => setFilterStatus(filterStatus === s.value ? null : s.value)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  filterStatus === s.value
                    ? 'gradient-bg text-white shadow-sm'
                    : 'bg-bg-tertiary text-text-secondary hover:bg-surface-hover'
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {filteredAndSorted.length === 0 ? (
          /* ===== EMPTY STATE ===== */
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-2xl gradient-bg flex items-center justify-center shadow-lg">
                <FolderKanban className="w-10 h-10 text-white" />
              </div>
              <div className="absolute inset-0 w-20 h-20 rounded-2xl gradient-bg opacity-30 blur-xl" />
            </div>

            <h2 className="text-xl font-bold text-text-primary mb-2">
              {searchQuery || filterStatus ? 'Aucun projet trouvé' : 'Aucun projet encore'}
            </h2>
            <p className="text-text-secondary max-w-sm mb-8 text-sm">
              {searchQuery || filterStatus
                ? 'Essaie une autre recherche ou ajuste tes filtres.'
                : 'Décris ton idée et ANZAR crée le projet complet, ou ouvre un dossier existant pour travailler dessus.'}
            </p>

            {!searchQuery && !filterStatus && (
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => setShowNewProject(true)}
                  className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-medium gradient-bg text-white shadow-md hover:opacity-90 active:scale-[0.98] transition-all"
                >
                  <Sparkles size={16} />
                  Créer avec l'IA
                  <ArrowRight size={14} />
                </button>
                <button
                  onClick={handleOpenFolder}
                  className={cn(
                    'flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-medium',
                    'bg-surface-default border border-border-subtle hover:bg-surface-hover',
                    'text-text-primary transition-all'
                  )}
                >
                  <FolderOpen size={16} />
                  Ouvrir un dossier
                </button>
              </div>
            )}
          </div>
        ) : (
          /* ===== PROJECT GRID ===== */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-max">
            {filteredAndSorted.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>

      {/* New Project Modal */}
      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}
    </div>
  );
};

export default ProjectsView;
