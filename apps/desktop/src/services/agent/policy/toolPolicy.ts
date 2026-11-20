/**
 * Décision d'approbation d'un outil, extraite du hook pour être testable.
 * Ne dépend ni de React ni de Tauri.
 */
import { needsApproval, READ_ONLY_TOOLS, type PermissionMode } from './permissions';

export interface ApprovalDecisionInput {
  mode: PermissionMode;
  tool: string;
  /** Annotation MCP readOnlyHint déclarée par le serveur. */
  mcpReadOnly: boolean;
  mcpAsk: boolean;
  /** Nom lisible du connecteur, pour le message de refus. */
  mcpName?: string;
  background: boolean;
  /** Risque calculé par commandGuard, null si aucun. */
  risk: { reason: string } | null;
  personalSpace: boolean;
  /** L'utilisateur a déjà autorisé le code de l'agent dans cette conversation. */
  trusted: boolean;
}

export interface ApprovalDecision {
  allowed: boolean;
  ask: boolean;
  /** Message renvoyé à l'agent quand l'action est refusée sans demander. */
  refusal?: string;
}

const PLAN_ALWAYS_ALLOWED = new Set(['task_done', 'propose_plan', 'load_skill', 'ask_user']);

export function approvalDecision(input: ApprovalDecisionInput): ApprovalDecision {
  const { mode, tool, mcpReadOnly, mcpAsk, mcpName, background, risk, personalSpace, trusted } = input;

  if (mode === 'plan' && !READ_ONLY_TOOLS.has(tool) && !mcpReadOnly && !PLAN_ALWAYS_ALLOWED.has(tool)) {
    return { allowed: false, ask: false };
  }
  if (mcpAsk && background) {
    return {
      allowed: false,
      ask: false,
      refusal: `Refusé automatiquement : l'action « ${tool} » du connecteur ${mcpName || 'MCP'} demande un accord, et personne n'est là pendant une automatisation. Signale-le dans ta réponse.`,
    };
  }
  if (risk && background) {
    return {
      allowed: false,
      ask: false,
      refusal: `Refusé automatiquement : ${risk.reason}. Personne n'est là pour valider pendant une automatisation. Ne contourne pas ce refus ; signale-le dans ta réponse.`,
    };
  }

  const ask = (!personalSpace && needsApproval(mode, tool))
    || !!risk
    || mcpAsk;
  // `trusted` ne couvre plus les risques réseau/installation : un accord de code
  // dans l'espace ANZAR ne doit pas autoriser un push ou un npm install silencieux.
  if (ask && background) {
    return {
      allowed: false,
      ask: false,
      refusal: "Refusé automatiquement : cette action demande une approbation et personne n'est là pendant une automatisation. Signale-le dans ta réponse.",
    };
  }

  return { allowed: true, ask };
}
