/**
 * SkillsPanel — Panneau de skills dans le VibeCoding Studio.
 *
 * 2 onglets:
 *   1. Builtin — skills locaux (rapides, pas de réseau)
 *   2. Hub — community skills (browse, install, publish, rate)
 *
 * Un clic sur un skill lance l'itération avec le prompt et le mode.
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { studioSkills } from '@/services/studio/studioSkills';
import type { StudioSkill, SkillCategory } from '@/services/studio/studioSkills';
import {
  skillsHubService,
  type CommunitySkill,
  type HubSkillCategory,
  type HubSkillMode,
} from '@/services/studio/skillsHubService';

// ============================================================================
// TYPES
// ============================================================================

interface SkillsPanelProps {
  onExecuteSkill: (prompt: string, mode: string) => void;
  disabled?: boolean;
  selectedFile?: string | null;
  projectName?: string;
}

type PanelTab = 'builtin' | 'hub';

// ============================================================================
// HUB CONSTANTS
// ============================================================================

const HUB_CATEGORIES: { id: HubSkillCategory; label: string; icon: string }[] = [
  { id: 'ui', label: 'UI', icon: '🎨' },
  { id: 'perf', label: 'Perf', icon: '⚡' },
  { id: 'quality', label: 'Qualite', icon: '✅' },
  { id: 'feature', label: 'Feature', icon: '🚀' },
  { id: 'fix', label: 'Fix', icon: '🔧' },
  { id: 'test', label: 'Test', icon: '🧪' },
  { id: 'custom', label: 'Custom', icon: '⭐' },
];

const MODE_OPTIONS: { value: HubSkillMode; label: string }[] = [
  { value: 'iterate', label: 'Iterate' },
  { value: 'refactor', label: 'Refactor' },
  { value: 'patch', label: 'Patch' },
  { value: 'debug', label: 'Debug' },
  { value: 'test', label: 'Test' },
  { value: 'review', label: 'Review' },
];

// ============================================================================
// SKILL CARD (local builtin)
// ============================================================================

const SkillCard: React.FC<{
  skill: StudioSkill;
  onClick: () => void;
  disabled?: boolean;
}> = ({ skill, onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'w-full text-left px-2.5 py-2 rounded-lg border border-border-subtle',
      'hover:bg-surface-hover hover:border-accent-primary/20 transition-all duration-150',
      'group',
      disabled && 'opacity-50 cursor-not-allowed',
    )}
  >
    <div className="flex items-start gap-2">
      <span className="text-base flex-shrink-0 mt-0.5">{skill.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-text-primary group-hover:text-accent-primary transition-colors truncate">
          {skill.name}
        </div>
        <div className="text-[10px] text-text-muted leading-tight mt-0.5 line-clamp-2">
          {skill.description}
        </div>
      </div>
    </div>
  </button>
);

// ============================================================================
// COMMUNITY SKILL CARD
// ============================================================================

const CommunitySkillCard: React.FC<{
  skill: CommunitySkill;
  installed: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onExecute: () => void;
  disabled?: boolean;
}> = ({ skill, installed, onInstall, onUninstall, onExecute, disabled }) => (
  <div className={cn(
    'px-2.5 py-2 rounded-lg border border-border-subtle',
    'hover:bg-surface-hover transition-all duration-150',
  )}>
    <div className="flex items-start gap-2">
      <span className="text-base flex-shrink-0 mt-0.5">{skill.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium text-text-primary truncate">{skill.name}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-muted flex-shrink-0">
            {skill.mode}
          </span>
        </div>
        <div className="text-[10px] text-text-muted leading-tight mt-0.5 line-clamp-2">
          {skill.description}
        </div>
        <div className="flex items-center gap-3 mt-1.5 text-[9px] text-text-muted/60">
          <span>⬇ {skill.downloads}</span>
          <span>⭐ {(skill.rating || 0).toFixed(1)}</span>
          <span className="truncate">{skill.author_email?.split('@')[0]}</span>
        </div>
      </div>
    </div>
    <div className="flex gap-1.5 mt-2">
      {installed ? (
        <>
          <button
            onClick={onExecute}
            disabled={disabled}
            className="flex-1 px-2 py-1 rounded text-[10px] font-medium text-white bg-accent-primary hover:opacity-90 disabled:opacity-50"
          >
            Executer
          </button>
          <button
            onClick={onUninstall}
            className="px-2 py-1 rounded text-[10px] text-accent-error/70 hover:bg-accent-error/10"
          >
            Retirer
          </button>
        </>
      ) : (
        <button
          onClick={onInstall}
          className="flex-1 px-2 py-1 rounded text-[10px] font-medium text-accent-primary border border-accent-primary/20 hover:bg-accent-primary/5"
        >
          Installer
        </button>
      )}
    </div>
  </div>
);

// ============================================================================
// CATEGORY TABS (local)
// ============================================================================

const CategoryTab: React.FC<{
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
  count: number;
}> = ({ label, icon, active, onClick, count }) => (
  <button
    onClick={onClick}
    className={cn(
      'px-2 py-1 rounded-md text-[10px] font-medium transition-all whitespace-nowrap',
      active
        ? 'bg-accent-primary/10 text-accent-primary border border-accent-primary/20'
        : 'text-text-muted hover:text-text-secondary hover:bg-bg-tertiary',
    )}
  >
    {icon} {label}
    {count > 0 && (
      <span className="ml-1 text-[9px] opacity-60">({count})</span>
    )}
  </button>
);

// ============================================================================
// PUBLISH FORM
// ============================================================================

const PublishForm: React.FC<{
  onPublish: (data: { name: string; description: string; prompt: string; mode: HubSkillMode; category: HubSkillCategory; icon: string }) => void;
  onCancel: () => void;
  publishing: boolean;
}> = ({ onPublish, onCancel, publishing }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<HubSkillMode>('iterate');
  const [category, setCategory] = useState<HubSkillCategory>('custom');
  const [icon, setIcon] = useState('⭐');

  const valid = name.trim().length >= 2 && prompt.trim().length >= 10;

  return (
    <div className="p-3 space-y-2.5 border-t border-border-subtle">
      <div className="text-[11px] font-semibold text-text-primary">Publier un skill</div>
      <div className="flex gap-2">
        <input
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          maxLength={4}
          className="w-10 px-1 py-1.5 rounded text-center text-sm bg-bg-secondary border border-border-subtle"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nom du skill"
          className="flex-1 px-2 py-1.5 rounded text-[11px] bg-bg-secondary border border-border-subtle text-text-primary placeholder:text-text-muted/50"
        />
      </div>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description courte"
        className="w-full px-2 py-1.5 rounded text-[11px] bg-bg-secondary border border-border-subtle text-text-primary placeholder:text-text-muted/50"
      />
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Prompt du skill (min. 10 caracteres)"
        rows={3}
        className="w-full px-2 py-1.5 rounded text-[11px] bg-bg-secondary border border-border-subtle text-text-primary placeholder:text-text-muted/50 resize-none"
      />
      <div className="flex gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as HubSkillMode)}
          className="flex-1 px-2 py-1.5 rounded text-[10px] bg-bg-secondary border border-border-subtle text-text-primary"
        >
          {MODE_OPTIONS.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as HubSkillCategory)}
          className="flex-1 px-2 py-1.5 rounded text-[10px] bg-bg-secondary border border-border-subtle text-text-primary"
        >
          {HUB_CATEGORIES.map(c => (
            <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onPublish({ name, description, prompt, mode, category, icon })}
          disabled={!valid || publishing}
          className="flex-1 py-1.5 rounded text-[11px] font-medium text-white bg-accent-primary hover:opacity-90 disabled:opacity-50"
        >
          {publishing ? 'Publication...' : 'Publier'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded text-[11px] text-text-muted hover:bg-surface-hover">
          Annuler
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const SkillsPanel: React.FC<SkillsPanelProps> = ({
  onExecuteSkill,
  disabled,
  selectedFile,
  projectName,
}) => {
  const [tab, setTab] = useState<PanelTab>('builtin');
  const [activeCategory, setActiveCategory] = useState<SkillCategory | 'all'>('all');

  // Hub state
  const [hubSkills, setHubSkills] = useState<CommunitySkill[]>([]);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState<string | null>(null);
  const [hubCategory, setHubCategory] = useState<HubSkillCategory | 'all'>('all');
  const [hubSearch, setHubSearch] = useState('');
  const [showPublish, setShowPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Local skills
  const categories = useMemo(() => studioSkills.getCategories(), []);
  const allSkills = useMemo(() => studioSkills.getAll(), []);
  const filteredSkills = useMemo(() => {
    if (activeCategory === 'all') return allSkills;
    return allSkills.filter(s => s.category === activeCategory);
  }, [activeCategory, allSkills]);

  // Load hub data when switching to hub tab
  const loadHub = useCallback(async () => {
    setHubLoading(true);
    setHubError(null);
    try {
      const [skills, installed] = await Promise.all([
        skillsHubService.browse({
          category: hubCategory !== 'all' ? hubCategory : undefined,
          search: hubSearch || undefined,
        }),
        skillsHubService.getInstalled(),
      ]);
      setHubSkills(skills);
      setInstalledIds(new Set(installed.map(s => s.id)));
    } catch (err: any) {
      setHubError(err.message || 'Erreur de chargement');
    } finally {
      setHubLoading(false);
    }
  }, [hubCategory, hubSearch]);

  useEffect(() => {
    if (tab === 'hub') loadHub();
  }, [tab, loadHub]);

  const handleSkillClick = (skill: StudioSkill) => {
    const prompt = studioSkills.resolvePrompt(skill, {
      file: selectedFile || undefined,
      project: projectName,
    });
    onExecuteSkill(prompt, skill.mode);
  };

  const handleInstall = async (skillId: string) => {
    try {
      await skillsHubService.install(skillId);
      setInstalledIds(prev => new Set([...prev, skillId]));
    } catch { /* ignore */ }
  };

  const handleUninstall = async (skillId: string) => {
    try {
      await skillsHubService.uninstall(skillId);
      setInstalledIds(prev => {
        const next = new Set(prev);
        next.delete(skillId);
        return next;
      });
    } catch { /* ignore */ }
  };

  const handlePublish = async (data: { name: string; description: string; prompt: string; mode: HubSkillMode; category: HubSkillCategory; icon: string }) => {
    setPublishing(true);
    try {
      await skillsHubService.publish(data);
      setShowPublish(false);
      loadHub();
    } catch (err: any) {
      setHubError(err.message || 'Erreur de publication');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab switcher */}
      <div className="px-2 pt-2 pb-1 flex-shrink-0">
        <div className="flex gap-1 bg-bg-secondary rounded-lg p-0.5">
          <button
            onClick={() => setTab('builtin')}
            className={cn(
              'flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all',
              tab === 'builtin'
                ? 'bg-surface-default text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            )}
          >
            Builtin
          </button>
          <button
            onClick={() => setTab('hub')}
            className={cn(
              'flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all',
              tab === 'hub'
                ? 'bg-surface-default text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            )}
          >
            Hub communautaire
          </button>
        </div>
      </div>

      {/* ── BUILTIN TAB ── */}
      {tab === 'builtin' && (
        <>
          <div className="px-2 py-2 border-b border-border-subtle flex-shrink-0">
            <div className="flex flex-wrap gap-1">
              <CategoryTab
                label="Tous"
                icon="📋"
                active={activeCategory === 'all'}
                onClick={() => setActiveCategory('all')}
                count={allSkills.length}
              />
              {categories.filter(c => allSkills.some(s => s.category === c.id)).map(cat => (
                <CategoryTab
                  key={cat.id}
                  label={cat.label}
                  icon={cat.icon}
                  active={activeCategory === cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  count={allSkills.filter(s => s.category === cat.id).length}
                />
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5 scrollbar-thin">
            {filteredSkills.map(skill => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onClick={() => handleSkillClick(skill)}
                disabled={disabled}
              />
            ))}
            {filteredSkills.length === 0 && (
              <div className="text-center py-6 text-text-muted text-[11px]">
                Aucun skill dans cette categorie
              </div>
            )}
          </div>
        </>
      )}

      {/* ── HUB TAB ── */}
      {tab === 'hub' && (
        <>
          {/* Search + filters */}
          <div className="px-2 py-2 border-b border-border-subtle flex-shrink-0 space-y-2">
            <input
              value={hubSearch}
              onChange={(e) => setHubSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadHub()}
              placeholder="Rechercher un skill..."
              className="w-full px-2.5 py-1.5 rounded-lg text-[11px] bg-bg-secondary border border-border-subtle text-text-primary placeholder:text-text-muted/50"
            />
            <div className="flex flex-wrap gap-1">
              <CategoryTab
                label="Tous"
                icon="📋"
                active={hubCategory === 'all'}
                onClick={() => setHubCategory('all')}
                count={hubSkills.length}
              />
              {HUB_CATEGORIES.map(cat => (
                <CategoryTab
                  key={cat.id}
                  label={cat.label}
                  icon={cat.icon}
                  active={hubCategory === cat.id}
                  onClick={() => setHubCategory(cat.id)}
                  count={hubSkills.filter(s => s.category === cat.id).length}
                />
              ))}
            </div>
          </div>

          {/* Error */}
          {hubError && (
            <div className="mx-2 mt-2 px-2 py-1.5 rounded text-[10px] text-accent-error bg-accent-error/10">
              {hubError}
            </div>
          )}

          {/* Skills list */}
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 scrollbar-thin">
            {hubLoading ? (
              <div className="text-center py-8 text-[11px] text-text-muted">Chargement...</div>
            ) : hubSkills.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-2xl mb-2">🌐</div>
                <div className="text-[11px] text-text-muted">Aucun skill communautaire</div>
                <div className="text-[10px] text-text-muted/60 mt-1">Sois le premier a publier !</div>
              </div>
            ) : (
              hubSkills.map(skill => (
                <CommunitySkillCard
                  key={skill.id}
                  skill={skill}
                  installed={installedIds.has(skill.id)}
                  onInstall={() => handleInstall(skill.id)}
                  onUninstall={() => handleUninstall(skill.id)}
                  onExecute={() => onExecuteSkill(skill.prompt, skill.mode)}
                  disabled={disabled}
                />
              ))
            )}
          </div>

          {/* Publish button / form */}
          {showPublish ? (
            <PublishForm
              onPublish={handlePublish}
              onCancel={() => setShowPublish(false)}
              publishing={publishing}
            />
          ) : (
            <div className="px-2 py-2 border-t border-border-subtle flex-shrink-0">
              <button
                onClick={() => setShowPublish(true)}
                className="w-full py-1.5 rounded-lg text-[11px] font-medium text-accent-primary border border-accent-primary/20 hover:bg-accent-primary/5 transition-all"
              >
                + Publier un skill
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SkillsPanel;
