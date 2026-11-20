/**
 * Transports MCP de l'app, branchés sur le module Rust (src-tauri/src/mcp.rs) :
 * - stdio : serveur local lancé par l'app (npx, uvx, docker…), une ligne JSON par message
 * - HTTP  : « Streamable HTTP » de la spécification, réponse JSON ou SSE
 */
import { ensureNode, needsNode } from '@/services/runtime/nodeRuntime';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { MODERN_PROTOCOL_VERSION, McpError, parseHttpMessages, type JsonRpcMessage, type McpTransport } from './client';

export class StdioTransport implements McpTransport {
  private unlisten: UnlistenFn[] = [];
  /** Dernières lignes d'erreur du serveur : affichées si le lancement échoue */
  readonly logs: string[] = [];

  constructor(
    private id: string,
    private command: string,
    private args: string[],
    private env: Record<string, string>,
    private cwd?: string,
    private onLog?: (line: string) => void,
    /** « line » pour MCP, « lsp » (Content-Length) pour les serveurs de langage */
    private framing: 'line' | 'lsp' = 'line',
    /** Connecteur configuré : Rust lit la commande, les arguments et les secrets. */
    private serverId?: string,
  ) {}

  async start(onMessage: (m: JsonRpcMessage) => void, onClose: (reason: string) => void): Promise<void> {
    this.unlisten.push(await listen<{ id: string; line: string }>('mcp://message', (e) => {
      if (e.payload.id !== this.id) return;
      try {
        onMessage(JSON.parse(e.payload.line));
      } catch {
        this.pushLog(e.payload.line); // ligne non JSON écrite sur la sortie standard
      }
    }));
    this.unlisten.push(await listen<{ id: string; line: string }>('mcp://log', (e) => {
      if (e.payload.id === this.id) this.pushLog(e.payload.line);
    }));
    this.unlisten.push(await listen<{ id: string; code: number | null }>('mcp://exit', (e) => {
      if (e.payload.id !== this.id) return;
      const last = this.logs.slice(-3).join(' · ');
      onClose(`Le serveur s'est arrêté (code ${e.payload.code ?? '?'})${last ? ` : ${last}` : ''}`);
    }));
    if (needsNode(this.command)) {
      const node = await ensureNode({ reason: 'cet outil' });
      if (!node.ok) { this.dispose(); throw new McpError(node.message || 'Node.js est nécessaire.'); }
    }
    try {
      await invoke('mcp_spawn', {
        id: this.id,
        serverId: this.serverId ?? null,
        command: this.serverId ? '' : this.command,
        args: this.serverId ? [] : this.args,
        env: this.serverId ? {} : this.env,
        cwd: this.cwd ?? null,
        framing: this.framing,
      });
    } catch (e) {
      this.dispose();
      throw new McpError(String(e));
    }
  }

  private pushLog(line: string) {
    this.logs.push(line);
    if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200);
    this.onLog?.(line);
  }

  send(msg: JsonRpcMessage): Promise<void> {
    return invoke('mcp_send', { id: this.id, line: JSON.stringify(msg) });
  }

  private dispose() {
    this.unlisten.forEach((u) => u());
    this.unlisten = [];
  }

  async close(): Promise<void> {
    this.dispose();
    await invoke('mcp_stop', { id: this.id }).catch(() => {});
  }
}

interface HttpResponse { status: number; headers: Record<string, string>; body: string }

export class HttpTransport implements McpTransport {
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private onMessage: ((m: JsonRpcMessage) => void) | null = null;
  private onClose: ((reason: string) => void) | null = null;

  constructor(private serverId: string, private url: string) {}

  async start(onMessage: (m: JsonRpcMessage) => void, onClose: (reason: string) => void): Promise<void> {
    this.onMessage = onMessage;
    this.onClose = onClose;
  }

  setProtocolVersion(version: string) {
    this.protocolVersion = version;
  }

  private requestHeaders(msg?: JsonRpcMessage): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json, text/event-stream' };
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    const version = this.protocolVersion ?? (msg?.method === 'server/discover' ? MODERN_PROTOCOL_VERSION : null);
    if (version) h['MCP-Protocol-Version'] = version;
    // 2026-07-28 : méthode (et nom de l'outil, du prompt ou de la ressource) en en-têtes
    if (version === MODERN_PROTOCOL_VERSION && msg?.method) {
      h['Mcp-Method'] = msg.method;
      const name = msg.params?.name ?? msg.params?.uri;
      if (typeof name === 'string' && /^[\x20-\x7e]{1,200}$/.test(name)) h['Mcp-Name'] = name;
    }
    return h;
  }

  async send(msg: JsonRpcMessage): Promise<void> {
    const res = await invoke<HttpResponse>('mcp_http', { serverId: this.serverId, url: '', headers: this.requestHeaders(msg), body: JSON.stringify(msg), method: 'POST' })
      .catch((e) => { throw new McpError(String(e)); });
    const sid = res.headers['mcp-session-id'];
    if (sid) this.sessionId = sid;
    if (res.status === 404 && this.sessionId) {
      this.onClose?.('Session expirée sur le serveur');
      throw new McpError('Session expirée sur le serveur');
    }
    const auth = res.headers['www-authenticate'] || '';
    if (res.status === 401 || res.status === 403 || /invalid_token/i.test(auth)) {
      throw new McpError(res.status === 403 && !/invalid_token/i.test(auth)
        ? 'Accès interdit avec ce jeton (droits insuffisants).'
        : 'Accès refusé : jeton manquant ou invalide. Vérifie la clé du connecteur.', res.status);
    }
    if (res.status >= 400) {
      // Le serveur peut renvoyer une erreur JSON-RPC dans le corps : on la transmet telle quelle
      const msgs = parseHttpMessages(res.body, res.headers['content-type'] || '');
      if (msgs.length) { msgs.forEach((m) => this.onMessage?.(m)); return; }
      throw new McpError(`Le serveur a répondu ${res.status}${res.body ? ` : ${res.body.slice(0, 200)}` : ''}`, res.status);
    }
    // 202 : notification acceptée, pas de corps
    for (const m of parseHttpMessages(res.body, res.headers['content-type'] || '')) this.onMessage?.(m);
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    await invoke('mcp_http', { serverId: this.serverId, url: '', headers: this.requestHeaders(), body: null, method: 'DELETE' }).catch(() => {});
    this.sessionId = null;
  }
}
