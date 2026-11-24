/**
 * Client MCP (Model Context Protocol) : JSON-RPC 2.0 au-dessus d'un transport.
 * Indépendant du transport (stdio ou HTTP), donc testable hors de l'app.
 *
 * Deux cycles de vie :
 * - moderne (2026-07-28, sans état) : `server/discover` d'abord, puis chaque requête porte sa
 *   version et les capacités du client dans `_meta` ; pas de poignée de main ;
 * - historique (2024-11-05 → 2025-11-25) : `initialize` puis `notifications/initialized`.
 * À la connexion, le client sonde `server/discover` et revient à `initialize` si le serveur
 * ne le connaît pas.
 */

/** Version moderne, sans état. */
export const MODERN_PROTOCOL_VERSION = '2026-07-28';
/** Version proposée à `initialize` aux serveurs historiques. */
export const PROTOCOL_VERSION = '2025-11-25';
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const CLIENT_INFO = { name: 'anzar', title: 'ANZAR', version: '2.1.2' };
/** Sonde server/discover : courte, un serveur historique peut ne jamais y répondre. */
const DISCOVER_TIMEOUT_MS = 6_000;

export type JsonRpcMessage = {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
};

export interface McpTransport {
  /** Démarre le transport ; onMessage reçoit chaque message du serveur. */
  start(onMessage: (msg: JsonRpcMessage) => void, onClose: (reason: string) => void): Promise<void>;
  send(msg: JsonRpcMessage): Promise<void>;
  /** Informe le transport de la version négociée (en-tête HTTP). */
  setProtocolVersion?(version: string): void;
  close(): Promise<void>;
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, any>;
  annotations?: McpToolAnnotations;
}

export interface McpContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: { uri: string; text?: string; mimeType?: string };
  uri?: string;
  name?: string;
}

export interface McpCallResult {
  content: McpContent[];
  isError?: boolean;
  structuredContent?: unknown;
}

export interface McpServerInfo {
  name: string;
  version?: string;
  protocolVersion: string;
  instructions?: string;
  /** Cycle de vie utilisé avec ce serveur. */
  lifecycle: 'modern' | 'legacy';
}

export class McpError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
  }
}

export class McpClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private closed = false;
  info: McpServerInfo | null = null;
  /** Mode moderne : version et capacités envoyées dans le _meta de chaque requête. */
  private modern = false;
  /** Appelé quand le serveur annonce que sa liste d'outils a changé */
  onToolsChanged?: () => void;
  /** Appelé quand le transport se ferme sans qu'on l'ait demandé */
  onClosed?: (reason: string) => void;

  constructor(private transport: McpTransport, private roots: () => string[] = () => []) {}

  async connect(timeoutMs = 30_000): Promise<McpServerInfo> {
    await this.transport.start(
      (m) => this.handle(m),
      (reason) => {
        if (this.closed) return;
        this.closed = true;
        this.failAll(new McpError(reason));
        this.onClosed?.(reason);
      },
    );
    const modern = await this.discover(Math.min(timeoutMs, DISCOVER_TIMEOUT_MS));
    if (modern) return modern;
    if (this.closed) throw new McpError('Le serveur s\'est arrêté pendant la connexion.');
    return this.initializeLegacy(timeoutMs);
  }

  /** Cycle moderne : server/discover. Renvoie null si le serveur ne le prend pas en charge. */
  private async discover(timeoutMs: number): Promise<McpServerInfo | null> {
    let res: any;
    try {
      res = await this.request('server/discover', { _meta: this.meta(MODERN_PROTOCOL_VERSION) }, timeoutMs);
    } catch {
      return null; // méthode inconnue, refus ou silence : serveur historique
    }
    const versions: string[] = Array.isArray(res?.supportedVersions) ? res.supportedVersions.map(String) : [];
    if (!versions.includes(MODERN_PROTOCOL_VERSION)) return null;
    this.modern = true;
    this.transport.setProtocolVersion?.(MODERN_PROTOCOL_VERSION);
    const server = res?._meta?.['io.modelcontextprotocol/serverInfo'] || res?.serverInfo || {};
    this.info = {
      name: server.title || server.name || 'serveur',
      version: server.version,
      protocolVersion: MODERN_PROTOCOL_VERSION,
      instructions: typeof res?.instructions === 'string' ? res.instructions : undefined,
      lifecycle: 'modern',
    };
    return this.info;
  }

  /** Cycle historique : initialize puis notifications/initialized. */
  private async initializeLegacy(timeoutMs: number): Promise<McpServerInfo> {
    const res = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { roots: { listChanged: false } },
      clientInfo: CLIENT_INFO,
    }, timeoutMs);
    const version = String(res?.protocolVersion || PROTOCOL_VERSION);
    if (!LEGACY_VERSIONS.includes(version)) {
      throw new McpError(`Version du protocole non prise en charge par ANZAR : ${version}`);
    }
    this.transport.setProtocolVersion?.(version);
    await this.notify('notifications/initialized');
    this.info = {
      name: res?.serverInfo?.title || res?.serverInfo?.name || 'serveur',
      version: res?.serverInfo?.version,
      protocolVersion: version,
      instructions: typeof res?.instructions === 'string' ? res.instructions : undefined,
      lifecycle: 'legacy',
    };
    return this.info;
  }

  /** _meta d'une requête moderne : version, capacités et identité du client. */
  private meta(version: string): Record<string, unknown> {
    return {
      'io.modelcontextprotocol/protocolVersion': version,
      'io.modelcontextprotocol/clientCapabilities': {},
      'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
    };
  }

  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await this.request('tools/list', cursor ? { cursor } : {});
      for (const t of res?.tools || []) {
        if (t && typeof t.name === 'string') tools.push(t);
      }
      cursor = res?.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<McpCallResult> {
    const res = await this.request('tools/call', { name, arguments: args }, opts.timeoutMs ?? 180_000, opts.signal);
    return { content: Array.isArray(res?.content) ? res.content : [], isError: !!res?.isError, structuredContent: res?.structuredContent };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new McpError('Connexion fermée'));
    await this.transport.close().catch(() => {});
  }

  get isClosed(): boolean {
    return this.closed;
  }

  // ── JSON-RPC ──────────────────────────────────────────────────────────────

  request(method: string, params?: unknown, timeoutMs = 60_000, signal?: AbortSignal): Promise<any> {
    if (this.closed) return Promise.reject(new McpError('Serveur déconnecté'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        void this.notify('notifications/cancelled', { requestId: id, reason: 'délai dépassé' }).catch(() => {});
        reject(new McpError(`Le serveur n'a pas répondu à « ${method} » à temps.`));
      }, timeoutMs);
      const onAbort = () => {
        if (!this.pending.has(id)) return;
        clearTimeout(timer);
        this.pending.delete(id);
        void this.notify('notifications/cancelled', { requestId: id, reason: 'annulé' }).catch(() => {});
        reject(new McpError('Annulé'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        resolve: (v) => { signal?.removeEventListener('abort', onAbort); resolve(v); },
        reject: (e) => { signal?.removeEventListener('abort', onAbort); reject(e); },
        timer,
      });
      const body = this.modern
        ? { ...((params as Record<string, unknown>) || {}), _meta: { ...this.meta(MODERN_PROTOCOL_VERSION), ...((params as any)?._meta || {}) } }
        : params;
      this.transport.send({ jsonrpc: '2.0', id, method, ...(body !== undefined ? { params: body } : {}) }).catch((e) => {
        const p = this.pending.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.reject(e instanceof Error ? e : new McpError(String(e)));
      });
    });
  }

  notify(method: string, params?: unknown): Promise<void> {
    if (this.closed && method !== 'notifications/cancelled') return Promise.resolve();
    return this.transport.send({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) });
  }

  private failAll(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private handle(msg: JsonRpcMessage) {
    if (!msg || typeof msg !== 'object') return;
    // Réponse à une de nos requêtes
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(Number(msg.id));
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(Number(msg.id));
      if (msg.error) p.reject(new McpError(msg.error.message || 'Erreur du serveur', msg.error.code));
      // Sans resultType (serveur historique), le résultat est complet.
      else if (msg.result?.resultType === 'input_required') {
        p.reject(new McpError("Ce connecteur demande une information supplémentaire pendant l'appel (requêtes en plusieurs allers-retours), ce qu'ANZAR ne prend pas encore en charge."));
      } else p.resolve(msg.result);
      return;
    }
    // Requête du serveur : on répond toujours, sinon il attend
    if (msg.id !== undefined && msg.method) {
      const reply = (body: { result?: unknown; error?: JsonRpcMessage['error'] }) =>
        void this.transport.send({ jsonrpc: '2.0', id: msg.id, ...body }).catch(() => {});
      if (msg.method === 'ping') reply({ result: {} });
      else if (msg.method === 'roots/list') reply({ result: { roots: this.roots().map((r) => ({ uri: toFileUri(r), name: r.split(/[\\/]/).pop() || r })) } });
      // Ni génération de texte pour le serveur (sampling), ni formulaires (elicitation)
      else reply({ error: { code: -32601, message: `Méthode non prise en charge par ANZAR : ${msg.method}` } });
      return;
    }
    // Notification
    if (msg.method === 'notifications/tools/list_changed') this.onToolsChanged?.();
  }
}

function toFileUri(path: string): string {
  const p = path.replace(/\\/g, '/');
  return `file://${p.startsWith('/') ? '' : '/'}${encodeURI(p)}`;
}

/** Messages JSON d'une réponse HTTP (JSON simple, lot JSON ou flux SSE). */
export function parseHttpMessages(body: string, contentType: string): JsonRpcMessage[] {
  const out: JsonRpcMessage[] = [];
  const push = (v: any) => {
    if (Array.isArray(v)) v.forEach(push);
    else if (v && typeof v === 'object') out.push(v);
  };
  if (/text\/event-stream/i.test(contentType)) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
      if (!data.trim()) continue;
      try { push(JSON.parse(data)); } catch { /* évènement non JSON ignoré */ }
    }
  } else if (body.trim()) {
    try { push(JSON.parse(body)); } catch { /* corps vide ou non JSON */ }
  }
  return out;
}

/** Texte lisible par le modèle d'un résultat d'outil. */
export function resultToText(result: McpCallResult, maxChars = 30_000): string {
  const parts: string[] = [];
  for (const c of result.content) {
    if (c.type === 'text' && c.text) parts.push(c.text);
    else if (c.type === 'image') parts.push(`[image ${c.mimeType || ''} renvoyée par l'outil — non affichable ici]`);
    else if (c.type === 'audio') parts.push('[audio renvoyé par l\'outil — non pris en charge]');
    else if (c.type === 'resource' && c.resource) parts.push(c.resource.text ? `Ressource ${c.resource.uri} :\n${c.resource.text}` : `[ressource ${c.resource.uri}]`);
    else if (c.type === 'resource_link') parts.push(`[lien de ressource : ${c.name || ''} ${c.uri || ''}]`);
  }
  if (!parts.length && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent, null, 2));
  const text = parts.join('\n\n') || '(résultat vide)';
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n… [résultat tronqué : ${text.length.toLocaleString('fr-FR')} caractères au total]`
    : text;
}
