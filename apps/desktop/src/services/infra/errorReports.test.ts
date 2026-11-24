import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings: { errorReports?: boolean } = {};
let token: string | null = 'jeton';
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ settings, getAuthToken: () => token, getBackendUrl: () => 'https://api.test' }),
  },
}));

import {
  __resetErrorReports, commandTitle, flushErrorReports, isEnvironmentFailure, reportError, scrubReport,
} from './errorReports';

const fetchMock = vi.fn(async () => ({ ok: true }) as Response);

describe('rapports d’erreurs', () => {
  beforeEach(() => {
    __resetErrorReports();
    delete settings.errorReports;
    token = 'jeton';
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('nettoie chemins personnels, clés et e-mails', () => {
    const out = scrubReport('/Users/abdoul/Desktop/app ag@yahoo.com sk-proj-ABCDEFGHIJKLMNOP token=xyz123 C:\\Users\\Abdoul\\x');
    for (const leak of ['abdoul', 'Abdoul', 'ag@yahoo.com', 'ABCDEFGHIJKLMNOP', 'xyz123']) expect(out).not.toContain(leak);
    expect(out).toContain('~/Desktop/app');
  });

  it('ne garde que les échecs qui peuvent venir d’ANZAR', () => {
    expect(isEnvironmentFailure('Got socket error trying to find package x at https://pub.dev.', 69)).toBe(true);
    expect(isEnvironmentFailure('« python » est introuvable sur cet ordinateur.')).toBe(true);
    expect(isEnvironmentFailure('[ANZAR] Relais réseau ignoré : …', 1)).toBe(true);
    expect(isEnvironmentFailure("src/app.ts(3,1): error TS2304: Cannot find name 'x'.", 2)).toBe(false);
    expect(isEnvironmentFailure('1 failing test', 1)).toBe(false);
  });

  it('titre sans arguments ni chemins', () => {
    expect(commandTitle('flutter pub get', 69)).toBe('flutter pub get → code 69');
    expect(commandTitle('python3 /Users/a/secret/x.py --token abc', 1)).toBe('python3 → code 1');
    expect(commandTitle('npm install lodash', 1)).toBe('npm install lodash → code 1');
    expect(commandTitle('git clone https://x.y/z', 128)).toBe('git clone → code 128');
  });

  it('envoie par lot, une fois par problème et par session', async () => {
    reportError({ kind: 'command', title: 'flutter pub get → code 69', detail: 'Got socket error … /Users/abdoul/x' });
    reportError({ kind: 'command', title: 'flutter pub get → code 69', detail: 'Got socket error … /Users/abdoul/x' });
    await flushErrorReports();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/telemetry/errors');
    const body = JSON.parse(String(init.body));
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].detail).not.toContain('abdoul');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jeton');
  });

  it('n’envoie rien si le réglage est coupé, garde la file sans connexion', async () => {
    settings.errorReports = false;
    reportError({ kind: 'crash', title: 'Interface : TypeError : x' });
    await flushErrorReports();
    expect(fetchMock).not.toHaveBeenCalled();

    delete settings.errorReports;
    token = null;
    reportError({ kind: 'crash', title: 'Interface : TypeError : y' });
    await flushErrorReports();
    expect(fetchMock).not.toHaveBeenCalled();
    token = 'jeton';
    await flushErrorReports();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
