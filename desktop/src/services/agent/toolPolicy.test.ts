import { describe, expect, it } from 'vitest';
import { approvalDecision } from './toolPolicy';

const base = {
  mode: 'full' as const,
  tool: 'read_file',
  mcpReadOnly: false,
  mcpAsk: false,
  background: false,
  risk: null,
  personalSpace: false,
  trusted: false,
};

describe('approvalDecision', () => {
  it('mode plan : refuse les outils d’écriture, autorise la lecture et propose_plan', () => {
    expect(approvalDecision({ ...base, mode: 'plan', tool: 'write_file' }).allowed).toBe(false);
    expect(approvalDecision({ ...base, mode: 'plan', tool: 'read_file' }).allowed).toBe(true);
    expect(approvalDecision({ ...base, mode: 'plan', tool: 'propose_plan' }).allowed).toBe(true);
  });

  it('mode ask : demande pour écrire, pas pour lire', () => {
    expect(approvalDecision({ ...base, mode: 'ask', tool: 'write_file' }).ask).toBe(true);
    expect(approvalDecision({ ...base, mode: 'ask', tool: 'read_file' }).ask).toBe(false);
  });

  it('mode auto : demande pour une commande, pas pour une écriture', () => {
    expect(approvalDecision({ ...base, mode: 'auto', tool: 'run_command' }).ask).toBe(true);
    expect(approvalDecision({ ...base, mode: 'auto', tool: 'write_file' }).ask).toBe(false);
  });

  it('espace ANZAR : pas d’accord pour écrire, sauf risque non encore autorisé', () => {
    expect(approvalDecision({ ...base, mode: 'ask', tool: 'write_file', personalSpace: true }).ask).toBe(false);
    expect(approvalDecision({ ...base, mode: 'ask', tool: 'run_command', personalSpace: true, risk: { reason: 'script modifié' }, trusted: false }).ask).toBe(true);
    expect(approvalDecision({ ...base, mode: 'ask', tool: 'run_command', personalSpace: true, risk: { reason: 'script modifié' }, trusted: true }).ask).toBe(false);
  });

  it('automatisation : refuse sans demander, avec une explication', () => {
    const risk = approvalDecision({ ...base, background: true, risk: { reason: 'commande risquée' } });
    expect(risk.allowed).toBe(false);
    expect(risk.refusal).toContain('commande risquée');

    const mcp = approvalDecision({ ...base, background: true, mcpAsk: true, mcpName: 'GitHub' });
    expect(mcp.allowed).toBe(false);
    expect(mcp.refusal).toContain('GitHub');
  });
});
