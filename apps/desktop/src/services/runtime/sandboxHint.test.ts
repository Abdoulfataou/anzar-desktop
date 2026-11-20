import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings: { sandboxCommands?: boolean } = {};
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings }) } }));

import { sandboxEnabled, withSandboxHint } from './terminal';

describe('isolation des commandes', () => {
  beforeEach(() => { delete settings.sandboxCommands; });

  it('est activée par défaut', () => {
    expect(sandboxEnabled()).toBe(true);
    settings.sandboxCommands = false;
    expect(sandboxEnabled()).toBe(false);
  });

  it('explique un refus d’écriture hors du projet', () => {
    const out = withSandboxHint(1, "EPERM: operation not permitted, open '/Users/a/Documents/x'");
    expect(out).toContain("[ANZAR] Bloqué par l'isolation des commandes");
  });

  it('ne touche pas une erreur ordinaire ni un succès', () => {
    expect(withSandboxHint(1, 'SyntaxError: Unexpected token')).toBe('SyntaxError: Unexpected token');
    expect(withSandboxHint(0, 'operation not permitted')).toBe('operation not permitted');
  });

  it("n'ajoute rien quand l'isolation est coupée", () => {
    settings.sandboxCommands = false;
    expect(withSandboxHint(1, 'Operation not permitted')).toBe('Operation not permitted');
  });
});
