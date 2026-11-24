/** Avertissement affiché quand l'utilisateur choisit « Accès complet ». */
export const FULL_ACCESS_WARNING = {
  title: 'Activer l’accès complet ?',
  message:
    "L'agent agira sans te demander : il modifie et supprime des fichiers du projet, lance des commandes, " +
    "installe des paquets (npm, pub, pip…) et utilise internet pour ça. Un paquet installé peut exécuter du code " +
    'sur ton ordinateur. Les écritures restent limitées au projet, aux dossiers temporaires et aux caches ; ' +
    'les dossiers de secrets (~/.ssh, ~/.aws, ~/.gnupg) restent illisibles.\n\n' +
    "Utilise ce mode sur des projets sauvegardés (Git) et pour des demandes que tu maîtrises. " +
    'Tu peux revenir à un autre mode à tout moment.\n\n' +
    "ANZAR te demandera encore ton accord dans deux cas seulement : un connecteur réglé sur « toujours demander », " +
    'et une page web ou un connecteur qui contient des consignes cachées.\n\n' +
    'Le code n’est jamais poussé : git push et la configuration git restent à ta main.',
  confirmLabel: 'J’accepte, activer',
  cancelLabel: 'Annuler',
  variant: 'warning' as const,
};

/**
 * Second avertissement, réservé au choix « Accès complet sans isolation ».
 * Sans Seatbelt, un programme lancé par l'agent peut lire les secrets du home :
 * il faut le dire clairement, pas le cacher derrière le mot « complet ».
 */
export const FULL_ACCESS_UNCONFINED_WARNING = {
  title: 'Désactiver aussi l’isolation ?',
  message:
    "L'accès complet sans isolation va plus loin : les commandes de l'agent ne sont plus confinées par le système. " +
    "Elles peuvent écrire en dehors du projet et lire les dossiers que l'isolation protégeait : ~/.ssh (clés), " +
    "~/.aws (identifiants cloud), ~/.gnupg, ~/.kube, ~/.netrc et ~/.git-credentials. Un programme peut aussi ignorer " +
    "le proxy réseau et modifier les hooks/config Git ; les refus de la politique de commandes (git push, git config, " +
    'secrets explicitement cités) restent, mais un script peut les contourner.\n\n' +
    'Ne l’active que sur une machine de confiance, avec un projet sauvegardé (Git). ' +
    'Tu peux revenir à « Accès complet » (isolé) ou à un autre mode à tout moment.\n\n' +
    'Le code n’est jamais poussé : git push et la configuration git restent à ta main.',
  confirmLabel: 'Je comprends, désactiver l’isolation',
  cancelLabel: 'Annuler',
  variant: 'danger' as const,
};
