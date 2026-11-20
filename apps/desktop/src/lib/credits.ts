/**
 * Solde prépayé — le serveur est la source de vérité.
 * Le backend facture chaque appel au modèle sur l'usage réel ; le client ne fait
 * que relire le solde pour l'afficher et en déduire le coût réel d'une tâche.
 */
import { useSettingsStore } from '@/stores/settingsStore';
import { useAccountStore } from '@/stores/accountStore';

/** Relit le solde côté serveur et met à jour l'affichage. Retourne le solde, ou null si indisponible. */
export async function refreshCredits(): Promise<number | null> {
  try {
    const settings = useSettingsStore.getState();
    const token = settings.getAuthToken();
    if (!token) return null;
    const res = await fetch(`${settings.getBackendUrl()}/api/credits`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data?.balance_fcfa !== 'number') return null;
    useAccountStore.getState().syncCreditsFromServer({
      balance_fcfa: data.balance_fcfa,
      total_recharged: data.total_recharged ?? 0,
      total_used: data.total_used ?? 0,
    });
    return data.balance_fcfa;
  } catch {
    return null;
  }
}

/** Seuil sous lequel on prévient l'utilisateur (FCFA). */
export const LOW_BALANCE_FCFA = 100;
