import { describe, expect, it } from 'vitest';
import { escalate, looksLikeCreation, routeRequest } from './autoRouter';

describe('autoRouter', () => {
  it('question courte sans projet → fast', () => {
    expect(routeRequest({ text: 'Bonjour, comment vas-tu ?', workspace: false }).mode).toBe('fast');
  });

  it('projet ouvert → au moins thinking', () => {
    expect(routeRequest({ text: 'Ajoute un champ email au formulaire de contact', workspace: true }).mode).toBe('thinking');
  });

  it('demande de création → jamais fast', () => {
    const route = routeRequest({ text: 'Fais-moi une pub vidéo pour une boutique', workspace: true });
    expect(route.mode).not.toBe('fast');
  });

  it('tâche difficile → max ou pro', () => {
    const route = routeRequest({
      text: 'Conçois une architecture de paiement sécurisée avec webhook, idempotence, base de données et authentification',
      workspace: true,
    });
    expect(['max', 'pro']).toContain(route.mode);
  });

  it('mode plan force au moins thinking', () => {
    expect(routeRequest({ text: 'Explique ce fichier', workspace: true, planMode: true }).mode).toBe('thinking');
  });

  it('une suite courte garde le réglage précédent', () => {
    expect(routeRequest({ text: 'continue', workspace: true, previous: 'max' }).mode).toBe('max');
  });

  it('escalade fast → thinking → max → pro puis s’arrête', () => {
    expect(escalate({ mode: 'fast', reason: 'x' }, 'échec')?.mode).toBe('thinking');
    expect(escalate({ mode: 'thinking', reason: 'x' }, 'échec')?.mode).toBe('max');
    expect(escalate({ mode: 'max', reason: 'x' }, 'échec')?.mode).toBe('pro');
    expect(escalate({ mode: 'pro', reason: 'x' }, 'échec')).toBeNull();
  });

  it('détecte une demande de création', () => {
    expect(looksLikeCreation('fais-moi une affiche pour le lancement')).toBe(true);
    expect(looksLikeCreation('corrige ce bug TypeScript')).toBe(false);
  });
});
