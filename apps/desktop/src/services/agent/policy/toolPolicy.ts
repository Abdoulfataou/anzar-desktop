/**
 * Décision d'approbation d'un outil, extraite du hook pour être testable.
 * Ne dépend ni de React ni de Tauri.
 *
 * Aligné sur Harness : une écriture ou une commande ordinaire ne demande rien.
 * Seules les actions propres à ANZAR (connecteurs réglés « toujours demander »)
 * passent par une carte ; l'élévation de sandbox est traitée dans toolHost.
 */
export interface ApprovalDecisionInput {
  mode: 'ask' | 'auto' | 'plan' | 'full';
  tool: string;
  /** Annotation MCP readOnlyHint déclarée par le serveur. */
  mcpReadOnly: boolean;
  mcpAsk: boolean;
  /** Nom lisible du connecteur, pour le message de refus. */
  mcpName?: string;
  background: boolean;
  /** Outil de connecteur qui agit (pas une simple lecture déclarée). */
  mcpAction?: boolean;
}

export interface ApprovalDecision {
  allowed: boolean;
  ask: boolean;
  /** Message renvoyé à l'agent quand l'action est refusée sans demander. */
  refusal?: string;
}

export function approvalDecision(input: ApprovalDecisionInput): ApprovalDecision {
  const { mcpAsk, mcpName, background } = input;
  if (mcpAsk && background) {
    return {
      allowed: false,
      ask: false,
      refusal: `Refusé automatiquement : l'action « ${input.tool} » du connecteur ${mcpName || 'MCP'} demande un accord, et personne n'est là pendant une automatisation. Signale-le dans ta réponse.`,
    };
  }
  // Pas de carte générique pour les écritures, installations ou commandes : le mode
  // d'isolation décide, et l'élévation est le seul élargissement soumis à accord.
  return { allowed: true, ask: mcpAsk };
}
