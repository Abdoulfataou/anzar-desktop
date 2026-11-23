import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/services/infra/externalLinks', () => ({ openExternalUrl: vi.fn(async () => {}) }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import RechargeModal, { tierBonus } from './RechargeModal';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCurrencyStore } from '@/stores/currencyStore';

const nbsp = (s: string | null) => (s || '').replace(/[  ]/g, ' ');

const EUR_OFFER = {
  currency: 'EUR', decimals: 2, symbol: '€', requested_currency: 'EUR', fallback_reason: '', pricing_source: 'grid',
  fcfa_per_unit: 655.957, rate_as_of: '2026-11-23T00:00:00Z', rate_source: 'parite_fixe', rate_fixed: true,
  packs: [{ id: 11, label: 'Pro', price_minor: 840, credit_fcfa: 5750, bonus_pct: 0 }],
  providers: [{ id: 'stripe', label: 'Carte bancaire', kind: 'card', description: 'Visa', currency: '' }],
  free_amount: false, preferred_currency: null, country: 'FR', message: '', min_fcfa: 500, max_fcfa: 1000000,
  manual: false, bonus_tiers: [],
};

let calls: { url: string; body?: unknown }[] = [];

function mockFetch(offer: object) {
  calls = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes('/api/pricing')) return new Response(JSON.stringify(offer), { status: 200 });
    if (url.includes('/api/currencies')) return new Response(JSON.stringify({ currencies: [] }), { status: 200 });
    if (url.includes('/api/payments/initiate')) {
      return new Response(JSON.stringify({ intent_id: 'i1', paymentUrl: 'https://checkout.stripe.com/x', status: 'pending' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
}

beforeEach(() => {
  useSettingsStore.setState({ getAuthToken: () => 'tok', getBackendUrl: () => 'http://api' } as never);
  useCurrencyStore.setState({ offer: null, currencies: [], loading: false, error: '' });
});
afterEach(() => vi.restoreAllMocks());

describe('tierBonus', () => {
  it('suit les paliers envoyés par le serveur', () => {
    const tiers: [number, number][] = [[5000, 15], [15000, 25]];
    expect(tierBonus(4999, tiers)).toBe(0);
    expect(tierBonus(5000, tiers)).toBe(15);
    expect(tierBonus(20000, tiers)).toBe(25);
  });
});

describe('RechargeModal', () => {
  it('affiche les packs dans la devise du serveur et n\'envoie jamais de prix', async () => {
    mockFetch(EUR_OFFER);
    render(createElement(RechargeModal, { onClose: () => {} }));
    const pack = await screen.findByRole('button', { name: /8,40/ });
    expect(nbsp(pack.textContent)).toContain('5 750 crédits');
    expect(screen.queryByLabelText(/montant libre/i)).toBeNull();          // pas de montant libre hors XOF
    fireEvent.click(pack);
    const pay = await screen.findByRole('button', { name: /Payer 8,40/ });
    fireEvent.click(pay);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/payments/initiate'))).toBe(true));
    const body = calls.find((c) => c.url.endsWith('/api/payments/initiate'))!.body as Record<string, unknown>;
    expect(body).toEqual({ provider: 'stripe', currency: 'EUR', country: 'FR', pack_id: 11 });
    expect(body).not.toHaveProperty('amount');
  });

  it('montre le message de repli USD', async () => {
    mockFetch({ ...EUR_OFFER, currency: 'USD', requested_currency: 'GHS', fallback_reason: 'no_provider',
      fcfa_per_unit: 600, rate_fixed: false, symbol: '$',
      packs: [{ id: 3, label: 'Pro', price_minor: 1000, credit_fcfa: 5750, bonus_pct: 15 }],
      message: "Aucun moyen de paiement n'accepte encore cette monnaie. Paiement proposé en USD." });
    render(createElement(RechargeModal, { onClose: () => {} }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('USD'));
    expect(nbsp((await screen.findByRole('button', { name: /10,00/ })).textContent)).toContain('+15 %');
  });

  it('montant libre en XOF avec le bonus des paliers', async () => {
    mockFetch({ ...EUR_OFFER, currency: 'XOF', decimals: 0, symbol: 'F CFA', fcfa_per_unit: 1, free_amount: true,
      packs: [{ id: 1, label: 'Starter', price_minor: 2000, credit_fcfa: 2000, bonus_pct: 0 }],
      providers: [{ id: 'fedapay', label: 'Mobile money', kind: 'mobile_money', description: '', currency: '' }],
      bonus_tiers: [[5000, 15]], country: 'NE' });
    render(createElement(RechargeModal, { onClose: () => {} }));
    const input = await screen.findByLabelText(/montant libre/i);
    fireEvent.change(input, { target: { value: '6000' } });
    const pay = await screen.findByRole('button', { name: /Payer/ });
    expect(nbsp(pay.textContent)).toContain('6 900 crédits');
    fireEvent.click(pay);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/payments/initiate'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/api/payments/initiate'))!.body)
      .toEqual({ provider: 'fedapay', currency: 'XOF', country: 'NE', amount: 6000 });
  });
});
