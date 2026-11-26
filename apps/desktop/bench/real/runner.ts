/**
 * Un passage du banc réel ANZAR : prépare le dossier, exécute le **vrai `AgentRunner`**
 * avec le vrai modèle via le serveur ANZAR (jeton lu dans l'environnement, jamais écrit),
 * puis relève toutes les mesures depuis les traces réelles.
 *
 * Le shim Tauri doit être installé AVANT l'import de tout service ANZAR : ce module
 * n'importe donc aucun service au niveau du fichier, seulement via `await import()`.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installTauriShim, type TauriShim } from './tauriHost';
import { prepareTaskDir, type BenchTask } from './tasks';
import { measureAnzarPassage, type PassageRow } from './measures';
import { installSmokeModel } from './smoke';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // apps/desktop

export const DEFAULT_BACKEND = 'https://anzar-api.issalanhub.com';
/**
 * Modèle du banc : `thinking` = deepseek-flash, effort de réflexion **high** —
 * exactement le réglage par défaut de `dsh --profile headless` (deepseek-flash,
 * reasoningEffort high, vérifié dans la session persistée d'un calibrage). Le banc
 * mesure le harnais, pas le routeur : modèle et effort sont figés et identiques des
 * deux côtés (principe 1 du banc : même modèle, même effort).
 */
export const BENCH_MODEL = 'thinking' as const;

export interface PassOptions {
  variant: 'avant' | 'apres';
  version: string;
  task: BenchTask;
  pass: number;
  /** Racine du banc (~/Desktop/banc) : dossiers de tâche, store du banc, résultats. */
  workRoot: string;
  fixturesDir: string;
  /** Jeton du serveur ANZAR, lu dans l'environnement — jamais écrit dans un fichier. */
  token: string;
  /** Modèle simulé local (fumée) au lieu du serveur ANZAR. */
  smoke?: boolean;
}

export interface PassReport {
  row: PassageRow;
  traces: { journal: string; history: string };
  reponseFinale: string;
  verifierOutput: string;
  stopReason: string;
  spawned: { id: string; program: string; args: string[]; cwd: string }[];
}

/** Ouvre les traces d'une conversation (journal + historique API). */
function readTraces(appData: string, convId: string): { journal: string; history: string } {
  const dir = join(appData, 'store', 'sessions');
  const journalPath = join(dir, `${convId}.events.jsonl`);
  const historyPath = join(dir, `${convId}.json`);
  return {
    journal: existsSync(journalPath) ? readFileSync(journalPath, 'utf8') : '',
    history: existsSync(historyPath) ? readFileSync(historyPath, 'utf8') : '',
  };
}

export async function runPass(opts: PassOptions): Promise<{ report: PassReport; reportPath: string }> {
  const { variant, task, pass, token, workRoot, fixturesDir } = opts;
  const runDir = join(workRoot, `anzar-${variant}`, task.id, `p${pass}`);
  const appData = join(workRoot, `store-${variant}`);
  const outDir = join(workRoot, 'results');
  const tracesDir = join(outDir, 'traces');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(tracesDir, { recursive: true });

  // 1. Dossier du passage : recréé vierge, fixture copiée, dépendances installées.
  prepareTaskDir(task, runDir, fixturesDir);

  // 2. Environnement : localStorage nettoyé, baselines du banc oubliées.
  (globalThis as any).localStorage?.clear();
  rmSync(join(appData, 'store', 'baselines'), { recursive: true, force: true });

  // 3. Shim Tauri (commandes, fichiers, événements) — AVANT les imports de services.
  const shim: TauriShim = installTauriShim({
    variant,
    appDataDir: appData,
    allowedRoots: [runDir],
    // Politique « avant » : copie de commands.json à e058e56 (supprimé depuis) —
    // le banc garde ainsi la même liste de programmes quel que soit le worktree.
    commandsJsonPath: variant === 'avant' ? join(dirname(fileURLToPath(import.meta.url)), 'commands-avant.json') : undefined,
  });

  // 4. Imports des services (le shim est en place).
  const { useSettingsStore } = await import('@/stores/settingsStore');
  const { useChatStore } = await import('@/stores/chatStore');
  const { useUsageStore } = await import('@/stores/usageStore');
  const { resetBaselineCache } = await import('@/services/agent/verify/baseline');
  const { terminalService } = await import('@/services/runtime/terminal');
  const { AgentRunner } = await import('@/services/agent/runtime/agentRunner');
  resetBaselineCache();

  // 5. Réglages du banc : mode Auto, vérification automatique, pas de web ni de LSP
  //    (dsh n'en a pas ; le serveur de langage ne tourne pas hors app).
  useSettingsStore.setState({
    authToken: token,
    settings: {
      ...useSettingsStore.getState().settings,
      model: BENCH_MODEL,
      webTools: false,
      codeDiagnostics: false,
      sandboxCommands: true,
      autoVerifyAfterApply: true,
      backendUrl: DEFAULT_BACKEND,
    },
  });
  useChatStore.setState({ conversations: [], activeConversationId: null, isGenerating: false });
  useUsageStore.setState({ records: [] });

  // 6. « Ouvrir le projet » : le dossier du passage est la racine autorisée des commandes.
  terminalService.registerProjectPath(runDir);
  shim.addRoot(runDir);

  // 6bis. Runtime tree-sitter : sous l'app, les WASM viennent du bundle ; hors app, on
  // les charge depuis public/wasm. Sans ça, l'init échoue à chaque tour et pollue les
  // traces d'un rejet non géré. Absent à e058e56 : échec silencieux (index regex).
  try {
    const tree = await import('@/services/filesystem/treeSitter') as any;
    const wasmDir = join(APP_ROOT, 'public', 'wasm');
    await tree.prepareTreeSitter([], {
      runtimePath: join(wasmDir, 'tree-sitter.wasm'),
      load: async (file: string) => readFileSync(join(wasmDir, file)),
    });
  } catch { /* module absent à cet endroit du code : la carte retombe sur l'extraction regex */ }

  if (opts.smoke) installSmokeModel(DEFAULT_BACKEND);

  // 7. L'agent, comme l'app le crée. Les cartes d'accord sont refusées (le banc exige
  //    de ne rien accepter) et comptées comme interventions ; les questions sont passées.
  const runner = new AgentRunner({
    workspacePath: runDir,
    workspaceName: task.id,
    model: BENCH_MODEL,
    permissionMode: 'auto',
  });
  let interventions = 0;
  const unsubscribe = runner.subscribe(() => {
    const state = runner.getState();
    if (state.approval) {
      interventions++;
      runner.resolveApproval(false);
    }
    if (state.question) {
      interventions++;
      runner.resolveQuestion(null);
    }
  });

  // 8. Le tour.
  const t0 = Date.now();
  const result = await runner.sendMessage(task.demande);
  const dureeS = (Date.now() - t0) / 1000;
  unsubscribe();
  if (!result) throw new Error('Le tour n\'a pas démarré (runner.sendMessage → null).');

  // 9. Traces : le journal s'écrit en file d'attente — on laisse le tour se poser.
  await new Promise((r) => setTimeout(r, 1200));
  const traces = readTraces(appData, result.conversationId);

  // 10. Critère objectif, après le tour.
  const verifier = task.verifier(runDir);
  let notes = verifier.ok ? 'critère vérifié' : 'critère non vérifié';
  if (!verifier.ok && !task.fixture) {
    // T1 : distinguer « compile mais incomplet » (1) de « ne compile pas » (0).
    const { spawnSync } = await import('node:child_process');
    const analyze = spawnSync('flutter', ['analyze'], { cwd: runDir, encoding: 'utf8', timeout: 5 * 60_000 });
    if (analyze.status === 0) notes += ' ; compileSeule';
  }
  if (!verifier.ok && task.id === 't10') notes += ' ; T10 : vérifier le compte rendu des refus dans la réponse finale';

  // 11. Tokens : depuis le message assistant final (chatStore).
  const conv = useChatStore.getState().conversations.find((c) => c.id === result.conversationId);
  const finalMessage = conv?.messages.find((m) => m.id === result.assistantId);
  const promptTokens = finalMessage?.tokens?.prompt ?? 0;
  const completionTokens = finalMessage?.tokens?.completion ?? 0;

  // 12. Mesures depuis les traces.
  const events = traces.journal.split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
  let history: any[] = [];
  try { history = JSON.parse(traces.history || '{}')?.messages || []; } catch { /* trace absente */ }

  const row = measureAnzarPassage({
    variant,
    version: opts.version,
    tache: task.id,
    passage: pass,
    events,
    history,
    reponseFinale: result.content || '',
    stopReason: result.stopReason,
    costFCFA: result.costFCFA ?? null,
    promptTokens,
    completionTokens,
    dureeS,
    interventionsHumaines: interventions,
    verifier,
    notes,
  });

  const report: PassReport = {
    row,
    traces: {
      journal: join(tracesDir, `anzar-${variant}-${task.id}-p${pass}.events.jsonl`),
      history: join(tracesDir, `anzar-${variant}-${task.id}-p${pass}.json`),
    },
    reponseFinale: result.content || '',
    verifierOutput: verifier.output,
    stopReason: result.stopReason,
    spawned: [...shim.spawned],
  };
  // Copie des traces vers le dossier de résultats : l'analyse des causes s'appuiera dessus.
  const { writeFileSync } = await import('node:fs');
  writeFileSync(report.traces.journal, traces.journal);
  writeFileSync(report.traces.history, traces.history);
  const reportPath = join(outDir, `anzar-${variant}-${task.id}-p${pass}.json`);
  const { row: _row, ...reportRest } = report;
  writeFileSync(reportPath, JSON.stringify({ ...reportRest, row }, null, 2));
  return { report, reportPath };
}
