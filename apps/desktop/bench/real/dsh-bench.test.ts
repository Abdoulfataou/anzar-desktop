/**
 * Banc réel — côté Harness (dsh). Mêmes tâches que le côté ANZAR, avec le CLI dsh en mode
 * headless. Piloté par les mêmes variables que le banc ANZAR :
 *
 * ```bash
 * ANZAR_BENCH_REAL=1 npx vitest run bench/real/dsh-bench.test.ts --testTimeout=3600000
 * ```
 *
 * - `ANZAR_BENCH_TASKS`   : `t1,t3,t5,t10` (défaut)
 * - `ANZAR_BENCH_PASSES`  : passages par tâche (défaut : 3)
 * - `ANZAR_BENCH_WORK`    : racine du banc (défaut : `~/Desktop/banc`)
 * - `ANZAR_BENCH_DSH`     : binaire dsh (défaut : le CLI de DeepSeek Harness.app)
 *
 * Ce banc n'a pas besoin du jeton ANZAR ; il consomme les crédits du compte DeepSeek
 * connecté à Harness. Il exige le CLI dsh et un compte actif.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TASKS } from './tasks';
import { DEFAULT_DSH_BIN, runDshPass } from './dsh';

const RUN = process.env.ANZAR_BENCH_REAL === '1';
const WORK = process.env.ANZAR_BENCH_WORK || join(homedir(), 'Desktop', 'banc');
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const FIXTURES = process.env.ANZAR_BENCH_FIXTURES || join(REPO_ROOT, 'bench', 'fixtures');
const PASSES = Number(process.env.ANZAR_BENCH_PASSES || 3);
const TASK_IDS = (process.env.ANZAR_BENCH_TASKS || 't1,t3,t5,t10').split(',').map((s) => s.trim());
const DSH_BIN = process.env.ANZAR_BENCH_DSH || DEFAULT_DSH_BIN;
const PASS_TIMEOUT_MS = 45 * 60_000;

const reportExists = (tache: string, pass: number): boolean =>
  existsSync(join(WORK, 'results', `dsh-${tache}-p${pass}.json`));

describe.skipIf(!RUN)('banc réel dsh (Harness)', () => {
  it('prépare le banc dsh', () => {
    expect(existsSync(DSH_BIN), `CLI dsh introuvable : ${DSH_BIN}`).toBe(true);
    if (!existsSync(FIXTURES)) throw new Error(`Fixtures introuvables : ${FIXTURES}`);
  });

  const selected = TASKS.filter((t) => TASK_IDS.includes(t.id));

  for (const task of selected) {
    for (let pass = 1; pass <= PASSES; pass++) {
      it(`dsh · ${task.id} · passage ${pass}`, { timeout: PASS_TIMEOUT_MS }, async () => {
        if (reportExists(task.id, pass)) {
          console.log(`[bench] dsh ${task.id} p${pass} : rapport déjà présent, passage sauté`);
          return;
        }
        const { report, reportPath } = await runDshPass({
          task, pass, workRoot: WORK, fixturesDir: FIXTURES, dshBin: DSH_BIN,
        });
        console.log(`[bench] dsh ${task.id} p${pass} → ${report.row.reussi ? 'RÉUSSI' : 'ÉCHEC'} · ${report.row.appels_outils} appels · ${report.row.credits_fcfa} FCFA est. · ${report.row.duree_s}s → ${reportPath}`);
      });
    }
  }
});
