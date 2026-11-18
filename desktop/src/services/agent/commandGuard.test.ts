import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/filesystem/fileSystem', () => ({
  fileSystemService: { readFile: vi.fn().mockRejectedValue(new Error('absent')) },
}));

import { commandRisk } from './commandGuard';
import { precheckCommand } from './agentTools';

describe('command policy P0', () => {
  it('refuse npx dans les commandes agent', () => {
    const refusal = precheckCommand('npx -c "node --eval 1"');
    expect(refusal).toMatch(/npx|autoris/i);
    expect(precheckCommand('npm run build')).toBeNull();
    expect(precheckCommand('node script.mjs')).toBeNull();
  });

  it('ne déclare plus npx dans les capacités shell Tauri', () => {
    const caps = JSON.parse(readFileSync('src-tauri/capabilities/migrated.json', 'utf8'));
    const commands = caps.permissions
      .filter((p: any) => p?.identifier === 'shell:allow-execute' || p?.identifier === 'shell:allow-spawn')
      .flatMap((p: any) => p.allow || [])
      .map((a: any) => a.cmd);
    expect(commands).not.toContain('npx');
  });

  it('classe npm install, pip install et git push comme risqués', async () => {
    await expect(commandRisk('t', '/p', 'npm install')).resolves.toMatchObject({ reason: expect.stringMatching(/installe/) });
    await expect(commandRisk('t', '/p', 'pip install package')).resolves.toMatchObject({ reason: expect.stringMatching(/paquet/) });
    await expect(commandRisk('t', '/p', 'git push')).resolves.toMatchObject({ reason: expect.stringMatching(/dépôt distant/) });
    await expect(commandRisk('t', '/p', 'git remote add origin https://example.com/x.git')).resolves.toMatchObject({ reason: expect.stringMatching(/dépôt distant/) });
  });

  it('laisse npm run build sans risque spécifique', async () => {
    await expect(commandRisk('t', '/p', 'npm run build')).resolves.toBeNull();
  });
});
