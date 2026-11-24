/** Avertissement affiché quand l'utilisateur choisit « Accès complet ». */
export const FULL_ACCESS_WARNING = {
  title: 'Activer l’accès complet ?',
  message:
    "L'agent agira sans te demander et sans isolation système : il modifie et supprime des fichiers, y compris " +
    "hors du projet, lance des commandes, installe des paquets (npm, pub, pip…) et utilise internet pour ça. " +
    "Les dossiers de secrets (~/.ssh, ~/.aws, ~/.gnupg, ~/.kube, ~/.netrc, ~/.git-credentials) deviennent lisibles " +
    "par une commande, et un script peut modifier les hooks/config Git ou ignorer le proxy réseau.\n\n" +
    "ANZAR garde ses refus explicites (git push, git config, sudo, secrets cités dans une commande), mais un script " +
    "peut les contourner. Utilise ce mode sur une machine de confiance, avec un projet sauvegardé (Git).\n\n" +
    "ANZAR te demandera encore ton accord dans deux cas seulement : un connecteur réglé sur « toujours demander », " +
    'et une page web ou un connecteur qui contient des consignes cachées.\n\n' +
    'Le code n’est jamais poussé : git push et la configuration git restent à ta main.',
  confirmLabel: 'J’accepte, activer sans isolation',
  cancelLabel: 'Annuler',
  variant: 'danger' as const,
};
