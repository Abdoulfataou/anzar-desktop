import { describe, expect, it } from 'vitest';
import { approvalDecision } from './toolPolicy';

const base = {
  mode: 'ask' as const,
  tool: 'write_file',
  mcpReadOnly: false,
  mcpAsk: false,
  background: false,
};

describe('approvalDecision', () => {
  it('ne demande rien pour une écriture ou une commande ordinaire', () => {
    expect(approvalDecision(base)).toEqual({ allowed: true, ask: false });
    expect(approvalDecision({ ...base, mode: 'auto', tool: 'run_command' })).toEqual({ allowed: true, ask: false });
    expect(approvalDecision({ ...base, mode: 'full', tool: 'bash' })).toEqual({ allowed: true, ask: false });
  });

  it('garde la demande des connecteurs réglés toujours demander', () => {
    expect(approvalDecision({ ...base, tool: 'mcp__gimp__x', mcpAsk: true }).ask).toBe(true);
    expect(approvalDecision({ ...base, mode: 'full', tool: 'mcp__obs__x', mcpAsk: true }).ask).toBe(true);
  });

  it('refuse une action de connecteur en arrière-plan', () => {
    const decision = approvalDecision({ ...base, background: true, mcpAsk: true, mcpName: 'GIMP', tool: 'mcp__gimp__x' });
    expect(decision.allowed).toBe(false);
    expect(decision.refusal).toContain('GIMP');
  });
});
