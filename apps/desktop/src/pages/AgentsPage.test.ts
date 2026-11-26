import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';

const listCustomAgents = vi.fn(async () => [] as any[]);
const savePersonalAgent = vi.fn(async () => undefined);
vi.mock('@/services/agent/profiles/custom', () => ({
  listCustomAgents: (...a: unknown[]) => listCustomAgents(...(a as [])),
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
  beforeEach(() => { listCustomAgents.mockClear(); savePersonalAgent.mockClear(); });

  it('montre les rôles intégrés et les agents du projet', async () => {
    listCustomAgents.mockResolvedValueOnce([{
      name: 'expert-flutter', description: 'Expert Flutter', kind: 'subagent', tools: [], maxSteps: 25, skills: [], keywords: [],
      deny: [], prompt: 'Riverpod.', source: 'project', origin: '.anzar/agents', path: '/p/.anzar/agents/expert-flutter.md',
      editable: false, overridesBuiltin: false, warnings: ['outils ignorés (sans équivalent dans ANZAR) : WebFetch'],
    }]);
    render(createElement(AgentsPage));
    await waitFor(() => expect(screen.getByText('expert-flutter')).toBeTruthy());
    for (const role of ['dev', 'revue', 'redaction', 'motion-designer']) expect(screen.getByText(role)).toBeTruthy();
    expect(screen.getByText('à vérifier')).toBeTruthy();
    expect(listCustomAgents).toHaveBeenCalledWith('/p');
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
