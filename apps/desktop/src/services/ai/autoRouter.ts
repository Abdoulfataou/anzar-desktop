/**
 * Mode Auto : choisit pour chaque demande le réglage le moins cher qui suffit.
 *
 *   fast     deepseek-flash, réflexion courte   questions simples, petites retouches
 *   thinking deepseek-flash, réflexion normale  la plupart des tâches de code
 *   max      deepseek-flash, réflexion maximale bugs, conception, gros changements
 *   pro      deepseek-v4-pro                    tâches les plus difficiles (≈ 3 à 4 fois plus cher)
 *
 * Règles locales, sans appel au modèle : gratuit, instantané, et la raison est affichée.
 * Pendant la tâche, une série d'échecs fait monter d'un cran (escalate).
 * On reste sur Flash autant que possible : changer de modèle repart sans le cache.
 */
import type { AIModel } from '@/types';

export type ConcreteModel = Exclude<AIModel, 'auto'>;

export interface Route {
  mode: ConcreteModel;
  reason: string;
}

export interface RouteInput {
  text: string;
  /** Un dossier de projet est ouvert (l'agent peut modifier du code) */
  workspace: boolean;
  planMode?: boolean;
  images?: number;
  /** Taille des pièces jointes en caractères */
  attachmentChars?: number;
  /** Réglage choisi pour la demande précédente de la conversation */
  previous?: ConcreteModel;
}

const LADDER: ConcreteModel[] = ['fast', 'thinking', 'max', 'pro'];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Signes d'une tâche difficile, avec leur poids. */
const HARD: [RegExp, number, string][] = [
  [/\b(architecture|concevoir|conception|design system|schema de (base|donnees)|modelisation)\b/, 2, 'conception'],
  // Création / motion design : jamais « question courte » — ces tâches produisent
  // de gros contenus et exigent réflexion (le routage fast ruinait la qualité).
  [/\b(cr[ée]{1,2}|cree|gen[ée]r\w*|fais[- ]moi|con[çc]ois|maquett\w*|publicit\w*|\bpub\b|animat\w*|vid[ée]o\w*|visuel\w*|affiche|logo|banni[èe]re|story|reel|motion|landing|mockup)\b/, 2, 'création'],
  [/\b(refactor\w*|refonte|reecri\w*|restructur\w*|migr\w*)\b/, 2, 'refonte'],
  [/\b(securite|faille|vulnerab\w*|injection|authentification|permissions?|chiffr\w*)\b/, 2, 'sécurité'],
  [/\b(performance|lent(e|eur)?|optimis\w*|fuite memoire|memory leak|concurren\w*|race condition|deadlock)\b/, 2, 'performance'],
  [/\b(pourquoi|ne (marche|fonctionne) (pas|plus)|plante|crash\w*|bug\w*|bloque|erreur|echoue|regression)\b/, 1, 'débogage'],
  [/\b(algorithme|complexite|recursi\w*|graphe|optimisation combinatoire)\b/, 2, 'algorithme'],
  [/\b(tout le projet|toute l.app|l.ensemble du (code|projet)|de zero|from scratch|application complete)\b/, 2, 'grande ampleur'],
  [/\b(paiement|mobile money|orange money|wave|webhook|transaction|idempoten\w*|facturation)\b/, 3, 'paiement'],
  [/\b(test(s)? (unitaire|d.integration)|couverture|ci\/cd|pipeline|docker|kubernetes|deploi\w*)\b/, 1, 'infrastructure'],
];

/** Signes d'une demande simple. */
const SIMPLE = /\b(renomm\w*|change(r)? (la |le |les )?(couleur|texte|titre|libelle|icone|police)|corrige (la|une) faute|traduis|traduire|ajoute (un|une) (bouton|lien|commentaire|log)|explique (moi )?(ce|cette)|c.est quoi|qu.est-ce que|resume|liste les)\b/;

/** Traces d'erreur collées dans la demande. */
const STACK = /(Traceback \(most recent call last\)|^\s+at .+\(.+:\d+:\d+\)|Error: .+\n|Exception in thread|panicked at|error\[E\d+\]|TS\d{4}:|Uncaught \w+Error)/m;

export function routeRequest(input: RouteInput): Route {
  const raw = input.text || '';
  const t = norm(raw);
  const len = raw.length + (input.attachmentChars || 0);

  let score = 0;
  const why: string[] = [];
  for (const [re, w, label] of HARD) {
    if (re.test(t)) { score += w; why.push(label); }
  }
  if (STACK.test(raw)) { score += 2; why.push("trace d'erreur"); }
  if (len > 6_000) { score += 2; why.push('demande longue'); } else if (len > 2_000) { score += 1; }
  const steps = (raw.match(/^\s*(\d+[.)]|[-*•])\s+/gm) || []).length;
  if (steps >= 5) { score += 1; why.push(`${steps} points à traiter`); }
  if (input.images) { score += 1; why.push('image jointe'); }

  const simple = SIMPLE.test(t) && score <= 1 && len < 600;

  let route: Route;
  if (!input.workspace && score === 0 && len < 1_200) {
    route = { mode: 'fast', reason: 'question courte' };
  } else if (simple) {
    route = { mode: 'fast', reason: 'retouche simple' };
  } else if (score >= 6) {
    route = { mode: 'pro', reason: why.slice(0, 3).join(', ') };
  } else if (score >= 3) {
    route = { mode: 'max', reason: why.slice(0, 3).join(', ') };
  } else if (input.workspace || score > 0) {
    route = { mode: 'thinking', reason: why.length ? why.join(', ') : 'tâche de code' };
  } else {
    route = { mode: 'fast', reason: 'question courte' };
  }

  // Le mode plan mérite une vraie réflexion : un mauvais plan coûte plus cher que la réflexion
  if (input.planMode && LADDER.indexOf(route.mode) < LADDER.indexOf('thinking')) {
    route = { mode: 'thinking', reason: `plan${route.reason ? ` (${route.reason})` : ''}` };
  }
  // Une suite courte (« continue », « ok vas-y ») garde le réglage de la demande précédente
  if (input.previous && len < 120 && score === 0 && /^(ok|oui|vas[- ]y|continue|go|d.accord|fais[- ]le|parfait|merci)\b/.test(t.trim())) {
    route = { mode: input.previous, reason: 'suite de la demande précédente' };
  }
  return route;
}

/**
 * Cran supérieur après une série d'échecs. Pro seulement après Max : c'est un autre
 * modèle (cache perdu, prix plus élevé). null si on est déjà au plus haut.
 */
export function escalate(route: Route, cause: string): Route | null {
  const i = LADDER.indexOf(route.mode);
  if (i < 0 || i >= LADDER.length - 1) return null;
  return { mode: LADDER[i + 1], reason: cause };
}

export const ROUTE_LABELS: Record<ConcreteModel, string> = {
  fast: 'Rapide',
  thinking: 'Réflexion',
  max: 'Max',
  pro: 'Pro',
};

/** true si la demande est une CRÉATION (visuel, pub, vidéo, site…) — sert au
 *  routage ET à l'ouverture automatique de l'espace ANZAR. */
export function looksLikeCreation(text: string): boolean {
  const t = norm(text || '');
  return /\b(cr[ée]{1,2}|cree|gen[ée]r\w*|fais[- ]moi|con[çc]ois|maquett\w*|publicit\w*|\bpub\b|animat\w*|vid[ée]o\w*|visuel\w*|affiche|logo|banni[èe]re|story|reel|motion|landing|mockup)\b/.test(t);
}
