import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';

const scanCustomAgents = vi.fn(async () => ({ agents: [] as any[], ignored: [] as any[] }));
const savePersonalAgent = vi.fn(async () => undefined);
vi.mock('@/services/agent/profiles/custom', () => ({
  scanCustomAgents: (...a: unknown[]) => scanCustomAgents(...(a as [])),
  savePersonalAgent: (...a: unknown[]) => savePersonalAgent(...(a as [])),
  deletePersonalAgent: vi.fn(),
}));
vi.mock('@/services/skills', () => ({
  listSkills: async () => [{ name: 'tdd', description: 'Tests d’abord', body: '', source: 'builtin', origin: 'ANZAR', files: [], editable: false }],
  slugifySkillName: (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
}));
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: (sel: (s: any) => unknown) => sel({ projects: [{ id: 'p1', name: 'Boutique', metadata: { localPath: '/p' } }], activeProjectId: 'p1' }),
}));
vi.mock('react-hot-toast', () => {
  const t: any = vi.fn(); t.success = vi.fn(); t.error = vi.fn();
  return { default: t };
});

import AgentsPage from './AgentsPage';

describe('page Agents', () => {
  beforeEach(() => { scanCustomAgents.mockClear(); savePersonalAgent.mockClear(); });

  it('montre les rôles intégrés et les agents du projet', async () => {
    scanCustomAgents.mockResolvedValueOnce({ ignored: [], agents: [{
      name: 'expert-flutter', description: 'Expert Flutter', kind: 'subagent', tools: [], maxSteps: 25, skills: [], keywords: [],
      deny: [], prompt: 'Riverpod.', source: 'project', origin: '.anzar/agents', path: '/p/.anzar/agents/expert-flutter.md',
      editable: false, overridesBuiltin: false, warnings: ['outils ignorés (sans équivalent dans ANZAR) : WebFetch'],
    }] });
    render(createElement(AgentsPage));
    await waitFor(() => expect(screen.getByText('expert-flutter')).toBeTruthy());
    for (const role of ['dev', 'revue', 'redaction', 'motion-designer']) expect(screen.getByText(role)).toBeTruthy();
    expect(screen.getByText('à vérifier')).toBeTruthy();
    expect(scanCustomAgents).toHaveBeenCalledWith('/p');
    expect(screen.queryByText(/ignoré/)).toBeNull();
  });

  it('explique les fichiers ignorés et masqués', async () => {
    scanCustomAgents.mockResolvedValueOnce({ agents: [], ignored: [
      { name: 'vieux', reason: "description manquante : ajoute description: dans l'en-tête", kind: 'invalid', source: 'project', origin: '.claude/agents', path: '/p/.claude/agents/vieux.md', editable: false },
      { name: 'testeur', reason: "masqué par l'agent du même nom dans .anzar/agents, prioritaire", kind: 'shadowed', source: 'personal', origin: 'ANZAR', path: '/data/agents/testeur.md', editable: true },
    ] });
    render(createElement(AgentsPage));
    expect(await screen.findByText("1 fichier d'agent ignoré")).toBeTruthy();
    expect(screen.getByText(/description manquante/)).toBeTruthy();
    expect(screen.getByText(/masqué par l'agent du même nom/)).toBeTruthy();
    expect(screen.getByText('/p/.claude/agents/vieux.md')).toBeTruthy();
    // Un fichier masqué n'est pas cassé : pas de bouton de suppression
    expect(screen.queryByTitle('Supprimer le fichier')).toBeNull();
  });

  it('crée un agent personnel depuis le formulaire', async () => {
    render(createElement(AgentsPage));
    fireEvent.click(await screen.findByText('Nouvel agent'));
    fireEvent.change(screen.getByPlaceholderText('expert-flutter'), { target: { value: 'Testeur API' } });
    fireEvent.change(screen.getByPlaceholderText(/Expert Flutter :/), { target: { value: 'Écrit les tests d’intégration de l’API' } });
    fireEvent.click(screen.getByLabelText('Peut lancer des commandes'));
    fireEvent.click(await screen.findByText('tdd'));
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(savePersonalAgent).toHaveBeenCalled());
    const [draft] = savePersonalAgent.mock.calls[0] as any[];
    expect(draft.name).toBe('testeur-api');
    expect(draft.deny).toEqual(['shell.exec']);
    expect(draft.skills).toEqual(['tdd']);
  });

  it('copier un rôle intégré garde ses réglages cachés (budget, réseau)', async () => {
    render(createElement(AgentsPage));
    await screen.findByText('redaction');
    const row = screen.getByText('redaction').closest('div.group') as HTMLElement;
    fireEvent.click(row.querySelector('button[title^="Personnaliser"]')!);
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(savePersonalAgent).toHaveBeenCalled());
    const [draft] = savePersonalAgent.mock.calls[0] as any[];
    expect(draft.name).toBe('redaction');
    expect(draft.deny).toEqual(['shell.exec', 'network']);
    expect(draft.budgetFCFA).toBe(30);
    expect(draft.outputMaxChars).toBe(1200);
  });
});
