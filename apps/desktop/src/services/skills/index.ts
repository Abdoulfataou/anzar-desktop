/**
 * Skills : des fiches d'instructions réutilisables que l'agent charge quand la
 * tâche s'y prête. Format du standard ouvert Agent Skills (agentskills.io), le même
 * que Claude Code, Codex, DeepSeek Harness (dsh) et une quarantaine d'autres outils :
 * une skill écrite pour l'un fonctionne dans ANZAR, et inversement.
 *
 * Une skill = un dossier contenant SKILL.md, et éventuellement d'autres fichiers
 * (références, modèles, scripts) que l'agent lit à la demande :
 *   ---
 *   name: deploiement-railway
 *   description: Déployer le backend sur Railway (variables, build, vérifications)
 *   ---
 *   Instructions en Markdown…
 *
 * Emplacements, du plus prioritaire au moins prioritaire (même nom = le premier gagne) :
 * - projet    : .anzar/skills, .agents/skills, .dsh/skills, .claude/skills du dossier ouvert
 * - personnel : dossier de données de l'app (store/skills), puis ~/.agents/skills et ~/.dsh/skills
 * - intégré   : le pack fourni avec ANZAR (services/skills/pack)
 */
import { getRemoteSkills } from '@/services/skills/remote';
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { ensureDir, removeDirEntry, storeRoot, writeText } from '@/lib/fileStore';
import { BUILTIN_SKILLS } from '@/services/skills/pack';
import { parseSkill, serializeSkill, slugifySkillName } from './format';

export { parseFrontmatter, parseSkill, parseToolList, serializeSkill, slugifySkillName, type ParsedSkill } from './format';

export type SkillSource = 'project' | 'personal' | 'builtin';

export interface Skill {
  name: string;
  description: string;
  body: string;
  source: SkillSource;
  /** Dossier de la skill sur le disque (absent pour les skills intégrées) */
  dir?: string;
  /** Emplacement lisible : « .agents/skills », « ~/.agents/skills », « ANZAR »… */
  origin: string;
  /** Fichiers joints, chemins relatifs au dossier de la skill (SKILL.md exclu) */
  files: string[];
  /** Skill personnelle modifiable dans l'app (créée ou installée par ANZAR) */
  editable: boolean;
  /** Outils pré-approuvés déclarés dans le frontmatter (`allowed-tools`) */
  allowedTools?: string[];
  /** Contenu des fichiers joints d'une skill servie par le serveur (pas de dossier sur le disque) */
  inlineFiles?: Record<string, string>;
}

export const MAX_SKILL_BODY_CHARS = 20_000;
export const MAX_SKILL_FILE_CHARS = 40_000;
const MAX_FILES_PER_SKILL = 60;

/** Dossiers de skills d'un projet, du plus prioritaire au moins prioritaire. */
export const PROJECT_SKILL_DIRS = ['.anzar/skills', '.agents/skills', '.dsh/skills', '.claude/skills'];
/** Dossiers personnels partagés avec les autres outils compatibles. */
const HOME_SKILL_DIRS = ['.agents/skills', '.dsh/skills'];

// ============================================================================
// LECTURE DES SKILLS
// ============================================================================

const join = (...parts: string[]) => parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, ''))).join('/');

/** Fichiers d'une skill (chemins relatifs), sans SKILL.md ni fichiers cachés. */
async function listSkillFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (path: string, prefix: string, depth: number) => {
    const nodes = await fileSystemService.readDirectoryTree(path, 1).catch(() => []);
    for (const n of nodes) {
      if (out.length >= MAX_FILES_PER_SKILL) return;
      const rel = prefix ? `${prefix}/${n.name}` : n.name;
      if (n.type === 'directory') {
        if (depth > 0) await walk(n.path, rel, depth - 1);
      } else if (rel.toLowerCase() !== 'skill.md') {
        out.push(rel);
      }
    }
  };
  await walk(dir, '', 3);
  return out.sort();
}

/** Toutes les skills d'un dossier racine (<racine>/<nom>/SKILL.md). */
async function readSkillsRoot(root: string, source: SkillSource, origin: string, editable: boolean): Promise<Skill[]> {
  if (!(await fileSystemService.exists(root).catch(() => false))) return [];
  const nodes = await fileSystemService.readDirectoryTree(root, 2).catch(() => []);
  const out: Skill[] = [];
  for (const n of nodes) {
    if (n.type !== 'directory') continue;
    const file = (n.children || []).find((c) => c.type === 'file' && c.name.toLowerCase() === 'skill.md');
    if (!file) continue;
    const text = await fileSystemService.readFile(file.path).catch(() => '');
    if (!text.trim()) continue;
    const parsed = parseSkill(text, n.name);
    out.push({
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      source,
      dir: n.path,
      origin,
      files: await listSkillFiles(n.path),
      editable,
    });
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

/** Dossier des skills personnelles gérées par ANZAR. */
export async function personalSkillsRoot(): Promise<string | null> {
  const root = await storeRoot();
  return root ? `${root}/skills` : null;
}

/** Skills disponibles pour un projet : projet, puis personnelles, puis intégrées. */
export async function listSkills(workspacePath: string | null): Promise<Skill[]> {
  const home = await homeDirectory();
  const personalRoot = await personalSkillsRoot();
  const batches = await Promise.all([
    ...(workspacePath ? PROJECT_SKILL_DIRS.map((d) => readSkillsRoot(join(workspacePath, d), 'project', d, false)) : []),
    personalRoot ? readSkillsRoot(personalRoot, 'personal', 'ANZAR', true) : Promise.resolve([]),
    ...(home ? HOME_SKILL_DIRS.map((d) => readSkillsRoot(join(home, d), 'personal', `~/${d}`, false)) : []),
  ]);
  const builtin: Skill[] = BUILTIN_SKILLS.map((s) => ({ ...parseSkill(s.markdown, s.name), source: 'builtin', origin: 'ANZAR', files: [], editable: false }));
  // Skills du serveur : prioritaires sur celles intégrées à l'app (versions plus récentes)
  const remote: Skill[] = (await getRemoteSkills().catch(() => []))
    .map((s) => ({
      ...parseSkill(s.markdown, s.name), source: 'builtin' as const, origin: 'ANZAR', editable: false,
      files: Object.keys(s.files ?? {}).sort(), inlineFiles: s.files,
    }));

  const seen = new Set<string>();
  const result: Skill[] = [];
  for (const skill of [...batches.flat(), ...remote, ...builtin]) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    result.push(skill);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** Retrouve une skill par son nom (exact, sinon nom qui le contient). */
export function findSkill(skills: Skill[], wanted: string): Skill | undefined {
  const w = slugifySkillName(wanted);
  return skills.find((s) => s.name === w) || (w.length > 2 ? skills.find((s) => s.name.includes(w)) : undefined);
}

/** Lit un fichier joint d'une skill. Refuse tout chemin qui sortirait du dossier de la skill. */
export async function readSkillFile(skill: Skill, rel: string): Promise<string> {
  const clean = rel.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!skill.dir && !skill.inlineFiles) throw new Error('cette skill n\'a pas de fichiers joints');
  if (!clean || clean.startsWith('/') || clean.split('/').includes('..') || /^[a-z]:/i.test(clean)) {
    throw new Error('chemin invalide');
  }
  if (!skill.files.includes(clean)) {
    throw new Error(`fichier absent de la skill. Fichiers : ${skill.files.join(', ') || 'aucun'}`);
  }
  const text = skill.inlineFiles
    ? skill.inlineFiles[clean]
    : await fileSystemService.readFile(join(skill.dir!, clean));
  return text.length > MAX_SKILL_FILE_CHARS
    ? `${text.slice(0, MAX_SKILL_FILE_CHARS)}\n… [fichier tronqué : ${text.length.toLocaleString('fr-FR')} caractères]`
    : text;
}

// ============================================================================
// ÉCRITURE (skills personnelles gérées par l'app)
// ============================================================================

export async function savePersonalSkill(skill: { name: string; description: string; body: string }, previousName?: string): Promise<void> {
  const name = slugifySkillName(skill.name);
  if (!name) throw new Error('Nom de skill invalide');
  await ensureDir(`skills/${name}`);
  await writeText(`skills/${name}/SKILL.md`, serializeSkill({ ...skill, name }));
  if (previousName && previousName !== name) await removeDirEntry(`skills/${slugifySkillName(previousName)}`);
}

export async function deletePersonalSkill(name: string): Promise<void> {
  await removeDirEntry(`skills/${slugifySkillName(name)}`);
}

// ============================================================================
// PROMPT
// ============================================================================

/** Section du prompt système : la liste (nom + description), pas le contenu. */
export function skillsPromptSection(skills: Skill[]): string {
  if (!skills.length) return '';
  return `\n\n# Skills disponibles
Ce sont des fiches d'instructions éprouvées. Quand l'une d'elles correspond à la tâche, charge-la avec load_skill AVANT d'agir, puis suis ses instructions.
Une skill peut avoir des fichiers joints (références, modèles) : charge-les avec load_skill et le paramètre file, seulement quand ses instructions le demandent.
Ne lance jamais un script fourni par une skill sans l'accord explicite de l'utilisateur.
${skills.map((s) => `- ${s.name} : ${s.description}`).join('\n')}`;
}

/** Résultat de load_skill renvoyé à l'agent. */
export function skillToolOutput(skill: Skill, prefix: string): string {
  const files = skill.files.length
    ? `\n\n---\nFichiers joints (load_skill avec name="${skill.name}" et file="<chemin>") :\n${skill.files.map((f) => `- ${f}`).join('\n')}`
    : '';
  const tools = skill.allowedTools?.length ? `\n\nOutils prévus par cette skill : ${skill.allowedTools.join(', ')}` : '';
  return `${prefix}${skill.name} »\n\n${skill.body.slice(0, MAX_SKILL_BODY_CHARS)}${tools}${files}`;
}
