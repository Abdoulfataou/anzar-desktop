/**
 * IterationMemory — Gestion intelligente de l'historique d'itération du studio.
 *
 * Inspiré de TRAE SOLO qui utilise des stratégies de compaction pour garder
 * le contexte conversationnel pertinent sans exploser la fenêtre de tokens.
 *
 * Stratégies:
 *  - KEEP_RECENT: Garde les N derniers messages intacts
 *  - MICRO_COMPACT: Résume les anciens messages en un bloc compact
 *  - FILE_SUMMARY: Garde uniquement les noms de fichiers modifiés pour les vieilles itérations
 */

// ============================================================================
// TYPES
// ============================================================================

export interface IterationMessage {
  role: 'user' | 'assistant' | 'summary';
  content: string;
  /** Timestamp for ordering */
  timestamp: number;
  /** Estimated token count (rough: ~4 chars per token) */
  tokens: number;
}

export interface MemoryConfig {
  /** Max total tokens to keep in history before compaction (default: 8000) */
  maxTokens: number;
  /** Number of recent messages to always keep intact (default: 6) */
  keepRecentCount: number;
  /** Max tokens for a single compacted summary (default: 500) */
  maxSummaryTokens: number;
}

export interface MemoryStats {
  /** Total messages (including summaries) */
  totalMessages: number;
  /** Total estimated tokens */
  totalTokens: number;
  /** Number of compactions performed */
  compactionCount: number;
  /** Messages currently protected (recent) */
  protectedMessages: number;
}

// ============================================================================
// SERVICE
// ============================================================================

const DEFAULT_CONFIG: MemoryConfig = {
  maxTokens: 8000,
  keepRecentCount: 6,
  maxSummaryTokens: 500,
};

class IterationMemoryService {
  private messages: IterationMessage[] = [];
  private config: MemoryConfig = { ...DEFAULT_CONFIG };
  private compactionCount = 0;

  /**
   * Configure les limites de mémoire.
   */
  configure(config: Partial<MemoryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Ajoute un message à l'historique.
   */
  push(role: 'user' | 'assistant', content: string): void {
    this.messages.push({
      role,
      content,
      timestamp: Date.now(),
      tokens: this.estimateTokens(content),
    });
  }

  /**
   * Retourne l'historique pour envoi au backend.
   * Effectue la compaction si nécessaire AVANT de retourner.
   */
  getHistory(): Array<{ role: 'user' | 'assistant'; content: string }> {
    this.compactIfNeeded();
    return this.messages.map(m => ({
      role: m.role === 'summary' ? 'assistant' as const : m.role,
      content: m.content,
    }));
  }

  /**
   * Retourne l'historique SANS le dernier message (pour envoi avec iterate).
   */
  getHistoryWithoutLast(): Array<{ role: 'user' | 'assistant'; content: string }> {
    const history = this.getHistory();
    return history.slice(0, -1);
  }

  /**
   * Retourne les stats actuelles de la mémoire.
   */
  getStats(): MemoryStats {
    const totalTokens = this.messages.reduce((sum, m) => sum + m.tokens, 0);
    const protectedMessages = Math.min(this.config.keepRecentCount, this.messages.length);
    return {
      totalMessages: this.messages.length,
      totalTokens,
      compactionCount: this.compactionCount,
      protectedMessages,
    };
  }

  /**
   * Réinitialise l'historique (nouveau projet ou reset).
   */
  clear(): void {
    this.messages = [];
    this.compactionCount = 0;
  }

  /**
   * Compacte l'historique si le total de tokens dépasse le seuil.
   *
   * Stratégie:
   * 1. Garde les `keepRecentCount` derniers messages intacts
   * 2. Résume tous les messages plus anciens en un seul bloc "summary"
   * 3. Le résumé est structuré: liste des demandes + fichiers modifiés
   */
  private compactIfNeeded(): void {
    const totalTokens = this.messages.reduce((sum, m) => sum + m.tokens, 0);

    if (totalTokens <= this.config.maxTokens) return;
    if (this.messages.length <= this.config.keepRecentCount) return;

    // Split: old messages (to compact) vs recent (to keep)
    const splitIndex = this.messages.length - this.config.keepRecentCount;
    const oldMessages = this.messages.slice(0, splitIndex);
    const recentMessages = this.messages.slice(splitIndex);

    // Build compact summary from old messages
    const summary = this.buildCompactSummary(oldMessages);

    // Replace old messages with single summary message
    const summaryMessage: IterationMessage = {
      role: 'summary',
      content: summary,
      timestamp: oldMessages[oldMessages.length - 1]?.timestamp || Date.now(),
      tokens: this.estimateTokens(summary),
    };

    this.messages = [summaryMessage, ...recentMessages];
    this.compactionCount += 1;
  }

  /**
   * Construit un résumé compact des anciens messages.
   * Format optimisé pour que l'IA comprenne le contexte sans les détails.
   */
  private buildCompactSummary(messages: IterationMessage[]): string {
    const parts: string[] = ['[Résumé des itérations précédentes]'];

    // Extract user requests and file modifications
    const requests: string[] = [];
    const filesModified = new Set<string>();
    let iterationCount = 0;

    for (const msg of messages) {
      if (msg.role === 'user') {
        iterationCount++;
        // Extract the core request (skip auto-fix prefixes and project maps)
        let content = msg.content;

        // Strip [Project Map] prefix if present
        const reqIdx = content.indexOf('[User Request]\n');
        if (reqIdx !== -1) {
          content = content.slice(reqIdx + '[User Request]\n'.length);
        }

        // Strip auto-fix prefix
        if (content.startsWith('🔧')) {
          const nlIdx = content.indexOf('\n');
          if (nlIdx !== -1) content = content.slice(nlIdx + 1);
        }

        // Truncate long requests
        const short = content.trim().split('\n')[0]?.slice(0, 150) || content.slice(0, 150);
        requests.push(`${iterationCount}. ${short}`);
      }

      if (msg.role === 'assistant') {
        // Extract file paths from "Fichiers modifiés: path1, path2"
        const match = msg.content.match(/Fichiers modifiés:\s*(.+)/);
        if (match) {
          match[1].split(',').forEach(f => filesModified.add(f.trim()));
        }
      }

      if (msg.role === 'summary') {
        // Previous summary — include as-is but truncated
        parts.push(msg.content.slice(0, 300));
      }
    }

    if (requests.length > 0) {
      parts.push(`\n${iterationCount} itérations effectuées:`);
      // Keep only the last 5 request descriptions to stay compact
      const displayRequests = requests.length > 5
        ? [`... ${requests.length - 5} itérations antérieures ...`, ...requests.slice(-5)]
        : requests;
      parts.push(displayRequests.join('\n'));
    }

    if (filesModified.size > 0) {
      parts.push(`\nFichiers touchés: ${Array.from(filesModified).join(', ')}`);
    }

    // Ensure summary stays within token budget
    let summary = parts.join('\n');
    const maxChars = this.config.maxSummaryTokens * 4;
    if (summary.length > maxChars) {
      summary = summary.slice(0, maxChars) + '\n... (résumé tronqué)';
    }

    return summary;
  }

  /**
   * Estimation rough du nombre de tokens (~4 chars = 1 token).
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

export const iterationMemory = new IterationMemoryService();
