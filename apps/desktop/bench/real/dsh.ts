/**
 * Banc réel — côté Harness (DeepSeek dsh). Mêmes tâches, mêmes dossiers, mêmes mesures
 * que le côté ANZAR, avec `dsh --profile headless --json` :
 *
 * - sandbox : `--permission-mode workspace-write` (le profil standard de dsh : écriture
 *   limitée au dossier de travail, réseau comme Harness) — comparable au mode Auto
 *   d'ANZAR, qui isole aussi les commandes ;
 * - approbations : politique par défaut du profil (`ask`). Sans interface, personne ne
 *   peut répondre : dsh refuse l'action (`unavailable`, fail closed). C'est le
 *   comportement demandé par le protocole du banc (« ne rien accepter ») ;
 * - modèle : `deepseek-flash`, effort de réflexion par défaut du profil (max) — le même
 *   que le banc ANZAR (`model: 'max'`).
 *
 * Les mesures viennent du flux `--json` (documenté dans `dsh-headless/src/json-stream.ts`) :
 * `session`, `status` (turn/step), `tool_call`, `tool_result`, `final`. Les crédits dsh
 * n'existent pas : le coût est **estimé** avec la grille ANZAR (marqué dans les notes).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { prepareTaskDir, type BenchTask } from './tasks';
import { classifyRefusal, contournementsIn, estimateFcfaDsh, type PassageRow } from './measures';

export const DEFAULT_DSH_BIN = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';
/** Timeout d'un passage dsh : même plafond de mur que le budget du tour ANZAR. */
const DSH_TIMEOUT_MS = 45 * 60_000;

export interface DshPassOptions {
  task: BenchTask;
  pass: number;
  workRoot: string;
  fixturesDir: string;
  dshBin?: string;
}

export interface DshPassReport {
  row: PassageRow;
  events: unknown[];
  reponseFinale: string;
  stopReason: string;
  verifierOutput: string;
  sessionId: string | null;
  /** Config modèle réellement utilisée, lue dans la session persistée de dsh. */
  modelConfig: { model?: string; reasoningEffort?: string } | null;
}

export async function runDshPass(opts: DshPassOptions): Promise<{ report: DshPassReport; reportPath: string }> {
  const { task, pass, workRoot, fixturesDir } = opts;
  const dshBin = opts.dshBin || DEFAULT_DSH_BIN;
  if (!existsSync(dshBin)) throw new Error(`CLI dsh introuvable : ${dshBin} (ANZAR_BENCH_DSH ?)`);

  const runDir = join(workRoot, 'dsh', task.id, `p${pass}`);
  const outDir = join(workRoot, 'results');
  const tracesDir = join(outDir, 'traces');
  mkdirSync(tracesDir, { recursive: true });

  // 1. Dossier du passage : recréé vierge, identique au côté ANZAR.
  prepareTaskDir(task, runDir, fixturesDir);

  // 2. Le tour dsh : le flux d'événements va sur stdout, le diagnostic sur stderr.
  const t0 = Date.now();
  const proc = spawn(dshBin, [
    '--profile', 'headless',
    '--json',
    '--permission-mode', 'workspace-write',
    task.demande,
  ], { cwd: runDir, stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (c) => { stdout += c; });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (c) => { stderr += c; });
  const timedOut = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve(true); }, DSH_TIMEOUT_MS);
    proc.on('close', () => { clearTimeout(timer); resolve(false); });
  });
  const dureeS = (Date.now() - t0) / 1000;
  const exitCode = proc.exitCode ?? -1;

  // 3. Parse du flux NDJSON.
  const events: any[] = stdout.split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
  const final = events.filter((e) => e.type === 'final').pop() as { sessionId?: string; reason?: any; text?: string } | undefined;
  const reponseFinale = String(final?.text || '');
  const stopReason = final
    ? String(final.reason?.kind || 'completed')
    : timedOut ? 'timeout' : `exit_${exitCode}`;

  // Détecter l'échec d'environnement AVANT d'écrire un rapport : sans clé, le
  // « passage » ne mesure rien (le banc exige de signaler ces échecs, pas de les compter).
  // dsh émet un `final` même en cas d'erreur : on lit le code d'erreur, pas sa présence.
  const errCode = String((final?.reason as any)?.error?.code || '');
  if (errCode === 'MISSING_CREDENTIAL' || /MISSING_CREDENTIAL/.test(stderr)) {
    throw new Error(
      'dsh headless n\'a pas de clé API : le profil headless n\'utilise ni le compte de\n'
      + 'l\'app ni le stockage de clés (tous deux désactivés dans ce profil). Exporte ta clé\n'
      + 'DeepSeek officielle avant de relancer :\n'
      + '  export DEEPSEEK_API_KEY="<clé API DeepSeek>"\n'
      + 'La clé reste en mémoire : elle n\'est écrite dans aucun fichier.',
    );
  }

  // 4. Config modèle réelle, depuis la session persistée (traçabilité de l'égalité modèle/effort).
  const sessionId = final?.sessionId || null;
  const modelConfig = sessionId ? readDshModelConfig(sessionId) : null;

  // 5. Critère objectif.
  const verifier = task.verifier(runDir);

  // 6. Mesures depuis le flux.
  const toolCalls = events.filter((e) => e.type === 'tool_call') as any[];
  const toolResults = events.filter((e) => e.type === 'tool_result') as any[];
  const stepEnds = events.filter((e) => e.type === 'status' && e.phase === 'step_end') as any[];

  let refus = 0;
  let refusSansAlternative = 0;
  let fauxEchecs = 0;
  for (const r of toolResults) {
    const text = String(r.result || r.error || '');
    if (r.status === 'error') {
      const c = classifyRefusal(text);
      if (c.refus) {
        refus++;
        if (c.sansAlternative) refusSansAlternative++;
      } else {
        fauxEchecs++;
      }
    }
  }

  // Boucles identiques : couples (outil, arguments) répétés au-delà de la première fois.
  const seen = new Set<string>();
  let bouclesIdentiques = 0;
  for (const c of toolCalls) {
    const key = `${c.tool}:${JSON.stringify(c.input ?? null)}`;
    if (seen.has(key)) bouclesIdentiques++;
    else seen.add(key);
  }

  // Contournements : dans les entrées des outils (commandes bash surtout).
  const contournements = toolCalls.reduce((n, c) => n + contournementsIn(JSON.stringify(c.input ?? {})), 0);

  const tokensIn = stepEnds.reduce((n, e) => n + Number(e.usage?.inputTokens ?? 0), 0);
  const tokensOut = stepEnds.reduce((n, e) => n + Number(e.usage?.outputTokens ?? 0), 0);
  const reussi: 0 | 1 = verifier.ok ? 1 : 0;
  const qualite = !reussi ? (/compileSeule/i.test(verifier.output) ? 1 : 0) : verifier.warnings ? 2 : 3;

  const row: PassageRow = {
    date: new Date().toISOString(),
    version: `dsh ${dshVersion(dshBin)}`,
    agent: 'dsh',
    tache: task.id,
    passage: pass,
    reussi,
    qualite,
    appels_outils: toolCalls.length,
    etapes_modele: stepEnds.length,
    tokens_entree: tokensIn,
    tokens_sortie: tokensOut,
    credits_fcfa: Math.round(estimateFcfaDsh(tokensIn, tokensOut) * 100) / 100,
    duree_s: Math.round(dureeS),
    interventions_humaines: 0, // headless : personne ne peut répondre (fail closed)
    refus,
    refus_sans_alternative: refusSansAlternative,
    boucles_identiques: bouclesIdentiques,
    appels_bloques: 0, // le garde de dsh bloque à sa manière ; aucun appel n'est exécuté puis annulé ici
    arret_boucle: 0,
    contournements,
    erreurs_outil: toolResults.filter((r) => r.status === 'error').length,
    faux_echecs: fauxEchecs,
    notes: `session ${sessionId || 'inconnue'} ; coût estimé (grille ANZAR, aucun crédit dsh lu)`
      + (modelConfig ? ` ; modèle ${modelConfig.model} effort ${modelConfig.reasoningEffort}` : '')
      + (timedOut ? ' ; DÉLAI DÉPASSÉ' : ''),
  };

  const report: DshPassReport = {
    row,
    events,
    reponseFinale,
    stopReason,
    verifierOutput: verifier.output,
    sessionId,
    modelConfig,
  };
  const eventsPath = join(tracesDir, `dsh-${task.id}-p${pass}.events.jsonl`);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(eventsPath, stdout);
  const reportPath = join(outDir, `dsh-${task.id}-p${pass}.json`);
  const { row: _row, events: _e, ...rest } = report;
  writeFileSync(reportPath, JSON.stringify({ ...rest, row }, null, 2));
  if (stderr.trim()) writeFileSync(join(tracesDir, `dsh-${task.id}-p${pass}.stderr.txt`), stderr);
  return { report, reportPath };
}

/** Version du CLI dsh, pour la colonne `version`. */
function dshVersion(dshBin: string): string {
  try { return execFileSync(dshBin, ['--version'], { encoding: 'utf8' }).trim(); } catch { return 'inconnue'; }
}

/**
 * Config modèle de la session persistée : `~/.dsh/sessions/<dossier-mungé>/<sessionId>/`.
 * Le dossier est retrouvé par son contenu (le munging du cwd varie selon les versions).
 */
function readDshModelConfig(sessionId: string): { model?: string; reasoningEffort?: string } | null {
  try {
    const sessionsRoot = join(homedir(), '.dsh', 'sessions');
    for (const dir of readdirSync(sessionsRoot)) {
      const sessionDir = join(sessionsRoot, dir, sessionId);
      if (!existsSync(sessionDir)) continue;
      const file = join(sessionDir, 'session.v4.jsonl.zstd');
      if (!existsSync(file)) continue;
      const text = execFileSync('/opt/homebrew/bin/zstdcat', [file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const header = text.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .find((e: any) => e?.type === 'request/header');
      const config = header?.data?.header?.config;
      return { model: config?.model, reasoningEffort: config?.reasoningEffort };
    }
    return null;
  } catch { return null; }
}
