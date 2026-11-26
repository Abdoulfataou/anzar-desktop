# Nouveautés

## Permissions alignées sur DeepSeek Harness

- **Un seul sélecteur** : « Écriture projet · accord », « Écriture projet · sans accord »,
  « Plan guidé » et « Accès complet ».
- **Écriture projet** : l'agent écrit et exécute dans le projet, les dossiers temporaires et
  les caches sans demander. Le réseau et les lectures sont libres. Seule une écriture hors
  projet est refusée ; avec « accord », l'agent peut demander une élévation à usage unique.
- **Accès complet** : plus d'isolation et plus aucune demande. Écritures partout, lectures
  de `.env`, des clés et de `~/.ssh`, réseau direct, hooks et configuration Git modifiables.
  Un seul avertissement, puis la confirmation native de Rust.
- **Plan guidé** : l'agent explore et propose un plan, mais garde **tous** ses outils. Le
  mode plan est une consigne, pas une restriction.
- **Supprimé** : liste blanche de programmes, refus de `git push`, `git config`, `sudo`,
  `reset --hard`, `clean -f`, refus des secrets dans les commandes, protection Git,
  proxy réseau, liste d'hôtes, accords d'installation, cartes pour un programme inconnu ou
  un script écrit. Ces règles n'existent pas dans Harness.
- **Conservé** : les ports 9876 (Blender), 9877 (GIMP), 4455 (OBS) et le tube Audacity sont
  bloqués pour les commandes ; les connecteurs gardent leurs outils refusés et
  « toujours demander ». Les fichiers propres à l'app restent protégés.
- **Élévation** : une commande refusée hors projet peut être relancée une fois avec
  `sandbox_permissions: "danger-full-access"` et une justification. En « accord » et
  « plan », une carte demande l'accord ; en « sans accord », c'est refusé ; en « Accès
  complet », l'isolation est déjà retirée.
- **Windows** : les commandes ne peuvent pas encore être isolées dans le projet. Elles ne
  partent donc jamais toutes seules hors Accès complet : en « Demander », chaque commande
  demande ton accord ; en « Modifier automatiquement », elles sont refusées ; en « Accès
  complet », elles partent sans limite, comme l'avertissement le dit.

## Agent

- Vrai shell `bash` sur macOS (enchaînements, pipes, redirections), travaux en arrière-plan,
  `job_output`, `job_kill` et bouton Stop qui arrête l'arborescence.
- `glob`, `apply_patch`, appels d'outils sûrs en parallèle (10 au plus), fin de tour
  naturelle sans `task_done` obligatoire, vérification lint/build/tests après modification.
- Prompt plus court avec les faits du tour (dossier, plateforme, permissions, réseau),
  compaction du contexte long, rappel de boucle non bloquant.
- Sous-agents vivants : `spawn_agent`, `send_message`, `wait_agent`, `list_agents`,
  `stop_agent` ; historique repris, 8 actifs, profondeur 1, panneau au-dessus de la saisie,
  notifications, persistance des enfants au repos, sortie JSON validée.
- Accords à quatre issues (`allowed-once`, `rejected`, `cancelled`, `unavailable`) : le
  modèle distingue un refus, une annulation et l'absence de canal.

## Si tu étais déjà en « Accès complet »

Resélectionne-le une fois : l'isolation n'est retirée qu'après le nouvel avertissement et
la confirmation native.
