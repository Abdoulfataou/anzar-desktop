/** Résolution du dossier de travail : projet ouvert ou espace ANZAR. */
import type { ChatAttachment } from '@/types';
import { looksLikeCreation } from '@/services/ai/autoRouter';

export interface AgentRootInput {
  workspacePath: string | null;
  background: boolean;
  conversationId: string;
  content: string;
  attachments: ChatAttachment[];
  /** Conversations déjà passées dans l'espace ANZAR (mémoire de session). */
  personalConversations: Set<string>;
  /** La conversation a déjà utilisé l'espace ANZAR (persisté). */
  conversationPersonalSpace: boolean;
  ensurePersonalSpace: () => Promise<string | null>;
}

export interface AgentRootResult {
  agentRoot: string | null;
  personalSpace: boolean;
  /** La demande ressemble à une création (pub, visuel, site…). */
  creationRequest: boolean;
}

/**
 * Projet ouvert → ce projet. Sinon, l'espace ANZAR s'ouvre automatiquement
 * pour une création, un fichier joint ou une conversation qui l'utilisait déjà.
 */
export async function resolveAgentRoot(input: AgentRootInput): Promise<AgentRootResult> {
  if (input.workspacePath) {
    return { agentRoot: input.workspacePath, personalSpace: false, creationRequest: false };
  }
  if (input.background) {
    return { agentRoot: null, personalSpace: false, creationRequest: false };
  }

  const creationRequest = looksLikeCreation(input.content);
  const shouldOpen = input.attachments.some((a) => a.sourcePath)
    || input.personalConversations.has(input.conversationId)
    || input.conversationPersonalSpace
    || creationRequest;

  if (!shouldOpen) return { agentRoot: null, personalSpace: false, creationRequest };

  const agentRoot = await input.ensurePersonalSpace().catch(() => null);
  return { agentRoot, personalSpace: !!agentRoot, creationRequest };
}
