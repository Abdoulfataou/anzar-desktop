/**
 * Banc réel ANZAR — point d'entrée. Exécute le vrai `AgentRunner` avec le vrai modèle
 * sur les tâches de [`docs/desktop/banc-essai-agent.md`](../../../docs/desktop/banc-essai-agent.md).
 *
 * Par défaut ce test est SAUTÉ : il coûte des crédits et ne doit partir que sur demande.
 *
 * ```bash
 * # Variante « après » (ce worktree, refonte-agent) :
 * ANZAR_BENCH_REAL=1 ANZAR_BENCH_TOKEN=<jeton> \
 *   npx vitest run bench/real --testTimeout=3600000 --hookTimeout=600000
 *
 * # Variante « avant » : worktree e058e56 (voir bench/real/README.md)
 * # Fumée sans modèle (aucun crédit, aucune mesure enregistrée) :
 * ANZAR_BENCH_REAL=1 ANZAR_BENCH_SMOKE=1 npx vitest run bench/real
 * ```
 *
 * Variables d'environnement :
 * - `ANZAR_BENCH_TOKEN`  : jeton du serveur ANZAR. **Jamais écrit dans un fichier.**
 *   Sans lui (et sans fumée), le banc s'arrête : aucun résultat n'est inventé.
 * - `ANZAR_BENCH_VARIANT` : `apres` (défaut) ou `avant` — la politique du commit mesuré.
 * - `ANZAR_BENCH_TASKS`   : `t1,t3,t5,t10` (défaut).
 * - `ANZAR_BENCH_PASSES`  : nombre de passages par tâche (défaut : 3).
 * - `ANZAR_BENCH_WORK`    : racine du banc (défaut : `~/Desktop/banc`).
 * - `ANZAR_BENCH_FIXTURES`: dossier des fixtures (défaut : `<dépôt>/bench/fixtures`).
 * - `ANZAR_BENCH_SMOKE`   : `1` = modèle simulé local, zéro crédit (fumée du lanceur).
 */
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TASKS } from './tasks';
import { runPass } from './runner';

const RUN = process.env.ANZAR_BENCH_REAL === '1';
const SMOKE = process.env.ANZAR_BENCH_SMOKE === '1';
const VARIANT = process.env.ANZAR_BENCH_VARIANT === 'avant' ? 'avant' : 'apres';
const WORK = process.env.ANZAR_BENCH_WORK || join(homedir(), 'Desktop', 'banc');
// Fixtures : résolues depuis ce fichier (apps/desktop/bench/real → racine du dépôt).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const FIXTURES = process.env.ANZAR_BENCH_FIXTURES || join(REPO_ROOT, 'bench', 'fixtures');
/** Fumée : un seul passage d'une seule tâche suffit à valider la plomberie. */
const PASSES = Number(process.env.ANZAR_BENCH_PASSES || (SMOKE ? 1 : 3));
const TASK_IDS = (process.env.ANZAR_BENCH_TASKS || (SMOKE ? 't3' : 't1,t3,t5,t10'))
  .split(',').map((s) => s.trim());
const PASS_TIMEOUT_MS = 45 * 60_000;

const version = (() => {
  try { return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { return 'inconnu'; }
})();

const tokenMissing = !SMOKE && !process.env.ANZAR_BENCH_TOKEN;

/** Un passage déjà fait (reprise après interruption) n'est pas rejoué. */
const reportExists = (tache: string, pass: number): boolean =>
  existsSync(join(WORK, 'results', `anzar-${VARIANT}-${tache}-p${pass}.json`));

describe.skipIf(!RUN)('banc réel ANZAR', () => {
  it('prépare le banc', () => {
    if (tokenMissing) {
      throw new Error(
        'ANZAR_BENCH_TOKEN est absent : aucun passage réel ne peut partir.\n'
        + 'Fournis le jeton du serveur ANZAR (session de l\'app), par exemple :\n'
        + '  export ANZAR_BENCH_TOKEN="<jeton>"\n'
        + 'puis relance la même commande. Le jeton reste en mémoire : il n\'est écrit dans aucun fichier.\n'
        + 'Pour valider le lanceur sans modèle ni crédit : ANZAR_BENCH_SMOKE=1.',
      );
    }
    if (!existsSync(FIXTURES)) {
      throw new Error(`Fixtures introuvables : ${FIXTURES} (ANZAR_BENCH_FIXTURES ?)`);
    }
    expect(existsSync('/usr/bin/sandbox-exec'), 'le banc exige l\'isolation macOS (sandbox-exec)').toBe(true);
  });

  const selected = TASKS.filter((t) => TASK_IDS.includes(t.id));

  for (const task of selected) {
    for (let pass = 1; pass <= PASSES; pass++) {
      it(`${VARIANT} · ${task.id} · passage ${pass}`, { timeout: PASS_TIMEOUT_MS }, async () => {
        if (tokenMissing) return; // le test « prépare » échoue déjà avec l'explication
        if (reportExists(task.id, pass)) {
          console.log(`[bench] ${task.id} p${pass} : rapport déjà présent, passage sauté`);
          return;
        }
        const { report, reportPath } = await runPass({
          variant: VARIANT,
          version,
          task,
          pass,
          workRoot: SMOKE ? join(WORK, 'smoke') : WORK,
          fixturesDir: FIXTURES,
          token: process.env.ANZAR_BENCH_TOKEN || 'smoke-sans-jeton',
          smoke: SMOKE,
        });
        console.log(`[bench] ${task.id} p${pass} → ${report.row.reussi ? 'RÉUSSI' : 'ÉCHEC'} · ${report.row.appels_outils} appels · ${report.row.credits_fcfa} FCFA · ${report.row.duree_s}s → ${reportPath}`);
      });
    }
  }
});
