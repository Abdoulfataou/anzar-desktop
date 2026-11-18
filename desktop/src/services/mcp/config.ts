/**
 * Connecteurs MCP enregistrés : store/mcp.json dans le dossier de données de l'app.
 * Les jetons (GitHub…) y sont stockés localement et ne sont jamais envoyés au modèle.
 */
import { readText, writeText } from '@/lib/fileStore';

export type McpTransportKind = 'stdio' | 'http';

export interface McpServerConfig {
  /** Identifiant court, unique : préfixe des outils (mcp__<id>__<outil>) */
  id: string;
  name: string;
  transport: McpTransportKind;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  /** Demander l'accord avant chaque action qui n'est pas une simple lecture */
  alwaysAsk?: boolean;
  /** Modèle d'origine (context7, playwright, github…) */
  preset?: string;
}

export interface PresetField {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
  secret?: boolean;
  kind?: 'text' | 'checkbox';
  default?: string | boolean;
}

export interface McpPreset {
  id: string;
  name: string;
  description: string;
  requirement?: string;
  link: string;
  fields: PresetField[];
  build(values: Record<string, string | boolean>): Omit<McpServerConfig, 'enabled'>;
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'context7',
    name: 'Context7',
    description: "Documentation à jour de milliers de bibliothèques (React, FastAPI, Expo…), à la bonne version. Moins d'API inventées.",
    link: 'https://github.com/upstash/context7',
    fields: [{ key: 'apiKey', label: 'Clé API (facultative)', placeholder: 'ctx7sk-…', help: 'Sans clé : limite de requêtes plus basse. Clé gratuite sur context7.com.', secret: true }],
    build: (v) => ({
      id: 'context7', name: 'Context7', transport: 'http', url: 'https://mcp.context7.com/mcp',
      headers: (v.apiKey ? { CONTEXT7_API_KEY: String(v.apiKey).trim() } : {}) as Record<string, string>, preset: 'context7',
    }),
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description: "Un vrai navigateur que l'agent pilote : ouvrir ton app, cliquer, remplir, lire la page et la console, pour vérifier que ça marche.",
    requirement: 'Node.js installé (npx). Le premier lancement télécharge le serveur.',
    link: 'https://github.com/microsoft/playwright-mcp',
    fields: [{ key: 'headless', label: 'Navigateur invisible (sans fenêtre)', kind: 'checkbox', default: false }],
    build: (v) => ({
      id: 'playwright', name: 'Playwright', transport: 'stdio', command: 'npx',
      args: ['-y', '@playwright/mcp@0.0.85', ...(v.headless ? ['--headless'] : [])], env: {}, preset: 'playwright',
    }),
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Dépôts, tickets, pull requests et actions GitHub. Serveur officiel de GitHub.',
    link: 'https://github.com/github/github-mcp-server',
    fields: [
      { key: 'token', label: "Jeton d'accès personnel GitHub", placeholder: 'github_pat_…', required: true, secret: true,
        help: 'GitHub → Settings → Developer settings → Fine-grained tokens. Donne-lui seulement les dépôts et droits nécessaires.' },
      { key: 'readonly', label: 'Lecture seule (recommandé)', kind: 'checkbox', default: true },
    ],
    build: (v) => ({
      id: 'github', name: 'GitHub', transport: 'http', url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: `Bearer ${String(v.token || '').trim()}`, ...(v.readonly ? { 'X-MCP-Readonly': 'true' } : {}) },
      alwaysAsk: true, preset: 'github',
    }),
  },
];

const FILE = 'mcp.json';

export function slugifyServerId(raw: string): string {
  return raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

export async function loadServers(): Promise<McpServerConfig[]> {
  try {
    const raw = await readText(FILE);
    const data = raw ? JSON.parse(raw) : null;
    return Array.isArray(data?.servers) ? data.servers.filter((s: any) => s && typeof s.id === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveServers(servers: McpServerConfig[]): Promise<void> {
  await writeText(FILE, JSON.stringify({ version: 1, servers }, null, 2));
  // Ce fichier peut contenir des jetons : jamais 0644.
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('secure_app_secrets');
  } catch { /* hors Tauri */ }
}

/** Découpe une ligne de commande en programme + arguments (guillemets respectés). */
export function splitCommandLine(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Lignes « CLÉ=valeur » ou « Nom: valeur » → objet. */
export function parsePairs(text: string, sep: '=' | ':'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(sep);
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    if (k) out[k] = line.slice(i + 1).trim();
  }
  return out;
}

/** Masque une valeur secrète pour l'affichage. */
export function mask(value: string): string {
  return value.length <= 8 ? '••••' : `${value.slice(0, 4)}••••${value.slice(-2)}`;
}

// ── Connecteurs déclarés par un projet ─────────────────────────────────────

/** Fichiers de connecteurs que d'autres outils mettent dans les dépôts. */
export const PROJECT_MCP_FILES = ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json'];

export interface ProjectServerProposal {
  /** Fichier d'origine, relatif au projet */
  file: string;
  name: string;
  transport: McpTransportKind;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Contient des valeurs à compléter (${env:…}, ${input:…}) */
  needsSetup: boolean;
  /** Transport non pris en charge (ancien SSE) */
  unsupported?: string;
}

const strRecord = (v: any): Record<string, string> =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) as Record<string, string> : {};

/** Lit un fichier de connecteurs (formats Claude Code / Cursor : mcpServers ; VS Code : servers). */
export function parseProjectMcp(text: string, file: string): ProjectServerProposal[] {
  let data: any;
  try { data = JSON.parse(text.replace(/^\s*\/\/.*$/gm, '')); } catch { return []; }
  const servers = data?.mcpServers || data?.servers;
  if (!servers || typeof servers !== 'object') return [];
  const out: ProjectServerProposal[] = [];
  for (const [name, raw] of Object.entries<any>(servers)) {
    if (!raw || typeof raw !== 'object') continue;
    const type = String(raw.type || (raw.url ? 'http' : 'stdio')).toLowerCase();
    const isHttp = ['http', 'streamable-http', 'streamablehttp', 'sse'].includes(type) || (!!raw.url && type !== 'stdio');
    const proposal: ProjectServerProposal = isHttp
      ? { file, name, transport: 'http', url: String(raw.url || ''), headers: strRecord(raw.headers), needsSetup: false }
      : { file, name, transport: 'stdio', command: String(raw.command || ''), args: Array.isArray(raw.args) ? raw.args.map(String) : [], env: strRecord(raw.env), needsSetup: false };
    if (type === 'sse') proposal.unsupported = 'ancien transport SSE : utilise l\'adresse HTTP du serveur si elle existe';
    if (!isHttp && !proposal.command) continue;
    proposal.needsSetup = /\$\{[^}]+\}/.test(JSON.stringify(raw));
    out.push(proposal);
  }
  return out;
}
