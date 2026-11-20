import { describe, expect, it } from 'vitest';
import { McpClient, MODERN_PROTOCOL_VERSION, PROTOCOL_VERSION, type JsonRpcMessage, type McpTransport } from './client';

/** Faux transport : `respond` décide de la réponse à chaque requête. */
function fakeTransport(respond: (msg: JsonRpcMessage) => Partial<JsonRpcMessage> | null) {
  const sent: JsonRpcMessage[] = [];
  let onMessage: (m: JsonRpcMessage) => void = () => {};
  let version: string | null = null;
  const transport: McpTransport = {
    async start(cb) { onMessage = cb; },
    async send(msg) {
      sent.push(msg);
      if (msg.id === undefined) return;
      const reply = respond(msg);
      if (reply) queueMicrotask(() => onMessage({ ...reply, jsonrpc: '2.0', id: msg.id }));
    },
    setProtocolVersion(v) { version = v; },
    async close() {},
  };
  return { transport, sent, version: () => version };
}

describe('McpClient — cycles de vie', () => {
  it('serveur 2026-07-28 : server/discover, pas de initialize, _meta sur chaque requête', async () => {
    const t = fakeTransport((m) => {
      if (m.method === 'server/discover') {
        return { result: { resultType: 'complete', supportedVersions: [MODERN_PROTOCOL_VERSION], capabilities: { tools: {} },
          _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'meteo', version: '3.0.0' } } } } as any;
      }
      if (m.method === 'tools/call') return { result: { resultType: 'complete', content: [{ type: 'text', text: '21°C' }] } } as any;
      return { error: { code: -32601, message: 'inconnu' } };
    });
    const client = new McpClient(t.transport);
    const info = await client.connect();
    expect(info).toMatchObject({ name: 'meteo', version: '3.0.0', protocolVersion: MODERN_PROTOCOL_VERSION, lifecycle: 'modern' });
    expect(t.sent.some((m) => m.method === 'initialize')).toBe(false);
    expect(t.version()).toBe(MODERN_PROTOCOL_VERSION);

    const r = await client.callTool('meteo', { ville: 'Niamey' });
    expect(r.content[0].text).toBe('21°C');
    const call = t.sent.find((m) => m.method === 'tools/call')!;
    expect(call.params).toMatchObject({
      name: 'meteo',
      arguments: { ville: 'Niamey' },
      _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION, 'io.modelcontextprotocol/clientInfo': { name: 'anzar' } },
    });
  });

  it('serveur historique : repli sur initialize quand server/discover est inconnu', async () => {
    const t = fakeTransport((m) => {
      if (m.method === 'server/discover') return { error: { code: -32601, message: 'Method not found' } };
      if (m.method === 'initialize') return { result: { protocolVersion: '2025-06-18', serverInfo: { name: 'ancien' }, capabilities: {} } } as any;
      if (m.method === 'tools/list') return { result: { tools: [{ name: 'a', inputSchema: {} }] } } as any;
      return null;
    });
    const client = new McpClient(t.transport);
    const info = await client.connect();
    expect(info).toMatchObject({ name: 'ancien', protocolVersion: '2025-06-18', lifecycle: 'legacy' });
    expect(t.sent.find((m) => m.method === 'initialize')?.params).toMatchObject({ protocolVersion: PROTOCOL_VERSION });
    expect(t.sent.some((m) => m.method === 'notifications/initialized')).toBe(true);
    await client.listTools();
    expect(t.sent.find((m) => m.method === 'tools/list')?.params?._meta).toBeUndefined();
  });

  it('serveur qui annonce seulement des versions anciennes dans server/discover : initialize', async () => {
    const t = fakeTransport((m) => {
      if (m.method === 'server/discover') return { result: { supportedVersions: ['2025-11-25'] } } as any;
      if (m.method === 'initialize') return { result: { protocolVersion: '2025-11-25', serverInfo: { name: 'mixte' } } } as any;
      return null;
    });
    const info = await new McpClient(t.transport).connect();
    expect(info.lifecycle).toBe('legacy');
  });

  it('refuse proprement un résultat « input_required » (MRTR non pris en charge)', async () => {
    const t = fakeTransport((m) => {
      if (m.method === 'server/discover') return { result: { supportedVersions: [MODERN_PROTOCOL_VERSION] } } as any;
      return { result: { resultType: 'input_required', inputRequests: {} } } as any;
    });
    const client = new McpClient(t.transport);
    await client.connect();
    await expect(client.callTool('x', {})).rejects.toThrow(/information supplémentaire/);
  });
});
