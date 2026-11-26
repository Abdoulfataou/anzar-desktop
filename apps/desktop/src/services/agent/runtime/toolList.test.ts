import { describe, expect, it, vi } from 'vitest';

// Seul module non pur de la composition : la liste des outils de l'espace ANZAR.
vi.mock('@/services/workspace/personalSpace', () => ({
  PERSONAL_SPACE_TOOLS: new Set(['read_file', 'write_file']),
}));

import { buildToolsForStep, type ToolListInput } from './toolList';

const base: ToolListInput = {
  mode: 'auto',
  workspacePath: '/tmp/projet',
  webEnabled: false,
  background: false,
  personalSpace: false,
  hasSkills: false,
  mcpTools: [],
};

const names = (tools: ReturnType<typeof buildToolsForStep>) => (tools || []).map((t) => t.function.name);

describe('buildToolsForStep', () => {
  it('donne tous les outils de l’agent hors mode plan', () => {
    const list = names(buildToolsForStep(base));
    expect(list).toContain('write_file');
    expect(list).toContain('spawn_agent');
    expect(list).toContain('wait_agent');
    expect(list).toContain('list_agents');
    // Selon la plateforme : shell confiné (macOS) ou run_command (Windows).
    expect(list.some((n) => n === 'bash' || n === 'run_command')).toBe(true);
    expect(list).toContain('ask_user');
    expect(list).not.toContain('propose_plan');
  });

  it('propose le shell confiné et les travaux sur macOS', () => {
    const original = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    try {
      const list = names(buildToolsForStep(base));
      expect(list).toContain('bash');
      expect(list).toContain('job_output');
      expect(list).toContain('job_kill');
      // Le shell remplace run_command sur macOS : une seule façon de lancer une commande.
      expect(list).not.toContain('run_command');
      expect(names(buildToolsForStep({ ...base, mode: 'plan' }))).toContain('bash');
    } finally {
      Object.defineProperty(navigator, 'platform', { value: original, configurable: true });
    }
  });

  it('Windows : run_command seul, jamais bash absent', () => {
    const platform = navigator.platform;
    const ua = navigator.userAgent;
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', configurable: true });
    try {
      const list = names(buildToolsForStep(base));
      expect(list).toContain('run_command');
      expect(list).not.toContain('bash');
    } finally {
      Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
      Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
    }
  });

  it('le mode plan guide mais ne retire aucun outil', () => {
    const list = names(buildToolsForStep({ ...base, mode: 'plan' }));
    expect(list).toContain('read_file');
    expect(list).toContain('propose_plan');
    expect(list).toContain('write_file');
    expect(list.some((n) => n === 'bash' || n === 'run_command')).toBe(true);
    expect(list).toContain('spawn_agent');
    expect(list).toContain('apply_patch');
  });

  it('ne propose pas ask_user quand personne n’est devant l’écran', () => {
    expect(names(buildToolsForStep({ ...base, background: true }))).not.toContain('ask_user');
  });

  it('ajoute load_skill seulement quand des skills existent', () => {
    expect(names(buildToolsForStep(base))).not.toContain('load_skill');
    expect(names(buildToolsForStep({ ...base, hasSkills: true }))).toContain('load_skill');
  });

  it('restreint l’espace ANZAR aux outils autorisés', () => {
    const list = names(buildToolsForStep({ ...base, workspacePath: null, personalSpace: true }));
    expect(list).toEqual(['read_file', 'write_file', 'ask_user']);
    expect(list).not.toContain('run_command');
  });

  it('ne garde que la question et la recherche web sans projet ni espace ANZAR', () => {
    expect(names(buildToolsForStep({ ...base, workspacePath: null }))).toEqual(['ask_user']);
    expect(names(buildToolsForStep({ ...base, workspacePath: null, webEnabled: true }))).toContain('web_search');
  });

  it('n’expose aucun outil quand personne ne peut répondre et qu’il n’y a pas de projet', () => {
    expect(buildToolsForStep({ ...base, workspacePath: null, background: true })).toBeUndefined();
  });

  it('ajoute les outils des connecteurs hors mode plan', () => {
    const mcp = [{ type: 'function' as const, function: { name: 'mcp__github__issue', description: '', parameters: {} } }];
    expect(names(buildToolsForStep({ ...base, mcpTools: mcp }))).toContain('mcp__github__issue');
    expect(names(buildToolsForStep({ ...base, mode: 'plan', mcpTools: mcp }))).toContain('mcp__github__issue');
  });
});
