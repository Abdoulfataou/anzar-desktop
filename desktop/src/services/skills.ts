/**
 * Skills : des fiches d'instructions réutilisables que l'agent charge quand la
 * tâche s'y prête (même principe que les skills de ZCode / Claude Code).
 *
 * Une skill = un dossier contenant SKILL.md :
 *   ---
 *   name: deploiement-railway
 *   description: Déployer le backend sur Railway (variables, build, vérifications)
 *   ---
 *   Instructions en Markdown…
 *
 * Emplacements :
 * - projet    : <dossier du projet>/.anzar/skills/<nom>/SKILL.md (partagées avec le dépôt)
 * - personnel : dossier de données de l'app, store/skills/<nom>/SKILL.md (tous les projets)
 * Une skill du projet remplace une skill personnelle du même nom.
 */
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { ensureDir, listDir, readText, removeDirEntry, writeText } from '@/lib/fileStore';

export interface Skill {
  name: string;
  description: string;
  body: string;
  source: 'project' | 'personal';
}

export const MAX_SKILL_BODY_CHARS = 20_000;

/** Nom de skill : minuscules, chiffres et tirets. */
export function slugifySkillName(raw: string): string {
  return raw
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function parseSkill(markdown: string, fallbackName: string): Omit<Skill, 'source'> {
  const fm = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(markdown);
  const meta: Record<string, string> = {};
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
      if (m) meta[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  const body = (fm ? markdown.slice(fm[0].length) : markdown).trim();
  const firstLine = body.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '') || '';
  return {
    name: slugifySkillName(meta.name || fallbackName) || fallbackName,
    description: (meta.description || firstLine).slice(0, 200),
    body,
  };
}

export function serializeSkill(skill: { name: string; description: string; body: string }): string {
  const desc = skill.description.replace(/\n+/g, ' ').trim();
  return `---\nname: ${skill.name}\ndescription: ${desc}\n---\n\n${skill.body.trim()}\n`;
}

async function listProjectSkills(workspacePath: string): Promise<Skill[]> {
  const dir = `${workspacePath.replace(/[\\/]+$/, '')}/.anzar/skills`;
  const out: Skill[] = [];
  try {
    const nodes = await fileSystemService.readDirectoryTree(dir, 2);
    for (const n of nodes) {
      if (n.type !== 'directory') continue;
      const file = (n.children || []).find((c) => c.type === 'file' && c.name.toLowerCase() === 'skill.md');
      if (!file) continue;
      const text = await fileSystemService.readFile(file.path).catch(() => '');
      if (text.trim()) out.push({ ...parseSkill(text, n.name), source: 'project' });
    }
  } catch { /* pas de skills dans ce projet */ }
  return out;
}

async function listPersonalSkills(): Promise<Skill[]> {
  const out: Skill[] = [];
  for (const name of await listDir('skills')) {
    const text = await readText(`skills/${name}/SKILL.md`);
    if (text?.trim()) out.push({ ...parseSkill(text, name), source: 'personal' });
  }
  return out;
}

/** Skills disponibles pour un projet (celles du projet d'abord). */
export async function listSkills(workspacePath: string | null): Promise<Skill[]> {
  const [project, personal] = await Promise.all([
    workspacePath ? listProjectSkills(workspacePath) : Promise.resolve([]),
    listPersonalSkills(),
  ]);
  const names = new Set(project.map((s) => s.name));
  return [...project, ...personal.filter((s) => !names.has(s.name))].sort((a, b) => a.name.localeCompare(b.name));
}

export async function savePersonalSkill(skill: { name: string; description: string; body: string }, previousName?: string): Promise<void> {
  const name = slugifySkillName(skill.name);
  if (!name) throw new Error('Nom de skill invalide');
  await ensureDir(`skills/${name}`);
  await writeText(`skills/${name}/SKILL.md`, serializeSkill({ ...skill, name }));
  if (previousName && previousName !== name) await removeDirEntry(`skills/${previousName}`);
}

export async function deletePersonalSkill(name: string): Promise<void> {
  await removeDirEntry(`skills/${slugifySkillName(name)}`);
}

/** Section du prompt système : la liste (nom + description), pas le contenu. */
export function skillsPromptSection(skills: Skill[]): string {
  if (!skills.length) return '';
  return `\n\n# Skills disponibles
Ce sont des fiches d'instructions éprouvées. Quand l'une d'elles correspond à la tâche, charge-la avec load_skill AVANT d'agir, puis suis ses instructions.
${skills.map((s) => `- ${s.name} : ${s.description}`).join('\n')}`;
}
