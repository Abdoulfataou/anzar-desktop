import { beforeEach, describe, expect, it, vi } from 'vitest';

// Disque simulé : chemin → contenu ; les dossiers sont déduits des chemins.
const files = new Map<string, string>();
vi.mock('@/services/filesystem/fileSystem', () => ({
  fileSystemService: {
    exists: async (p: string) => [...files.keys()].some((f) => f === p || f.startsWith(`${p}/`)),
    readDirectoryTree: async (dir: string) => [...files.keys()]
      .filter((f) => f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes('/'))
      .map((f) => ({ name: f.slice(dir.length + 1), path: f, type: 'file' })),
    readFile: async (p: string) => files.get(p) ?? '',
  },
}));
const written = new Map<string, string>();
vi.mock('@/lib/fileStore', () => ({
  storeRoot: async () => '/data/store',
  ensureDir: async () => undefined,
  writeText: async (rel: string, text: string) => { written.set(rel, text); },
  removeEntry: async (rel: string) => { written.delete(rel); },
}));
vi.mock('@tauri-apps/api/path', () => ({ homeDir: async () => '/home/abdoul' }));

import {
  availableRoles, customAgentsPromptSection, listCustomAgents, normalizeTools, parseCustomAgent,
  readCustomAgent, resolveRole, savePersonalAgent, scanCustomAgents, serializeAgent,
} from './custom';
import { detectSubagentRole } from './index';

const where = { source: 'project' as const, origin: '.claude/agents', path: '/p/.claude/agents/x.md', editable: false };

const CLAUDE_AGENT = `---
name: code-reviewer
description: Expert code review specialist. Use after writing or modifying code.
tools: Read, Grep, Glob, Bash(git diff:*), WebFetch
model: sonnet
color: blue
---
You are a senior code reviewer ensuring high standards of code quality.`;

beforeEach(() => { files.clear(); written.clear(); });

describe('agents personnalisés', () => {
  it('lit un agent au format Claude Code et traduit outils et modèle', () => {
    const a = parseCustomAgent(CLAUDE_AGENT, 'x', where)!;
    expect(a.name).toBe('code-reviewer');
    expect(a.kind).toBe('subagent');
    expect(a.tools.sort()).toEqual(['bash', 'glob', 'job_kill', 'job_output', 'read_file', 'run_command', 'search_files'].sort());
    expect(a.model).toBe('fast');
    expect(a.prompt).toContain('senior code reviewer');
    expect(a.warnings.join(' ')).toContain('WebFetch');
    expect(a.overridesBuiltin).toBe(false);
  });

  it('traduit les modèles et signale un modèle inconnu', () => {
    const withModel = (m: string) => parseCustomAgent(`---\nname: a1\ndescription: Un agent\nmodel: ${m}\n---\nConsignes.`, 'a1', where)!;
    expect(withModel('opus').model).toBe('pro');
    expect(withModel('inherit').model).toBeUndefined();
    expect(withModel('thinking').model).toBe('thinking');
    const odd = withModel('gpt-9');
    expect(odd.model).toBeUndefined();
    expect(odd.warnings.join(' ')).toMatch(/modèle « gpt-9 » inconnu/);
  });

  it('refuse un fichier inutilisable', () => {
    expect(parseCustomAgent('Pas de frontmatter', 'a', where)).toBeNull();
    expect(parseCustomAgent('---\nname: sans-description\n---\nx', 'a', where)).toBeNull();
    expect(parseCustomAgent('---\nname: explorer\ndescription: x\n---\nx', 'a', where)).toBeNull();
    expect(parseCustomAgent('---\nname: web\ndescription: x\ntools: WebFetch, WebSearch\n---\nx', 'a', where)).toBeNull();
  });

  it('garde les noms ANZAR tels quels', () => {
    expect(normalizeTools(['read_file', 'edit_file', 'Inconnu'])).toEqual({ tools: ['read_file', 'edit_file'], ignored: ['Inconnu'] });
  });

  it('un agent du même nom remplace le rôle intégré', () => {
    const dev = parseCustomAgent('---\nname: dev\ndescription: Notre développeur maison\n---\nSuis notre guide de style.', 'dev', where)!;
    expect(dev.overridesBuiltin).toBe(true);
    expect(resolveRole('dev', [dev])?.description).toBe('Notre développeur maison');
    expect(resolveRole('dev')?.description).toMatch(/^Développeur/);
    expect(resolveRole('explorer')).toBeUndefined();
    expect(availableRoles([dev])).toEqual(['dev', 'motion-designer', 'redaction', 'revue']);
  });

  it('les mots-clés d’un agent personnalisé guident le choix du rôle', () => {
    const flutter = parseCustomAgent('---\nname: expert-flutter\ndescription: Expert Flutter\nkeywords: flutter dart widget\n---\nx', 'f', where)!;
    expect(detectSubagentRole('corrige le widget flutter du panier', [flutter])).toBe('expert-flutter');
    expect(detectSubagentRole('corrige le widget flutter du panier')).toBe('dev');
  });

  it('liste projet, personnels et ~/.claude/agents, le projet en premier', async () => {
    files.set('/p/.anzar/agents/expert-flutter.md', '---\nname: expert-flutter\ndescription: Version du projet\n---\nA');
    files.set('/p/.claude/agents/expert-flutter.md', '---\nname: expert-flutter\ndescription: Version Claude\n---\nB');
    files.set('/data/store/agents/testeur.md', '---\nname: testeur\ndescription: Écrit les tests manquants\n---\nC');
    files.set('/home/abdoul/.claude/agents/code-reviewer.md', CLAUDE_AGENT);
    files.set('/p/.anzar/agents/notes.txt', 'ignoré');
    const agents = await listCustomAgents('/p');
    expect(agents.map((a) => `${a.name}:${a.source}:${a.origin}`)).toEqual([
      'code-reviewer:personal:~/.claude/agents',
      'expert-flutter:project:.anzar/agents',
      'testeur:personal:ANZAR',
    ]);
    expect(agents.find((a) => a.name === 'testeur')?.editable).toBe(true);
    expect(agents.find((a) => a.name === 'expert-flutter')?.description).toBe('Version du projet');
  });

  it('enregistre un agent personnel relisible à l’identique', async () => {
    await savePersonalAgent({
      name: 'Expert Paiement', description: 'Spécialiste Orange Money et Wave', prompt: 'Toujours vérifier la signature du webhook.',
      tools: [], model: 'thinking', skills: ['paiement-mobile-money'], maxSteps: 30, deny: ['shell.exec'], keywords: ['paiement', 'wave'],
    });
    const text = written.get('agents/expert-paiement.md')!;
    const back = parseCustomAgent(text, 'expert-paiement', { ...where, source: 'personal' })!;
    expect(back.name).toBe('expert-paiement');
    expect(back.model).toBe('thinking');
    expect(back.skills).toEqual(['paiement-mobile-money']);
    expect(back.deny).toEqual(['shell.exec']);
    expect(back.maxSteps).toBe(30);
    expect(back.prompt).toBe('Toujours vérifier la signature du webhook.');
    await expect(savePersonalAgent({ ...back, name: 'lead', prompt: 'x', model: undefined, tools: [], skills: [], deny: [], keywords: [] })).rejects.toThrow(/réservé/);
  });

  it('une description avec guillemets et deux-points survit à l’aller-retour', () => {
    const text = serializeAgent({ name: 'a-b', description: 'Rôle : « testeur » "strict"', prompt: 'x', tools: [], skills: [], maxSteps: 20, deny: [], keywords: [] });
    expect(parseCustomAgent(text, 'a-b', where)?.description).toBe('Rôle : « testeur » "strict"');
  });

  it('présente les agents à l’agent principal', () => {
    const a = parseCustomAgent(CLAUDE_AGENT, 'x', where)!;
    const section = customAgentsPromptSection([a]);
    expect(section).toContain('# Agents du projet et personnels');
    expect(section).toContain('- code-reviewer : Expert code review specialist.');
    expect(customAgentsPromptSection([])).toBe('');
  });

  it('donne la raison exacte d’un fichier inutilisable', () => {
    const reason = (md: string) => readCustomAgent(md, 'fichier', where).reason;
    expect(reason('   ')).toBe('fichier vide');
    expect(reason('Tu es un expert.')).toMatch(/^pas d'en-tête/);
    expect(reason('---\nname: a\ndescription: x\n---\ny')).toMatch(/^nom invalide/);
    expect(reason('---\nname: lead\ndescription: x\n---\ny')).toMatch(/« lead » est un nom réservé/);
    expect(reason('---\nname: sans-desc\n---\ny')).toMatch(/^description manquante/);
    expect(reason('---\nname: web\ndescription: x\ntools: WebFetch, WebSearch\n---\ny')).toMatch(/aucun outil reconnu dans tools \(WebFetch, WebSearch\)/);
    expect(readCustomAgent(CLAUDE_AGENT, 'x', where).agent?.name).toBe('code-reviewer');
  });

  it('liste les fichiers ignorés et les agents masqués par un plus prioritaire', async () => {
    files.set('/p/.anzar/agents/testeur.md', '---\nname: testeur\ndescription: Version projet\n---\nA');
    files.set('/data/store/agents/testeur.md', '---\nname: testeur\ndescription: Version perso\n---\nB');
    files.set('/p/.claude/agents/casse.md', 'Juste des consignes, sans en-tête.');
    files.set('/home/abdoul/.claude/agents/vide.md', '');
    const scan = await scanCustomAgents('/p');
    expect(scan.agents.map((a) => `${a.name}:${a.description}`)).toEqual(['testeur:Version projet']);
    const byName = Object.fromEntries(scan.ignored.map((f) => [f.name, f]));
    expect(byName.casse.kind).toBe('invalid');
    expect(byName.casse.reason).toMatch(/^pas d'en-tête/);
    expect(byName.casse.origin).toBe('.claude/agents');
    expect(byName.vide.reason).toBe('fichier vide');
    expect(byName.testeur.kind).toBe('shadowed');
    expect(byName.testeur.reason).toBe("masqué par l'agent du même nom dans .anzar/agents, prioritaire");
    expect(byName.testeur.editable).toBe(true);
    // Ce que reçoit l'agent principal : les agents utilisables seulement
    expect((await listCustomAgents('/p')).map((a) => a.name)).toEqual(['testeur']);
  });
});
