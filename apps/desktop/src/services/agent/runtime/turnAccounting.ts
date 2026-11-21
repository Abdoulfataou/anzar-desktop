/**
 * Comptabilité d'un tour : coût réel (coûts exacts du serveur, sinon écart de solde,
 * sinon estimation locale) et ligne de journal d'usage.
 *
 * Module pur : pas de React, pas de Tauri, pas de store.
 */
import type { AIModel } from '@/types';
import { computeSessionCost, hasExactCost } from '../engine/chatSession';

/** Coûts exacts envoyés par le serveur pour chaque appel au modèle (B6). */
export interface ServerCost {
  sum: number;
  reports: number;
  calls: number;
}

/** Repli si le serveur n'envoie pas le coût exact (FCFA / 1M tokens, ordre de grandeur). */
export const PRICE_IN_PER_MILLION = 250;
export const PRICE_OUT_PER_MILLION = 1000;
/** Taux de conversion utilisé pour le journal local (FCFA pour 1 USD). */
const FCFA_PER_USD = 615;
/** Sans coûts exacts, on laisse au serveur le temps d'enregistrer le dernier appel. */
const SETTLE_DELAY_MS = 600;

export const newServerCost = (): ServerCost => ({ sum: 0, reports: 0, calls: 0 });

/** Estimation locale du coût d'un appel (FCFA), quand le serveur n'envoie pas de coût exact. */
export const estimateFcfa = (tokensIn: number, tokensOut: number): number =>
  (tokensIn / 1_000_000) * PRICE_IN_PER_MILLION + (tokensOut / 1_000_000) * PRICE_OUT_PER_MILLION;

/** Vrai s'il faut attendre avant de lire le solde (le serveur n'a pas envoyé tous les coûts). */
export const needsSettleDelay = (cost: ServerCost): boolean => !hasExactCost(cost.reports, cost.calls);

export const settleDelay = (ms: number = SETTLE_DELAY_MS): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Ligne écrite dans l'historique d'usage local (ou journalisée sans redébit). */
export interface UsageRecord {
  provider: 'deepseek';
  model: AIModel;
  taskType: 'agent_chat';
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  costFCFA: number;
  wasFallback: boolean;
  timestamp: number;
  durationMs: number;
}

export interface TurnCostInput {
  cost: ServerCost;
  promptTokens: number;
  completionTokens: number;
  balanceBefore: number | null;
  balanceAfter: number | null;
  /** Modèle demandé par l'utilisateur (pas le routage Auto). */
  model: AIModel;
  /** Début du tour (ms), pour `durationMs`. */
  startedAt: number;
}

export interface TurnCostResult {
  costFCFA: number;
  /** Le coût vient du serveur (ou de l'écart de solde) : pas d'estimation locale. */
  fromServer: boolean;
  exact: boolean;
  /** Estimation locale, même quand un coût plus fiable existe. */
  estimate: number;
  record: UsageRecord;
}

export function finalizeTurnCost(input: TurnCostInput): TurnCostResult {
  const { cost, promptTokens, completionTokens, balanceBefore, balanceAfter, model, startedAt } = input;
  const exact = hasExactCost(cost.reports, cost.calls);
  const { costFCFA, fromServer, estimate } = computeSessionCost({
    serverCostSum: cost.sum,
    serverCostReports: cost.reports,
    serverModelCalls: cost.calls,
    balanceBefore,
    balanceAfter,
    promptTokens,
    completionTokens,
    priceInPerMillion: PRICE_IN_PER_MILLION,
    priceOutPerMillion: PRICE_OUT_PER_MILLION,
  });
  return {
    costFCFA,
    fromServer,
    exact,
    estimate,
    record: {
      provider: 'deepseek',
      model,
      taskType: 'agent_chat',
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      costUSD: Math.round((costFCFA / FCFA_PER_USD) * 10000) / 10000,
      costFCFA,
      wasFallback: false,
      timestamp: Date.now(),
      durationMs: Date.now() - startedAt,
    },
  };
}
