import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open, revealPath } from './shell';

/**
 * Le renderer n'ouvre plus de chemin lui-même : les URL passent par le plugin, les chemins
 * par la commande Rust qui contrôle les racines de projet. Ces tests figent le routage et
 * l'absence de la capacité large (`$HOME/**`).
 */
beforeEach(() => {
  vi.mocked(invoke).mockClear();
  vi.mocked(openUrl).mockClear();
});

describe('ouverture de liens et de chemins', () => {
  it('ouvre une URL par le plugin, sans passer par Rust', async () => {
    await open('https://getanzar.com');
    expect(openUrl).toHaveBeenCalledWith('https://getanzar.com');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('ouvre un mailto par le plugin', async () => {
    await open('mailto:abdul@issalanhub.com');
    expect(openUrl).toHaveBeenCalledWith('mailto:abdul@issalanhub.com');
  });

  it('révèle un chemin par la commande Rust, jamais par le plugin', async () => {
    await open('/Users/agahmadou/Desktop/projet/src/a.ts');
    expect(invoke).toHaveBeenCalledWith('reveal_path', { path: '/Users/agahmadou/Desktop/projet/src/a.ts' });
    expect(openUrl).not.toHaveBeenCalled();

    vi.mocked(invoke).mockClear();
    await revealPath('/Users/agahmadou/Desktop/projet');
    expect(invoke).toHaveBeenCalledWith('reveal_path', { path: '/Users/agahmadou/Desktop/projet' });
  });
});

describe('capacités Tauri', () => {
  const caps = JSON.parse(readFileSync('src-tauri/capabilities/migrated.json', 'utf8'));

  it('ne laisse plus le renderer ouvrir un chemin arbitraire', () => {
    const openerPath = caps.permissions.filter((p: any) => p?.identifier === 'opener:allow-open-path');
    expect(openerPath).toEqual([]);
  });

  it('garde les secrets du store hors de portée de la webview', () => {
    const scope = caps.permissions.find((p: any) => p?.identifier === 'fs:scope');
    expect(scope.deny).toEqual(expect.arrayContaining(['**/vault-key.dat']));
  });
});
