import { describe, expect, it, vi } from 'vitest';

vi.mock('./transports', () => ({ HttpTransport: vi.fn(), StdioTransport: vi.fn() }));
vi.mock('./client', () => ({ McpClient: vi.fn(), resultToText: vi.fn() }));
vi.mock('./config', () => ({ loadServers: vi.fn().mockResolvedValue([]), saveServers: vi.fn() }));

import { mcpNeedsApproval, type McpToolRef } from './manager';

const ref = (readOnly: boolean, alwaysAsk: boolean): McpToolRef => ({
  serverId: 's',
  serverName: 'Serveur',
  alwaysAsk,
  tool: {
    name: 'action',
    annotations: { readOnlyHint: readOnly },
    inputSchema: { type: 'object' },
  } as any,
});

describe('mcpNeedsApproval', () => {
  it('respecte alwaysAsk même si le serveur déclare readOnlyHint', () => {
    expect(mcpNeedsApproval('full', ref(true, true))).toBe(true);
    expect(mcpNeedsApproval('auto', ref(true, true))).toBe(true);
  });

  it('demande toujours en mode ask, même pour une lecture déclarée', () => {
    expect(mcpNeedsApproval('ask', ref(true, false))).toBe(true);
  });

  it('ignore les annotations hors Full', () => {
    expect(mcpNeedsApproval('auto', ref(true, false))).toBe(true);
    expect(mcpNeedsApproval('plan', ref(true, false))).toBe(true);
    expect(mcpNeedsApproval('full', ref(false, false))).toBe(false);
  });
});
