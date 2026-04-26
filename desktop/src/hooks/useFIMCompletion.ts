/**
 * useFIMCompletion — Hook d'autocomplétion via DeepSeek FIM
 *
 * Fill-In-the-Middle: envoie le code avant et après le curseur
 * pour prédire le code manquant. Ultra rapide, ultra cheap.
 *
 * Déclenchement: pause de frappe > 500ms
 * Annulation: nouvelle frappe, Escape, ou clic ailleurs
 * Acceptation: Tab pour insérer la suggestion
 *
 * Coût: même tarif que DeepSeek V3 chat (~0.14$/M tokens)
 * → Coût très faible pour des compléments de 50-200 tokens
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { aiRouter } from '@/services/router';

export interface FIMSuggestion {
  text: string;           // Code suggéré
  startOffset: number;    // Position dans le texte
  isVisible: boolean;     // Affiché ou non
}

interface UseFIMOptions {
  /** Délai avant déclenchement (ms) */
  debounceMs?: number;
  /** Nombre max de tokens à générer */
  maxTokens?: number;
  /** Activer/désactiver */
  enabled?: boolean;
  /** Longueur min du préfixe pour déclencher */
  minPrefixLength?: number;
}

export function useFIMCompletion(options: UseFIMOptions = {}) {
  const {
    debounceMs = 600,
    maxTokens = 128,
    enabled = true,
    minPrefixLength = 10,
  } = options;

  const [suggestion, setSuggestion] = useState<FIMSuggestion | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const lastRequestId = useRef(0);

  /**
   * Demander une complétion FIM
   */
  const requestCompletion = useCallback(
    (content: string, cursorPosition: number) => {
      if (!enabled) return;

      // Annuler le timer précédent
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      // Annuler la requête précédente
      if (abortController.current) {
        abortController.current.abort();
      }

      const prefix = content.slice(0, cursorPosition);
      const suffix = content.slice(cursorPosition);

      // Ne pas déclencher si le préfixe est trop court
      if (prefix.length < minPrefixLength) {
        setSuggestion(null);
        return;
      }

      // Ne pas déclencher si le curseur est au milieu d'un mot
      const charBefore = prefix[prefix.length - 1];
      if (charBefore && /\w/.test(charBefore)) {
        // C'est OK, on est en train de taper un identifiant
      }

      // Debounce
      debounceTimer.current = setTimeout(async () => {
        const requestId = ++lastRequestId.current;
        const controller = new AbortController();
        abortController.current = controller;

        setIsLoading(true);

        try {
          const completion = await aiRouter.fimComplete(prefix, suffix, {
            maxTokens,
            signal: controller.signal,
          });

          // Vérifier que cette requête est encore la plus récente
          if (requestId !== lastRequestId.current) return;

          if (completion && completion.trim()) {
            setSuggestion({
              text: completion,
              startOffset: cursorPosition,
              isVisible: true,
            });
          } else {
            setSuggestion(null);
          }
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            console.warn('[FIM] Completion error:', err.message);
          }
          if (requestId === lastRequestId.current) {
            setSuggestion(null);
          }
        } finally {
          if (requestId === lastRequestId.current) {
            setIsLoading(false);
          }
        }
      }, debounceMs);
    },
    [enabled, debounceMs, maxTokens, minPrefixLength]
  );

  /**
   * Accepter la suggestion (Tab)
   * Retourne le nouveau contenu avec la suggestion insérée
   */
  const acceptSuggestion = useCallback(
    (currentContent: string): { newContent: string; newCursorPosition: number } | null => {
      if (!suggestion || !suggestion.isVisible) return null;

      const before = currentContent.slice(0, suggestion.startOffset);
      const after = currentContent.slice(suggestion.startOffset);
      const newContent = before + suggestion.text + after;
      const newCursorPosition = suggestion.startOffset + suggestion.text.length;

      setSuggestion(null);

      return { newContent, newCursorPosition };
    },
    [suggestion]
  );

  /**
   * Rejeter la suggestion (Escape ou nouvelle frappe)
   */
  const dismissSuggestion = useCallback(() => {
    setSuggestion(null);

    if (abortController.current) {
      abortController.current.abort();
      abortController.current = null;
    }
  }, []);

  /**
   * Nettoyer à l'unmount
   */
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (abortController.current) abortController.current.abort();
    };
  }, []);

  return {
    suggestion,
    isLoading,
    requestCompletion,
    acceptSuggestion,
    dismissSuggestion,
  };
}
