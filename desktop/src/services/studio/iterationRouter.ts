/**
 * IterationRouter — Routage intelligent des demandes d'itération
 * vers le mode CoderAgent optimal.
 *
 * Inspiré de TRAE SOLO qui route automatiquement vers des sub-agents
 * spécialisés selon le type de demande utilisateur.
 *
 * Modes disponibles:
 *  - iterate : ajout de fonctionnalités, modifications substantielles
 *  - patch   : corrections ciblées (fix, typo, import manquant)
 *  - refactor: restructuration, renommage, réorganisation
 *  - debug   : diagnostic d'erreurs, investigation de bugs
 *  - test    : génération de tests unitaires/intégration
 *  - review  : audit de code, suggestions d'amélioration
 */

// ============================================================================
// TYPES
// ============================================================================

export type IterationMode = 'iterate' | 'patch' | 'refactor' | 'debug' | 'test' | 'review';

export interface RouteResult {
  mode: IterationMode;
  confidence: number;  // 0-1
  reason: string;      // Short explanation for UI
}

// ============================================================================
// PATTERNS — regex patterns for each mode
// ============================================================================

interface ModePattern {
  mode: IterationMode;
  /** Positive patterns — if matched, favor this mode */
  positive: RegExp;
  /** Negative patterns — if matched, disfavor this mode */
  negative?: RegExp;
  /** Base priority (higher = preferred when tied) */
  priority: number;
  /** UI label */
  label: string;
}

const MODE_PATTERNS: ModePattern[] = [
  {
    mode: 'debug',
    positive: /\b(debug|erreur|error|bug|crash|plante|exception|trace|stack|segfault|undefined is not|cannot read|null pointer|ne marche pas|ne fonctionne pas|broken|cassé|problème|investig|diagnos)\b/i,
    negative: /\b(ajoute|crée|implement|nouveau|nouvelle|génère)\b/i,
    priority: 90,
    label: 'Debug',
  },
  {
    mode: 'patch',
    positive: /\b(fix|corrig|typo|faute|import manquant|missing import|rename|supprime la ligne|enlève|retire|remplace par|change .{0,20} en |modifie .{0,20} pour)\b/i,
    negative: /\b(ajoute|crée|implement|refond|refactor|restructur|réorganis)\b/i,
    priority: 80,
    label: 'Patch',
  },
  {
    mode: 'refactor',
    positive: /\b(refactor|refond|restructur|réorganis|déplace|extrai|sépare|découpe|split|merge|fusionne|consolide|simplifie le code|nettoie|clean|décompose|modularise)\b/i,
    priority: 70,
    label: 'Refactor',
  },
  {
    mode: 'test',
    positive: /\b(test|tests|testing|unitaire|intégration|jest|vitest|pytest|spec|assertion|expect\(|describe\(|it\(|coverage|couverture)\b/i,
    negative: /\b(corrig|fix|debug)\b/i,
    priority: 60,
    label: 'Test',
  },
  {
    mode: 'review',
    positive: /\b(review|audit|analyse le code|vérifie le code|qualité|performance|sécurité du code|code smell|lint|optimise le code|best practice|améliore la qualité)\b/i,
    priority: 50,
    label: 'Review',
  },
  {
    mode: 'iterate',
    positive: /\b(ajoute|crée|implement|nouveau|nouvelle|génère|intègre|met en place|constru|design|style|couleur|thème|responsive|mobile|animation|formulaire|bouton|page|composant|section|feature|fonctionnalité)\b/i,
    priority: 40,
    label: 'Iterate',
  },
];

// ============================================================================
// ROUTER SERVICE
// ============================================================================

class IterationRouterService {
  /**
   * Analyse un message utilisateur et détermine le mode d'itération optimal.
   *
   * @param message - La demande utilisateur en langage naturel
   * @param hasErrors - Si le terminal montre des erreurs actives
   * @param isAutoFix - Si c'est une correction automatique (auto-fix)
   * @returns Le mode choisi avec confiance et raison
   */
  route(message: string, hasErrors = false, isAutoFix = false): RouteResult {
    // Auto-fix always uses patch mode
    if (isAutoFix) {
      return { mode: 'patch', confidence: 1.0, reason: 'Auto-fix → patch' };
    }

    // If terminal has errors and message seems about fixing, use debug
    if (hasErrors && /\b(fix|corrig|erreur|error|résou)\b/i.test(message)) {
      return { mode: 'debug', confidence: 0.9, reason: 'Erreurs actives → debug' };
    }

    const msgLower = message.toLowerCase();

    // Score each mode
    const scores: Array<{ mode: IterationMode; score: number; label: string }> = [];

    for (const pattern of MODE_PATTERNS) {
      let score = 0;

      // Check positive patterns
      if (pattern.positive.test(msgLower)) {
        score += pattern.priority;
      }

      // Check negative patterns (reduce score)
      if (pattern.negative && pattern.negative.test(msgLower)) {
        score -= 30;
      }

      // Bonus for message length heuristics
      if (pattern.mode === 'iterate' && message.length > 200) {
        score += 10; // Long messages tend to be feature requests
      }
      if (pattern.mode === 'patch' && message.length < 80) {
        score += 10; // Short messages tend to be quick fixes
      }

      if (score > 0) {
        scores.push({ mode: pattern.mode, score, label: pattern.label });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    if (scores.length === 0) {
      // Default: iterate for general requests
      return { mode: 'iterate', confidence: 0.5, reason: 'Défaut → iterate' };
    }

    const best = scores[0];
    const second = scores[1];

    // Calculate confidence based on gap between top two
    let confidence = 0.8;
    if (second) {
      const gap = best.score - second.score;
      confidence = Math.min(0.95, 0.5 + gap / 100);
    }

    return {
      mode: best.mode,
      confidence,
      reason: `${best.label} (${Math.round(confidence * 100)}%)`,
    };
  }

  /**
   * Returns a human-readable label for a mode.
   */
  getModeLabel(mode: IterationMode): string {
    const labels: Record<IterationMode, string> = {
      iterate: '🔨 Modifier',
      patch: '🩹 Corriger',
      refactor: '♻️ Refactorer',
      debug: '🐛 Débugger',
      test: '🧪 Tester',
      review: '🔍 Auditer',
    };
    return labels[mode] || mode;
  }

  /**
   * Returns the emoji for a mode (for chat display).
   */
  getModeEmoji(mode: IterationMode): string {
    const emojis: Record<IterationMode, string> = {
      iterate: '🔨',
      patch: '🩹',
      refactor: '♻️',
      debug: '🐛',
      test: '🧪',
      review: '🔍',
    };
    return emojis[mode] || '⚡';
  }
}

export const iterationRouter = new IterationRouterService();
