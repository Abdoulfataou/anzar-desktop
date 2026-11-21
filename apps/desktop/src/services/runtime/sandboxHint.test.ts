import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings: { sandboxCommands?: boolean; commandNetwork?: boolean } = {};
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings }) } }));

import { sandboxEnabled, withSandboxHint } from './terminal';

describe('isolation des commandes', () => {
  beforeEach(() => { delete settings.sandboxCommands; delete settings.commandNetwork; });

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

  it('explique une connexion coupée, sauf si le réseau est ouvert', () => {
    const err = 'Error: getaddrinfo ENOTFOUND api.example.com';
    expect(withSandboxHint(1, err)).toContain('Réseau coupé');
    settings.commandNetwork = true;
    expect(withSandboxHint(1, err)).toBe(err);
  });
});
