/**
 * Rapports d'erreurs envoyés au serveur ANZAR, pour le suivi automatique (DeepSeek Harness).
 *
 * Seulement ce qui peut venir d'ANZAR lui-même : commandes bloquées par l'environnement
 * (réseau, isolation, programme introuvable…), mises à jour ratées, plantages de l'interface.
 * Jamais le code ni les fichiers du projet. Tout est nettoyé ici (chemins personnels, clés,
 * jetons, e-mails), puis une seconde fois par le serveur. Coupé par le réglage
 * « Envoyer les rapports d'erreurs » ; jamais bloquant : une erreur d'envoi est ignorée.
 */
import { useSettingsStore } from '@/stores/settingsStore';

export type ErrorKind = 'command' | 'update' | 'tool' | 'crash';

export interface ErrorReport {
  kind: ErrorKind;
  title: string;
  detail?: string;
}

const MAX_DETAIL = 4000;
const MAX_PER_SESSION = 30;
const FLUSH_DELAY_MS = 20_000;
const BATCH = 20;

const SECRETS: [RegExp, string][] = [
  [/\b(sk|pk|rk)[-_](live|test|proj)?[-_]?[A-Za-z0-9]{12,}\b/g, '<clé>'],
  [/\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{16,}\b/g, '<clé>'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '<clé>'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '<jeton>'],
  [/(authorization|bearer)\s*[:=]?\s*[A-Za-z0-9._~+/=-]{12,}/gi, '$1 <jeton>'],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1$2<masqué>'],
  [/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1<identifiants>@'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<e-mail>'],
];
const HOMES: [RegExp, string][] = [
  [/\/Users\/[^/\s]+/g, '~'],
  [/\/home\/[^/\s]+/g, '~'],
  [/[A-Za-z]:\\Users\\[^\\\s]+/gi, '~'],
];

/** Retire chemins personnels, clés, jetons et e-mails ; garde la fin (là où est l'erreur). */
export function scrubReport(text: string, limit = MAX_DETAIL): string {
  let out = String(text || '');
  for (const [re, rep] of HOMES) out = out.replace(re, rep);
  for (const [re, rep] of SECRETS) out = out.replace(re, rep);
  return out.length > limit ? out.slice(-limit) : out;
}

const ENV_FAILURE = new RegExp([
  '\\[ANZAR\\]', 'introuvable', 'command not found', 'not recognized as an internal',
  'operation not permitted', 'permission denied', 'EACCES', 'EPERM',
  'socket error', 'SocketException', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET',
  'ETIMEDOUT', 'getaddrinfo', 'Could not resolve', 'Network is unreachable', 'Failed host lookup',
  'certificate', 'SSL', 'TLS', 'sandbox', 'Programme non autorisé', 'Dossier non autorisé',
].join('|'), 'i');

/**
 * Échec de commande qui peut venir d'ANZAR (environnement, réseau, isolation) et non du
 * code du projet : une erreur de compilation ou un test rouge de l'utilisateur n'est pas
 * un bug d'ANZAR et noierait les vrais problèmes.
 */
export function isEnvironmentFailure(output: string, exitCode?: number): boolean {
  if (exitCode === 126 || exitCode === 127 || exitCode === 69) return true;
  return ENV_FAILURE.test(output || '');
}

/** Titre stable et sans données : programme + sous-commande, jamais les arguments. */
export function commandTitle(command: string, exitCode?: number): string {
  const tokens = String(command || '').trim().split(/\s+/).filter(Boolean);
  const prog = (tokens[0] || '?').replace(/^.*[\\/]/, '');
  const sub = tokens[1] && /^[a-z][a-z0-9:_-]{0,30}$/i.test(tokens[1]) ? ` ${tokens[1]}` : '';
  const sub2 = sub && tokens[2] && /^[a-z][a-z0-9:_-]{0,30}$/i.test(tokens[2]) && !/[./]/.test(tokens[2]) ? ` ${tokens[2]}` : '';
  return `${prog}${sub}${sub2}${exitCode !== undefined ? ` → code ${exitCode}` : ' → échec'}`.slice(0, 200);
}

let queue: ErrorReport[] = [];
const seen = new Set<string>();
let sentThisSession = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function enabled(): boolean {
  return useSettingsStore.getState().settings.errorReports !== false;
}

/** Ajoute un rapport (dédoublonné pour la session) ; l'envoi part par lots, plus tard. */
export function reportError(report: ErrorReport): void {
  try {
    if (!enabled() || sentThisSession >= MAX_PER_SESSION) return;
    const title = scrubReport(report.title, 200).trim();
    if (!title) return;
    const detail = scrubReport(report.detail || '');
    const key = `${report.kind}|${title}|${detail.split('\n').find((l) => /error|erreur|exception|failed|introuvable/i.test(l)) || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    sentThisSession += 1;
    queue.push({ kind: report.kind, title, detail });
    if (queue.length >= BATCH) void flushErrorReports();
    else if (!timer) timer = setTimeout(() => { void flushErrorReports(); }, FLUSH_DELAY_MS);
  } catch {
    // Le suivi ne doit jamais gêner l'utilisateur.
  }
}

function osName(): string {
  const p = (typeof navigator !== 'undefined' ? navigator.platform : '').toLowerCase();
  return p.includes('win') ? 'windows' : p.includes('mac') ? 'macos' : 'linux';
}

/** Envoie la file d'attente (utilisateur connecté seulement). */
export async function flushErrorReports(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!queue.length || !enabled()) { queue = []; return; }
  const settings = useSettingsStore.getState();
  const token = settings.getAuthToken();
  if (!token) return; // gardé pour après la connexion
  const batch = queue.splice(0, BATCH);
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
  try {
    await fetch(`${settings.getBackendUrl()}/api/telemetry/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reports: batch.map((r) => ({ ...r, app_version: version, os: osName() })) }),
    });
  } catch {
    // Hors ligne : tant pis, l'erreur reviendra si elle se reproduit.
  }
  if (queue.length) timer = setTimeout(() => { void flushErrorReports(); }, FLUSH_DELAY_MS);
}

/** Plantages de l'interface non rattrapés (à appeler une fois au démarrage). */
export function installCrashReporting(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => {
    const err = e.error as Error | undefined;
    reportError({ kind: 'crash', title: `Interface : ${err?.name || 'Error'} : ${err?.message || e.message}`.slice(0, 200), detail: err?.stack || '' });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const err = e.reason as Error | undefined;
    const msg = err?.message || String(e.reason ?? '');
    reportError({ kind: 'crash', title: `Interface : promesse rejetée : ${msg}`.slice(0, 200), detail: err?.stack || msg });
  });
}

/** Tests uniquement. */
export function __resetErrorReports(): void {
  queue = []; seen.clear(); sentThisSession = 0;
  if (timer) { clearTimeout(timer); timer = null; }
}
