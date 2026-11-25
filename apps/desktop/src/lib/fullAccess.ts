/** Avertissement affiché quand l'utilisateur choisit « Accès complet ». */
export const FULL_ACCESS_WARNING = {
  title: 'Activer l’accès complet ?',
  message:
    "L'agent agira sans te demander et sans isolation : il pourra modifier ou supprimer n'importe quel fichier " +
    "de ton compte, lire tes secrets (~/.ssh, ~/.aws, ~/.gnupg, ~/.kube, ~/.netrc, ~/.git-credentials, .env), " +
    "utiliser internet directement et modifier les hooks ou la configuration Git.\n\n" +
    "C'est le profil le plus ouvert de Harness. ANZAR ne garde que les demandes de ses connecteurs réglés " +
    "« toujours demander ». Utilise-le sur une machine de confiance, avec un projet sauvegardé.\n\n" +
    'Tu peux revenir à un autre mode à tout moment.',
  confirmLabel: 'J’accepte, activer sans isolation',
  cancelLabel: 'Annuler',
  variant: 'danger' as const,
};
