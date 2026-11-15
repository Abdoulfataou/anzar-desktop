/**
 * Usage Store — Suivi des coûts API par provider
 * Historique d'utilisation, budget, alertes
 */
import { safeStorage } from '@/lib/safeStorage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AIProvider, AIModel } from '@/types';
import { useAccountStore } from '@/stores/accountStore';

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
  getMonthUsage: () => { totalCostUSD: number; totalCostFCFA: number; totalRequests: number };

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
          useAccountStore.getState().deductCredit(
            record.costFCFA,
            `Requête IA (${record.model})`
          );
        }
      },

      getTodayUsage: () => {
        const today = getDateKey(Date.now());
        const deepseek = { requests: 0, tokens: 0, costUSD: 0 };
        for (const r of get().records) {
          if (getDateKey(r.timestamp) !== today) continue;
          deepseek.requests++;
          deepseek.tokens += r.inputTokens + r.outputTokens;
          deepseek.costUSD += r.costUSD;
        }
        return {
          date: today,
          deepseek,
          totalCostUSD: deepseek.costUSD,
          totalCostFCFA: Math.round(deepseek.costUSD * USD_TO_FCFA),
        };
      },

      getMonthUsage: () => {
        const thisMonth = getMonthKey(Date.now());
        const monthRecords = get().records.filter((r) => getMonthKey(r.timestamp) === thisMonth);
        const totalCostUSD = monthRecords.reduce((sum, r) => sum + r.costUSD, 0);
        return {
          totalCostUSD,
          totalCostFCFA: Math.round(totalCostUSD * USD_TO_FCFA),
          totalRequests: monthRecords.length,
        };
      },

      hasCredit: () => {
        return useAccountStore.getState().hasCredit();
      },

      getRemainingBalance: () => {
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
      storage: safeStorage,
      partialize: (state) => ({
        records: state.records.slice(-500),
      }),
    }
  )
);
