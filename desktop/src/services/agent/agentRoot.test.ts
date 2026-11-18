import { describe, expect, it, vi } from 'vitest';
import { resolveAgentRoot } from './agentRoot';

const base = {
  workspacePath: null,
  background: false,
  conversationId: 'conv',
  content: 'Explique ce code',
  attachments: [],
  personalConversations: new Set<string>(),
  conversationPersonalSpace: false,
  ensurePersonalSpace: vi.fn().mockResolvedValue('/tmp/anzar'),
};

describe('resolveAgentRoot', () => {
  it('utilise le projet ouvert', async () => {
    const result = await resolveAgentRoot({ ...base, workspacePath: '/tmp/projet' });
    expect(result).toEqual({ agentRoot: '/tmp/projet', personalSpace: false, creationRequest: false });
  });

  it('ne touche à rien en arrière-plan sans projet', async () => {
    const result = await resolveAgentRoot({ ...base, background: true, content: 'fais une pub' });
    expect(result.agentRoot).toBeNull();
    expect(base.ensurePersonalSpace).not.toHaveBeenCalled();
  });

  it('ouvre l’espace ANZAR pour une création', async () => {
    const result = await resolveAgentRoot({ ...base, content: 'fais-moi une affiche pour le lancement' });
    expect(result.personalSpace).toBe(true);
    expect(result.agentRoot).toBe('/tmp/anzar');
  });

  it('ouvre l’espace pour un fichier joint ou une conversation qui l’utilisait', async () => {
    const fromAttachment = await resolveAgentRoot({
      ...base,
      attachments: [{ sourcePath: '/tmp/f.pdf' } as any],
    });
    expect(fromAttachment.personalSpace).toBe(true);

    const fromConversation = await resolveAgentRoot({ ...base, conversationPersonalSpace: true });
    expect(fromConversation.personalSpace).toBe(true);

    const fromSession = await resolveAgentRoot({ ...base, personalConversations: new Set(['conv']) });
    expect(fromSession.personalSpace).toBe(true);
  });

  it('reste sans dossier si rien ne l’exige', async () => {
    const result = await resolveAgentRoot(base);
    expect(result.agentRoot).toBeNull();
    expect(result.personalSpace).toBe(false);
  });

  it('tolère un échec d’ouverture', async () => {
    const result = await resolveAgentRoot({
      ...base,
      content: 'fais-moi une affiche',
      ensurePersonalSpace: vi.fn().mockRejectedValue(new Error('refus')),
    });
    expect(result.agentRoot).toBeNull();
    expect(result.personalSpace).toBe(false);
  });
});
