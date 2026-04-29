/**
 * Account Store — Modèle prépayé "achète et consomme"
 *
 * Pas d'abonnement. L'utilisateur achète du crédit FCFA
 * (Wave, Orange Money, M-Pesa), consomme via les requêtes IA,
 * et recharge quand le solde est à 0.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { UserProfile, CreditBalance, Transaction } from '@/types';

interface AccountStore {
  // State
  user: UserProfile | null;
  credits: CreditBalance;
  transactions: Transaction[];
  isLoggedIn: boolean;
  hasCompletedOnboarding: boolean;

  // Actions
  setUser: (user: UserProfile) => void;
  logout: () => void;
  setCredits: (credits: CreditBalance) => void;
  addTransaction: (tx: Transaction) => void;
  setTransactions: (txs: Transaction[]) => void;

  /** Recharge — ajouter du crédit au solde */
  addCredits: (amount: number, method: 'wave' | 'orange_money' | 'mpesa' | 'card') => void;

  /** Déduction — retirer du solde après une requête IA */
  deductCredit: (amountFCFA: number, description: string) => void;

  /** Sync credits from server response (source of truth) */
  syncCreditsFromServer: (serverCredits: { balance_fcfa: number; total_recharged: number; total_used: number }) => void;

  /** Mark onboarding as completed */
  completeOnboarding: () => void;

  // Selectors
  /** Vérifie si l'utilisateur a du crédit pour continuer */
  hasCredit: () => boolean;
  /** Retourne le solde restant en FCFA */
  getRemainingBalance: () => number;
}

const defaultCredits: CreditBalance = {
  totalRecharged: 0,
  totalUsed: 0,
  remaining: 0,
};

export const useAccountStore = create<AccountStore>()(
  persist(
    (set, get) => ({
      // Initial state — no user until login
      user: null,
      credits: defaultCredits,
      transactions: [],
      isLoggedIn: false,
      hasCompletedOnboarding: false,

      setUser: (user) => set({ user, isLoggedIn: true }),
      completeOnboarding: () => set({ hasCompletedOnboarding: true }),

      logout: () =>
        set({
          user: null,
          credits: defaultCredits,
          transactions: [],
          isLoggedIn: false,
        }),

      setCredits: (credits) => set({ credits }),

      addTransaction: (tx) =>
        set((state) => ({
          transactions: [tx, ...state.transactions],
        })),

      setTransactions: (txs) => set({ transactions: txs }),

      addCredits: (amount, method) =>
        set((state) => {
          const methodLabels: Record<string, string> = {
            wave: 'Wave', orange_money: 'Orange Money', mpesa: 'M-Pesa', card: 'Carte bancaire',
          };

          const tx: Transaction = {
            id: `tx-${Date.now()}`,
            type: 'recharge',
            amount,
            description: `Recharge via ${methodLabels[method] || method}`,
            date: Date.now(),
            paymentMethod: method,
            status: 'completed',
          };

          return {
            credits: {
              totalRecharged: state.credits.totalRecharged + amount,
              totalUsed: state.credits.totalUsed,
              remaining: state.credits.remaining + amount,
            },
            transactions: [tx, ...state.transactions],
          };
        }),

      deductCredit: (amountFCFA, description) =>
        set((state) => {
          const deduction = Math.min(amountFCFA, state.credits.remaining);

          const tx: Transaction = {
            id: `tx-${Date.now()}-usage`,
            type: 'usage',
            amount: -deduction,
            description,
            date: Date.now(),
            status: 'completed',
          };

          return {
            credits: {
              totalRecharged: state.credits.totalRecharged,
              totalUsed: state.credits.totalUsed + deduction,
              remaining: Math.max(0, state.credits.remaining - deduction),
            },
            transactions: [tx, ...state.transactions],
          };
        }),

      syncCreditsFromServer: (serverCredits) =>
        set({
          credits: {
            totalRecharged: serverCredits.total_recharged,
            totalUsed: serverCredits.total_used,
            remaining: serverCredits.balance_fcfa,
          },
        }),

      hasCredit: () => get().credits.remaining > 0,

      getRemainingBalance: () => get().credits.remaining,
    }),
    {
      name: 'anzar-account',
      partialize: (state) => ({
        user: state.user,
        credits: state.credits,
        transactions: state.transactions,
        isLoggedIn: state.isLoggedIn,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
      }),
    }
  )
);
