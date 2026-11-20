import { describe, expect, it } from 'vitest';
import type { APIMessage } from '@/types';
import {
  appendTimelineText,
  appendTimelineTool,
  computeSessionCost,
  estimateCompletionTokens,
  estimateHistoryTokens,
  hasExactCost,
  snapshotTimeline,
} from './chatSession';

describe('chatSession', () => {
  it('estime les tokens d’historique et de complétion', () => {
    const history: APIMessage[] = [
      { role: 'system', content: '1234' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'n', arguments: '{}' } }] },
    ];
    expect(estimateHistoryTokens(history)).toBeGreaterThan(1);
    expect(estimateCompletionTokens('abcd', [])).toBe(2);
    expect(estimateCompletionTokens('abcd', [{ id: 'x' }])).toBeGreaterThan(1);
  });

  it('ajoute texte et outils dans l’ordre', () => {
    const timeline: any[] = [];
    appendTimelineText(timeline, 'Bonjour');
    appendTimelineText(timeline, '   ');
    appendTimelineTool(timeline, 'a');
    appendTimelineTool(timeline, 'b');
    appendTimelineText(timeline, 'Fin');
    expect(timeline).toEqual([
      { kind: 'text', text: 'Bonjour' },
      { kind: 'tools', ids: ['a', 'b'] },
      { kind: 'text', text: 'Fin' },
    ]);
  });

  it('snapshot ajoute le texte live sans muter la timeline', () => {
    const timeline: any[] = [{ kind: 'tools', ids: ['a'] }];
    const snap = snapshotTimeline(timeline, 'en cours');
    expect(snap).toEqual([
      { kind: 'tools', ids: ['a'] },
      { kind: 'text', text: 'en cours' },
    ]);
    expect(timeline).toEqual([{ kind: 'tools', ids: ['a'] }]);
  });

  it('coût exact quand le serveur a répondu pour chaque appel', () => {
    expect(hasExactCost(2, 2)).toBe(true);
    const cost = computeSessionCost({
      serverCostSum: 12.345,
      serverCostReports: 2,
      serverModelCalls: 2,
      balanceBefore: 100,
      balanceAfter: 80,
      promptTokens: 0,
      completionTokens: 0,
      priceInPerMillion: 250,
      priceOutPerMillion: 1000,
    });
    expect(cost.exact).toBe(true);
    expect(cost.costFCFA).toBe(12.35);
  });

  it('coût par écart de solde quand le serveur ne détaille pas', () => {
    const cost = computeSessionCost({
      serverCostSum: 0,
      serverCostReports: 0,
      serverModelCalls: 3,
      balanceBefore: 100,
      balanceAfter: 80,
      promptTokens: 0,
      completionTokens: 0,
      priceInPerMillion: 250,
      priceOutPerMillion: 1000,
    });
    expect(cost.fromServer).toBe(true);
    expect(cost.costFCFA).toBe(20);
  });

  it('estimation locale en dernier recours, jamais négative', () => {
    const cost = computeSessionCost({
      serverCostSum: 0,
      serverCostReports: 0,
      serverModelCalls: 0,
      balanceBefore: null,
      balanceAfter: null,
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      priceInPerMillion: 250,
      priceOutPerMillion: 1000,
    });
    expect(cost.fromServer).toBe(false);
    expect(cost.costFCFA).toBe(1250);
  });
});
