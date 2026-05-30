/**
 * SkillsPanel — Panneau de skills rapides dans le VibeCoding Studio.
 *
 * Affiche les skills builtin et custom en grille compacte,
 * filtrables par catégorie. Un clic lance l'itération avec
 * le prompt et le mode du skill.
 */

import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { studioSkills } from '@/services/studio/studioSkills';
import type { StudioSkill, SkillCategory } from '@/services/studio/studioSkills';

// ============================================================================
// TYPES
// ============================================================================

interface SkillsPanelProps {
  onExecuteSkill: (prompt: string, mode: string) => void;
  disabled?: boolean;
  selectedFile?: string | null;
  projectName?: string;
}

// ============================================================================
// SKILL CARD
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
// CATEGORY TABS
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
// MAIN COMPONENT
// ============================================================================

const SkillsPanel: React.FC<SkillsPanelProps> = ({
  onExecuteSkill,
  disabled,
  selectedFile,
  projectName,
}) => {
  const [activeCategory, setActiveCategory] = useState<SkillCategory | 'all'>('all');

  const categories = useMemo(() => studioSkills.getCategories(), []);
  const allSkills = useMemo(() => studioSkills.getAll(), []);

  const filteredSkills = useMemo(() => {
    if (activeCategory === 'all') return allSkills;
    return allSkills.filter(s => s.category === activeCategory);
  }, [activeCategory, allSkills]);

  const handleSkillClick = (skill: StudioSkill) => {
    const prompt = studioSkills.resolvePrompt(skill, {
      file: selectedFile || undefined,
      project: projectName,
    });
    onExecuteSkill(prompt, skill.mode);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Category filter */}
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

      {/* Skills grid */}
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
            Aucun skill dans cette catégorie
          </div>
        )}
      </div>
    </div>
  );
};

export default SkillsPanel;
