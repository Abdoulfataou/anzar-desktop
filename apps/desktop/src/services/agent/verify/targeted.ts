/**
 * Vérification ciblée : n'exécuter que ce que les fichiers modifiés peuvent casser.
 *
 * Le principe est conservateur — en cas de doute, on vérifie tout :
 * - un fichier de configuration modifié (package.json, tsconfig, lockfile…) → vérification complète ;
 * - seuls des documents/images modifiés → rien à vérifier ;
 * - seuls des styles modifiés → build conservé (une CSS peut casser un build), tests et
 *   typecheck écartés (aucun code n'a changé) ;
 * - du code modifié → lint et tests **restreints aux fichiers concernés**, quand le script du
 *   projet utilise un outil reconnu (eslint/stylelint/ruff, vitest/jest/mocha). Sinon, commande
 *   complète : on n'ajoute jamais des arguments à un script dont on ne connaît pas l'outil.
 *
 * Module pur : les fichiers de test existants sont résolus par l'appelant.
 */
import type { VerifyCommand } from './agentVerifier';

/** Extensions considérées comme du code : leur modification peut casser un build ou des tests. */
export const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte',
  'py', 'rs', 'go', 'java', 'kt', 'php', 'rb', 'cs', 'c', 'h', 'cpp', 'hpp',
]);

/** Styles et gabarits : le build peut échouer, les tests ne dépendent pas d'eux. */
export const STYLE_EXTENSIONS = new Set(['css', 'scss', 'sass', 'less', 'html', 'htm']);

/** Fichiers dont la modification change le résultat de la vérification elle-même. */
const GLOBAL_FILES = /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|jsconfig\.json|vite\.config\.[^/]+|next\.config\.[^/]+|nuxt\.config\.[^/]+|svelte\.config\.[^/]+|webpack\.config\.[^/]+|rollup\.config\.[^/]+|eslint\.config\.[^/]+|\.eslintrc[^/]*|\.stylelintrc[^/]*|pyproject\.toml|requirements[^/]*\.txt|setup\.py|Cargo\.toml|Cargo\.lock|go\.mod|Dockerfile|Makefile)$/i;

/** Scripts de test dont on sait qu'ils acceptent une liste de fichiers en arguments. */
const TEST_RUNNERS = /\b(vitest|jest|mocha|ava|tape)\b|node\s+--test/;
/** Linters dont on sait qu'ils acceptent une liste de fichiers en arguments. */
const LINTERS = /\b(eslint|stylelint|oxlint|ruff|flake8|pylint)\b/;

/**
 * Le lanceur de commandes plafonne les arguments (8) : au-delà, la commande serait refusée.
 * « npm run lint -- » consomme déjà trois arguments.
 */
export const MAX_TARGETED_FILES = 5;

const normalize = (path: string) => path.replace(/\\/g, '/').replace(/^\.?\//, '').trim();
const extension = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** Guillemets si le chemin contient un caractère qui casserait la tokenisation. */
const quote = (path: string): string => (/^[\w./-]+$/.test(path) ? path : `"${path.replace(/"/g, '')}"`);

export interface TargetPlan {
  /** Commandes réellement à exécuter. */
  commands: VerifyCommand[];
  /** Ce qui a été décidé, pour l'affichage. */
  notes: string[];
  /** Commandes écartées et pourquoi. */
  skipped: { label: string; reason: string }[];
}

export interface TargetOptions {
  /** Scripts npm du projet (`scripts` de package.json). */
  scripts?: Record<string, string>;
  /** Fichiers modifiés par l'agent, relatifs à la racine. */
  changedFiles: string[];
  /** Fichiers de test existants correspondant aux fichiers modifiés. */
  relatedTests?: string[];
}

/**
 * Décide quelles commandes exécuter pour un tour.
 *
 * `changedFiles` vide signifie « état inconnu » (vérification de référence) : on vérifie tout.
 */
export function planVerification(commands: VerifyCommand[], options: TargetOptions): TargetPlan {
  const notes: string[] = [];
  const skipped: { label: string; reason: string }[] = [];
  const files = (options.changedFiles || []).map(normalize).filter(Boolean);

  if (!commands.length || !files.length) return { commands, notes, skipped };

  if (files.some((f) => GLOBAL_FILES.test(f))) {
    return { commands, notes: ['fichier de configuration modifié : vérification complète'], skipped };
  }

  const code = files.filter((f) => CODE_EXTENSIONS.has(extension(f)));
  const style = files.filter((f) => STYLE_EXTENSIONS.has(extension(f)));

  if (!code.length && !style.length) {
    for (const cmd of commands) {
      skipped.push({ label: cmd.label, reason: 'aucun fichier de code modifié (documents ou ressources seulement)' });
    }
    return { commands: [], notes: ['aucun fichier de code modifié : vérification ignorée'], skipped };
  }

  const scripts = options.scripts || {};
  const relatedTests = (options.relatedTests || []).map(normalize).filter(Boolean);
  const out: VerifyCommand[] = [];

  for (const cmd of commands) {
    // Styles seulement : le build peut casser (une CSS invalide, un import manquant),
    // mais les tests et le typecheck ne portent sur aucun fichier modifié.
    if (!code.length && (cmd.label === 'test' || cmd.label === 'typecheck')) {
      skipped.push({ label: cmd.label, reason: 'aucun fichier de code modifié (styles ou gabarits seulement)' });
      continue;
    }

    if (cmd.label === 'test' && relatedTests.length && TEST_RUNNERS.test(scripts.test || '')) {
      const targeted = relatedTests.slice(0, MAX_TARGETED_FILES);
      out.push({ label: cmd.label, command: `npm test -- ${targeted.map(quote).join(' ')}` });
      notes.push(`tests limités à ${targeted.length} fichier${targeted.length > 1 ? 's' : ''}`);
      continue;
    }

    if (cmd.label === 'lint' && code.length && LINTERS.test(scripts.lint || '')) {
      const targeted = code.slice(0, MAX_TARGETED_FILES);
      out.push({ label: cmd.label, command: `npm run lint -- ${targeted.map(quote).join(' ')}` });
      notes.push(`lint limité à ${targeted.length} fichier${targeted.length > 1 ? 's' : ''}`);
      continue;
    }

    out.push(cmd);
  }

  if (out.length && code.length > MAX_TARGETED_FILES && notes.length) {
    notes.push('fichiers au-delà de la limite passés en vérification complète');
  }
  return { commands: out, notes, skipped };
}

const TEST_FILE = /\.(test|spec)\.[^./]+$/i;

/** Chemins de test correspondant à un fichier modifié (conventions courantes). */
export function candidateTestPaths(file: string): string[] {
  const path = normalize(file);
  if (!path) return [];
  if (TEST_FILE.test(path)) return [path];
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return [];
  const base = name.slice(0, dot);
  const ext = name.slice(dot); // « .ts », « .tsx »…
  return [
    `${dir}${base}.test${ext}`,
    `${dir}${base}.spec${ext}`,
    `${dir}__tests__/${base}.test${ext}`,
    `${dir}__tests__/${base}.spec${ext}`,
    `${dir}tests/${base}.test${ext}`,
  ];
}

/**
 * Fichiers de test existants pour les fichiers modifiés.
 * `exists` est fourni par l'appelant (accès disque), ce qui garde ce module testable.
 */
export async function collectRelatedTests(
  changedFiles: string[],
  exists: (relativePath: string) => Promise<boolean>,
): Promise<string[]> {
  const found = new Set<string>();
  for (const file of changedFiles) {
    for (const candidate of candidateTestPaths(file)) {
      if (found.size >= MAX_TARGETED_FILES) return [...found];
      if (await exists(candidate).catch(() => false)) {
        found.add(candidate);
        break;
      }
    }
  }
  return [...found];
}
