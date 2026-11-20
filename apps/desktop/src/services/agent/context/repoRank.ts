/**
 * Classement des fichiers d'un projet par importance (PageRank sur le graphe des imports,
 * comme la « repo map » d'Aider). Un fichier importé par des fichiers importants est
 * important. Avec une personnalisation (fichiers liés à la tâche), le classement favorise
 * ces fichiers et leurs voisins : le composant demandé, mais aussi le store qu'il utilise.
 *
 * Module pur, déterministe : à entrée égale, même ordre (utile au cache DeepSeek).
 */

export interface RankEdge { from: string; to: string }

export interface RankOptions {
  /** Probabilité de suivre un import plutôt que de « sauter » (défaut 0,85). */
  damping?: number;
  iterations?: number;
  /** Poids de départ par fichier (tâche) ; uniforme si absent ou vide. */
  personalization?: Map<string, number>;
}

export function pageRank(nodes: string[], edges: RankEdge[], opts: RankOptions = {}): Map<string, number> {
  const damping = opts.damping ?? 0.85;
  const iterations = opts.iterations ?? 40;
  const ids = [...new Set(nodes)].sort();
  const n = ids.length;
  const rank = new Map<string, number>();
  if (!n) return rank;
  const index = new Map(ids.map((id, i) => [id, i]));

  // Vecteur de saut : personnalisation normalisée, sinon uniforme
  const jump = new Float64Array(n);
  let total = 0;
  for (const [id, w] of opts.personalization ?? []) {
    const i = index.get(id);
    if (i !== undefined && w > 0) { jump[i] += w; total += w; }
  }
  if (total > 0) for (let i = 0; i < n; i++) jump[i] /= total;
  else jump.fill(1 / n);

  // Arêtes dédupliquées : importeur → importé
  const out: number[][] = Array.from({ length: n }, () => []);
  const seen = new Set<string>();
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    const key = `${a}>${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out[a].push(b);
  }

  let r = Float64Array.from(jump);
  for (let it = 0; it < iterations; it++) {
    const next = new Float64Array(n);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      if (out[i].length === 0) { dangling += r[i]; continue; }
      const share = (damping * r[i]) / out[i].length;
      for (const j of out[i]) next[j] += share;
    }
    // Saut aléatoire + masse des fichiers sans import, redistribuées selon la personnalisation
    for (let i = 0; i < n; i++) next[i] += ((1 - damping) + damping * dangling) * jump[i];
    let delta = 0;
    for (let i = 0; i < n; i++) delta += Math.abs(next[i] - r[i]);
    r = next;
    if (delta < 1e-9) break;
  }
  ids.forEach((id, i) => rank.set(id, r[i]));
  return rank;
}

/** Fichiers triés du plus au moins important ; égalités départagées par le chemin. */
export function rankedFiles(rank: Map<string, number>): string[] {
  return [...rank.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
}
