/**
 * Diagnostics de code pour l'agent : après chaque écriture d'un fichier TypeScript,
 * JavaScript ou Python, le serveur de langage du projet renvoie ses erreurs, et
 * l'agent les voit dans le résultat de l'outil, sans lancer de build.
 *
 * Serveurs lancés par npx (Node.js requis), un par projet et par langage :
 * - typescript-language-server (+ TypeScript du projet s'il existe)
 * - pyright
 * Démarrage à la première modification, arrêt après 15 minutes sans usage.
 */
import { StdioTransport } from '@/services/mcp/transports';
import { LspClient, type LspDiagnostic } from './client';

export type LspLanguage = 'typescript' | 'python';

interface ServerSpec {
  command: string;
  args: string[];
  initializationOptions?: unknown;
}

const SERVERS: Record<LspLanguage, ServerSpec> = {
  typescript: {
    command: 'npx',
    args: ['-y', '-p', 'typescript-language-server@4', '-p', 'typescript@5', 'typescript-language-server', '--stdio'],
    initializationOptions: { preferences: { includeCompletionsForModuleExports: false } },
  },
  python: {
    command: 'npx',
    args: ['-y', '-p', 'pyright@1', 'pyright-langserver', '--stdio'],
  },
};

const EXTENSIONS: Record<string, { lang: LspLanguage; languageId: string }> = {
  ts: { lang: 'typescript', languageId: 'typescript' },
  mts: { lang: 'typescript', languageId: 'typescript' },
  cts: { lang: 'typescript', languageId: 'typescript' },
  tsx: { lang: 'typescript', languageId: 'typescriptreact' },
  js: { lang: 'typescript', languageId: 'javascript' },
  mjs: { lang: 'typescript', languageId: 'javascript' },
  cjs: { lang: 'typescript', languageId: 'javascript' },
  jsx: { lang: 'typescript', languageId: 'javascriptreact' },
  py: { lang: 'python', languageId: 'python' },
  pyi: { lang: 'python', languageId: 'python' },
};

const START_TIMEOUT_MS = 180_000;   // premier lancement : téléchargement des paquets par npx
const IDLE_STOP_MS = 15 * 60_000;
const MAX_REPORTED = 15;

interface Entry {
  client: LspClient;
  ready: Promise<boolean>;
  lastUse: number;
  failed?: string;
}

const servers = new Map<string, Entry>();
let idleTimer: ReturnType<typeof setInterval> | null = null;
let counter = 0;
/** Fabrique de transport : remplaçable pour les tests. */
export let makeTransport = (id: string, spec: ServerSpec, cwd: string) =>
  new StdioTransport(id, spec.command, spec.args, {}, cwd, undefined, 'lsp');
export function setTransportFactory(f: typeof makeTransport) { makeTransport = f; }

export function languageOf(path: string): { lang: LspLanguage; languageId: string } | null {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return EXTENSIONS[ext] || null;
}

function joinPath(root: string, rel: string): string {
  return /^([a-zA-Z]:)?[\\/]/.test(rel) ? rel : `${root.replace(/[\\/]+$/, '')}/${rel.replace(/^\.?[\\/]+/, '')}`;
}

function getServer(root: string, lang: LspLanguage): Entry {
  const key = `${root}::${lang}`;
  const existing = servers.get(key);
  if (existing && !existing.client.isClosed && !existing.failed) return existing;

  const spec = SERVERS[lang];
  const client = new LspClient(makeTransport(`lsp-${lang}-${++counter}`, spec, root), root, spec.initializationOptions);
  const entry: Entry = { client, lastUse: Date.now(), ready: Promise.resolve(false) };
  entry.ready = client.start(START_TIMEOUT_MS).then(() => true).catch((e) => {
    entry.failed = String(e?.message || e);
    void client.stop().catch(() => {});
    return false;
  });
  client.onClosed = (reason) => { entry.failed = reason; };
  servers.set(key, entry);

  if (!idleTimer) {
    idleTimer = setInterval(() => {
      for (const [k, e] of servers) {
        if (Date.now() - e.lastUse > IDLE_STOP_MS) {
          servers.delete(k);
          void e.client.stop().catch(() => {});
        }
      }
      if (!servers.size && idleTimer) { clearInterval(idleTimer); idleTimer = null; }
    }, 60_000);
  }
  return entry;
}

export interface FileDiagnostics {
  path: string;
  errors: LspDiagnostic[];
  warnings: number;
  /** Erreurs qui existaient déjà avant la modification (quand on a pu le vérifier) */
  preexisting?: number;
}

/**
 * Diagnostics d'un fichier après modification. null quand ils ne sont pas disponibles
 * (langage non pris en charge, serveur en cours de démarrage, Node absent, délai dépassé) :
 * l'agent continue alors normalement, sans rien bloquer.
 */
export async function diagnoseFile(root: string, relPath: string, text: string, opts: { waitMs?: number } = {}): Promise<FileDiagnostics | null> {
  const lang = languageOf(relPath);
  if (!lang) return null;
  const entry = getServer(root, lang.lang);
  entry.lastUse = Date.now();
  const waitMs = opts.waitMs ?? 8_000;
  const ready = await Promise.race([entry.ready, new Promise<boolean>((r) => setTimeout(() => r(false), waitMs))]);
  if (!ready) return null;
  const items = await entry.client.diagnose(joinPath(root, relPath), text, lang.languageId, waitMs).catch(() => null);
  if (!items) return null;
  return {
    path: relPath,
    errors: items.filter((d) => (d.severity ?? 1) === 1),
    warnings: items.filter((d) => d.severity === 2).length,
  };
}

const errorKey = (d: LspDiagnostic) => `${d.code ?? ''}|${d.message}`;

/**
 * Diagnostics après une modification, en distinguant les erreurs introduites de celles
 * qui étaient déjà là : l'agent corrige les siennes sans se lancer dans tout le projet.
 */
export async function diagnoseChange(root: string, relPath: string, before: string | null, after: string, opts: { waitMs?: number } = {}): Promise<FileDiagnostics | null> {
  let baseline: FileDiagnostics | null = null;
  if (before !== null && before !== after) {
    baseline = await diagnoseFile(root, relPath, before, opts);
  }
  const result = await diagnoseFile(root, relPath, after, opts);
  if (!result || !baseline) return result;
  // Comparaison par code + message (les numéros de ligne bougent avec la modification)
  const remaining = new Map<string, number>();
  for (const e of baseline.errors) remaining.set(errorKey(e), (remaining.get(errorKey(e)) || 0) + 1);
  const introduced: LspDiagnostic[] = [];
  let preexisting = 0;
  for (const e of result.errors) {
    const n = remaining.get(errorKey(e)) || 0;
    if (n > 0) { remaining.set(errorKey(e), n - 1); preexisting++; } else introduced.push(e);
  }
  return { ...result, errors: introduced, preexisting };
}

/** Démarre à l'avance le serveur d'un langage (au premier fichier lu, par exemple). */
export function warmUp(root: string, relPath: string): void {
  const lang = languageOf(relPath);
  if (lang) getServer(root, lang.lang).lastUse = Date.now();
}

/** État des serveurs d'un projet, pour l'affichage. */
export function serverStatus(root: string): { lang: LspLanguage; state: 'starting' | 'ready' | 'error'; error?: string }[] {
  const out: { lang: LspLanguage; state: 'starting' | 'ready' | 'error'; error?: string }[] = [];
  for (const lang of Object.keys(SERVERS) as LspLanguage[]) {
    const e = servers.get(`${root}::${lang}`);
    if (!e) continue;
    out.push(e.failed ? { lang, state: 'error', error: e.failed } : { lang, state: e.client.isClosed ? 'error' : 'ready' });
  }
  return out;
}

const LABEL: Record<LspLanguage, string> = { typescript: 'TypeScript', python: 'Python' };

/** Texte ajouté au résultat de l'outil : court, avec la ligne et le message de chaque erreur. */
export function formatDiagnostics(d: FileDiagnostics): string {
  const lang = languageOf(d.path);
  const label = lang ? LABEL[lang.lang] : 'Code';
  const before = d.preexisting
    ? ` ${d.preexisting} erreur${d.preexisting > 1 ? 's existaient' : ' existait'} déjà avant ta modification : ne t'en occupe que si la tâche le demande.`
    : '';
  if (!d.errors.length) {
    return `Diagnostics ${label} : aucune ${d.preexisting !== undefined ? 'nouvelle ' : ''}erreur${d.warnings ? ` (${d.warnings} avertissement${d.warnings > 1 ? 's' : ''})` : ''}.${before}`;
  }
  const lines = d.errors.slice(0, MAX_REPORTED).map((e) => {
    const code = e.code !== undefined ? ` [${e.source ? `${e.source} ` : ''}${e.code}]` : '';
    return `- ${d.path}:${e.range.start.line + 1}:${e.range.start.character + 1} ${e.message.split('\n')[0].slice(0, 300)}${code}`;
  });
  const more = d.errors.length > MAX_REPORTED ? `\n… et ${d.errors.length - MAX_REPORTED} autres` : '';
  // Modules introuvables : souvent des dépendances pas encore installées
  const missingDeps = d.errors.some((e) => [2307, 2875, 7016].includes(Number(e.code)) || /reportMissingImports|reportMissingModuleSource/.test(String(e.code)))
    ? '\nDes modules sont introuvables : si les dépendances ne sont pas installées, installe-les (npm install, pip install…) avant de corriger le code.'
    : '';
  const isNew = d.preexisting !== undefined ? 'nouvelle' + (d.errors.length > 1 ? 's ' : ' ') : '';
  return `Diagnostics ${label} : ${d.errors.length} ${isNew}erreur${d.errors.length > 1 ? 's' : ''} dans ce fichier — corrige-les avant de continuer.${before}\n${lines.join('\n')}${more}${missingDeps}`;
}

export async function stopAllLanguageServers(): Promise<void> {
  const all = [...servers.values()];
  servers.clear();
  await Promise.all(all.map((e) => e.client.stop().catch(() => {})));
}
