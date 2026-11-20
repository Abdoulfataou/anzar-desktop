/**
 * Travaux de fond de l'agent (file du super-agent, automatisations). Ils tournent hors
 * de tout composant : démarrés une fois à l'ouverture de la session, arrêtés à sa fin.
 */
import { startTicketQueue } from '@/services/superagent/ticketQueue';
import { startAutomationQueue } from './automationQueue';
import { installCloseGuard } from './closeGuard';

export function startBackgroundQueues(): () => void {
  const stops = [startAutomationQueue(), startTicketQueue(), installCloseGuard()];
  return () => stops.forEach((stop) => stop());
}

export { hasBackgroundWork } from './status';
