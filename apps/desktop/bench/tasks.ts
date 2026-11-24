/**
 * Catalogue du banc d'essai.
 *
 * Chaque tâche décrit un scénario **déterministe** : un dépôt de départ, le script du modèle
 * (une action par appel), les vérifications du projet et ce qui est attendu. Le harnais
 * (`bench.test.ts`) exécute le vrai `AgentRunner` avec les outils branchés sur le dépôt en
 * mémoire : ce sont les mécanismes du harnais qui sont mesurés (boucle, budget, détection de
 * boucle, vérification ciblée, ligne de base), pas la qualité du modèle.
 *
 * Ajouter une tâche = ajouter une entrée ici.
 */

export type Action =
  | { a: 'read'; path: string }
  | { a: 'write'; path: string; content: string }
  | { a: 'edit'; path: string; old: string; new: string }
  | { a: 'cmd'; command: string }
  | { a: 'done'; summary: string }
  | { a: 'text'; text: string }
  | { a: 'plan'; title: string; plan: string }
  | { a: 'repeat'; times: number; of: Action };

/** Vérification du projet simulée : la commande passe quand `ok(repo)` est vrai. */
export interface Check {
  command: string;
  ok: (repo: Record<string, string>) => boolean;
  /** Message d'échec ; peut dépendre de l'état du dépôt (pour produire une *nouvelle* erreur). */
  failure: string | ((repo: Record<string, string>) => string);
}

export type ExpectedStop =
  | 'task_done' | 'final_answer' | 'plan' | 'loop_detected' | 'budget_exhausted' | 'verify_failed';

export interface BenchTask {
  id: string;
  prompt: string;
  files: Record<string, string>;
  script: Action[];
  checks?: Check[];
  budget?: { fcfa?: number };
  expect: {
    stop: ExpectedStop;
    /** Contenu attendu des fichiers après le tour (chaîne incluse, ou expression). */
    files?: Record<string, string | RegExp>;
    minCalls?: number;
    maxCalls?: number;
    /** Aucune commande de vérification ne doit être lancée (ciblage total). */
    noCommands?: boolean;
    /** Une commande exacte doit avoir été lancée. */
    command?: string;
    /** Ne doit pas contenir cette commande. */
    notCommand?: string;
  };
}

const PKG = (scripts: Record<string, string>) =>
  JSON.stringify({ name: 'bench', version: '1.0.0', scripts }, null, 2);

const NODE_SCRIPTS = { lint: 'eslint .', build: 'vite build', test: 'vitest run' };

const pkgFiles = (extra: Record<string, string> = {}) => ({
  'package.json': PKG(NODE_SCRIPTS),
  'src/a.ts': 'export const x = 1;\n',
  ...extra,
});

export const TASKS: BenchTask[] = [
  {
    id: 'reponse-simple',
    prompt: 'Explique en une phrase ce que fait src/a.ts.',
    files: pkgFiles(),
    script: [{ a: 'text', text: 'Ce fichier exporte une constante x valant 1.' }],
    expect: { stop: 'final_answer', maxCalls: 1 },
  },
  {
    id: 'lecture-puis-fin',
    prompt: 'Lis src/a.ts et confirme sa valeur.',
    files: pkgFiles(),
    script: [
      { a: 'read', path: 'src/a.ts' },
      { a: 'done', summary: 'x vaut 1.' },
    ],
    expect: { stop: 'task_done', minCalls: 2 },
  },
  {
    id: 'ecriture-simple',
    prompt: 'Crée src/b.ts qui exporte y = 2.',
    files: pkgFiles(),
    script: [
      { a: 'write', path: 'src/b.ts', content: 'export const y = 2;\n' },
      { a: 'done', summary: 'src/b.ts créé.' },
    ],
    expect: {
      stop: 'task_done',
      files: { 'src/b.ts': 'export const y = 2' },
      command: 'npm run build',
    },
  },
  {
    id: 'edition-puis-tests',
    prompt: 'Passe x à 3 dans src/a.ts.',
    files: pkgFiles(),
    script: [
      { a: 'edit', path: 'src/a.ts', old: 'x = 1', new: 'x = 2' },
      { a: 'done', summary: 'x passe à 2.' },
      { a: 'edit', path: 'src/a.ts', old: 'x = 2', new: 'x = 3' },
      { a: 'done', summary: 'x passe à 3.' },
    ],
    checks: [{
      command: 'npm test',
      // x = 1 passe au départ (référence saine) ; x = 2 échoue (nouvel échec) ; x = 3 passe.
      ok: (repo) => /x = (1|3)/.test(repo['src/a.ts'] || ''),
      failure: 'expected x to equal 3',
    }],
    expect: { stop: 'task_done', files: { 'src/a.ts': 'x = 3' }, minCalls: 4 },
  },
  {
    id: 'build-deja-casse',
    prompt: 'Ajoute src/c.ts, sans toucher au build cassé.',
    files: pkgFiles(),
    script: [
      { a: 'write', path: 'src/c.ts', content: 'export const z = 3;\n' },
      { a: 'done', summary: 'src/c.ts ajouté.' },
    ],
    checks: [{
      command: 'npm run build',
      ok: () => false,
      failure: 'error TS100: erreur déjà présente avant la tâche',
    }],
    expect: { stop: 'task_done', minCalls: 2 },
  },
  {
    id: 'nouvelle-erreur',
    prompt: 'Ajoute src/d.ts.',
    files: pkgFiles(),
    script: [
      { a: 'write', path: 'src/d.ts', content: 'export const w = 4;\n' },
      { a: 'done', summary: 'Ajouté.' },
      { a: 'done', summary: 'Ajouté, corrigé.' },
      { a: 'done', summary: 'Toujours cassé.' },
    ],
    checks: [{
      command: 'npm run build',
      ok: (repo) => !repo['src/d.ts'],
      failure: (repo) => (repo['src/d.ts']
        ? 'error TS100: erreur déjà présente\nerror TS200: new failure'
        : 'error TS100: erreur déjà présente'),
    }],
    expect: { stop: 'verify_failed', minCalls: 3 },
  },
  {
    id: 'boucle-identique',
    prompt: 'Écris le même fichier en boucle.',
    files: pkgFiles(),
    script: [
      { a: 'repeat', times: 6, of: { a: 'write', path: 'src/e.ts', content: 'export const e = 1;\n' } },
      { a: 'done', summary: 'Fini.' },
    ],
    // Depuis la refonte : les répétitions ne bloquent plus, un rappel est injecté au
    // 3e appel identique, et la tâche se termine normalement.
    expect: { stop: 'task_done', minCalls: 6, maxCalls: 8 },
  },
  {
    id: 'budget-epuise',
    prompt: 'Lis plusieurs fichiers.',
    files: pkgFiles({ 'src/b.ts': 'export const y = 2;\n', 'src/c.ts': 'export const z = 3;\n' }),
    script: [
      { a: 'read', path: 'src/a.ts' },
      { a: 'read', path: 'src/b.ts' },
      { a: 'read', path: 'src/c.ts' },
      { a: 'done', summary: 'Lu.' },
    ],
    budget: { fcfa: 2 },
    expect: { stop: 'budget_exhausted', maxCalls: 2 },
  },
  {
    id: 'texte-sans-done',
    prompt: 'Crée src/f.ts puis annonce la fin.',
    files: pkgFiles(),
    script: [
      { a: 'write', path: 'src/f.ts', content: 'export const f = 1;\n' },
      { a: 'text', text: 'J’ai créé le fichier.' },
      { a: 'done', summary: 'src/f.ts créé.' },
    ],
    // Le chat n'utilise pas le nudging de `agentLoop` : un texte sans task_done termine le tour.
    expect: { stop: 'final_answer', maxCalls: 2, files: { 'src/f.ts': 'export const f' } },
  },
  {
    id: 'mode-plan',
    prompt: 'Propose un plan pour renommer x.',
    files: pkgFiles(),
    script: [{ a: 'plan', title: 'Renommer x', plan: '## Étapes\n1. Renommer x en value.\n' }],
    expect: { stop: 'plan', maxCalls: 1 },
  },
  {
    id: 'ciblage-docs',
    prompt: 'Mets à jour le README.',
    files: pkgFiles({ 'README.md': '# Projet\n' }),
    script: [
      { a: 'write', path: 'README.md', content: '# Projet\n\nDescription.\n' },
      { a: 'done', summary: 'README mis à jour.' },
    ],
    expect: { stop: 'task_done', noCommands: true, files: { 'README.md': 'Description' } },
  },
  {
    id: 'ciblage-test',
    prompt: 'Modifie src/a.ts.',
    files: pkgFiles({ 'src/a.test.ts': "import { x } from './a';\n" }),
    script: [
      { a: 'edit', path: 'src/a.ts', old: 'x = 1', new: 'x = 5' },
      { a: 'done', summary: 'x = 5.' },
    ],
    checks: [{ command: 'npm test -- src/a.test.ts', ok: () => true, failure: '' }],
    expect: { stop: 'task_done', command: 'npm test -- src/a.test.ts', notCommand: 'npm test' },
  },
  {
    id: 'fichier-global',
    prompt: 'Ajoute un script de test au package.json.',
    files: pkgFiles(),
    script: [
      { a: 'write', path: 'package.json', content: PKG({ ...NODE_SCRIPTS, start: 'node .' }) },
      { a: 'done', summary: 'Script ajouté.' },
    ],
    expect: { stop: 'task_done', command: 'npm run lint' },
  },
  {
    id: 'commande-simple',
    prompt: 'Lance le build du projet.',
    files: pkgFiles(),
    script: [
      { a: 'cmd', command: 'npm run build' },
      { a: 'done', summary: 'Terminé.' },
    ],
    expect: { stop: 'task_done', minCalls: 2, command: 'npm run build' },
  },
];
