/**
 * Client LSP (Language Server Protocol) réduit au besoin d'ANZAR : les diagnostics.
 * Ouvre ou met à jour un fichier dans le serveur de langage, puis récupère ses
 * erreurs : en mode « pull » (textDocument/diagnostic) si le serveur le permet,
 * sinon en attendant la notification textDocument/publishDiagnostics.
 * Indépendant du transport : testable hors de l'app.
 */
import type { JsonRpcMessage, McpTransport } from '@/services/mcp/client';

export interface LspPosition { line: number; character: number }
export interface LspDiagnostic {
  range: { start: LspPosition; end: LspPosition };
  severity?: 1 | 2 | 3 | 4;
  code?: string | number;
  source?: string;
  message: string;
}

interface DocState { version: number; text: string; languageId: string }
interface DiagState { version?: number; items: LspDiagnostic[]; at: number }

export function pathToUri(path: string): string {
  const p = path.replace(/\\/g, '/');
  const withSlash = p.startsWith('/') ? p : `/${p}`;
  return `file://${withSlash.split('/').map((seg) => encodeURIComponent(seg).replace(/%3A/g, ':')).join('/')}`;
}

/** Clé de comparaison : les serveurs ne codent pas toujours l'URI comme nous (espaces, lettre de lecteur). */
export function normUri(uri: string): string {
  let u = uri;
  try { u = decodeURIComponent(uri); } catch { /* garde tel quel */ }
  return u.replace(/^file:\/\/\/([A-Za-z]):/, (_m, d: string) => `file:///${d.toLowerCase()}:`);
}

export class LspClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private docs = new Map<string, DocState>();
  private diags = new Map<string, DiagState>();
  private listeners = new Set<(uri: string) => void>();
  private closed = false;
  private pullDiagnostics = false;
  onClosed?: (reason: string) => void;

  constructor(private transport: McpTransport, private rootPath: string, private initializationOptions: unknown = undefined) {}

  async start(timeoutMs = 120_000): Promise<void> {
    await this.transport.start(
      (m) => this.handle(m),
      (reason) => {
        if (this.closed) return;
        this.closed = true;
        this.failAll(new Error(reason));
        this.onClosed?.(reason);
      },
    );
    const rootUri = pathToUri(this.rootPath);
    const res = await this.request('initialize', {
      processId: null,
      clientInfo: { name: 'anzar', version: '2.1.2' },
      rootUri,
      rootPath: this.rootPath,
      workspaceFolders: [{ uri: rootUri, name: this.rootPath.split(/[\\/]/).pop() || 'projet' }],
      initializationOptions: this.initializationOptions,
      capabilities: {
        textDocument: {
          synchronization: { didSave: true, dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: false, versionSupport: true },
          diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
        },
        workspace: { configuration: true, workspaceFolders: true },
        window: { workDoneProgress: true },
      },
    }, timeoutMs);
    this.pullDiagnostics = !!res?.capabilities?.diagnosticProvider;
    this.notify('initialized', {});
  }

  get isClosed(): boolean {
    return this.closed;
  }


  /** Diagnostics d'un fichier, à jour par rapport au texte donné. null si le serveur n'a pas répondu à temps. */
  async diagnose(path: string, text: string, languageId: string, timeoutMs = 8_000): Promise<LspDiagnostic[] | null> {
    const uri = pathToUri(path);
    const key = normUri(uri);
    const since = Date.now();
    const unchanged = this.docs.get(uri)?.text === text;
    const version = this.sync(uri, text, languageId);
    // Texte déjà connu du serveur et déjà analysé : rien de neuf à attendre
    const known = this.diags.get(key);
    if (unchanged && known) return known.items;

    if (this.pullDiagnostics) {
      try {
        const res = await this.request('textDocument/diagnostic', { textDocument: { uri } }, timeoutMs);
        if (res?.kind === 'full' && Array.isArray(res.items)) return res.items;
        if (res?.kind === 'unchanged') return this.diags.get(key)?.items ?? [];
      } catch { /* repli sur les notifications */ }
    }

    // Mode « push » : on attend une publication postérieure à la modification,
    // puis un court délai pour une éventuelle seconde vague (syntaxe puis types).
    return new Promise((resolve) => {
      let settle: ReturnType<typeof setTimeout> | null = null;
      const fresh = () => {
        const d = this.diags.get(key);
        return d && (d.version === undefined ? d.at >= since : d.version >= version) ? d : null;
      };
      const finish = (v: LspDiagnostic[] | null) => {
        clearTimeout(deadline);
        if (settle) clearTimeout(settle);
        this.listeners.delete(onPublish);
        resolve(v);
      };
      const onPublish = (u: string) => {
        if (u !== key || !fresh()) return;
        if (settle) clearTimeout(settle);
        settle = setTimeout(() => finish(fresh()?.items ?? []), 400);
      };
      const deadline = setTimeout(() => finish(fresh()?.items ?? null), timeoutMs);
      this.listeners.add(onPublish);
      if (fresh()) onPublish(key);
    });
  }

  /** Diagnostics déjà publiés pour un fichier ouvert (sans nouvelle demande). */
  cached(path: string): LspDiagnostic[] | undefined {
    return this.diags.get(normUri(pathToUri(path)))?.items;
  }

  private sync(uri: string, text: string, languageId: string): number {
    const doc = this.docs.get(uri);
    if (!doc) {
      this.docs.set(uri, { version: 1, text, languageId });
      this.notify('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } });
      return 1;
    }
    if (doc.text === text) return doc.version;
    doc.version += 1;
    doc.text = text;
    this.notify('textDocument/didChange', { textDocument: { uri, version: doc.version }, contentChanges: [{ text }] });
    this.notify('textDocument/didSave', { textDocument: { uri } });
    return doc.version;
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    try {
      await this.request('shutdown', null, 3_000);
      this.notify('exit');
    } catch { /* serveur déjà arrêté */ }
    this.closed = true;
    this.failAll(new Error('Serveur arrêté'));
    await this.transport.close().catch(() => {});
  }

  // ── JSON-RPC ──────────────────────────────────────────────────────────────

  private request(method: string, params: unknown, timeoutMs = 30_000): Promise<any> {
    if (this.closed) return Promise.reject(new Error('Serveur de langage arrêté'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.notify('$/cancelRequest', { id });
        reject(new Error(`Pas de réponse à « ${method} » à temps`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send({ jsonrpc: '2.0', id, method, params } as JsonRpcMessage).catch((e) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  private notify(method: string, params?: unknown) {
    if (this.closed) return;
    void this.transport.send({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) } as JsonRpcMessage).catch(() => {});
  }

  private reply(id: number | string, result: unknown) {
    void this.transport.send({ jsonrpc: '2.0', id, result } as JsonRpcMessage).catch(() => {});
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
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(Number(msg.id));
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(Number(msg.id));
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    if (msg.id !== undefined && msg.method) {
      // Requêtes du serveur : réponses neutres (réglages par défaut, pas d'interface)
      if (msg.method === 'workspace/configuration') {
        this.reply(msg.id, (msg.params?.items || []).map(() => null));
      } else if (msg.method === 'workspace/workspaceFolders') {
        const uri = pathToUri(this.rootPath);
        this.reply(msg.id, [{ uri, name: this.rootPath.split(/[\\/]/).pop() || 'projet' }]);
      } else {
        this.reply(msg.id, null); // registerCapability, workDoneProgress/create, showMessageRequest…
      }
      return;
    }
    if (msg.method === 'textDocument/publishDiagnostics' && msg.params?.uri) {
      const uri = normUri(String(msg.params.uri));
      this.diags.set(uri, { version: msg.params.version, items: msg.params.diagnostics || [], at: Date.now() });
      this.listeners.forEach((l) => l(uri));
    }
  }
}
