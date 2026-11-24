import { describe, expect, it } from 'vitest';
import { buildSessionSystemPrompt, PLAN_MODE_PROMPT } from './systemPrompt';

const base = {
  workspacePath: null,
  workspaceName: undefined,
  freshHistory: true,
  planMode: false,
  webEnabled: false,
  personal: 'Instructions personnelles',
  skillsSection: '',
  platform: 'macos',
  permissionMode: 'auto' as const,
};

describe('buildSessionSystemPrompt', () => {
  it('construit le prompt sans projet et garde la partie personnelle à part', () => {
    const bundle = buildSessionSystemPrompt(base);
    expect(bundle.system.role).toBe('system');
    expect(String(bundle.system.content)).toContain('AUCUN PROJET');
    expect(String(bundle.system.content)).toContain('Instructions personnelles');
    expect(bundle.systemHead.endsWith('Instructions personnelles')).toBe(false);
    expect(bundle.systemRefresh).toBe('Instructions personnelles');
    // Les faits d'environnement vivent dans la demande du tour, jamais dans le prompt système.
    expect(bundle.turnContext).toContain("État de l'environnement");
    expect(bundle.turnContext).toContain('Permissions');
    expect(String(bundle.system.content)).not.toContain("État de l'environnement");
  });

  it('ajoute la recherche web quand elle est activée', () => {
    const bundle = buildSessionSystemPrompt({ ...base, webEnabled: true });
    expect(String(bundle.system.content)).toContain('chercher sur le web');
  });

  it('construit le prompt projet avec skills et mémoire', () => {
    const bundle = buildSessionSystemPrompt({
      ...base,
      workspacePath: '/tmp/projet',
      workspaceName: 'Projet',
      skillsSection: '\n\n# Skills\n- deploy',
      memory: 'Convention : tests avant commit',
      personal: '',
    });
    expect(String(bundle.system.content)).toContain('deploy');
    expect(bundle.systemRefresh).toContain('Convention');
    expect(bundle.systemRefresh).toContain('deploy');
  });

  it('place la carte du code et les indices dans le message, pas dans le prompt', () => {
    const bundle = buildSessionSystemPrompt({
      ...base,
      workspacePath: '/tmp/projet',
      freshHistory: true,
      codeMap: 'src/app.ts',
      taskHints: 'src/app.ts',
    });
    expect(bundle.turnContext).toContain('Carte du code');
    expect(bundle.turnContext).toContain('Fichiers probablement pertinents');
    expect(String(bundle.system.content)).not.toContain('Carte du code');
  });

  it('n’envoie la carte du code qu’une fois et ajoute le mode plan', () => {
    const bundle = buildSessionSystemPrompt({
      ...base,
      workspacePath: '/tmp/projet',
      freshHistory: false,
      codeMap: 'src/app.ts',
      planMode: true,
    });
    expect(bundle.turnContext).not.toContain('Carte du code');
    expect(bundle.turnContext).toContain(PLAN_MODE_PROMPT.trim());
  });

  it('ajoute le contexte de l’espace ANZAR', () => {
    const bundle = buildSessionSystemPrompt({ ...base, personalSpaceContext: '\n\n# Espace ANZAR' });
    expect(bundle.turnContext).toContain('Espace ANZAR');
  });
});
