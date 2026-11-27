import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/filesystem/fileSystem', () => ({
  fileSystemService: { exists: vi.fn(async () => false), readDirectoryTree: vi.fn(async () => []), readFile: vi.fn() },
}));
vi.mock('@/lib/fileStore', () => ({
  ensureDir: vi.fn(), removeDirEntry: vi.fn(), storeRoot: vi.fn(async () => null), writeText: vi.fn(),
}));
vi.mock('@tauri-apps/api/path', () => ({ homeDir: vi.fn(async () => '/home/test') }));
vi.mock('@/services/skills/remote', () => ({
  getRemoteSkills: vi.fn(async () => [{
    name: 'diagrammes',
    description: 'Dessiner un diagramme',
    markdown: '---\nname: diagrammes\ndescription: Dessiner un diagramme\n---\nCorps',
    files: { 'references/organigramme.md': '# Organigramme', LICENSE: 'MIT' },
  }]),
}));

import { listSkills, readSkillFile, skillToolOutput } from './index';

describe('fichiers joints des skills servies par le serveur', () => {
  it('liste et lit les fichiers sans dossier sur le disque', async () => {
    const skill = (await listSkills(null)).find((s) => s.name === 'diagrammes')!;
    expect(skill.files).toEqual(['LICENSE', 'references/organigramme.md']);
    expect(await readSkillFile(skill, 'references/organigramme.md')).toBe('# Organigramme');
    expect(skillToolOutput(skill, '« ')).toContain('file="<chemin>"');
  });

  it('refuse un fichier absent ou un chemin qui sort de la skill', async () => {
    const skill = (await listSkills(null)).find((s) => s.name === 'diagrammes')!;
    await expect(readSkillFile(skill, 'references/absent.md')).rejects.toThrow('fichier absent');
    await expect(readSkillFile(skill, '../secret.md')).rejects.toThrow('chemin invalide');
  });
});
