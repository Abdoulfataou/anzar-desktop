/**
 * Historique des recharges, lu sur le serveur (GET /api/credits/transactions).
 * Chaque recharge porte le montant réellement payé, dans sa devise d'origine.
 */
import { useSettingsStore } from '@/stores/settingsStore';
import { formatMinor, formatMoney } from '@/lib/money';

export type RechargeEntry = {
  id: string;
  date: number;
  credits: number;
  description: string;
  /** « 5,00 € », « 7 500,00 ₦ »… ; '' pour un crédit sans paiement (bonus, geste commercial). */
  paid: string;
  paidCurrency: string;
  provider: string;
};

type ServerTx = {
  id: number | string; type: string; amount_fcfa: number; description?: string; created_at?: string;
  paid_amount?: number; paid_amount_minor?: number | null; paid_currency?: string; payment_provider?: string;
};

/** Décimales ISO connues de l'app pour formater un montant historique (repli : Intl). */
function decimalsOf(currency: string): number | undefined {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    return undefined;
  }
}

export function toRechargeEntry(t: ServerTx): RechargeEntry | null {
  if (t.type !== 'recharge' && t.type !== 'bonus') return null;
  const cur = (t.paid_currency || '').toUpperCase();
  let paid = '';
  if (cur && typeof t.paid_amount_minor === 'number') {
    paid = formatMinor(t.paid_amount_minor, cur, decimalsOf(cur) ?? 2);
  } else if (cur && typeof t.paid_amount === 'number') {
    paid = formatMoney(t.paid_amount, cur, decimalsOf(cur));
  }
  const iso = t.created_at ? (t.created_at.endsWith('Z') ? t.created_at : `${t.created_at}Z`) : '';
  return {
    id: String(t.id),
    date: iso ? Date.parse(iso) : 0,
    credits: Math.abs(Number(t.amount_fcfa) || 0),
    description: t.description || 'Recharge',
    paid,
    paidCurrency: cur,
    provider: t.payment_provider || '',
  };
}

export async function fetchRechargeHistory(limit = 100): Promise<RechargeEntry[]> {
  const s = useSettingsStore.getState();
  const token = s.getAuthToken();
  if (!token) return [];
  const res = await fetch(`${s.getBackendUrl()}/api/credits/transactions?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Historique indisponible pour le moment.');
  const data = await res.json();
  const list: ServerTx[] = Array.isArray(data?.transactions) ? data.transactions : [];
  return list.map(toRechargeEntry).filter((e): e is RechargeEntry => e !== null);
}
