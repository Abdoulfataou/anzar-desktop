/**
 * Profils d'agents : chaque rôle (explorateur, sous-agents spécialisés) est déclaré dans un
 * fichier Markdown de ce dossier — frontmatter (outils, budget, modèle, skills) + consignes.
 * Ajouter un rôle = ajouter un fichier, sans toucher à la boucle.
 */
import { parseFrontmatter } from '@/services/skills/format';
import { BUILTIN_SKILLS } from '@/services/skills/pack';
import type { AIModel, ReasoningEffort } from '@/types';

export interface AgentProfile {
  name: string;
  description: string;
  kind: 'subagent' | 'explorer';
  /** Outils autorisés (vide = politique par défaut du rôle). */
  tools: string[];
  maxSteps: number;
  model?: AIModel;
  reasoningEffort?: ReasoningEffort;
  /** Skills du pack intégré injectées dans le prompt système. */
  skills: string[];
  /** Consignes (corps Markdown), {{max_steps}} remplacé. */
  prompt: string;
}

const list = (v?: string) => (v || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

export function parseProfile(markdown: string, fallbackName: string): AgentProfile {
  const fm = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(markdown);
  const meta = fm ? parseFrontmatter(fm[1]) : {};
  const body = (fm ? markdown.slice(fm[0].length) : markdown).trim();
  const maxSteps = Math.max(1, Math.min(60, Number(meta.max_steps) || 15));
  return {
    name: meta.name || fallbackName,
    description: meta.description || '',
    kind: meta.kind === 'explorer' ? 'explorer' : 'subagent',
    tools: list(meta.tools),
    maxSteps,
    ...(meta.model ? { model: meta.model as AIModel } : {}),
    ...(meta.reasoning ? { reasoningEffort: meta.reasoning as ReasoningEffort } : {}),
    skills: list(meta.skills),
    prompt: body.replace(/\{\{max_steps\}\}/g, String(maxSteps)),
  };
}

const FILES = import.meta.glob('./*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const AGENT_PROFILES: Record<string, AgentProfile> = Object.fromEntries(
  Object.entries(FILES).map(([path, md]) => {
    const p = parseProfile(md, path.replace(/^\.\/|\.md$/g, ''));
    return [p.name, p];
  }),
);

export function getProfile(name: string): AgentProfile {
  const p = AGENT_PROFILES[name];
  if (!p) throw new Error(`Profil d'agent inconnu : ${name}`);
  return p;
}

// ── Sous-agents spécialisés (spawn_subagents) ──

export type SubagentRole = 'motion-designer' | 'dev' | 'redaction';
export const SUBAGENT_ROLES: SubagentRole[] = ['motion-designer', 'dev', 'redaction'];

export const isSubagentRole = (v: unknown): v is SubagentRole =>
  typeof v === 'string' && (SUBAGENT_ROLES as string[]).includes(v);

/** Détecte un rôle depuis l'énoncé de la tâche quand l'agent principal ne l'a pas précisé. */
export function detectSubagentRole(task: string): SubagentRole {
  if (/motion|animat|vid[ée]o|pub |publicit|visuel|banni[èe]re|logo|motion ?design|reel|story|affiche/i.test(task)) return 'motion-designer';
  if (/texte|slogan|r[ée]daction|description|copywriting|contenu du site/i.test(task)) return 'redaction';
  return 'dev';
}

/** Prompt additionnel d'un sous-agent : consignes du rôle + skills obligatoires du profil. */
export function subagentSystemPrompt(role: SubagentRole): string | undefined {
  const profile = AGENT_PROFILES[role];
  if (!profile) return undefined;
  const skills = profile.skills
    .map((n) => BUILTIN_SKILLS.find((sk) => sk.name === n)?.markdown)
    .filter(Boolean)
    .join('\n\n---\n\n');
  const parts = [profile.prompt, skills ? `# SKILLS OBLIGATOIRES (applique-les à la lettre)\n${skills}` : '']
    .filter(Boolean);
  return parts.length ? `\n\n${parts.join('\n\n')}` : undefined;
}
