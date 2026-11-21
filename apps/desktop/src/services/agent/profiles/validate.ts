/**
 * Validation des manifestes d'agents.
 *
 * Un profil est un fichier Markdown ; une faute de frappe (`tools: readfile`) donnerait un
 * rôle silencieusement plus pauvre (aucun outil ne correspond) ou invalide (modèle inconnu).
 * La validation est explicite et rend les problèmes lisibles, au lieu de les ignorer.
 */
import { AGENT_PROFILES, type AgentProfile } from './index';

const MODELS = new Set(['auto', 'fast', 'thinking', 'max', 'pro']);
const REASONING = new Set(['none', 'low', 'medium', 'high']);
const KINDS = new Set(['subagent', 'explorer']);

export interface ProfileIssue {
  profile: string;
  issue: string;
}

/** Problèmes d'un profil, étant donné les outils connus du registre. */
export function validateProfile(profile: AgentProfile, knownTools: Iterable<string>): string[] {
  const issues: string[] = [];
  const tools = new Set(knownTools);
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(profile.name)) {
    issues.push(`nom invalide « ${profile.name} » (minuscules, chiffres et tirets)`);
  }
  if (!KINDS.has(profile.kind)) issues.push(`kind inconnu : ${profile.kind}`);
  if (!profile.description.trim()) issues.push('description vide');
  for (const tool of profile.tools) {
    if (!tools.has(tool)) issues.push(`outil inconnu : ${tool}`);
  }
  if (profile.model && !MODELS.has(profile.model)) issues.push(`modèle inconnu : ${profile.model}`);
  if (profile.reasoningEffort && !REASONING.has(profile.reasoningEffort)) {
    issues.push(`réflexion inconnue : ${profile.reasoningEffort}`);
  }
  if (!(profile.maxSteps >= 1 && profile.maxSteps <= 60)) issues.push(`max_steps hors bornes : ${profile.maxSteps}`);
  if (profile.budgetFCFA !== undefined && !(profile.budgetFCFA > 0)) issues.push('budget_fcfa doit être positif');
  return issues;
}

/** Tous les problèmes du registre (vide = manifestes cohérents). */
export function validateAllProfiles(knownTools: Iterable<string>): ProfileIssue[] {
  return Object.values(AGENT_PROFILES).flatMap((profile) =>
    validateProfile(profile, knownTools).map((issue) => ({ profile: profile.name, issue })));
}
