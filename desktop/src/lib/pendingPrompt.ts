/**
 * Prompt-first onboarding — persistance de l'idée saisie avant auth.
 *
 * La page d'accueil publique enregistre le prompt ; après login, ChatView
 * le "claim" (lecture + suppression atomique) et le rejoue automatiquement.
 */

const PENDING_PROMPT_KEY = 'anzar:pending-prompt';

export interface PendingPrompt {
  mode: 'build' | 'chat';
  prompt: string;
}

export function savePendingPrompt(p: PendingPrompt) {
  try {
    sessionStorage.setItem(PENDING_PROMPT_KEY, JSON.stringify(p));
  } catch {
    /* sessionStorage indisponible — on continue sans replay */
  }
}

/** Lit ET supprime le prompt en attente (consommé une seule fois). */
export function claimPendingPrompt(): PendingPrompt | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PROMPT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_PROMPT_KEY);
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.prompt === 'string' && parsed.prompt.trim()) {
      return { mode: parsed.mode === 'chat' ? 'chat' : 'build', prompt: parsed.prompt };
    }
  } catch {
    /* ignore */
  }
  return null;
}
