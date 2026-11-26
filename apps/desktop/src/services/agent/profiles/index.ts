/**
 * Profils d'agents : chaque rôle est déclaré dans un fichier Markdown de ce dossier —
 * frontmatter (outils, budget, modèle, skills, mots-clés) + consignes.
 *
 * Ajouter un rôle = ajouter un fichier : la liste des rôles de sous-agents est dérivée du
 * dossier (`kind: subagent`), et ses `tools` / `model` / `reasoning` sont réellement
 * appliqués par `subagents/live.ts` (intersection avec la politique du mode).
 */
import { parseFrontmatter } from '@/services/skills/format';
import type { AIModel, ReasoningEffort } from '@/types';

/**
 * Capacités qu'un manifeste peut refuser. Elles sont nommées par *effet* et non par outil :
 * un rôle peut interdire l'écriture de fichiers sans connaître la liste exacte des outils.
 */
export type Capability = 'fs.write' | 'shell.exec' | 'network';

export const CAPABILITIES: readonly Capability[] = ['fs.write', 'shell.exec', 'network'];

export interface AgentProfile {
  name: string;
  description: string;
  kind: 'subagent' | 'explorer';
  /** Outils autorisés (vide = politique par défaut du rôle). */
  tools: string[];
  maxSteps: number;
  model?: AIModel;
  reasoningEffort?: ReasoningEffort;
  /** Skills du pack intégré injectées dans le prompt du rôle (voir context/subagentPrompt.ts). */
  skills: string[];
  /** Mots-clés servant à deviner le rôle quand l'agent ne le précise pas. */
  keywords: string[];
  /** Capacités refusées au rôle (`fs.write`, `shell.exec`, `network`). */
  deny: string[];
  /** Plafond FCFA de ce rôle (plafonne l'enveloppe dérivée du parent). */
  budgetFCFA?: number;
  /** Longueur maximale du résumé renvoyé au parent, en caractères. */
  outputMaxChars?: number;
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
    keywords: list(meta.keywords),
    // Conservés bruts : `validateProfile` signale une capacité inconnue au lieu de l'ignorer.
    deny: list(meta.deny),
    ...(Number(meta.budget_fcfa) > 0 ? { budgetFCFA: Math.round(Number(meta.budget_fcfa)) } : {}),
    ...(Number(meta.output_max_chars) > 0
      ? { outputMaxChars: Math.max(100, Math.min(4000, Math.round(Number(meta.output_max_chars)))) }
      : {}),
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

// ── Sous-agents spécialisés (spawn_agent) ──
// La liste vient des profils : un fichier `kind: subagent` suffit à créer un rôle.

export type SubagentRole = string;

export const SUBAGENT_ROLES: SubagentRole[] = Object.values(AGENT_PROFILES)
  .filter((p) => p.kind === 'subagent')
  .map((p) => p.name)
  .sort();

export const isSubagentRole = (v: unknown): v is SubagentRole =>
  typeof v === 'string' && SUBAGENT_ROLES.includes(v);

/**
 * Devine un rôle depuis l'énoncé de la tâche, en comptant les mots-clés déclarés par chaque
 * profil. Sans correspondance : `dev` s'il existe, sinon le premier rôle déclaré.
 */
export function detectSubagentRole(task: string): SubagentRole {
  const text = String(task || '').toLowerCase();
  let best: { role: SubagentRole; score: number } | null = null;
  for (const role of SUBAGENT_ROLES) {
    const score = (AGENT_PROFILES[role]?.keywords || [])
      .filter((k) => k && text.includes(k.toLowerCase())).length;
    if (score > 0 && (!best || score > best.score)) best = { role, score };
  }
  if (best) return best.role;
  return SUBAGENT_ROLES.includes('dev') ? 'dev' : SUBAGENT_ROLES[0] || 'dev';
}
