/**
 * Le prompt ne décrit que le shell réellement proposé : bash sur macOS, powershell sous
 * Windows. Décrire bash sous Windows ferait écrire au modèle des « && » qui échouent.
 */
import { describe, expect, it } from 'vitest';
import { buildSessionSystemPrompt } from './systemPrompt';

const base = {
  workspacePath: '/Users/a/projet',
  workspaceName: 'projet',
  freshHistory: true,
  planMode: false,
  webEnabled: false,
  personal: '',
  skillsSection: '',
  permissionMode: 'ask' as const,
};

describe('shell décrit au modèle', () => {
  it('Windows : powershell, ni bash ni run_command', () => {
    const b = buildSessionSystemPrompt({ ...base, platform: 'windows', shellAvailable: true, shell: 'powershell', sandboxed: true });
    const system = String(b.system.content);
    expect(system).toContain('- powershell : le shell de Windows');
    expect(system).toContain('$LASTEXITCODE');
    expect(system).not.toContain('- bash :');
    expect(system).not.toContain('- run_command :');
    expect(b.turnContext).toContain('Commandes : powershell disponible');
    expect(b.turnContext).toContain('Isolation : indisponible sous Windows');
  });

  it('macOS : bash confiné, comme avant', () => {
    const b = buildSessionSystemPrompt({ ...base, platform: 'macos', shellAvailable: true, shell: 'bash', sandboxed: true });
    const system = String(b.system.content);
    expect(system).toContain('- bash : un vrai shell confiné');
    expect(system).not.toContain('- powershell :');
    expect(b.turnContext).toContain('Commandes : bash confiné disponible');
  });

  it('sans shell (Linux) : run_command seul', () => {
    const b = buildSessionSystemPrompt({ ...base, platform: 'linux', shellAvailable: false, shell: null });
    const system = String(b.system.content);
    expect(system).toContain('- run_command :');
    expect(system).not.toContain('- bash :');
    expect(system).not.toContain('- powershell :');
  });
});
