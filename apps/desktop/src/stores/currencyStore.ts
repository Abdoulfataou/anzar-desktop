/**
 * Monnaie de l'utilisateur : offre de recharge et taux d'affichage, fournis par le serveur
 * (GET /api/pricing). Le choix fait dans les Réglages est enregistré sur le compte
 * (PUT /api/user/currency). L'app ne calcule aucun prix.
 */
import { create } from 'zustand';
import { useSettingsStore } from '@/stores/settingsStore';
import { guessCountry, type DisplayRate } from '@/lib/money';

export type PackOffer = { id: number; label: string; price_minor: number; credit_fcfa: number; bonus_pct: number };
export type ProviderOffer = { id: string; label: string; kind: string; description: string; currency: string };
export type Offer = {
  currency: string;
  decimals: number;
  symbol: string;
  requested_currency: string;
  fallback_reason: '' | 'inactive' | 'no_provider' | 'rate_unavailable' | 'unavailable';
  pricing_source: 'grid' | 'computed' | '';
  fcfa_per_unit: number | null;
  rate_as_of: string | null;
  rate_source: string;
  rate_fixed: boolean;
  packs: PackOffer[];
  providers: ProviderOffer[];
  free_amount: boolean;
  preferred_currency: string | null;
  country: string;
  message: string;
  rates_attribution?: { label: string; url: string };
};
export type CurrencyInfo = { code: string; name: string; symbol: string; decimals: number };

interface CurrencyStore {
  offer: Offer | null;
  currencies: CurrencyInfo[];
  loading: boolean;
  error: string;
  /** Charge l'offre ; `currency` force une devise pour cette fenêtre (sinon préférence/pays). */
  load: (currency?: string) => Promise<Offer | null>;
  loadCurrencies: () => Promise<CurrencyInfo[]>;
  /** Enregistre la monnaie sur le compte (null = automatique), puis recharge l'offre. */
  setPreferred: (code: string | null) => Promise<void>;
  displayRate: () => DisplayRate | null;
}

function api(path: string, init: RequestInit = {}): Promise<Response> {
  const s = useSettingsStore.getState();
  const token = s.getAuthToken();
  return fetch(`${s.getBackendUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) },
  });
}

async function detail(res: Response, fallback: string): Promise<string> {
  try {
    const d = await res.json();
    if (typeof d?.detail === 'string') return d.detail;
  } catch { /* pas de JSON */ }
  return fallback;
}

export const useCurrencyStore = create<CurrencyStore>()((set, get) => ({
  offer: null,
  currencies: [],
  loading: false,
  error: '',

  load: async (currency) => {
    set({ loading: true, error: '' });
    try {
      const q = new URLSearchParams();
      if (currency) q.set('currency', currency);
      const country = guessCountry();
      if (country) q.set('country', country);
      const res = await api(`/api/pricing?${q.toString()}`);
      if (!res.ok) throw new Error(await detail(res, 'Prix indisponibles pour le moment.'));
      const offer = (await res.json()) as Offer;
      set({ offer, loading: false });
      return offer;
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Prix indisponibles pour le moment.' });
      return null;
    }
  },

  loadCurrencies: async () => {
    try {
      const res = await api('/api/currencies');
      if (!res.ok) return get().currencies;
      const data = await res.json();
      const list = Array.isArray(data?.currencies) ? (data.currencies as CurrencyInfo[]) : [];
      set({ currencies: list });
      return list;
    } catch {
      return get().currencies;
    }
  },

  setPreferred: async (code) => {
    const res = await api('/api/user/currency', { method: 'PUT', body: JSON.stringify({ currency: code }) });
    if (!res.ok) throw new Error(await detail(res, "Impossible d'enregistrer la monnaie."));
    await get().load();
  },

  displayRate: () => {
    const o = get().offer;
    return o ? { currency: o.currency, decimals: o.decimals, fcfaPerUnit: o.fcfa_per_unit } : null;
  },
}));
