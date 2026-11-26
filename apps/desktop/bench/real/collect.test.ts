/**
 * Collecteur du banc — lit les rapports de passages écrits par `bench-real.test.ts`
 * (côté ANZAR) et `dsh-bench.test.ts` (côté Harness) dans `<work>/results/`, puis :
 *
 * 1. écrit `docs/desktop/banc-essai-resultats.csv` : une ligne par passage, colonnes du
 *    banc (§3.4 de banc-essai-agent.md) ;
 * 2. affiche et journalise les médianes par (agent, tâche) et le taux de réussite —
 *    la base chiffrée des conclusions de `banc-essai-resultats.md`.
 *
 * ```bash
 * ANZAR_BENCH_COLLECT=1 npx vitest run bench/real/collect.test.ts
 * ```
 *
 * Ne calcule rien qui ne soit dans un rapport : pas de passage → pas de ligne. Les
 * rapports de fumée (`results/` sous `<work>/smoke/`) sont ignorés.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { CSV_HEADER, median, rowToCsv, successRate, type PassageRow } from './measures';

const COLLECT = process.env.ANZAR_BENCH_COLLECT === '1';
const WORK = process.env.ANZAR_BENCH_WORK || join(homedir(), 'Desktop', 'banc');
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
/** Par défaut le relevé va dans le dépôt ; ANZAR_BENCH_CSV le redirige (fumée, essais). */
const CSV_PATH = process.env.ANZAR_BENCH_CSV || join(REPO_ROOT, 'docs', 'desktop', 'banc-essai-resultats.csv');

interface ReportFile { row: PassageRow }

describe.skipIf(!COLLECT)('collecteur du banc', () => {
  it('remplit docs/desktop/banc-essai-resultats.csv depuis les rapports', () => {
    const resultsDir = join(WORK, 'results');
    if (!existsSync(resultsDir)) {
      throw new Error(`Aucun rapport : ${resultsDir} n'existe pas. Lance les passages d'abord.`);
    }
    const files = readdirSync(resultsDir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('smoke'))
      .sort();
    const rows: PassageRow[] = [];
    for (const f of files) {
      try {
        const report = JSON.parse(readFileSync(join(resultsDir, f), 'utf8')) as ReportFile;
        if (report?.row?.tache) rows.push(report.row);
      } catch { /* rapport illisible : il n'entrera pas dans le relevé */ }
    }
    if (rows.length === 0) throw new Error('Aucun rapport exploitable dans results/.');

    // Tri stable : agent, tâche, passage — le CSV se lit comme une grille de passages.
    rows.sort((a, b) => a.agent.localeCompare(b.agent) || a.tache.localeCompare(b.tache) || a.passage - b.passage);
    mkdirSync(dirname(CSV_PATH), { recursive: true });
    writeFileSync(CSV_PATH, `${CSV_HEADER}\n${rows.map(rowToCsv).join('\n')}\n`);

    // ── Médianes par (agent, tâche) : ce que lisent les conclusions ──
    const columns: (keyof PassageRow)[] = [
      'appels_outils', 'etapes_modele', 'tokens_entree', 'tokens_sortie', 'credits_fcfa',
      'duree_s', 'interventions_humaines', 'refus', 'refus_sans_alternative',
      'boucles_identiques', 'appels_bloques', 'contournements', 'erreurs_outil', 'faux_echecs',
    ];
    const groups = new Map<string, PassageRow[]>();
    for (const r of rows) {
      const key = `${r.agent}|${r.tache}`;
      groups.set(key, [...(groups.get(key) || []), r]);
    }
    console.log(`[collect] ${rows.length} passages → ${CSV_PATH}`);
    console.log(`[collect] colonnes : agent | tâche | réussite | ` + columns.join(' | '));
    const lines: string[] = [];
    for (const [key, group] of [...groups.entries()].sort()) {
      const [agent, tache] = key.split('|');
      const medians = columns.map((c) => {
        const m = median(group.map((r) => Number(r[c])));
        return m === null ? '—' : String(m);
      });
      const line = `${agent} | ${tache} | ${successRate(group.map((r) => r.reussi)).toFixed(2)} | ${medians.join(' | ')}`;
      console.log('[collect] ' + line);
      lines.push(line);
    }
    writeFileSync(join(WORK, 'results', 'mediane-par-tache.md'), lines.join('\n') + '\n');
  });
});
