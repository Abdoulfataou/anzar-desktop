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

const lowBandwidth = `---
name: app-faible-connexion
description: Concevoir une app web ou mobile qui marche bien avec une connexion lente, chère ou intermittente (3G, forfaits limités) — poids, cache, hors ligne, reprise.
---

## Quand l'utiliser
App destinée à des utilisateurs sur réseau mobile lent ou instable, ou avec des forfaits de données limités (cas fréquent en Afrique de l'Ouest).

## Règles
1. **Poids** : vise moins de 200 Ko de JavaScript au premier chargement ; images compressées (WebP/AVIF), à la bonne taille, chargées à la demande (loading="lazy").
2. **Requêtes** : regroupe les appels, pagine les listes (20 éléments), n'envoie que les champs utiles. Compresse les réponses (gzip/brotli côté serveur).
3. **Cache** : données de référence (catégories, produits) gardées en local avec une date ; affichage immédiat du cache puis mise à jour en arrière-plan.
4. **Hors ligne** : les actions de l'utilisateur (commande, formulaire) sont mises en file locale et renvoyées au retour du réseau, avec un identifiant unique pour éviter les doublons.
5. **Délais** : délai d'attente explicite sur chaque requête (15 à 30 s), nouvelle tentative avec attente croissante, bouton « Réessayer ».
6. **Interface** : squelettes de chargement plutôt que pages blanches ; indicateur « hors ligne » ; jamais de perte de ce que l'utilisateur a saisi.

## Vérifier
Dans le navigateur, profil réseau « Slow 3G » et mode hors ligne : l'app s'ouvre, affiche le cache, et ne perd aucune saisie.`;

const apiSecurity = `---
name: securite-api
description: Sécuriser une API (REST ou GraphQL) — authentification, droits par ressource, validation, limites de débit, secrets, erreurs — avant la mise en ligne.
---

## Points à vérifier, dans cet ordre
1. **Droits par ressource** (la faille la plus fréquente) : chaque route qui reçoit un identifiant vérifie que la ressource appartient à l'utilisateur connecté (ou qu'il a le rôle requis). Teste-le : utilisateur A qui demande la commande de B → 403 ou 404.
2. **Authentification** : jetons signés avec une clé forte venue de l'environnement, durée de vie courte, mots de passe hachés (bcrypt/argon2), limite de tentatives de connexion.
3. **Validation** : toute entrée est validée côté serveur (types, longueurs, formats) ; on n'accepte que les champs attendus (pas d'affectation en masse de « role » ou « solde »).
4. **Injections** : requêtes paramétrées ou ORM, jamais de concaténation de SQL ; pas de commande système construite avec une entrée utilisateur.
5. **Limites de débit** sur connexion, OTP, inscription et routes coûteuses.
6. **Secrets** : aucun dans le code ni le dépôt ; .env ignoré par git ; clés différentes entre test et production.
7. **Erreurs** : pas de pile d'appels ni de détail interne dans les réponses ; journal côté serveur.
8. **CORS** : liste explicite des origines autorisées, pas de « * » avec des cookies.

## Rendu
Pour chaque point : OK, ou le fichier et la ligne du problème, avec la correction. Corrige les points bloquants (1 à 4) avant le reste.`;

const vpsDeploy = `---
name: deployer-sur-vps-docker
description: Déployer une app (API + base de données + front) sur un VPS avec Docker Compose et un proxy HTTPS (Caddy), avec sauvegardes et vérification de santé.
---

## Étapes
1. **Images** : un Dockerfile par service, multi-étapes (build puis image d'exécution légère), utilisateur non root, pas de secret dans l'image.
2. **Compose** : services (api, db, front), volumes nommés pour la base, réseau interne ; la base n'expose aucun port à l'extérieur ; restart: unless-stopped ; healthcheck sur chaque service.
3. **Configuration** : un fichier .env sur le serveur (jamais dans git) ; un .env.example documenté dans le dépôt.
4. **HTTPS** : Caddy en frontal (certificats automatiques), un bloc par domaine, reverse_proxy vers le nom du service.
5. **Migrations** : lancées au démarrage de l'API ou par une commande dédiée, jamais à la main en production.
6. **Sauvegardes** : dump quotidien de la base, chiffré, gardé hors du serveur ; tester une restauration au moins une fois.
7. **Mise à jour** : script unique (sauvegarde → git pull → docker compose up -d --build → vérification /health).
8. **Pare-feu** : seuls les ports 22, 80 et 443 ouverts ; connexion SSH par clé.

## Vérifier
curl https://domaine/health répond 200 ; redémarrage du serveur → tout revient seul ; un dump de sauvegarde existe.`;

const dbMigration = `---
name: migration-base-de-donnees
description: Modifier le schéma d'une base de données en production sans perte de données ni coupure — ajout, renommage, suppression de colonnes, index.
---

## Principes
- Une migration = un fichier versionné, appliqué par l'outil du projet (Prisma, Alembic, Django, Knex…), jamais par une modification manuelle.
- Toujours réversible si possible, et testée sur une copie des données.
- **Sauvegarde avant** toute migration en production.

## Opérations délicates (en plusieurs déploiements)
- **Renommer une colonne** : ajouter la nouvelle → écrire dans les deux → copier l'ancien contenu → lire la nouvelle → supprimer l'ancienne plus tard.
- **Colonne obligatoire** : l'ajouter facultative avec une valeur par défaut, remplir les lignes existantes, puis la rendre obligatoire.
- **Supprimer** : d'abord ne plus l'utiliser dans le code (déployé), ensuite seulement la supprimer.
- **Index sur une grosse table** : en mode non bloquant si la base le permet (CREATE INDEX CONCURRENTLY pour PostgreSQL).

## Vérifier
La migration s'applique sur une base vide ET sur une copie de la base réelle ; l'application fonctionne pendant et après ; le retour arrière a été essayé.`;

const expo = `---
name: app-mobile-expo
description: Créer ou faire évoluer une app mobile React Native avec Expo — navigation (Expo Router), stockage, permissions, appels d'API, builds EAS.
---

## Bonnes pratiques
1. **Démarrage** : npx create-expo-app ; Expo Router pour la navigation par fichiers (app/), TypeScript.
2. **Documentation** : vérifie la version d'Expo du projet (package.json) et lis la doc correspondante (connecteur Context7 si disponible) ; les API changent d'une version à l'autre.
3. **Données** : appels d'API centralisés dans un module ; jeton dans expo-secure-store (jamais AsyncStorage pour un secret) ; cache léger pour l'affichage hors ligne.
4. **Permissions** (caméra, localisation, notifications) : demandées au moment où on en a besoin, avec une explication, et un repli si refusées.
5. **Interface** : SafeAreaView, tailles de police accessibles, cibles tactiles d'au moins 44 px, clavier qui ne masque pas les champs (KeyboardAvoidingView).
6. **Builds** : EAS Build pour Android/iOS ; variables d'environnement par profil (development, preview, production) ; ne jamais mettre de clé secrète dans l'app.

## Vérifier
npx expo-doctor sans erreur ; l'app démarre sur Android et iOS (ou Expo Go) ; les parcours principaux marchent en mode avion avec le cache.`;

const phoneAuth = `---
name: connexion-par-telephone
description: Connexion ou inscription par numéro de téléphone avec code à usage unique (OTP) par SMS ou WhatsApp — sûre, peu coûteuse, adaptée aux numéros africains.
---

## Règles
1. **Numéros** : stockés au format international E.164 (+227…) ; validation avec une bibliothèque (libphonenumber), pas une expression régulière maison.
2. **Code** : 6 chiffres, aléatoire cryptographique, valable 5 à 10 minutes, usage unique ; stocké haché, jamais en clair.
3. **Limites** : au plus 3 envois par numéro et par heure, et par adresse IP ; au plus 5 essais de code, puis blocage temporaire. Les SMS coûtent de l'argent : une boucle d'envois peut vider le compte.
4. **Fournisseur** : passer par un agrégateur SMS ou l'API WhatsApp Business ; prévoir un second canal si le premier échoue ; clés uniquement côté serveur.
5. **Réponse identique** que le numéro existe ou non (pas de fuite sur les comptes existants).
6. **Session** : après validation, jeton de session à durée limitée ; changement de numéro = nouvelle vérification.

## Tests
Code expiré, mauvais code 5 fois, renvoi trop fréquent, numéro mal formé, deux demandes simultanées.`;

const gsapCookbook = `---
name: gsap-cookbook
description: Recettes GSAP 3.13 prêtes à l'emploi (SplitText, DrawSVG, timelines) pour créer des animations professionnelles — à assembler plutôt qu'inventer.
---

## Quand l'utiliser
Dès qu'une page, pub ou visuel doit être animé. GSAP 3.13 est intégralement gratuit (plugins compris) et VENDÉ dans ANZAR.

## Mise en place (toujours la même)
1. Appelle \`vendor_lib\` avec \`["gsap","split-text","draw-svg","custom-ease"]\` (ajoute \`morph-svg\`, \`scramble-text\`, \`flip\` si besoin) et insère EXACTEMENT les balises <script> renvoyées.
2. Charge les polices AVANT la première frame : \`<link href="https://fonts.googleapis.com/css2?family=...&display=block">\` puis \`await document.fonts.ready\` avant de lancer la timeline.
3. Tout dans UNE timeline GSAP avec des labels — jamais de setTimeout ni de délais CSS dispersés.

## Recette 0 — Page de départ complète (copie CE squelette d'abord)
\`\`\`\`\`html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pub</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;900&display=block" rel="stylesheet">
  <!-- Balises renvoyées par vendor_lib — JAMAIS de CDN -->
  <script src="libs/gsap.min.js"></script>
  <script src="libs/SplitText.min.js"></script>
  <script src="libs/CustomEase.min.js"></script>
  <style>
    * { margin: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; background: #0B0B0C; color: #EDEDEF;
      font-family: 'Archivo', sans-serif; }
    img { max-width: 100%; height: auto; } /* tailles explicites si possible */
    .hero, .cache { will-change: transform; }
  </style>
</head>
<body>
  <main class="scene">
    <h1 class="hero">Ton titre</h1>
    <p class="sous-titre">Ta promesse en une ligne</p>
    <img class="produit" src="fichiers/produit.png" width="540" height="540" alt="">
    <p class="prixcta">12 500 F</p>
  </main>
  <script>
    gsap.registerPlugin(SplitText, CustomEase);
    CustomEase.create("anzar", "0.22, 1, 0.36, 1");
    // Aléa seedé : même vidéo à chaque export
    function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
    const rand = mulberry32(42);

    document.fonts.ready.then(() => {
      const split = new SplitText(".hero", { type: "words,chars" });
      const tl = gsap.timeline();
      tl.addLabel("intro")
        .from(split.chars, { yPercent: 120, opacity: 0, stagger: 0.025, duration: 0.8, ease: "anzar" }, "intro")
        .from(".sous-titre", { y: 24, opacity: 0, duration: 0.6, ease: "anzar" }, "intro+=0.4")
        .addLabel("produit")
        .from(".produit", { y: 48, opacity: 0, scale: 0.92, duration: 0.9, ease: "anzar" }, "produit+=0.3")
        .from(".prixcta", { scale: 0.6, opacity: 0, duration: 0.5, ease: "back.out(1.8)" }, "produit+=0.8")
        .to({}, { duration: 1.0 }); // respiration finale
    });
  </script>
</body>
</html>
\`\`\`\`\`
Tout y est : polices \`display=block\` + \`fonts.ready\`, PRNG seedé, courbe signature, cascade labelisée, respiration finale. Adapte textes/images/durées — ne réinvente pas la structure.

## Autres recettes (à copier puis ajuster)

### 1. Titre qui se révèle mot à mot (le classique pub)
\`\`\`js
const split = new SplitText("h1", { type: "words,chars" });
gsap.timeline({ defaults: { ease: "expo.out" } })
  .from(split.chars, { yPercent: 120, opacity: 0, stagger: 0.02, duration: 0.8 })
  .from(".sous-titre", { y: 24, opacity: 0, duration: 0.6 }, "-=0.3");
\`\`\`

### 2. Logo SVG qui se dessine (DrawSVG)
\`\`\`js
gsap.registerPlugin(DrawSVGPlugin);
gsap.from("#logo path", { drawSVG: "0%", duration: 1.6, stagger: 0.15, ease: "power2.inOut" });
\`\`\`

### 3. Masque qui glisse (révélation d'image)
\`\`\`css
.cache { overflow: hidden; }
\`\`\`
\`\`\`js
gsap.timeline()
  .fromTo(".cache", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 1, ease: "expo.inOut" })
  .from(".cache img", { scale: 1.3, duration: 1.4, ease: "power2.out" }, 0);
\`\`\`

### 4. Compteur qui monte
\`\`\`js
const obj = { v: 0 };
gsap.to(obj, { v: 12500, duration: 1.6, ease: "power2.out",
  onUpdate: () => { compteur.textContent = Math.round(obj.v).toLocaleString("fr-FR") + " F"; } });
\`\`\`

### 5. Fond aurora organique (sans lib)
\`\`\`js
gsap.to(".blob", { x: "random(-80,80)", y: "random(-60,60)", scale: "random(0.9,1.3)",
  duration: 6, repeat: -1, yoyo: true, ease: "sine.inOut", stagger: { each: 0.4, from: "random" } });
\`\`\`
(CSS : blobs flous \`filter: blur(60px)\` + \`will-change: transform\`)

### 6. Texte brouillé qui se résout (ScrambleText)
\`\`\`js
gsap.registerPlugin(ScrambleTextPlugin);
gsap.to(".annonce", { scrambleText: { text: "Ouverture samedi", chars: "upperCase", speed: 0.4 }, duration: 1.4 });
\`\`\`

### 7. Cartes en cascade (Flip — réordonnancement fluide)
\`\`\`js
gsap.registerPlugin(Flip);
const state = Flip.getItem(".cartes", props);
// … après changement du DOM (filtre, tri) :
Flip.from(state, { duration: 0.7, ease: "expo.out", stagger: 0.04, absolute: true });
\`\`\`

### 8. Morphing de forme (MorphSVG)
\`\`\`js
gsap.registerPlugin(MorphSVGPlugin);
gsap.to("#forme1", { morphSVG: "#forme2", duration: 1.2, ease: "expo.inOut" });
\`\`\`

### 9. Courbe signature maison (CustomEase)
\`\`\`js
gsap.registerPlugin(CustomEase);
CustomEase.create("anzar", "0.22, 1, 0.36, 1"); // easeOutExpo — le « feel » pro
gsap.to(".hero", { y: 0, duration: 0.9, ease: "anzar" });
\`\`\`

### 10. Séquence complète type « pub 6 s » (à adapter)
\`\`\`js
const tl = gsap.timeline();
tl.addLabel("intro")
  .from(".fond", { scale: 1.15, duration: 2.5, ease: "power1.out" }, "intro")
  .from(split.chars, { yPercent: 120, stagger: 0.025, duration: 0.7, ease: "expo.out" }, "intro+=0.2")
  .addLabel("produit")
  .from(".produit", { y: 40, opacity: 0, duration: 0.8, ease: "anzar" }, "produit+=0.3")
  .from(".prix", { scale: 0.6, opacity: 0, duration: 0.5, ease: "back.out(2)" }, "produit+=0.8")
  .addLabel("cta")
  .fromTo(".cta", { scale: 0.9 }, { scale: 1, duration: 0.6, ease: "elastic.out(1, 0.5)" }, "cta")
  .to({}, { duration: 1.2 }); // respiration finale
\`\`\`

## Pièges
- Ne JAMAIS charger GSAP depuis un CDN (réseau coupé = capture ratée) : \`vendor_lib\` d'abord.
- \`clip-path\`, \`transform\`, \`opacity\` = GPU ; éviter \`top/left/width\` animés.
- Une seule animation « héros » à la fois : le reste accompagne en discret.
- Après toute modification, RÉEXPORTER (règle de \`export_animation\`).
- Vérifie avec \`capture_page\` aux moments clés (début, milieu, fin) AVANT d'exporter.`;

const motionSystem = `---
name: motion-system
description: Les règles de design du mouvement d'ANZAR — durées, courbes, cascade, hiérarchie. Ce qui différencie un rendu designer d'un rendu template.
---

## Quand l'utiliser
Toute création ou retouche animée (pub, landing, visuel, vidéo). À charger avec gsap-cookbook.

## L'échelle des durées (jamais d'à-peu-près)
| Durée | Usage |
|---|---|
| 120–180 ms | Micro-feedback (hover, puce) |
| 300–450 ms | Apparition d'un élément secondaire |
| 600–900 ms | Animation HÉROS (titre, produit) |
| 1000–1600 ms | Grand mouvement de caméra / masque plein écran |

Règle : une vidéo de 4-8 s = 3 à 5 moments, pas 15.

## Les courbes (le « feel »)
- **Sortie** (apparaît) : \`expo.out\` ou CustomEase \`"0.22, 1, 0.36, 1"\` — rapide au départ, frein doux. 80 % des animations.
- **Entrée-sortie** (masque, caméra) : \`expo.inOut\`.
- **Rebond d'accent** (prix, CTA) : \`back.out(1.8)\` ou \`elastic.out(1, 0.4)\` — UNE fois par vidéo maximum.
- Jamais \`linear\` sauf défilement continu (marquee).

## La cascade (stagger)
- Éléments liés (lettres, cartes) : décalage **25-40 ms**, toujours du même sens.
- Ordre de entrées : fond → titre → sous-titre → visuel produit → prix → CTA. Chaque élément commence quand le précédent atteint ~60 % (chevauchement \`"-=0.3"\`).
- Le tout doit tenir dans une SEULE timeline avec labels.

## Hiérarchie d'attention (le plus important)
1. UN seul héros animé fort par écran/plan.
2. Le reste : opacité + 8-24 px de déplacement, discret.
3. Le silence visuel est un outil : 0,5-1 s de respiration avant le CTA final.
4. Contraste de RYTHME : rapide (reveal) → lent (travaille) → net (CTA).

## Déterminisme (re-renders identiques)
- Bruit/aléa : PRNG seedé, jamais \`Math.random()\` nu —
\`\`\`js
const rand = mulberry32(42); // même seed = même vidéo à chaque export
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
\`\`\`
- GSAP \`"random(min,max)"\` : préfère un \`random: { y: [min,max] }\` seedé ou fige les valeurs une fois calculées.
- Polices : \`display=block\` + \`await document.fonts.ready\` avant la timeline.
- Images : dimensions explicites (pas de reflow en pleine capture).

## Anti-patterns (ce qui fait « cheap »)
- Tout qui fade-in en même temps (aucune cascade).
- Easings différents à chaque élément.
- Rebonds élastiques sur 5 éléments.
- Durées rondes identiques partout (400 ms partout = template).
- Mouvement pendant que du texte se lit : l'œil ne suit qu'un seul flux.`;

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  { name: 'brainstorming', markdown: brainstorming },
  { name: 'ecrire-un-plan', markdown: plan },
  { name: 'tdd', markdown: tdd },
  { name: 'debogage-systematique', markdown: debug },
  { name: 'verification-avant-de-conclure', markdown: verify },
  { name: 'verifier-une-app-web', markdown: verifyWeb },
  { name: 'revue-de-code', markdown: review },
  { name: 'paiement-mobile-money', markdown: mobileMoney },
  { name: 'connexion-par-telephone', markdown: phoneAuth },
  { name: 'securite-api', markdown: apiSecurity },
  { name: 'app-faible-connexion', markdown: lowBandwidth },
  { name: 'app-mobile-expo', markdown: expo },
  { name: 'migration-base-de-donnees', markdown: dbMigration },
  { name: 'deployer-sur-vps-docker', markdown: vpsDeploy },
  { name: 'ecrire-une-skill', markdown: writeSkill },
  { name: 'gsap-cookbook', markdown: gsapCookbook },
  { name: 'motion-system', markdown: motionSystem },
];
