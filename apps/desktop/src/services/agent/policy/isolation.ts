/**
 * Commandes sans isolation possible (Windows) : comportement « fail-closed » de Harness.
 *
 * Sur macOS, Rust confine chaque commande au projet (Seatbelt, workspace-write). Sous
 * Windows, cette isolation n'existe pas encore : lancer la commande quand même reviendrait
 * à un Accès complet que l'utilisateur n'a pas choisi. Harness refuse dans ce cas plutôt que
 * de lancer sans protection ; ANZAR fait pareil :
 *   - « Écriture projet · accord » (et plan) : la commande passe par l'élévation à usage unique, donc par
 *     une carte d'accord ;
 *   - « Écriture projet · sans accord » : refus, avec la marche à suivre pour l'utilisateur ;
 *   - « Accès complet » : rien ne change, l'utilisateur a accepté l'absence d'isolation.
 * Linux n'est pas distribué : seule la plateforme Windows est concernée.
 */
import type { PermissionMode } from './permissions';
import { ESCALATION_HINT } from '@/services/runtime/terminal';
import { isWindowsPlatform } from '@/lib/platform';

export { isWindowsPlatform };

/** Refus à renvoyer au modèle, ou null si la commande peut partir. */
export function unconfinedCommandRefusal(
  mode: PermissionMode | undefined,
  escalated: boolean,
  tool: 'run_command' | 'start_dev_server' = 'run_command',
): string | null {
  if (escalated || mode === 'full' || !isWindowsPlatform()) return null;
  if (mode === 'auto') {
    return "Refusé : sur cet ordinateur (Windows), les commandes ne peuvent pas être isolées dans le projet, "
      + "et le mode « Écriture projet · sans accord » n'ouvre aucune demande d'accord. Dis à l'utilisateur de passer en "
      + "« Écriture projet · accord » (un accord pour chaque commande) ou en « Accès complet ». Ne cherche pas à contourner.";
  }
  if (tool === 'start_dev_server') {
    return "Refusé : sur cet ordinateur (Windows), un serveur de développement ne peut pas être isolé dans le projet. "
      + "Lance la commande du serveur avec run_command en élévation (une carte d'accord s'affichera), ou demande à "
      + "l'utilisateur de passer en « Accès complet ».";
  }
  return `[sandbox: unavailable on this computer (Windows) — commands cannot be confined to the project]\n${ESCALATION_HINT}`;
}

/** Vérifications automatiques (lint, build, tests) : elles exécutent le code du projet. */
export function autoVerifyAllowed(mode: PermissionMode | undefined): boolean {
  return mode === 'full' || !isWindowsPlatform();
}
