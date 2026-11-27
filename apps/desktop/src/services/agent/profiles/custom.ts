/**
 * Agents personnalisés : des rôles de sous-agents écrits par l'utilisateur, en plus des rôles
 * livrés avec ANZAR (dev, revue, redaction, motion-designer).
 *
 * Un agent = un fichier Markdown : frontmatter (name, description, tools, model, skills,
 * max_steps, deny, keywords) + consignes. C'est le format des sous-agents de Claude Code
 * (.claude/agents/*.md) : un agent écrit pour Claude Code marche ici, ses noms d'outils
 * (Read, Edit, Bash…) et de modèles (haiku, sonnet, opus, inherit) sont traduits.
 *
 * Emplacements, du plus prioritaire au moins prioritaire (même nom = le premier gagne) :
 * - projet    : .anzar/agents, .claude/agents du dossier ouvert (voyagent avec le dépôt)
 * - personnel : dossier de données de l'app (store/agents, modifiable dans l'app), ~/.claude/agents
 * - intégré   : services/agent/profiles/*.md
 * Un agent du même nom qu'un rôle intégré le remplace (comme dans Claude Code).
 *
 * Un agent personnalisé ne gagne aucun droit : ses outils sont toujours l'intersection avec
 * ceux du mode choisi par l'utilisateur (policy/subagentPolicy.ts).
 */
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { ensureDir, removeEntry, storeRoot, writeText } from '@/lib/fileStore';
import { parseFrontmatter, parseToolList, slugifySkillName } from '@/services/skills/format';
import { AGENT_TOOLS, BASH_TOOLS } from '../tools/definitions';
import { AGENT_PROFILES, parseProfile, type AgentProfile } from './index';
import { validateProfile } from './validate';

export type CustomAgentSource = 'project' | 'personal';

export interface CustomAgent extends AgentProfile {
  source: CustomAgentSource;
  /** Emplacement lisible : « .anzar/agents », « ~/.claude/agents », « ANZAR »… */
  origin: string;
  path: string;
  /** Agent personnel géré par l'app (modifiable et supprimable ici). */
  editable: boolean;
  /** Remplace un rôle livré avec ANZAR. */
  overridesBuiltin: boolean;
  /** Problèmes non bloquants (outil inconnu ignoré, modèle traduit…). */
  warnings: string[];
}

export const PROJECT_AGENT_DIRS = ['.anzar/agents', '.claude/agents'];
const HOME_AGENT_DIRS = ['.claude/agents'];
/** Noms réservés : l'explorateur interne et le nom du parent dans les messages. */
const RESERVED = new Set(['explorer', 'lead']);
const MAX_AGENTS_PER_DIR = 50;
const MAX_PROMPT_CHARS = 12_000;

const KNOWN_TOOLS = new Set([...AGENT_TOOLS, ...BASH_TOOLS].map((t) => t.function.name));

/** Outils de Claude Code → outils ANZAR. Les outils sans équivalent sont ignorés. */
const CLAUDE_TOOLS: Record<string, string[]> = {
  read: ['read_file'],
  ls: ['list_dir'],
  glob: ['glob'],
  grep: ['search_files'],
  edit: ['edit_file', 'apply_patch'],
  multiedit: ['edit_file', 'apply_patch'],
  write: ['write_file'],
  bash: ['bash', 'run_command', 'job_output', 'job_kill'],
  bashoutput: ['job_output'],
  killshell: ['job_kill'],
  notebookedit: ['edit_file'],
};

/** Modèles de Claude Code → modèles ANZAR (DeepSeek). « inherit » = défaut d'ANZAR. */
const MODEL_ALIASES: Record<string, AgentProfile['model'] | null> = {
  inherit: null,
  haiku: 'fast',
  sonnet: 'fast',
  opus: 'pro',
  fast: 'fast',
  thinking: 'thinking',
  pro: 'pro',
  max: 'max',
};

/** Traduit les outils déclarés ; rend aussi ceux qui ont été ignorés. */
export function normalizeTools(raw: string[]): { tools: string[]; ignored: string[] } {
  const tools = new Set<string>();
  const ignored: string[] = [];
  for (const entry of raw) {
    const name = entry.replace(/\(.*$/, '').trim();
    if (!name) continue;
    if (KNOWN_TOOLS.has(name)) { tools.add(name); continue; }
    const mapped = CLAUDE_TOOLS[name.toLowerCase()];
    if (mapped) mapped.forEach((t) => tools.add(t));
    else ignored.push(name);
  }
  return { tools: [...tools], ignored };
}

type AgentLocation = { source: CustomAgentSource; origin: string; path: string; editable: boolean };

/** Fichier d'agent écarté, avec la raison en clair (affiché dans la page Agents). */
export interface IgnoredAgentFile extends AgentLocation {
  /** Nom de fichier (ou nom déclaré, quand il a pu être lu). */
  name: string;
  reason: string;
  /** « shadowed » : valide mais remplacé par un agent du même nom plus prioritaire. */
  kind: 'invalid' | 'shadowed';
}

/** Lit un fichier d'agent et rend l'agent, ou la raison pour laquelle il est inutilisable. */
export function readCustomAgent(
  markdown: string,
  fallbackName: string,
  where: AgentLocation,
): { agent: CustomAgent; reason?: undefined } | { agent?: undefined; reason: string } {
  const text = markdown.replace(/^\uFEFF/, '');
  if (!text.trim()) return { reason: 'fichier vide' };
  const fm = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  if (!fm) {
    return { reason: "pas d'en-tête : le fichier doit commencer par une ligne ---, puis name: et description:, puis une ligne ---" };
  }
  const meta = parseFrontmatter(fm[1]);
  const warnings: string[] = [];

  const name = slugifySkillName(meta.name || fallbackName);
  if (!name || name.length < 2) return { reason: 'nom invalide : au moins 2 caractères, lettres, chiffres et tirets' };
  if (RESERVED.has(name)) return { reason: `« ${name} » est un nom réservé par ANZAR : choisis un autre nom` };
  const description = (meta.description || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!description) {
    return { reason: "description manquante : ajoute description: dans l'en-tête, l'agent principal la lit pour choisir ce spécialiste" };
  }

  // Le reste du frontmatter suit le format des profils intégrés
  const base = parseProfile(text, name);
  const declared = parseToolList(meta.tools);
  const { tools, ignored } = normalizeTools(declared);
  if (ignored.length) warnings.push(`outils ignorés (sans équivalent dans ANZAR) : ${ignored.join(', ')}`);
  if (declared.length && tools.length === 0) {
    return {
      reason: `aucun outil reconnu dans tools (${ignored.join(', ')}) : utilise des noms ANZAR ou de Claude Code (Read, Edit, Bash…), ou retire la ligne pour donner tous les outils du mode`,
    };
  }

  const rawModel = (meta.model || '').trim().toLowerCase();
  let model: AgentProfile['model'];
  if (rawModel) {
    const alias = MODEL_ALIASES[rawModel];
    if (alias === undefined) warnings.push(`modèle « ${meta.model} » inconnu : modèle par défaut utilisé`);
    else if (alias) model = alias;
  }

  const prompt = base.prompt.length > MAX_PROMPT_CHARS ? `${base.prompt.slice(0, MAX_PROMPT_CHARS)}…` : base.prompt;
  // Le modèle brut du fichier (« sonnet »…) est remplacé par sa traduction.
  const { model: _raw, ...rest } = base;
  void _raw;
  const profile: AgentProfile = {
    ...rest,
    name,
    description,
    kind: 'subagent',
    tools,
    prompt,
    ...(model ? { model } : {}),
  };
  // Les problèmes de validation restent visibles sans bloquer l'agent (bornes déjà ramenées).
  for (const issue of validateProfile(profile, KNOWN_TOOLS)) {
    if (!/^outil inconnu/.test(issue)) warnings.push(issue);
  }
  return {
    agent: {
      ...profile,
      ...where,
      overridesBuiltin: AGENT_PROFILES[name]?.kind === 'subagent',
      warnings,
    },
  };
}

/** Comme readCustomAgent, sans la raison : `null` quand le fichier est inutilisable. */
export function parseCustomAgent(markdown: string, fallbackName: string, where: AgentLocation): CustomAgent | null {
  return readCustomAgent(markdown, fallbackName, where).agent ?? null;
}

const join = (...parts: string[]) => parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, ''))).join('/');

async function readAgentsDir(
  dir: string,
  source: CustomAgentSource,
  origin: string,
  editable: boolean,
): Promise<{ agents: CustomAgent[]; ignored: IgnoredAgentFile[] }> {
  const agents: CustomAgent[] = [];
  const ignored: IgnoredAgentFile[] = [];
  if (!(await fileSystemService.exists(dir).catch(() => false))) return { agents, ignored };
  const nodes = await fileSystemService.readDirectoryTree(dir, 1).catch(() => []);
  for (const n of nodes) {
    if (n.type !== 'file' || !/\.md$/i.test(n.name)) continue;
    const where = { source, origin, path: n.path, editable };
    const fileName = n.name.replace(/\.md$/i, '');
    if (agents.length >= MAX_AGENTS_PER_DIR) {
      ignored.push({ ...where, name: fileName, kind: 'invalid', reason: `plus de ${MAX_AGENTS_PER_DIR} agents dans ce dossier : les suivants ne sont pas lus` });
      continue;
    }
    let text: string;
    try {
      text = await fileSystemService.readFile(n.path);
    } catch (e: any) {
      ignored.push({ ...where, name: fileName, kind: 'invalid', reason: `lecture impossible — ${e?.message || e}` });
      continue;
    }
    const read = readCustomAgent(text, fileName, where);
    if (read.agent) agents.push(read.agent);
    else ignored.push({ ...where, name: fileName, kind: 'invalid', reason: read.reason });
  }
  return { agents, ignored };
}

async function homeDirectory(): Promise<string | null> {
  try {
    const { homeDir } = await import('@tauri-apps/api/path');
    return (await homeDir()).replace(/[\\/]+$/, '');
  } catch {
    return null;
  }
}

/** Dossier des agents personnels gérés par ANZAR. */
export async function personalAgentsRoot(): Promise<string | null> {
  const root = await storeRoot();
  return root ? `${root}/agents` : null;
}

export interface CustomAgentScan {
  agents: CustomAgent[];
  /** Fichiers écartés (invalides ou masqués par un agent du même nom), pour les expliquer. */
  ignored: IgnoredAgentFile[];
}

/**
 * Agents personnalisés d'un projet et personnels, dédoublonnés par nom (le plus prioritaire
 * gagne), avec les fichiers écartés et la raison.
 */
export async function scanCustomAgents(workspacePath: string | null): Promise<CustomAgentScan> {
  const home = await homeDirectory();
  const personalRoot = await personalAgentsRoot();
  const empty = { agents: [] as CustomAgent[], ignored: [] as IgnoredAgentFile[] };
  const batches = await Promise.all([
    ...(workspacePath ? PROJECT_AGENT_DIRS.map((d) => readAgentsDir(join(workspacePath, d), 'project', d, false)) : []),
    personalRoot ? readAgentsDir(personalRoot, 'personal', 'ANZAR', true) : Promise.resolve(empty),
    ...(home ? HOME_AGENT_DIRS.map((d) => readAgentsDir(join(home, d), 'personal', `~/${d}`, false)) : []),
  ]);
  const winners = new Map<string, CustomAgent>();
  const ignored: IgnoredAgentFile[] = batches.flatMap((b) => b.ignored);
  for (const agent of batches.flatMap((b) => b.agents)) {
    const winner = winners.get(agent.name);
    if (!winner) { winners.set(agent.name, agent); continue; }
    ignored.push({
      source: agent.source, origin: agent.origin, path: agent.path, editable: agent.editable,
      name: agent.name, kind: 'shadowed',
      reason: `masqué par l'agent du même nom dans ${winner.origin}, prioritaire`,
    });
  }
  return {
    agents: [...winners.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ignored,
  };
}

/** Agents utilisables seulement (ce que reçoit l'agent principal). */
export async function listCustomAgents(workspacePath: string | null): Promise<CustomAgent[]> {
  return (await scanCustomAgents(workspacePath)).agents;
}

/** Profil d'un rôle : agent personnalisé d'abord, puis rôle intégré. */
export function resolveRole(role: string, custom: readonly AgentProfile[] = []): AgentProfile | undefined {
  const found = custom.find((a) => a.name === role);
  if (found) return found;
  const builtin = AGENT_PROFILES[role];
  return builtin?.kind === 'subagent' ? builtin : undefined;
}

/** Tous les rôles disponibles : intégrés et personnalisés, sans doublon. */
export function availableRoles(custom: readonly AgentProfile[] = []): string[] {
  const builtin = Object.values(AGENT_PROFILES).filter((p) => p.kind === 'subagent').map((p) => p.name);
  return [...new Set([...builtin, ...custom.map((a) => a.name)])].sort();
}

/** Section du prompt de l'agent principal : les agents personnalisés (nom + description). */
export function customAgentsPromptSection(agents: readonly CustomAgent[]): string {
  if (!agents.length) return '';
  return `\n\n# Agents du projet et personnels
En plus des rôles intégrés, tu peux confier une tâche à ces agents avec spawn_agent (role = leur nom). Choisis-en un quand sa description correspond mieux à la sous-tâche qu'un rôle intégré.
${agents.map((a) => `- ${a.name} : ${a.description}${a.overridesBuiltin ? ' (remplace le rôle intégré du même nom)' : ''}`).join('\n')}`;
}

// ============================================================================
// ÉCRITURE (agents personnels gérés par l'app)
// ============================================================================

export interface AgentDraft {
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  model?: string;
  skills: string[];
  maxSteps: number;
  deny: string[];
  keywords: string[];
  reasoning?: string;
  budgetFCFA?: number;
  outputMaxChars?: number;
}

const yamlLine = (v: string) => `"${v.replace(/\s+/g, ' ').trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function serializeAgent(d: AgentDraft): string {
  const lines = [
    '---',
    `name: ${slugifySkillName(d.name)}`,
    `description: ${yamlLine(d.description)}`,
    d.tools.length ? `tools: ${d.tools.join(' ')}` : '',
    d.model ? `model: ${d.model}` : '',
    d.reasoning ? `reasoning: ${d.reasoning}` : '',
    d.skills.length ? `skills: ${d.skills.join(' ')}` : '',
    `max_steps: ${Math.max(1, Math.min(60, Math.round(d.maxSteps) || 20))}`,
    d.deny.length ? `deny: ${d.deny.join(', ')}` : '',
    d.keywords.length ? `keywords: ${d.keywords.join(' ')}` : '',
    d.budgetFCFA && d.budgetFCFA > 0 ? `budget_fcfa: ${Math.round(d.budgetFCFA)}` : '',
    d.outputMaxChars ? `output_max_chars: ${Math.round(d.outputMaxChars)}` : '',
    '---',
  ].filter(Boolean);
  return `${lines.join('\n')}\n${d.prompt.trim()}\n`;
}

export async function savePersonalAgent(d: AgentDraft, previousName?: string): Promise<void> {
  const name = slugifySkillName(d.name);
  if (!name || name.length < 2) throw new Error("Nom d'agent invalide");
  if (RESERVED.has(name)) throw new Error(`« ${name} » est un nom réservé`);
  await ensureDir('agents');
  await writeText(`agents/${name}.md`, serializeAgent({ ...d, name }));
  if (previousName && slugifySkillName(previousName) !== name) await removeEntry(`agents/${slugifySkillName(previousName)}.md`);
}

export async function deletePersonalAgent(name: string): Promise<void> {
  await removeEntry(`agents/${slugifySkillName(name)}.md`);
}
