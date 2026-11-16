/**
 * Pack de skills intégré à ANZAR, en français.
 *
 * Méthode inspirée de obra/superpowers (licence MIT, © Jesse Vincent) : réfléchir
 * avant de coder, planifier, tester d'abord, déboguer par la preuve, vérifier avant
 * d'annoncer. Textes réécrits pour ANZAR. Une skill du projet ou personnelle portant
 * le même nom remplace celle du pack.
 */

export interface BuiltinSkill {
  name: string;
  markdown: string;
}

const brainstorming = `---
name: brainstorming
description: Clarifier une demande floue ou une nouvelle fonctionnalité AVANT d'écrire du code — questions ciblées, options, choix validé.
---

## Quand l'utiliser
- La demande décrit un résultat (« une app de livraison », « un tableau de bord ») sans préciser le comportement.
- Plusieurs façons raisonnables de faire existent et le mauvais choix coûterait cher à défaire.
Ne l'utilise pas pour une correction précise ou une question simple.

## Étapes
1. Lis d'abord ce qui existe (README, structure, fichiers concernés) : ne pose pas de question à laquelle le code répond.
2. Reformule le besoin en une phrase : qui l'utilise, pour faire quoi, comment on saura que c'est réussi.
3. Pose au plus 3 questions, une par sujet, en commençant par celle qui change le plus le résultat. Propose une réponse par défaut pour chacune.
4. Présente 2 ou 3 approches en quelques lignes chacune : ce qu'elle apporte, ce qu'elle coûte. Recommande-en une et dis pourquoi.
5. Une fois la direction validée, résume la décision (ce qui est inclus, ce qui ne l'est pas) puis passe à la skill ecrire-un-plan si la tâche est grosse.

## À éviter
- Commencer à coder « pour voir » sur une demande ambiguë.
- Les questionnaires : 10 questions d'un coup découragent. Va à l'essentiel.
- Ajouter des fonctionnalités que personne n'a demandées (YAGNI).`;

const plan = `---
name: ecrire-un-plan
description: Découper une tâche de plus de quelques fichiers en étapes vérifiables, avant de modifier le code.
---

## Quand l'utiliser
Tâche qui touche plusieurs fichiers ou plusieurs couches (base de données, API, interface), ou que l'utilisateur veut valider avant exécution.

## Contenu d'un bon plan
1. **Objectif** en une phrase et **critère de réussite** observable (commande qui passe, écran qui affiche X).
2. **Fichiers** : la liste de ceux qui seront créés ou modifiés, avec leur rôle en une ligne.
3. **Étapes** numérotées, chacune assez petite pour être vérifiée seule (2 à 10 minutes de travail) :
   - ce qu'on change ;
   - comment on vérifie (test, build, commande, capture).
4. **Risques** : ce qui peut casser ailleurs, et comment le détecter.
5. **Hors périmètre** : ce qu'on ne fait volontairement pas.

## Exécution
- Suis le plan dans l'ordre ; vérifie chaque étape avant la suivante.
- Si la réalité contredit le plan (fichier différent, dépendance absente), arrête-toi, explique l'écart et ajuste le plan au lieu d'improviser en silence.
- En mode plan, soumets-le avec propose_plan.`;

const tdd = `---
name: tdd
description: Développer ou corriger par les tests — écrire le test qui échoue, puis le code minimal, puis nettoyer.
---

## Quand l'utiliser
Logique métier (calculs, règles, transformations de données), correction de bug reproductible, code qui sera réutilisé. Le projet doit avoir (ou pouvoir avoir) un lanceur de tests.

## Cycle rouge → vert → nettoyage
1. **Rouge** : écris UN test qui décrit le comportement attendu. Lance-le et constate qu'il échoue pour la bonne raison (pas une faute de frappe ou un import manquant).
2. **Vert** : écris le code le plus simple qui fait passer ce test. Rien de plus.
3. **Nettoyage** : améliore la lisibilité sans changer le comportement ; relance tous les tests.
4. Recommence avec le cas suivant (cas limite, erreur, entrée vide).

## Pour un bug
Commence par un test qui reproduit le bug et échoue. Corrige. Le test reste dans le projet : le bug ne reviendra pas sans qu'on le voie.

## Règles
- Un test vérifie un comportement visible, pas le détail interne.
- Ne modifie jamais un test pour le faire passer sans expliquer pourquoi il était faux.
- Trouve la commande de test dans package.json, pyproject.toml ou le README avant d'en inventer une.`;

const debug = `---
name: debogage-systematique
description: Trouver la vraie cause d'un bug ou d'une erreur par la preuve, avant de proposer une correction.
---

## Quand l'utiliser
Erreur, crash, résultat faux, « ça ne marche pas », test qui échoue sans raison évidente.

## Méthode
1. **Reproduire** : obtiens l'erreur toi-même (commande, test, étapes). Note le message exact et la ligne.
2. **Lire** : lis le message d'erreur et la pile d'appels en entier. La réponse y est souvent.
3. **Délimiter** : quelle est la dernière version ou le dernier changement qui marchait ? Qu'est-ce qui diffère ? (git log, git diff)
4. **Une hypothèse à la fois** : formule-la (« la variable X est vide quand Y »), puis vérifie-la par un fait (lecture du code, log temporaire, test). Pas de correction tant que l'hypothèse n'est pas confirmée.
5. **Corriger la cause**, pas le symptôme : un try/catch qui avale l'erreur n'est pas une correction.
6. **Prouver** : relance la reproduction de l'étape 1, puis les tests. Retire les logs temporaires.

## Signaux d'alerte
- Trois corrections essayées sans succès : arrête, reprends à l'étape 1, l'hypothèse de départ est fausse.
- « Ça marche chez moi » : compare les environnements (versions, variables, données).
- Tu modifies du code que tu n'as pas lu : lis-le d'abord.`;

const verify = `---
name: verification-avant-de-conclure
description: Prouver que le travail fonctionne avant de dire « terminé » — build, tests, exécution réelle, relecture du diff.
---

## Quand l'utiliser
Toujours, avant d'annoncer qu'une tâche est finie ou qu'un bug est corrigé.

## Liste de contrôle
1. **Build / compilation** du projet : la commande du projet (npm run build, tsc, cargo build…) passe.
2. **Tests** existants : ils passent tous, pas seulement ceux que tu as ajoutés.
3. **Exécution réelle** : lance la fonctionnalité au moins une fois (script, requête, page) et regarde le résultat.
4. **Relecture du diff** : chaque fichier modifié l'a été volontairement ; pas de log de débogage, de code commenté ou de secret laissé.
5. **Demande d'origine** : relis-la. Tout ce qui était demandé est fait ; ce qui ne l'est pas est dit clairement.

## Annonce
Dis ce qui a été vérifié et comment (« build OK, 42 tests passent, testé avec … »). Si une vérification n'a pas pu être faite, dis-le : ne présente jamais une supposition comme un résultat.`;

const review = `---
name: revue-de-code
description: Relire un changement (le sien ou celui d'un autre) pour trouver bugs, failles et oublis avant la mise en ligne.
---

## Ordre de lecture
1. **Intention** : qu'est-ce que ce changement doit faire ? Le diff le fait-il, et seulement ça ?
2. **Exactitude** : cas limites (vide, nul, très grand, doublon), erreurs réseau, concurrence, fuseaux horaires, arrondis d'argent.
3. **Sécurité** : entrées utilisateur validées côté serveur, accès vérifié (un utilisateur ne voit pas les données d'un autre), pas de secret dans le code, pas d'injection SQL ou de commande.
4. **Données** : migrations réversibles, index pour les nouvelles requêtes, pas de suppression irréversible sans confirmation.
5. **Lisibilité** : noms clairs, fonctions courtes, pas de duplication évitable.

## Rendu
Classe les remarques : **bloquant** (bug, faille, perte de données), **important**, **suggestion**. Pour chacune : le fichier et la ligne, le scénario concret qui casse, la correction proposée. Ne remplis pas la revue de remarques de style si un bloquant existe.`;

const mobileMoney = `---
name: paiement-mobile-money
description: Intégrer un paiement Mobile Money (Orange Money, Wave, MTN MoMo, Moov, Airtel) de façon sûre — initiation côté serveur, webhook vérifié, idempotence, statuts.
---

## Principes non négociables
- **Le serveur décide**, jamais l'application : le client ne transmet qu'une intention (montant, produit). Le serveur crée la transaction et appelle l'opérateur ou l'agrégateur.
- **Les clés API restent sur le serveur**, dans des variables d'environnement. Jamais dans l'app mobile, le site ou le dépôt git.
- **Un paiement n'est validé que par l'opérateur** : notification serveur à serveur (webhook) vérifiée, ou requête de statut faite par le serveur. Le retour de l'utilisateur sur une page « succès » ne prouve rien.

## Étapes
1. Lis la documentation officielle de l'opérateur ou de l'agrégateur retenu (CinetPay, PayDunya, FedaPay, Flutterwave, ou l'API directe de l'opérateur) : URLs, authentification, format du webhook, environnement de test. Ne devine aucun nom de champ.
2. Table des paiements : identifiant interne unique, utilisateur, montant en entier (FCFA sans décimales), devise, opérateur, référence opérateur (unique), statut (en_attente, réussi, échoué, expiré, remboursé), dates.
3. Initiation : le serveur crée la ligne « en_attente » AVANT d'appeler l'opérateur, puis enregistre la référence retournée.
4. Webhook : vérifie la signature ou le secret, retrouve la transaction par sa référence, vérifie que le montant et la devise correspondent, puis passe le statut — une seule fois.
5. **Idempotence** : un même webhook peut arriver plusieurs fois. Si la transaction est déjà « réussi », réponds 200 sans recréditer. Utilise une contrainte d'unicité sur la référence opérateur.
6. Rattrapage : une tâche périodique interroge le statut des paiements restés « en_attente » (webhook perdu) et expire les trop vieux.
7. Interface : affiche « en attente de confirmation sur ton téléphone », puis le statut réel lu depuis le serveur.

## Tests à faire
Paiement réussi, refusé, abandonné, webhook reçu deux fois, webhook avec un montant modifié, webhook à la signature invalide, perte du webhook (rattrapage).`;

const writeSkill = `---
name: ecrire-une-skill
description: Créer une nouvelle skill (fiche SKILL.md) réutilisable pour ce projet ou pour tous les projets.
---

## Quand l'utiliser
L'utilisateur demande de « retenir une procédure », ou la même suite d'actions revient souvent (déploiement, création d'un écran type, conventions).

## Format (standard Agent Skills, compatible Claude Code, Codex, dsh…)
Un dossier au nom de la skill contenant SKILL.md :

\`\`\`text
.anzar/skills/
└── deploiement-api/
    ├── SKILL.md          instructions (obligatoire)
    └── references/       fichiers lus à la demande (facultatif)
\`\`\`

SKILL.md commence par un en-tête :

\`\`\`markdown
---
name: deploiement-api
description: Déployer l'API sur le VPS — build Docker, migration, vérification de santé.
---
\`\`\`

## Règles d'écriture
- **name** : minuscules, chiffres et tirets, identique au nom du dossier.
- **description** : c'est elle qui décide quand la skill est utilisée. Dis ce qu'elle fait ET quand s'en servir, en une phrase concrète.
- **Corps** : quand l'utiliser, étapes numérotées, vérifications, pièges. Moins de 300 lignes ; mets les détails longs dans des fichiers de references/.
- Pas de secret, de mot de passe ni de clé dans une skill.
- Emplacement : .anzar/skills/ pour le projet (versionné avec git). Pour tous les projets, l'utilisateur la crée dans la page Skills d'ANZAR.`;

const verifyWeb = `---
name: verifier-une-app-web
description: Vérifier dans un vrai navigateur une app web qu'on vient de modifier — lancer le serveur, ouvrir la page, essayer le parcours, corriger les erreurs de console et de réseau.
---

## Quand l'utiliser
Après une modification visible d'une app web (page, formulaire, bouton, appel d'API), avant d'annoncer que c'est terminé.

## Boucle de vérification
1. **Build d'abord** : les diagnostics du code doivent être propres. Une page ne s'affiche pas si le code ne compile pas.
2. **Serveur** : start_dev_server (commande devinée depuis package.json). S'il s'arrête, lis sa sortie, corrige, relance.
3. **Page** : check_page sur l'adresse de la page modifiée (par exemple /connexion), pas seulement l'accueil.
4. **Lire le rapport** :
   - erreurs de console : chacune est un bug à corriger, sauf favicon manquant ;
   - requêtes en échec : 404 = mauvaise route ou mauvaise adresse d'API, 401/403 = authentification, 500 = regarde dev_server_logs côté serveur ;
   - contenu : le texte, les boutons et les champs attendus sont-ils là ?
5. **Parcours** : avec page_action, fais ce que ferait l'utilisateur (remplir le formulaire, cliquer le bouton), puis vérifie le résultat affiché.
6. **Corriger puis revérifier** : après chaque correction, recharge avec check_page. Boucle jusqu'à une console propre et un parcours qui marche.

## À éviter
- Annoncer « ça marche » sans avoir ouvert la page.
- Saisir de vrais identifiants, mots de passe ou données de paiement : utilise des données de test.
- Laisser tourner le serveur si l'utilisateur ne l'utilise pas : stop_dev_server à la fin, sauf s'il veut le garder.`;

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  { name: 'brainstorming', markdown: brainstorming },
  { name: 'ecrire-un-plan', markdown: plan },
  { name: 'tdd', markdown: tdd },
  { name: 'debogage-systematique', markdown: debug },
  { name: 'verification-avant-de-conclure', markdown: verify },
  { name: 'verifier-une-app-web', markdown: verifyWeb },
  { name: 'revue-de-code', markdown: review },
  { name: 'paiement-mobile-money', markdown: mobileMoney },
  { name: 'ecrire-une-skill', markdown: writeSkill },
];
