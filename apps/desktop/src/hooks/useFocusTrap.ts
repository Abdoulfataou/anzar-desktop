/**
 * Piège de focus pour les dialogues : focus initial, Tab/Shift+Tab cycliques,
 * Échap pour fermer, et restauration du focus à la fermeture.
 */
import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap<T extends HTMLElement>(active: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled') && (el.offsetParent !== null || el === document.activeElement),
      );

    // Premier élément interactif ; à défaut, le dialogue lui-même.
    const first = focusables()[0];
    (first ?? node).focus?.();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const elements = focusables();
      if (elements.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = elements[0];
      const lastEl = elements[elements.length - 1];
      const activeEl = document.activeElement;

      if (e.shiftKey && activeEl === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && activeEl === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [active]);

  return ref;
}
