/**
 * Composition de la liste d'outils envoyée au modèle pour une étape.
 *
 * Séparé de l'exécution (`toolHost`) : la liste dépend du mode, du projet, de l'espace
 * ANZAR, des connecteurs et des skills — c'est une décision de capacité, pas d'exécution.
 * Module quasi pur (seule la liste des outils de l'espace ANZAR vient d'un service).
 */
import type { ToolDefinition } from '@/types';
import { READ_ONLY_TOOLS, type PermissionMode } from '../policy/permissions';
import { AGENT_TOOLS } from '../tools/definitions';
import { WEB_TOOLS } from '../tools/webTools';
import { PERSONAL_SPACE_TOOLS } from '@/services/workspace/personalSpace';
import { ASK_USER_TOOL, LOAD_SKILL_TOOL, PROPOSE_PLAN_TOOL } from '../tools/specialDefinitions';

export interface ToolListInput {
  mode: PermissionMode;
  workspacePath: string | null;
  /** Recherche web activée dans les Paramètres. */
  webEnabled: boolean;
  /** Sans personne devant l'écran (automatisation, ticket) : pas de question. */
  background: boolean;
  /** Conversation qui travaille dans l'espace ANZAR (outils restreints). */
  personalSpace: boolean;
  /** Des skills sont disponibles : l'outil load_skill est proposé. */
  hasSkills: boolean;
  mcpTools: ToolDefinition[];
}

/** Outils envoyés au modèle pour l'étape suivante. */
export function buildToolsForStep(input: ToolListInput): ToolDefinition[] | undefined {
  const web = input.webEnabled ? WEB_TOOLS : [];
  // Sans personne devant l'écran (automatisations, tickets), pas de question possible
  const ask = input.background ? [] : [ASK_USER_TOOL];
  const personalTools = input.personalSpace
    ? AGENT_TOOLS.filter((t) => PERSONAL_SPACE_TOOLS.has(t.function.name)
        && (input.mode !== 'plan' || READ_ONLY_TOOLS.has(t.function.name)))
    : [];
  if (!input.workspacePath) {
    const tools = [...personalTools, ...web, ...ask, ...input.mcpTools];
    return tools.length ? tools : undefined;
  }
  return input.mode === 'plan'
    ? [...AGENT_TOOLS.filter((t) => READ_ONLY_TOOLS.has(t.function.name)), ...web, PROPOSE_PLAN_TOOL, ...(input.hasSkills ? [LOAD_SKILL_TOOL] : []), ...ask]
    : [...AGENT_TOOLS, ...web, ...(input.hasSkills ? [LOAD_SKILL_TOOL] : []), ...ask, ...input.mcpTools];
}
