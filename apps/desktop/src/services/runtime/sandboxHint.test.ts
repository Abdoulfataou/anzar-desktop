import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings: { sandboxCommands?: boolean; commandNetwork?: boolean } = {};
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings }) } }));

import { NETWORK_BLOCKED_TAG, NETWORK_BYPASS_TAG, sandboxEnabled, withSandboxHint } from './terminal';

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
    expect(out).toContain('sandbox_permissions:"danger-full-access"');
  });

  it('ne touche pas une erreur ordinaire ni un succès', () => {
    expect(withSandboxHint(1, 'SyntaxError: Unexpected token')).toBe('SyntaxError: Unexpected token');
    expect(withSandboxHint(0, 'operation not permitted')).toBe('operation not permitted');
  });

  it("n'ajoute rien quand l'isolation est coupée", () => {
    settings.sandboxCommands = false;
    expect(withSandboxHint(1, 'Operation not permitted')).toBe('Operation not permitted');
  });

  it('réseau ouvert par défaut ; explique une connexion coupée si l’utilisateur l’a coupé', () => {
    const err = 'Error: getaddrinfo ENOTFOUND api.example.com';
    expect(withSandboxHint(1, err)).toBe(err); // ouvert par défaut
    settings.commandNetwork = false;
    expect(withSandboxHint(1, err)).toContain('Réseau coupé');
  });

  it('reconnaît une coupure réseau de Dart/Flutter', () => {
    const dart = 'Got socket error trying to find package flutter_lints at https://pub.dev.';
    settings.commandNetwork = false;
    expect(withSandboxHint(69, dart)).toContain(NETWORK_BLOCKED_TAG);
  });

  it('laisse le diagnostic du relais tel quel (traité automatiquement)', () => {
    const out = `SocketException: Connection failed (OS Error: Operation not permitted)\n${NETWORK_BYPASS_TAG} : …`;
    expect(withSandboxHint(69, out)).toBe(out);
  });

  it('explique la protection Git sans inviter à la contourner', () => {
    const out = withSandboxHint(128, "error: could not lock config file .git/config: Operation not permitted");
    expect(out).toContain('Ne contourne pas');
    expect(out).toContain('git init');
  });
});
