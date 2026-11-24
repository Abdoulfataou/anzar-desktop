/**
 * Types partagés par les outils de l'agent.
 */
import type { AgentLoopOptions, AgentSessionResult } from '../engine/agentLoop';
import type { SubagentRole } from '../profiles';
import type { PermissionMode } from '../policy/permissions';
import type { BudgetLedger } from '../engine/budget';

// ============================================================================
// TYPES
// ============================================================================

/** Progression en direct d'un sous-agent (affichée dans le chat pendant l'exécution). */
export interface SubagentProgress {
  task: string;
  /** Spécialisation affichée dans l'UI (motion-designer, dev, redaction) */
  role?: SubagentRole;
  status: 'running' | 'done' | 'error';
  /** Action en cours (dernier outil appelé) */
  current?: string;
  steps: number;
}

export interface ToolExecutionContext {
  /** Mode de permission du parent : les sous-agents héritent des restrictions. */
  permissionMode?: PermissionMode;
  /** Profondeur de récursion des sous-agents (0 = agent principal). */
  subagentDepth?: number;
  /** Racine absolue du projet — toutes les opérations sont relatives à elle */
  projectRoot: string;
  /** Signal d'annulation de la session */
  signal?: AbortSignal;
  /** Élévation approuvée à usage unique pour CET appel (Seatbelt désactivé). */
  escalated?: boolean;
  /** Callback appelé quand un fichier est écrit/modifié (pour rafraîchir l'UI) */
  onFileChanged?: (relativePath: string, content: string, action: 'create' | 'edit' | 'delete') => void;
  /** Progression en direct des sous-agents (spawn_subagents) pour l'UI */
  onSubagentProgress?: (progress: SubagentProgress[]) => void;
  /**
   * Lanceur de sous-agents, injecté par l'appelant (boucle ou chat). Les outils n'importent
   * jamais la boucle eux-mêmes : cela évite le cycle outils ↔ boucle.
   */
  runSubagent?: (options: AgentLoopOptions) => Promise<AgentSessionResult>;
  /**
   * Enveloppe de budget pour un sous-agent (fraction du budget restant du tour).
   * Absente : le sous-agent n'est borné que par ses étapes.
   */
  childBudget?: (share: number, capFcfa?: number) => BudgetLedger | undefined;
}

export interface ToolResult {
  /** Contenu renvoyé au modèle (message role:tool) */
  output: string;
  /** True si l'outil signale la fin de la tâche */
  isDone?: boolean;
  /** True si l'exécution a échoué (l'agent verra l'erreur et pourra corriger) */
  isError?: boolean;
  /** Coût des appels au modèle faits par l'outil (explorateurs), ajouté à celui de la réponse */
  costFCFA?: number;
  /** Captures d'écran à montrer au modèle juste après le résultat (capture_page) */
  images?: { label: string; dataUrl: string }[];
  /** Vidéo ou image produite (chemin absolu) : affichée en lecteur dans la conversation */
  media?: { path: string; kind: 'video' | 'image' };
}

// ============================================================================
// LIMITES
// ============================================================================
