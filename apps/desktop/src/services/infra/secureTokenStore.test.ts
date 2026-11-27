import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { onKeychainWait, READ_WAIT_MS, secureTokenStore } from './secureTokenStore';

describe('coffre du jeton (trousseau)', () => {
  beforeEach(() => { vi.useFakeTimers(); invoke.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('attend la réponse à la fenêtre d’autorisation au lieu d’abandonner au bout de 5 s', async () => {
    let answer!: (v: string) => void;
    invoke.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const states: boolean[] = [];
    const off = onKeychainWait((w) => states.push(w));

    const pending = secureTokenStore.getToken();
    await vi.advanceTimersByTimeAsync(30_000); // l'utilisateur tape son mot de passe
    expect(states).toEqual([false, true]);
    answer('jeton-valide');
    await expect(pending).resolves.toBe('jeton-valide');
    expect(states).toEqual([false, true, false]);
    off();
  });

  it('une lecture rapide ne signale aucune attente', async () => {
    invoke.mockResolvedValue('jeton');
    const states: boolean[] = [];
    const off = onKeychainWait((w) => states.push(w));
    await expect(secureTokenStore.getToken()).resolves.toBe('jeton');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(states).toEqual([false]);
    off();
  });

  it('abandonne seulement après le délai maximal, sans bloquer le démarrage', async () => {
    invoke.mockResolvedValueOnce(undefined); // déconnexion : oublie le jeton des tests précédents
    await secureTokenStore.clearToken();
    invoke.mockImplementation(() => new Promise(() => undefined));
    const pending = secureTokenStore.getToken();
    await vi.advanceTimersByTimeAsync(READ_WAIT_MS + 10);
    await expect(pending).resolves.toBeNull();
  });
});
