import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/filesystem/fileSystem', () => ({
  fileSystemService: { readFile: vi.fn().mockRejectedValue(new Error('absent')) },
}));

import { commandRisk, noteAgentWrite } from './commandGuard';
import { AGENT_TOOLS, isProtectedWritePath, precheckCommand } from './agentTools';

describe('command policy P0', () => {
  it('refuse npx dans les commandes agent', () => {
    const refusal = precheckCommand('npx -c "node --eval 1"');
    expect(refusal).toMatch(/npx|autoris/i);
    expect(precheckCommand('npm run build')).toBeNull();
    expect(precheckCommand('node script.mjs')).toBeNull();
  });

  it('garde une description cohérente de export_animation', () => {
    const description = AGENT_TOOLS.find((tool) => tool.function.name === 'export_animation')?.function.description || '';
    expect(description).toContain('horloge virtuelle');
    expect(description).toContain("RÈGLE ABSOLUE : l'export est la DERNIÈRE étape");
    expect(description).not.toContain('horloge  RÈGLE');
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

  it('classe les configurations Git et hooks comme risquées', async () => {
    await expect(commandRisk('git1', '/p', 'git config core.fsmonitor ./hook.sh')).resolves.toMatchObject({ reason: expect.stringMatching(/configuration Git/) });
    await expect(commandRisk('git2', '/p', 'git -c core.hooksPath=.git/hooks commit -m x')).resolves.toMatchObject({ reason: expect.stringMatching(/configuration Git/) });
    await noteAgentWrite('git3', '/p', '.git/hooks/pre-commit');
    await expect(commandRisk('git3', '/p', 'git commit -m x')).resolves.toMatchObject({ reason: expect.stringMatching(/hook écrit par l'agent/) });
  });

  it('normalise les chemins avant de rapprocher un script écrit', async () => {
    await noteAgentWrite('paths1', '/p', 'evil.mjs');
    await expect(commandRisk('paths1', '/p', 'node ./a/../evil.mjs')).resolves.toMatchObject({ reason: expect.stringMatching(/écrit par l'agent/) });
    await noteAgentWrite('paths2', '/p', 'a/evil.mjs');
    await expect(commandRisk('paths2', '/p', 'node a//evil.mjs')).resolves.toMatchObject({ reason: expect.stringMatching(/écrit par l'agent/) });
  });

  it('rapproche python -m du module écrit', async () => {
    await noteAgentWrite('py1', '/p', 'evil.py');
    await expect(commandRisk('py1', '/p', 'python -m evil')).resolves.toMatchObject({ reason: expect.stringMatching(/module evil/) });
  });

  it('bloque les écritures dans .git et .husky', () => {
    expect(isProtectedWritePath('.git/hooks/pre-commit')).toBe(true);
    expect(isProtectedWritePath('sub/.husky/pre-commit')).toBe(true);
    expect(isProtectedWritePath('src/index.ts')).toBe(false);
  });

  it('laisse npm run build sans risque spécifique', async () => {
    await expect(commandRisk('t', '/p', 'npm run build')).resolves.toBeNull();
  });
});
