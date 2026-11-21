import { describe, expect, it, vi } from 'vitest';
import { BudgetLedger, budgetStopMessage, CHAT_BUDGET } from './budget';

/** Horloge contrôlée : le budget ne doit pas dépendre du temps réel en test. */
function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe('BudgetLedger', () => {
  it('compte les étapes et s’arrête au plafond', () => {
    const budget = new BudgetLedger({ steps: 2 }, { now: clock().now });
    expect(budget.exhaustedBy()).toBeNull();
    budget.countStep();
    expect(budget.exhaustedBy()).toBeNull();
    budget.countStep();
    expect(budget.exhaustedBy()).toBe('steps');
  });

  it('s’arrête dès que le coût atteint le plafond', () => {
    const budget = new BudgetLedger({ fcfa: 100 }, { now: clock().now });
    budget.charge({ fcfa: 60 });
    expect(budget.exhaustedBy()).toBeNull();
    budget.charge({ fcfa: 40 });
    expect(budget.exhaustedBy()).toBe('fcfa');
    expect(budget.view().remaining.fcfa).toBe(0);
  });

  it('borne les tokens lus et écrits séparément', () => {
    const budget = new BudgetLedger({ tokensIn: 1000, tokensOut: 100 }, { now: clock().now });
    budget.charge({ tokensIn: 1200 });
    expect(budget.exhaustedBy()).toBe('tokensIn');
    const other = new BudgetLedger({ tokensIn: 1000, tokensOut: 100 }, { now: clock().now });
    other.charge({ tokensOut: 150 });
    expect(other.exhaustedBy()).toBe('tokensOut');
  });

  it('suit la durée avec l’horloge injectée', () => {
    const c = clock();
    const budget = new BudgetLedger({ wallMs: 60_000 }, { now: c.now });
    c.advance(30_000);
    expect(budget.exhaustedBy()).toBeNull();
    c.advance(30_000);
    expect(budget.exhaustedBy()).toBe('wallMs');
  });

  it('n’est jamais épuisé sans plafond', () => {
    const budget = new BudgetLedger({}, { now: clock().now });
    budget.countStep();
    budget.charge({ fcfa: 10_000, tokensIn: 10_000_000 });
    expect(budget.exhaustedBy()).toBeNull();
  });

  it('avertit une seule fois à 60 % puis 85 %', () => {
    const budget = new BudgetLedger({ fcfa: 100 }, { now: clock().now });
    const seen: number[] = [];
    budget.onWarning((pct) => seen.push(pct));
    budget.charge({ fcfa: 50 });
    budget.charge({ fcfa: 15 });
    budget.charge({ fcfa: 20 });
    budget.charge({ fcfa: 40 });
    expect(seen).toEqual([0.6, 0.85]);
  });

  it('notifie l’affichage à chaque consommation', () => {
    const budget = new BudgetLedger({ fcfa: 100 }, { now: clock().now });
    const watch = vi.fn();
    const off = budget.onChange(watch);
    budget.charge({ fcfa: 10 });
    budget.countStep();
    off();
    budget.charge({ fcfa: 10 });
    expect(watch).toHaveBeenCalledTimes(2);
    expect(watch.mock.calls[0][0].used.fcfa).toBe(10);
  });

  it('expose la part consommée la plus élevée', () => {
    const budget = new BudgetLedger({ steps: 10, fcfa: 100 }, { now: clock().now });
    budget.countStep();
    expect(budget.view().usedPct).toBeCloseTo(0.1);
    budget.charge({ fcfa: 75 });
    expect(budget.view().usedPct).toBeCloseTo(0.75);
  });

  it('décrit en français la dimension épuisée', () => {
    const budget = new BudgetLedger({ fcfa: 100 }, { now: clock().now });
    budget.charge({ fcfa: 120 });
    expect(budgetStopMessage('fcfa', budget)).toContain('coût maximal atteint');
    expect(budgetStopMessage('fcfa', budget)).toContain('FCFA');
    expect(budgetStopMessage('fcfa', budget)).toContain('travail déjà fait est conservé');
  });

  it('répartit le budget restant entre les enfants et remonte la consommation', () => {
    const parent = new BudgetLedger({ fcfa: 100, tokensOut: 1000, steps: 10 }, { now: clock().now });
    const child = parent.child(0.25);

    expect(child.spec.fcfa).toBe(25);
    expect(child.spec.tokensOut).toBe(250);
    expect(child.spec.steps).toBe(2);

    child.charge({ fcfa: 10, tokensOut: 100 });
    expect(child.usage().fcfa).toBe(10);
    // La comptabilité reste unique : le parent voit la dépense de l'enfant.
    expect(parent.usage().fcfa).toBe(10);
    expect(parent.usage().tokensOut).toBe(100);
    expect(parent.usage().steps).toBe(0);
    expect(child.isChild).toBe(true);
  });

  it('applique le plafond déclaré par le manifeste du rôle', () => {
    const parent = new BudgetLedger({ fcfa: 100 }, { now: clock().now });
    const capped = parent.child(0.5, 7);
    expect(capped.spec.fcfa).toBe(7);
    // Un plafond supérieur au restant ne l'élargit pas.
    expect(parent.child(0.5, 500).spec.fcfa).toBe(100);
  });

  it('un enfant ne peut pas dépasser son enveloppe', () => {
    const parent = new BudgetLedger({ fcfa: 100 }, { now: clock().now });
    const child = parent.child(0.1);
    child.charge({ fcfa: 11 });
    expect(child.exhaustedBy()).toBe('fcfa');
    expect(parent.exhaustedBy()).toBeNull();
  });

  it('documente un budget interactif généreux', () => {
    // Un tour pathologique doit être arrêté, pas un gros refactor légitime.
    expect(CHAT_BUDGET.fcfa).toBeGreaterThanOrEqual(1000);
    expect(CHAT_BUDGET.wallMs).toBeGreaterThanOrEqual(30 * 60_000);
  });
});
