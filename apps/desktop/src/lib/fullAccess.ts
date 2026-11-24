/** Avertissement affiché quand l'utilisateur choisit « Accès complet ». */
export const FULL_ACCESS_WARNING = {
  title: 'Activer l’accès complet ?',
  message:
    "L'agent agira sans te demander : il modifie et supprime des fichiers du projet, lance des commandes (y compris git push), " +
    "installe des paquets (npm, pub, pip…) et utilise internet pour ça. Un paquet installé peut exécuter du code " +
    'sur ton ordinateur.\n\n' +
    "Utilise ce mode sur des projets sauvegardés (Git) et pour des demandes que tu maîtrises. " +
    'Tu peux revenir à un autre mode à tout moment.\n\n' +
    "ANZAR te demandera encore ton accord dans deux cas seulement : un connecteur réglé sur « toujours demander », " +
    'et une page web ou un connecteur qui contient des consignes cachées.',
  confirmLabel: 'J’accepte, activer',
  cancelLabel: 'Annuler',
  variant: 'warning' as const,
};
