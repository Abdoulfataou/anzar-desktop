import { describe, expect, it } from 'vitest';
import type { APIMessage } from '@/types';
import { CAPTURE_MARK, setupNewTurn } from './sessionSetup';
import type { SessionPromptBundle } from '../context/systemPrompt';

const prompt = (refresh = ''): SessionPromptBundle => ({
  system: { role: 'system', content: `SYSTEM${refresh}` },
  systemHead: 'SYSTEM',
  systemRefresh: refresh,
  turnContext: '',
});

const input = (apiHistory: APIMessage[], overrides: Record<string, unknown> = {}) => ({
  apiHistory,
  lastCallAt: Date.now(),
  apiContent: 'Demande',
  attachments: [],
  priorMessages: [],
  userMsgId: 'u1',
  assistantId: 'a1',
  prompt: prompt(),
  ...overrides,
});

describe('setupNewTurn', () => {
  it('installe le prompt système puis la demande quand l’historique est vide', () => {
    const history: APIMessage[] = [];
    setupNewTurn(input(history) as any);
    expect(history[0]).toEqual({ role: 'system', content: 'SYSTEM' });
    expect(history.at(-1)).toEqual({ role: 'user', content: 'Demande' });
  });

  it('garde le prompt d’origine quand le projet n’a pas changé (cache fournisseur)', () => {
    const history: APIMessage[] = [{ role: 'system', content: 'SYSTEM' }, { role: 'user', content: 'avant' }];
    setupNewTurn(input(history, { prompt: prompt('MÉMOIRE À JOUR') }) as any);
    // Le message système n'est pas réécrit : le préfixe reste servi par le cache.
    expect(history[0]).toEqual({ role: 'system', content: 'SYSTEM' });
    expect(String(history.at(-1)?.content)).toContain('Contexte mis à jour');
    expect(String(history.at(-1)?.content)).toContain('MÉMOIRE À JOUR');
  });

  it('remplace le prompt quand le projet change', () => {
    const history: APIMessage[] = [{ role: 'system', content: 'AUTRE PROJET' }];
    setupNewTurn(input(history) as any);
    expect(history[0]).toEqual({ role: 'system', content: 'SYSTEM' });
  });

  it('rappelle la règle sur le contenu externe aux conversations anciennes', () => {
    const history: APIMessage[] = [{ role: 'system', content: 'SYSTEM' }];
    setupNewTurn(input(history) as any);
    expect(String(history.at(-1)?.content)).toContain('Contenu externe');
  });

  it('remplace les images déjà analysées par un marqueur', () => {
    const history: APIMessage[] = [
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: [{ type: 'text', text: 'regarde' }, { type: 'image_url', image_url: { url: 'data:x' } }] },
    ];
    setupNewTurn(input(history) as any);
    expect(String(history[1].content)).toContain('déjà analysée');
  });

  it('conserve le marqueur des captures de capture_page', () => {
    const history: APIMessage[] = [
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: [{ type: 'text', text: `${CAPTURE_MARK} 1. desktop` }, { type: 'image_url', image_url: { url: 'data:x' } }] },
    ];
    setupNewTurn(input(history) as any);
    expect(String(history[1].content)).toContain("capture d'écran prise par capture_page");
  });

  it('retire le raisonnement des tours précédents (payé à chaque appel sinon)', () => {
    const history: APIMessage[] = [
      { role: 'system', content: 'SYSTEM' },
      { role: 'assistant', content: 'ok', reasoning_content: 'long raisonnement' },
    ];
    setupNewTurn(input(history) as any);
    expect(history[1].reasoning_content).toBeUndefined();
  });

  it('reprend les échanges texte d’une conversation existante', () => {
    const history: APIMessage[] = [];
    setupNewTurn(input(history, {
      priorMessages: [
        { id: 'm1', role: 'user', content: 'premier', timestamp: 1 },
        { id: 'u1', role: 'user', content: 'courant', timestamp: 2 },
        { id: 'a1', role: 'assistant', content: '', timestamp: 3 },
      ],
    }) as any);
    expect(history).toContainEqual({ role: 'user', content: 'premier' });
    expect(history.find((m) => m.content === 'courant')).toBeUndefined();
  });
});
