/**
 * Point d'étape : repère qu'un agent piétine sur un problème, pas seulement qu'il répète
 * le même appel (ça, c'est loopGuard).
 *
 * Signal retenu : la même commande de vérification (la même « famille » : flutter test,
 * npm run build, pytest…) échoue plusieurs fois de suite, ou dépasse son délai deux fois,
 * sans réussir entre-temps. Les commandes changent légèrement d'un essai à l'autre
 * (autre fichier de test, autre filtre) : la famille, elle, reste la même.
 *
 * Comme loopGuard, ce module ne bloque rien : il rend un rappel à ajouter à l'historique
 * (méthode, hypothèses écartées, regard neuf, sortie propre) et signale au tour qu'il peut
 * passer à un modèle plus fort (mode Auto).
 */
import type { ToolCall } from '@/types';
import { STILL_RUNNING_MARKER, TIMEOUT_MARKER } from '../tools/commandHints';

/** Outils de commande suivis. */
const COMMAND_TOOLS = new Set(['bash', 'run_command']);

/**
 * Programmes d'exploration : leur « échec » n'en est pas un (grep sans résultat rend 1,
 * test -f rend 1 si le fichier manque). Ils ne comptent pas.
 */
const EXPLORATION = new Set([
  'grep', 'rg', 'find', 'ls', 'cat', 'head', 'tail', 'sed', 'awk', 'wc', 'test', '[', 'which', 'command',
  'echo', 'printf', 'stat', 'file', 'diff', 'cmp', 'sort', 'uniq', 'git', 'pwd', 'true', 'false', 'sleep',
]);
/** Préfixes à sauter pour trouver le vrai programme. */
const WRAPPERS = new Set(['sudo', 'npx', 'env', 'time', 'timeout', 'nice', 'exec', 'command', 'bunx', 'pnpx', 'xvfb-run']);

const base = (p: string) => p.replace(/^.*[\\/]/, '');

/**
 * Famille d'une commande : son programme et sa sous-commande (« flutter test »,
 * « npm run build », « python -m pytest »), sans les fichiers ni les options.
 * `null` pour une commande d'exploration ou illisible.
 */
export function commandFamily(command: string): string | null {
  const segments = command
    .replace(/\bset\s+-[a-z]*o\s+pipefail\s*;?/g, ' ')
    .split(/&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const segment of segments) {
    const tokens = segment.split(/\s+/).filter((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
    while (tokens.length && (WRAPPERS.has(base(tokens[0])) || /^\d+[smh]?$/.test(tokens[0]) || tokens[0].startsWith('-'))) tokens.shift();
    if (!tokens.length) continue;
    const program = base(tokens[0]);
    if (program === 'cd') continue;
    if (EXPLORATION.has(program)) {
      // « git » seul est de l'exploration ; une commande de build après lui ne l'est pas.
      continue;
    }
    const rest = tokens.slice(1).filter((t) => !t.startsWith('-'));
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(program)) {
      if (rest[0] === 'run' || rest[0] === 'run-script') return `${program} run ${rest[1] ?? ''}`.trim();
      return `${program} ${rest[0] ?? ''}`.trim();
    }
    if (/^python3?$/.test(program) && tokens[1] === '-m') return `python -m ${tokens[2] ?? ''}`.trim();
    // Sous-commande (« test », « build ») ou script lancé (« node verifier.mjs »), seulement
    // juste après le programme : « pytest -k nom » reste « pytest », pas « pytest nom ».
    const sub = tokens[1];
    if (sub && !sub.startsWith('-')) {
      if (/^[a-z][\w:-]*$/i.test(sub)) return `${program} ${sub}`;
      if (/\.[a-z]+$/i.test(sub)) return `${program} ${base(sub)}`;
    }
    return program;
  }
  return null;
}

export interface ProgressPoint {
  family: string;
  failures: number;
  timeouts: number;
  /** 1 : premier point d'étape ; 2 : l'agent piétine toujours. */
  level: 1 | 2;
  message: string;
}

export interface ProgressGuardOptions {
  /** Échecs consécutifs de la même famille avant un point d'étape (défaut 3, puis 6). */
  failureThresholds?: [number, number];
  /** Délais dépassés de la même famille avant un point d'étape (défaut 2). */
  timeoutThreshold?: number;
}

interface FamilyState { failures: number; timeouts: number; levels: Set<1 | 2> }

export function progressMessage(point: Omit<ProgressPoint, 'message'>, tools: ReadonlySet<string>): string {
  const what = [
    point.failures ? `${point.failures} échec${point.failures > 1 ? 's' : ''} de suite` : '',
    point.timeouts ? `${point.timeouts} délai${point.timeouts > 1 ? 's' : ''} dépassé${point.timeouts > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(', ');
  const skills = tools.has('load_skill')
    ? ' (skills debogage-systematique, cause-racine et commandes-longues, avec load_skill)'
    : '';
  const lines = [
    `[Point d'étape] « ${point.family} » : ${what}, sans réussite entre-temps. Avant un nouvel essai :`,
    '1. Écris en quelques lignes le symptôme exact, les hypothèses déjà écartées et ce qui les a écartées.',
    `2. Mesure au lieu de supposer : réduis à un seul cas, borné (délai par test), et instrumente l'endroit suspect${skills}. Un test qui expire peut bloquer dans sa préparation ou son nettoyage.`,
  ];
  if (tools.has('spawn_agent')) {
    lines.push("3. Regard neuf : si tu tournes autour du même endroit, confie le diagnostic à un sous-agent (spawn_agent, rôle revue) avec seulement le symptôme, la commande qui le reproduit et ce qui est écarté — pas ta piste actuelle. Puis attends son rapport avec wait_agent.");
  } else if (tools.has('explore')) {
    lines.push("3. Regard neuf : pose la question précise à explore (où ce symptôme peut-il naître ?) plutôt que de relire les mêmes fichiers.");
  }
  if (point.level === 2) {
    lines.push(`${lines.length}. Tu piétines toujours : change d'approche maintenant. Si rien ne progresse au prochain essai, arrête-toi proprement — rapporte ce qui est prouvé, ce qui est écarté et la prochaine mesure à faire — au lieu de dépenser le budget.`);
  } else {
    lines.push(`${lines.length}. Si tu ne progresses toujours pas après cela, termine proprement avec ce qui est prouvé, ce qui est écarté et la prochaine mesure à faire.`);
  }
  return lines.join('\n');
}

export class ProgressGuard {
  private readonly families = new Map<string, FamilyState>();
  /** Travaux passés en arrière-plan après leur délai : identifiant → famille de la commande. */
  private readonly jobs = new Map<string, string>();
  private readonly failureThresholds: [number, number];
  private readonly timeoutThreshold: number;

  constructor(options: ProgressGuardOptions = {}) {
    this.failureThresholds = options.failureThresholds ?? [3, 6];
    this.timeoutThreshold = options.timeoutThreshold ?? 2;
  }

  /**
   * À appeler après chaque appel d'outil. Rend un point d'étape quand une famille de
   * commandes franchit un seuil (une seule fois par niveau), sinon `null`.
   */
  after(
    call: ToolCall,
    outcome: { output?: string; isError?: boolean; failed?: boolean },
    tools: ReadonlySet<string> = new Set(),
  ): ProgressPoint | null {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(call.function.arguments || '{}'); } catch { return null; }
    const output = outcome.output || '';

    // Une commande qui a atteint son délai continue en arrière-plan : ce n'est pas encore un
    // échec. Elle en devient un si l'agent doit l'arrêter (bloquée) ou si elle finit mal.
    if (call.function.name === 'job_kill' || call.function.name === 'job_output') {
      const jobId = String(args.job_id || args.id || '');
      const jobFamily = this.jobs.get(jobId);
      if (!jobFamily) return null;
      if (call.function.name === 'job_kill') {
        this.jobs.delete(jobId);
        return this.record(jobFamily, { failed: true, timedOut: true }, tools);
      }
      const ended = /état: terminé \(code (-?\d+|inconnu)\)/.exec(output);
      if (!ended) return null;
      this.jobs.delete(jobId);
      return this.record(jobFamily, { failed: ended[1] !== '0', timedOut: false }, tools);
    }

    if (!COMMAND_TOOLS.has(call.function.name)) return null;
    const family = commandFamily(String(args.command || ''));
    if (!family) return null;
    if (output.includes(STILL_RUNNING_MARKER)) {
      const jobId = /job_id: ([\w-]+)/.exec(output)?.[1];
      if (jobId) this.jobs.set(jobId, family);
      return null;
    }
    const timedOut = output.includes(TIMEOUT_MARKER);

    // Commande non lancée (refus, introuvable) : ce n'est pas un essai sur le problème.
    if (outcome.isError && !outcome.failed && !timedOut) return null;
    return this.record(family, { failed: !!outcome.failed || !!outcome.isError || timedOut, timedOut }, tools);
  }

  /** Compte un essai d'une famille ; rend un point d'étape au franchissement d'un seuil. */
  private record(family: string, attempt: { failed: boolean; timedOut: boolean }, tools: ReadonlySet<string>): ProgressPoint | null {
    const state = this.families.get(family) ?? { failures: 0, timeouts: 0, levels: new Set<1 | 2>() };
    this.families.set(family, state);
    // Une réussite remet la famille à zéro : le problème est réglé ou a changé.
    if (!attempt.failed) {
      this.families.set(family, { failures: 0, timeouts: 0, levels: new Set() });
      return null;
    }
    const timedOut = attempt.timedOut;
    state.failures += 1;
    if (timedOut) state.timeouts += 1;

    const [first, second] = this.failureThresholds;
    let level: 1 | 2 | null = null;
    if (state.failures >= second && !state.levels.has(2)) level = 2;
    else if ((state.failures >= first || state.timeouts >= this.timeoutThreshold) && !state.levels.has(1)) level = 1;
    if (!level) return null;
    state.levels.add(level);
    if (level === 2) state.levels.add(1);
    const point = { family, failures: state.failures, timeouts: state.timeouts, level };
    return { ...point, message: progressMessage(point, tools) };
  }

  /** Nouvelle demande de l'utilisateur : on repart de zéro. */
  reset(): void {
    this.families.clear();
    this.jobs.clear();
  }
}
