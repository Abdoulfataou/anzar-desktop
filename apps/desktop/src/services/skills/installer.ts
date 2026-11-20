/**
 * Installation de skills depuis GitHub, avec revue avant activation.
 *
 * Passe uniquement par l'API GitHub (api.github.com, autorisée par la CSP) :
 *   1. /repos/{o}/{r}             → branche par défaut
 *   2. /repos/{o}/{r}/git/trees   → tous les SKILL.md du dépôt (un seul appel)
 *   3. /repos/{o}/{r}/git/blobs   → contenu de chaque fichier de la skill choisie
 * Rien n'est exécuté : les fichiers sont lus, montrés à l'utilisateur avec les
 * points d'attention détectés, puis écrits seulement s'il confirme.
 * Sans compte GitHub : 60 requêtes par heure et par adresse IP.
 */
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { parseSkill, personalSkillsRoot, slugifySkillName } from '@/services/skills';

const API = 'https://api.github.com';
const MAX_FILES = 60;
const MAX_FILE_BYTES = 400_000;
const MAX_TOTAL_BYTES = 2_000_000;

export interface GitHubTarget {
  owner: string;
  repo: string;
  ref?: string;
  /** Sous-dossier visé (vide = tout le dépôt) */
  path: string;
}

export interface SkillCandidate {
  /** Dossier de la skill dans le dépôt ('' si SKILL.md est à la racine) */
  dir: string;
  name: string;
}

export interface RepoScan {
  target: GitHubTarget & { ref: string };
  candidates: SkillCandidate[];
  license: string | null;
  stars: number;
  description: string;
}

export interface SkillFilePreview {
  path: string;
  size: number;
  /** Contenu texte (absent pour un fichier binaire ou trop gros, qui ne sera pas installé) */
  content?: string;
  script: boolean;
}

export interface Warning {
  level: 'danger' | 'attention';
  text: string;
}

export interface SkillPreview {
  name: string;
  description: string;
  body: string;
  /** SKILL.md tel que publié, écrit tel quel à l'installation */
  raw: string;
  files: SkillFilePreview[];
  license: string | null;
  warnings: Warning[];
  source: { url: string; owner: string; repo: string; ref: string; dir: string };
}

/** Accepte owner/repo, l'URL du dépôt, d'un dossier (tree) ou d'un SKILL.md (blob). */
export function parseGitHubInput(input: string): GitHubTarget | null {
  const raw = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(raw);
  if (short) return { owner: short[1], repo: short[2], path: '' };
  let url: URL;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/^(www\.)?github\.com$/.test(url.hostname)) return null;
  const [owner, repo, kind, ref, ...rest] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (!owner || !repo) return null;
  if ((kind === 'tree' || kind === 'blob') && ref) {
    let path = rest.join('/');
    if (kind === 'blob') path = path.replace(/\/?SKILL\.md$/i, '');
    return { owner, repo, ref, path };
  }
  return { owner, repo, path: '' };
}

async function gh<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Accept: 'application/vnd.github+json' }, signal });
  if (res.status === 404) throw new Error('Dépôt ou dossier introuvable (ou privé).');
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset') || 0);
    const when = reset ? ` Réessaie après ${new Date(reset * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.` : '';
    throw new Error(`Limite de requêtes GitHub atteinte (60 par heure sans compte).${when}`);
  }
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}.`);
  return res.json() as Promise<T>;
}

interface TreeEntry { path: string; type: 'blob' | 'tree'; sha: string; size?: number }
const treeCache = new Map<string, TreeEntry[]>();

async function repoTree(t: GitHubTarget & { ref: string }, signal?: AbortSignal): Promise<TreeEntry[]> {
  const key = `${t.owner}/${t.repo}@${t.ref}`;
  const cached = treeCache.get(key);
  if (cached) return cached;
  const data = await gh<{ tree: TreeEntry[]; truncated: boolean }>(
    `/repos/${t.owner}/${t.repo}/git/trees/${encodeURIComponent(t.ref)}?recursive=1`, signal);
  treeCache.set(key, data.tree);
  return data.tree;
}

/** Cherche les skills d'un dépôt (ou d'un de ses dossiers). */
export async function scanRepo(target: GitHubTarget, signal?: AbortSignal): Promise<RepoScan> {
  const info = await gh<{ default_branch: string; license?: { spdx_id?: string; name?: string } | null; stargazers_count: number; description: string | null }>(
    `/repos/${target.owner}/${target.repo}`, signal);
  const t = { ...target, ref: target.ref || info.default_branch };
  const tree = await repoTree(t, signal);
  const prefix = t.path ? `${t.path.replace(/\/+$/, '')}/` : '';
  const candidates = tree
    .filter((e) => e.type === 'blob' && /(^|\/)SKILL\.md$/i.test(e.path))
    .filter((e) => !prefix || e.path.startsWith(prefix) || e.path.toLowerCase() === `${prefix}skill.md`)
    .map((e) => {
      const dir = e.path.replace(/\/?SKILL\.md$/i, '');
      return { dir, name: slugifySkillName(dir.split('/').pop() || t.repo) };
    })
    .slice(0, 200);
  const spdx = info.license?.spdx_id && info.license.spdx_id !== 'NOASSERTION' ? info.license.spdx_id : info.license?.name || null;
  return { target: t, candidates, license: spdx, stars: info.stargazers_count, description: info.description || '' };
}

const SCRIPT_EXT = /\.(sh|bash|zsh|ps1|bat|cmd|py|js|mjs|cjs|ts|rb|pl|php|exe|bin)$/i;

function decodeBase64Utf8(b64: string): string | null {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (bytes.includes(0)) return null; // binaire
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Points d'attention : ce qu'une skill pourrait faire faire à l'agent. */
export function inspectSkill(body: string, files: SkillFilePreview[]): Warning[] {
  const warnings: Warning[] = [];
  const all = [body, ...files.map((f) => f.content || '')].join('\n');
  const rules: [RegExp, Warning][] = [
    [/(curl|wget|iwr|Invoke-WebRequest)[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|python|node|iex)/i,
      { level: 'danger', text: 'Télécharge et exécute du code depuis Internet (curl … | sh).' }],
    [/ignore (all |any )?(previous|prior|above) instructions|ignore les instructions|oublie (tes|les) instructions/i,
      { level: 'danger', text: "Contient une tentative de détourner l'agent (« ignore les instructions précédentes »)." }],
    [/\.ssh\/|id_rsa|id_ed25519|\.aws\/credentials|keychain|wallet\.dat/i,
      { level: 'danger', text: 'Mentionne des fichiers de clés ou d\'identifiants (.ssh, .aws…).' }],
    [/rm\s+-rf\s+(\/|~|\$HOME|\*)|del\s+\/[sq]|format\s+c:/i,
      { level: 'danger', text: 'Contient une commande de suppression massive.' }],
    [/(process\.env|os\.environ|\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD))[\s\S]{0,200}(fetch|curl|requests\.|http)/i,
      { level: 'danger', text: 'Lit des variables secrètes puis contacte le réseau : risque de fuite.' }],
    [/[A-Za-z0-9+/]{400,}={0,2}/,
      { level: 'attention', text: 'Contient un long bloc encodé (base64) illisible.' }],
    [/sudo\s/i, { level: 'attention', text: 'Demande des droits administrateur (sudo).' }],
    [/(npm|pnpm|yarn)\s+(i|install|add)\s+-g|pip\s+install(?!\s+-r)/i,
      { level: 'attention', text: 'Installe des paquets sur la machine.' }],
  ];
  for (const [re, w] of rules) if (re.test(all)) warnings.push(w);
  const scripts = files.filter((f) => f.script);
  if (scripts.length) {
    warnings.push({ level: 'attention', text: `${scripts.length} script(s) fourni(s) : ils ne s'exécutent jamais tout seuls, l'agent doit te demander l'accord.` });
  }
  const skipped = files.filter((f) => f.content === undefined);
  if (skipped.length) warnings.push({ level: 'attention', text: `${skipped.length} fichier(s) binaire(s) ou trop gros ignoré(s).` });
  return warnings;
}

/** Télécharge le contenu d'une skill pour la montrer avant installation. */
export async function previewSkill(scan: RepoScan, candidate: SkillCandidate, signal?: AbortSignal): Promise<SkillPreview> {
  const t = scan.target;
  const tree = await repoTree(t, signal);
  const prefix = candidate.dir ? `${candidate.dir}/` : '';
  const entries = tree
    .filter((e) => e.type === 'blob' && (!prefix || e.path.startsWith(prefix)))
    // À la racine d'un dépôt : on ne prend que SKILL.md et les dossiers usuels d'une skill
    .filter((e) => prefix || /^(SKILL\.md|references\/|scripts\/|assets\/|templates\/|examples\/|LICENSE)/i.test(e.path))
    .slice(0, MAX_FILES);

  let total = 0;
  let skillMd = '';
  const files: SkillFilePreview[] = [];
  let ownLicense: string | null = null;
  for (const e of entries) {
    const rel = e.path.slice(prefix.length);
    const size = e.size || 0;
    if (/^\./.test(rel.split('/').pop() || '')) continue; // fichiers cachés ignorés
    let content: string | undefined;
    if (size <= MAX_FILE_BYTES && total + size <= MAX_TOTAL_BYTES) {
      const blob = await gh<{ content: string }>(`/repos/${t.owner}/${t.repo}/git/blobs/${e.sha}`, signal);
      content = decodeBase64Utf8(blob.content) ?? undefined;
      if (content !== undefined) total += size;
    }
    if (rel.toLowerCase() === 'skill.md') { skillMd = content || ''; continue; }
    if (/^licen[cs]e(\.(txt|md))?$/i.test(rel) && content) ownLicense = content.split('\n').find((l) => l.trim())?.trim().slice(0, 120) || null;
    files.push({ path: rel, size, content, script: SCRIPT_EXT.test(rel) });
  }
  if (!skillMd.trim()) throw new Error('SKILL.md vide ou illisible.');

  const parsed = parseSkill(skillMd, candidate.name);
  const url = `https://github.com/${t.owner}/${t.repo}/tree/${t.ref}/${candidate.dir}`.replace(/\/$/, '');
  return {
    name: parsed.name,
    description: parsed.description,
    body: parsed.body,
    raw: skillMd,
    files,
    license: parsed.license || ownLicense || scan.license,
    warnings: inspectSkill(parsed.body, files),
    source: { url, owner: t.owner, repo: t.repo, ref: t.ref, dir: candidate.dir },
  };
}

/** Écrit la skill revue : pour tous les projets (dossier ANZAR) ou dans le projet ouvert. */
export async function installSkill(preview: SkillPreview, where: { scope: 'personal' } | { scope: 'project'; workspacePath: string }): Promise<string> {
  const name = slugifySkillName(preview.name);
  if (!name) throw new Error('Nom de skill invalide');
  const base = where.scope === 'personal'
    ? await personalSkillsRoot()
    : `${where.workspacePath.replace(/[\\/]+$/, '')}/.anzar/skills`;
  if (!base) throw new Error('Dossier de données indisponible');
  const dir = `${base}/${name}`;
  if (await fileSystemService.exists(`${dir}/SKILL.md`).catch(() => false)) {
    throw new Error(`Une skill « ${name} » existe déjà à cet endroit. Supprime-la d'abord pour la remplacer.`);
  }
  await fileSystemService.writeFile(`${dir}/SKILL.md`, preview.raw);
  for (const f of preview.files) {
    if (f.content === undefined) continue;
    const rel = f.path.replace(/\\/g, '/');
    if (rel.split('/').includes('..') || rel.startsWith('/')) continue;
    await fileSystemService.writeFile(`${dir}/${rel}`, f.content);
  }
  await fileSystemService.writeFile(`${dir}/.source.json`, JSON.stringify({
    ...preview.source, license: preview.license, installedAt: new Date().toISOString(),
  }, null, 2));
  return dir;
}

/** Dépôts de skills reconnus, proposés dans la page Skills. */
export const SUGGESTED_REPOS: { repo: string; label: string; note: string }[] = [
  { repo: 'obra/superpowers', label: 'Superpowers', note: 'Méthode de travail complète : plans, TDD, débogage, sous-agents. Licence MIT.' },
  { repo: 'anthropics/skills', label: 'Skills Anthropic', note: 'Exemples officiels du standard. Apache-2.0, sauf docx, pdf, pptx et xlsx (licence propriétaire).' },
];
