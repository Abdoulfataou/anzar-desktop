import { useTicketStore } from '@/stores/ticketStore';
import { useAutomationStore } from '@/stores/automationStore';

/** Un travail de fond est-il en cours ? (fermeture de la fenêtre, indicateurs) */
export function hasBackgroundWork(): boolean {
  return useTicketStore.getState().runningIds.length > 0 || !!useAutomationStore.getState().runningId;
}
