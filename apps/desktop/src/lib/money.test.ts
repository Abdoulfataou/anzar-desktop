import { describe, expect, it } from 'vitest';
import { creditsInLocal, formatCredits, formatMinor, formatMoney, fromMinor, guessCountry } from './money';

const nbsp = (s: string) => s.replace(/[  ]/g, ' ');

describe('formatCredits', () => {
  it('écrit le solde en crédits, singulier et pluriel', () => {
    expect(nbsp(formatCredits(12450))).toBe('12 450 crédits');
    expect(formatCredits(1)).toBe('1 crédit');
    expect(formatCredits(0)).toBe('0 crédit');
    expect(formatCredits(0.4)).toBe('< 1 crédit');
    expect(nbsp(formatCredits(12450.6, { short: true }))).toBe('12 451');
  });
});

describe('unités mineures et décimales ISO', () => {
  it('0 décimale (XOF, JPY) : jamais de virgule', () => {
    expect(fromMinor(5000, 0)).toBe(5000);
    expect(nbsp(formatMinor(5000, 'XOF', 0))).toMatch(/^5 000 F\s?CFA$/);
    expect(nbsp(formatMinor(1300, 'JPY', 0))).not.toMatch(/,/);
  });
  it('2 décimales (EUR, USD)', () => {
    expect(nbsp(formatMinor(840, 'EUR', 2))).toBe('8,40 €');
    expect(nbsp(formatMinor(1700, 'USD', 2))).toMatch(/^17,00 \$/);
  });
  it('3 décimales (KWD, BHD)', () => {
    expect(fromMinor(750, 3)).toBe(0.75);
    expect(nbsp(formatMinor(750, 'KWD', 3))).toMatch(/0,750/);
    expect(nbsp(formatMinor(1234, 'BHD', 3))).toMatch(/1,234/);
  });
  it('code inconnu : repli lisible sans planter', () => {
    expect(nbsp(formatMoney(12.5, 'ZZZ', 2))).toMatch(/12,50/);
  });
});

describe('creditsInLocal', () => {
  it('« ≈ » pour une conversion', () => {
    expect(nbsp(creditsInLocal(6559.57, { currency: 'EUR', decimals: 2, fcfaPerUnit: 655.957 }))).toBe('≈ 10,00 €');
  });
  it('exact (sans ≈) dans l\'unité du grand livre', () => {
    const s = creditsInLocal(12450, { currency: 'XOF', decimals: 0, fcfaPerUnit: 1 });
    expect(s.startsWith('≈')).toBe(false);
    expect(nbsp(s)).toMatch(/12 450/);
  });
  it('rien sans taux', () => {
    expect(creditsInLocal(100, { currency: 'NGN', decimals: 2, fcfaPerUnit: null })).toBe('');
    expect(creditsInLocal(100, null)).toBe('');
  });
});

describe('guessCountry', () => {
  it('région de la langue, puis fuseau horaire', () => {
    expect(guessCountry(['fr-NE', 'fr'], 'Europe/Paris')).toBe('NE');
    expect(guessCountry(['en-NG'], '')).toBe('NG');
    expect(guessCountry(['fr'], 'Africa/Niamey')).toBe('NE');     // « fr » seul ne vaut pas « France »
    expect(guessCountry(['en'], 'Mars/Base')).toBe('');
  });
});
