/**
 * Composition de la liste d'outils envoyée au modèle pour une étape.
 *
 * Séparé de l'exécution (`toolHost`) : la liste dépend du mode, du projet, de l'espace
 * ANZAR, des connecteurs et des skills — c'est une décision de capacité, pas d'exécution.
 * Module quasi pur (seule la liste des outils de l'espace ANZAR vient d'un service).
 */
import type { ToolDefinition } from '@/types';
import type { PermissionMode } from '../policy/permissions';
import { AGENT_TOOLS, BASH_TOOLS, POWERSHELL_TOOLS } from '../tools/definitions';
import { commandShell } from '@/lib/platform';
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
    ? AGENT_TOOLS.filter((t) => PERSONAL_SPACE_TOOLS.has(t.function.name))
    : [];
  if (!input.workspacePath) {
    const tools = [...personalTools, ...web, ...ask, ...input.mcpTools];
    return tools.length ? tools : undefined;
  }
  // Le shell de la plateforme remplace run_command : une seule façon de lancer une
  // commande, avec les pipes et les enchaînements. bash (confiné) sur macOS, powershell sous
  // Windows (sans isolation : Accès complet ou accord pour chaque commande).
  const platformShell = commandShell();
  const agentTools = platformShell
    ? AGENT_TOOLS.filter((t) => t.function.name !== 'run_command')
    : AGENT_TOOLS;
  const shell = platformShell === 'bash' ? BASH_TOOLS : platformShell === 'powershell' ? POWERSHELL_TOOLS : [];
  const plan = input.mode === 'plan' ? [PROPOSE_PLAN_TOOL] : [];
  return [...agentTools, ...shell, ...web, ...plan, ...(input.hasSkills ? [LOAD_SKILL_TOOL] : []), ...ask, ...input.mcpTools];
}
