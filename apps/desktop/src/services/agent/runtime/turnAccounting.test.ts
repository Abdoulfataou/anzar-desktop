import { describe, expect, it } from 'vitest';
import { finalizeTurnCost, newServerCost, needsSettleDelay } from './turnAccounting';

const base = {
  promptTokens: 1_000_000,
  completionTokens: 1_000_000,
  balanceBefore: 1000,
  balanceAfter: 1000,
  model: 'fast' as const,
  startedAt: Date.now(),
};

describe('finalizeTurnCost', () => {
  it('privilégie les coûts exacts du serveur', () => {
    const cost = { sum: 42.5, reports: 3, calls: 3 };
    const out = finalizeTurnCost({ ...base, cost });
    expect(out.costFCFA).toBe(42.5);
    expect(out.exact).toBe(true);
    expect(out.fromServer).toBe(true);
  });

  it('utilise l’écart de solde quand tous les coûts ne sont pas remontés', () => {
    const out = finalizeTurnCost({
      ...base,
      cost: { sum: 10, reports: 1, calls: 3 },
      balanceBefore: 1000,
      balanceAfter: 940,
    });
    expect(out.costFCFA).toBe(60);
    expect(out.exact).toBe(false);
    expect(out.fromServer).toBe(true);
  });

  it('estime localement sans coût serveur ni solde', () => {
    const out = finalizeTurnCost({
      ...base,
      cost: { sum: 0, reports: 0, calls: 2 },
      balanceBefore: null,
      balanceAfter: null,
    });
    // 1M entrée à 250 FCFA + 1M sortie à 1000 FCFA
    expect(out.estimate).toBe(1250);
    expect(out.costFCFA).toBe(1250);
    expect(out.fromServer).toBe(false);
  });

  it('journalise une ligne d’usage au coût retenu', () => {
    const out = finalizeTurnCost({ ...base, cost: { sum: 12, reports: 1, calls: 1 } });
    expect(out.record).toMatchObject({
      provider: 'deepseek',
      model: 'fast',
      taskType: 'agent_chat',
      costFCFA: 12,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
  });
});

describe('needsSettleDelay', () => {
  it('n’attend pas quand le serveur a remonté tous les coûts', () => {
    expect(needsSettleDelay({ sum: 1, reports: 2, calls: 2 })).toBe(false);
  });

  it('attend quand un appel n’a pas encore de coût', () => {
    expect(needsSettleDelay({ sum: 1, reports: 1, calls: 2 })).toBe(true);
    expect(needsSettleDelay(newServerCost())).toBe(true);
  });
});
