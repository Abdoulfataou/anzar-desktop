/**
 * Usage Store — Suivi des coûts API par provider
 * Historique d'utilisation, budget, alertes
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AIProvider, AIModel } from '@/types';

// ============================================================================
// TYPES
// ============================================================================

export interface UsageRecord {
  id: string;
  timestamp: number;
  provider: AIProvider;
  model: AIModel;
  taskType: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  costFCFA: number;
  wasFallback: boolean;
  durationMs?: number;
}

export interface DailyUsage {
  date: string;           // YYYY-MM-DD
  deepseek: { requests: number; tokens: number; costUSD: number };
  kimi:     { requests: number; tokens: number; costUSD: number };
  totalCostUSD: number;
  totalCostFCFA: number;
}

interface UsageStore {
  // State
  records: UsageRecord[];

  // Actions
  addRecord: (record: Omit<UsageRecord, 'id'>) => void;

  /**
   * Enregistre une requête et déduit le coût du solde prépayé.
   * Appelle accountStore.deductCredit() automatiquement.
   */
  addRecordAndDeduct: (record: Omit<UsageRecord, 'id'>) => void;

  // Selectors
  getTodayUsage: () => DailyUsage;
  getMonthUsage: () => { totalCostUSD: number; totalCostFCFA: number; deepseekPercent: number; kimiPercent: number; totalRequests: number };
  getProviderSplit: () => { deepseekPercent: number; kimiPercent: number };

  /** Vérifie si le solde prépayé est épuisé */
  hasCredit: () => boolean;
  /** Retourne le solde restant en FCFA */
  getRemainingBalance: () => number;

  getRecentRecords: (limit?: number) => UsageRecord[];

  // Cleanup
  clearOldRecords: (daysToKeep?: number) => void;
}

// ============================================================================
// HELPERS
// ============================================================================

const USD_TO_FCFA = 615;

function getDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().split('T')[0];
}

function getMonthKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ============================================================================
// STORE
// ============================================================================

export const useUsageStore = create<UsageStore>()(
  persist(
    (set, get) => ({
      records: [],

      addRecord: (record) => {
        const newRecord: UsageRecord = {
          ...record,
          id: `usage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        };
        set((state) => ({
          records: [...state.records, newRecord],
        }));
      },

      addRecordAndDeduct: (record) => {
        // Enregistrer l'utilisation
        const newRecord: UsageRecord = {
          ...record,
          id: `usage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        };
        set((state) => ({
          records: [...state.records, newRecord],
        }));

        // Déduire du solde prépayé
        if (record.costFCFA > 0) {
          const { useAccountStore } = require('@/stores/accountStore');
          useAccountStore.getState().deductCredit(
            record.costFCFA,
            `Requête IA (${record.provider}/${record.model})`
          );
        }
      },

      getTodayUsage: () => {
        const today = getDateKey(Date.now());
        const todayRecords = get().records.filter((r) => getDateKey(r.timestamp) === today);

        const deepseek = { requests: 0, tokens: 0, costUSD: 0 };
        const kimi = { requests: 0, tokens: 0, costUSD: 0 };

        for (const r of todayRecords) {
          const bucket = r.provider === 'deepseek' ? deepseek : kimi;
          bucket.requests++;
          bucket.tokens += r.inputTokens + r.outputTokens;
          bucket.costUSD += r.costUSD;
        }

        const totalCostUSD = deepseek.costUSD + kimi.costUSD;

        return {
          date: today,
          deepseek,
          kimi,
          totalCostUSD,
          totalCostFCFA: Math.round(totalCostUSD * USD_TO_FCFA),
        };
      },

      getMonthUsage: () => {
        const thisMonth = getMonthKey(Date.now());
        const monthRecords = get().records.filter((r) => getMonthKey(r.timestamp) === thisMonth);

        let deepseekCost = 0;
        let kimiCost = 0;
        let deepseekReqs = 0;
        let kimiReqs = 0;

        for (const r of monthRecords) {
          if (r.provider === 'deepseek') {
            deepseekCost += r.costUSD;
            deepseekReqs++;
          } else {
            kimiCost += r.costUSD;
            kimiReqs++;
          }
        }

        const total = deepseekReqs + kimiReqs;
        const totalCostUSD = deepseekCost + kimiCost;

        return {
          totalCostUSD,
          totalCostFCFA: Math.round(totalCostUSD * USD_TO_FCFA),
          deepseekPercent: total > 0 ? Math.round((deepseekReqs / total) * 100) : 0,
          kimiPercent: total > 0 ? Math.round((kimiReqs / total) * 100) : 0,
          totalRequests: total,
        };
      },

      getProviderSplit: () => {
        const { records } = get();
        const total = records.length;
        if (total === 0) return { deepseekPercent: 80, kimiPercent: 20 };

        const deepseek = records.filter((r) => r.provider === 'deepseek').length;
        return {
          deepseekPercent: Math.round((deepseek / total) * 100),
          kimiPercent: Math.round(((total - deepseek) / total) * 100),
        };
      },

      hasCredit: () => {
        const { useAccountStore } = require('@/stores/accountStore');
        return useAccountStore.getState().hasCredit();
      },

      getRemainingBalance: () => {
        const { useAccountStore } = require('@/stores/accountStore');
        return useAccountStore.getState().getRemainingBalance();
      },

      getRecentRecords: (limit = 50) => {
        return get().records.slice(-limit).reverse();
      },

      clearOldRecords: (daysToKeep = 30) => {
        const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
        set((state) => ({
          records: state.records.filter((r) => r.timestamp >= cutoff),
        }));
      },
    }),
    {
      name: 'anzar-usage',
      partialize: (state) => ({
        records: state.records,
      }),
    }
  )
);
