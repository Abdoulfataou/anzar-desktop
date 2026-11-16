/**
 * Transports MCP de l'app, branchés sur le module Rust (src-tauri/src/mcp.rs) :
 * - stdio : serveur local lancé par l'app (npx, uvx, docker…), une ligne JSON par message
 * - HTTP  : « Streamable HTTP » de la spécification, réponse JSON ou SSE
 */
import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { McpError, parseHttpMessages, type JsonRpcMessage, type McpTransport } from './client';

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
    try {
      await invoke('mcp_spawn', { id: this.id, command: this.command, args: this.args, env: this.env, cwd: this.cwd ?? null });
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

  constructor(private url: string, private headers: Record<string, string>) {}

  async start(onMessage: (m: JsonRpcMessage) => void, onClose: (reason: string) => void): Promise<void> {
    this.onMessage = onMessage;
    this.onClose = onClose;
  }

  setProtocolVersion(version: string) {
    this.protocolVersion = version;
  }

  private requestHeaders(): Record<string, string> {
    const h: Record<string, string> = { ...this.headers, Accept: 'application/json, text/event-stream' };
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    if (this.protocolVersion) h['MCP-Protocol-Version'] = this.protocolVersion;
    return h;
  }

  async send(msg: JsonRpcMessage): Promise<void> {
    const res = await invoke<HttpResponse>('mcp_http', { url: this.url, headers: this.requestHeaders(), body: JSON.stringify(msg), method: 'POST' })
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
    await invoke('mcp_http', { url: this.url, headers: this.requestHeaders(), body: null, method: 'DELETE' }).catch(() => {});
    this.sessionId = null;
  }
}
