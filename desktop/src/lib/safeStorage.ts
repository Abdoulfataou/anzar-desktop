/**
 * Stockage local des stores — ne fait JAMAIS planter l'app.
 *
 * localStorage est limité à ~5 Mo. Quand il est plein, `setItem` lève
 * « The quota has been exceeded » : sans protection, cette erreur remonte dans
 * la boucle de l'agent et l'arrête en plein travail. Ici l'écriture échoue en
 * silence (l'état reste correct en mémoire) et l'utilisateur est prévenu une fois.
 */
import { createJSONStorage, type StateStorage } from 'zustand/middleware';
import toast from 'react-hot-toast';

let warned = false;

const guarded: StateStorage = {
  getItem: (name) => {
    try { return localStorage.getItem(name); } catch { return null; }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch (err) {
      console.warn(`[storage] écriture impossible pour ${name} (${Math.round(value.length / 1024)} Ko)`, err);
      if (!warned) {
        warned = true;
        toast.error(
          "Stockage local plein : l'historique récent ne sera pas gardé au prochain démarrage. Retire d'anciens projets ou tâches dans la barre latérale.",
          { duration: 9000 }
        );
      }
    }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* rien à faire */ }
  },
};

/** À passer en option `storage` de `persist`. */
export const safeStorage = createJSONStorage<any>(() => guarded);

/** Taille occupée par clé, en Ko (diagnostic). */
export function storageUsageKb(): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) out[k] = Math.round((localStorage.getItem(k) || '').length / 1024);
    }
  } catch { /* indisponible */ }
  return out;
}
