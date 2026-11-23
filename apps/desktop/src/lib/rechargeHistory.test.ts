import { describe, expect, it } from 'vitest';
import { toRechargeEntry } from './rechargeHistory';

const nbsp = (s: string) => s.replace(/[  ]/g, ' ');

describe('historique des recharges', () => {
  it('montre le montant payé dans la devise d\'origine', () => {
    const e = toRechargeEntry({ id: 1, type: 'recharge', amount_fcfa: 5750, created_at: '2026-11-23T10:00:00',
      paid_amount: 8.4, paid_amount_minor: 840, paid_currency: 'eur', payment_provider: 'stripe' })!;
    expect(nbsp(e.paid)).toBe('8,40 €');
    expect(e.credits).toBe(5750);
    expect(e.date).toBe(Date.parse('2026-11-23T10:00:00Z'));
  });
  it('0 et 3 décimales', () => {
    expect(nbsp(toRechargeEntry({ id: 2, type: 'recharge', amount_fcfa: 5000, paid_amount_minor: 5000, paid_currency: 'XOF' })!.paid))
      .toMatch(/^5 000 F\s?CFA$/);
    expect(nbsp(toRechargeEntry({ id: 3, type: 'recharge', amount_fcfa: 1500, paid_amount_minor: 740, paid_currency: 'KWD' })!.paid))
      .toMatch(/0,740/);
  });
  it('ignore les usages, garde les bonus sans paiement', () => {
    expect(toRechargeEntry({ id: 4, type: 'usage', amount_fcfa: -12 })).toBeNull();
    const b = toRechargeEntry({ id: 5, type: 'bonus', amount_fcfa: 200, description: 'Geste' })!;
    expect(b.paid).toBe('');
  });
});
