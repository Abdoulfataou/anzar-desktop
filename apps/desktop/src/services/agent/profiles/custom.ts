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

/**
 * Lit un fichier d'agent. Rend `null` quand il n'est pas utilisable (pas de description,
 * nom réservé, aucun outil reconnu alors qu'une liste était donnée).
 */
export function parseCustomAgent(
  markdown: string,
  fallbackName: string,
  where: { source: CustomAgentSource; origin: string; path: string; editable: boolean },
): CustomAgent | null {
  const text = markdown.replace(/^﻿/, '');
  const fm = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  if (!fm) return null;
  const meta = parseFrontmatter(fm[1]);
  const warnings: string[] = [];

  const name = slugifySkillName(meta.name || fallbackName);
  if (!name || name.length < 2 || RESERVED.has(name)) return null;
  const description = (meta.description || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!description) return null;

  // Le reste du frontmatter suit le format des profils intégrés
  const base = parseProfile(text, name);
  const declared = parseToolList(meta.tools);
  const { tools, ignored } = normalizeTools(declared);
  if (ignored.length) warnings.push(`outils ignorés (sans équivalent dans ANZAR) : ${ignored.join(', ')}`);
  if (declared.length && tools.length === 0) return null;

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
    ...profile,
    ...where,
    overridesBuiltin: AGENT_PROFILES[name]?.kind === 'subagent',
    warnings,
  };
}

const join = (...parts: string[]) => parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, ''))).join('/');

async function readAgentsDir(
  dir: string,
  source: CustomAgentSource,
  origin: string,
  editable: boolean,
): Promise<CustomAgent[]> {
  if (!(await fileSystemService.exists(dir).catch(() => false))) return [];
  const nodes = await fileSystemService.readDirectoryTree(dir, 1).catch(() => []);
  const out: CustomAgent[] = [];
  for (const n of nodes) {
    if (out.length >= MAX_AGENTS_PER_DIR) break;
    if (n.type !== 'file' || !/\.md$/i.test(n.name)) continue;
    const text = await fileSystemService.readFile(n.path).catch(() => '');
    const agent = text.trim()
      ? parseCustomAgent(text, n.name.replace(/\.md$/i, ''), { source, origin, path: n.path, editable })
      : null;
    if (agent) out.push(agent);
  }
  return out;
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

/** Agents personnalisés d'un projet et personnels, dédoublonnés par nom (le plus prioritaire gagne). */
export async function listCustomAgents(workspacePath: string | null): Promise<CustomAgent[]> {
  const home = await homeDirectory();
  const personalRoot = await personalAgentsRoot();
  const batches = await Promise.all([
    ...(workspacePath ? PROJECT_AGENT_DIRS.map((d) => readAgentsDir(join(workspacePath, d), 'project', d, false)) : []),
    personalRoot ? readAgentsDir(personalRoot, 'personal', 'ANZAR', true) : Promise.resolve([]),
    ...(home ? HOME_AGENT_DIRS.map((d) => readAgentsDir(join(home, d), 'personal', `~/${d}`, false)) : []),
  ]);
  const seen = new Set<string>();
  const result: CustomAgent[] = [];
  for (const agent of batches.flat()) {
    if (seen.has(agent.name)) continue;
    seen.add(agent.name);
    result.push(agent);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
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
