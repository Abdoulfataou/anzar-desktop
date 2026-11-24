# Rapport de sécurité — ANZAR

**Date :** 23 novembre 2026 · **Périmètre :** `apps/desktop` (Tauri 2 + React), `apps/admin`, `services/api` (FastAPI), `deploy/`, `.github/workflows/`
**Méthode :** scans automatiques (Gitleaks 8.30.1, OSV-Scanner 2.7.1, Semgrep 1.186.0, Trivy 0.76.2) + lecture manuelle du code (API, paiements, auth, admin, permissions Tauri, runner Rust, politique de l'agent).
**Aucune modification du code n'a été faite.**

---

## Verdict

**Sécurité : bon niveau, pas de faille critique.** Les points sensibles d'une app vibecodée (clés API, crédits, paiements, admin) sont bien traités côté serveur.

**Distribution : pas encore prêt pour Windows** — l'app Windows n'est pas signée (SmartScreen la bloquera), et les commandes de l'agent n'y sont pas isolées.

| Gravité | Nombre |
|---|---|
| Critique | 0 |
| Élevée | 1 |
| Moyenne | 7 |
| Faible | 6 |

---

## Ce qui est déjà bien fait (vérifié dans le code)

- **Aucune clé dans l'app** : DeepSeek n'est appelé que par l'API ; `.env` jamais commité dans l'historique git (317 commits scannés).
- **Crédits** : réservation du coût maximal avant l'appel IA, débit réel après, 402 sans solde ; modèle verrouillé côté serveur ; recharge directe désactivée.
- **Paiements** (FedaPay, Stripe, Paystack, Flutterwave) : signature des webhooks vérifiée, montant comparé à l'unité près, crédit idempotent (`payment:{id}`), verrou `FOR UPDATE`, prix recalculé par le serveur.
- **Auth** : JWT signé avec audience, révocation par `jti`, rotation au refresh, durée de session absolue, jetons admin séparés des jetons utilisateurs, limites de tentatives sur login/OTP.
- **Admin** : toutes les routes protégées (`get_current_admin` / `require_admin_role`), MFA disponible, filtrage IP possible, Docker sans port public, `/docs` fermé en production.
- **Taille des requêtes** plafonnée avant lecture (l'ancien P0 du 21/11 est corrigé).
- **Desktop** : jeton dans le trousseau système, CSP stricte, pas de plugin shell, scope fichiers limité à `Documents/ANZAR` avec `.ssh`, `.env`, clés… interdits, SVG/Mermaid nettoyés par DOMPurify, hooks Git protégés, `commandGuard` qui montre le vrai script quand l'agent a modifié `package.json`, téléchargements Node/Git vérifiés par SHA-256, isolation Seatbelt sur macOS.

---

## Problèmes trouvés

| # | Gravité | Où | Problème | Risque concret | Correction proposée |
|---|---|---|---|---|---|
| 1 | **Élevée** | `apps/desktop/src-tauri/tauri.conf.json` (`bundle.windows`), `.github/workflows/release.yml` | **L'installeur Windows n'est pas signé** (aucun certificat, `signCommand` ni secret Azure). | Windows SmartScreen affiche « Windows a protégé votre ordinateur » et beaucoup d'utilisateurs abandonnent ; certains antivirus bloquent. Bloquant pour distribuer en Afrique, où Windows domine. | Azure Artifact Signing via ta LLC US (~9,99 $/mois) ou certificat OV ; ajouter `signCommand` dans `tauri.conf.json` + secrets dans la CI. Ou passer par le Microsoft Store (signature gratuite). |
| 2 | Moyenne | `src-tauri/src/sandbox.rs:130` (`available()` = macOS seulement) | **Sous Windows, les commandes de l'agent ne sont pas isolées** : elles peuvent écrire partout où l'utilisateur peut écrire, avec réseau. (Déjà documenté dans `docs/desktop/WINDOWS_SANDBOX.md`.) | Si un projet ou une page lue par l'agent contient des instructions cachées et que l'utilisateur approuve la commande, le code tourne sans garde-fou système. L'approbation obligatoire en mode `auto` limite fortement le risque. | Court terme : sur Windows, mode `ask` par défaut et avertissement clair dans la carte d'approbation. Moyen terme : AppContainer (plan déjà écrit). |
| 3 | Moyenne | `src-tauri/src/tool_runner.rs:229-266` | **Le cœur Rust croit l'interface sur parole** : `approved`, `sandbox`, `network` et `proxy_hosts` sont envoyés par la webview sans contrôle côté Rust. | Toute faille d'injection de script dans l'interface (une dépendance compromise, par exemple) permettrait de lancer `npm install` avec réseau et sans isolation. La CSP rend ça difficile, mais il n'y a pas de seconde barrière. | Faire émettre l'accord par Rust : un jeton à usage unique créé quand l'utilisateur clique « Autoriser », vérifié dans `tool_spawn`. Ignorer `sandbox:false` sauf si le réglage est lu côté Rust. |
| 4 | ~~Moyenne~~ Faible (déjà désactivé par défaut, voir Suivi) | `services/api/routes/skills.py` + `db/skills.py:189` | **Ancien « hub » de skills communautaires, si on le réactive** : alors que l'app ne l'utilise plus : `/api/skills/hub` renvoie l'**e-mail de chaque auteur** à tout utilisateur connecté ; publication sans modération (`is_public=True` par défaut) ; notes illimitées par utilisateur. | Collecte d'e-mails d'utilisateurs, spam, manipulation des notes, prompts malveillants publiés. | Retirer le routeur `skills` de `include_routers` (l'app utilise `/api/agent/skills`). À défaut : ne plus renvoyer `author_email`, une note par utilisateur, modération avant publication. |
| 5 | Moyenne | `apps/admin/package-lock.json` | **Dépendances vulnérables du panneau admin (publié sur le web)** : `axios 1.15.0` (36 avis, jusqu'à 8.7/10 : vol d'en-têtes, injection d'en-têtes, contournement de proxy), `react-router 7.14.1` (redirection ouverte, XSS en mode RSC), `follow-redirects`, `form-data`. | Le panneau admin manipule les crédits et les paiements : c'est la cible la plus intéressante. | `npm i axios@latest react-router@latest react-router-dom@latest` puis `npm audit fix`, `npx tsc --noEmit`, rebuild. |
| 6 | Moyenne | `services/api` (dépendances transitives résolues) | `certifi 2026.7.22` contient des **autorités emSign compromises** (9.1/10) ; `anyio 4.9.0` (TLS, 9.3/10), `idna 3.9.0`. | Les appels sortants de l'API (DeepSeek, FedaPay, Stripe…) font confiance à une autorité compromise → interception possible en théorie. | Ajouter dans `requirements.txt` : `certifi>=2026.10.18`, `anyio>=4.14.2`, `idna>=3.15`, puis reconstruire l'image Docker sur le VPS (`deploy/mettre-a-jour.sh`). |
| 7 | Moyenne | `apps/desktop/src-tauri/Cargo.lock` | Crates Rust livrées aux utilisateurs avec des failles : `zip 0.6.6` (plusieurs avis jusqu'à 9.4 : liens symboliques, droits SUID à l'extraction), `openssl 0.10.78` (débordement de tampon), `tar 0.4.45`, `quick-xml`, `url`, `tokio`. | `zip`/`tar` ne servent qu'aux archives officielles Node/Git vérifiées par SHA-256 : risque réel faible, mais c'est du code dans l'app distribuée. | `Cargo.toml` : `zip = "9"` (adapter l'appel `extract`), puis `cargo update` et `cargo audit` sur ta machine, `npm run smoke`. |
| 8 | Moyenne | `.github/workflows/*.yml` (19 occurrences) | Actions GitHub référencées par **étiquette modifiable** (`tauri-apps/tauri-action@v0`, `dtolnay/rust-toolchain@stable`…) dans le workflow qui détient la **clé de signature des mises à jour** et les identifiants Apple. | Si une de ces actions est piratée, elle peut voler la clé et publier une fausse mise à jour signée chez tous tes utilisateurs. | Épingler chaque action sur son SHA de commit complet (`uses: owner/action@<sha40> # v0.5.x`). |
| 9 | Faible | `apps/desktop/package-lock.json` | Dépendances livrées : `react-router 6.30.6` (redirection ouverte), `katex` (via mermaid). Les autres alertes (`vite`, `vitest`, `tinypool` 9.5, `postcss`…) ne concernent que les **outils de développement**, pas l'app installée. | Faible dans une app desktop sans navigation externe. | `npm update` + monter vitest/vite aux versions corrigées pour protéger ta machine de dev. |
| 10 | Faible | `tauri.conf.json` (CSP `connect-src`) | `http://localhost:*` et `ws://localhost:*` autorisés en production. | Nécessaire pour l'aperçu des serveurs de dev du projet de l'utilisateur ; élargit un peu la surface si l'interface est compromise. | Garder si l'aperçu en dépend ; sinon limiter aux ports réellement utilisés. |
| 11 | Faible | `src/services/studio/browserTools.ts:218` | Les messages `anzar-console` sont acceptés **de n'importe quelle origine** (pas de vérification `e.origin` / `e.source`). | Une page affichée dans l'aperçu peut injecter de fausses lignes de console, que l'agent peut lire. | Vérifier `e.source === iframe.contentWindow`. |
| 12 | Faible | `services/api/db/admin.py:38` | Si `ADMIN_DEFAULT_PASSWORD` n'est pas défini, le mot de passe admin initial est **écrit dans les logs**. | Les logs Docker sont conservés : quiconque les lit a le mot de passe s'il n'a pas été changé. | Définir `ADMIN_DEFAULT_PASSWORD` dans le `.env` du VPS, changer le mot de passe au 1er login, activer la MFA. |
| 13 | Faible | `apps/admin/Dockerfile`, `apps/site/Dockerfile` | Conteneurs Caddy lancés en **root**. | Aggrave l'impact d'une faille éventuelle de Caddy. | Ajouter `USER` non root (Caddy écoute sur :80 interne, possible avec `setcap` ou port >1024). |
| 14 | Faible | `services/api/security.py:118` | Le limiteur de requêtes **laisse passer** si la base est en erreur (fail-open). | Pendant une panne de base, plus de protection contre le brute-force. | Fail-closed pour les routes d'auth et d'OTP uniquement. |

---

## Faux positifs écartés

- **Gitleaks (7 alertes hors dépendances)** : mots de passe et secret JWT de **tests** (`tests/test_admin_*.py`) et **clé publique** du système de mise à jour (`pubkey`, publique par nature). Aucun vrai secret.
- **Gitleaks (113 alertes)** : dans `src-tauri/target/` (fichiers de compilation), ignorés.
- **Semgrep `avoid-sqlalchemy-text`** (`db/base.py`, migration) : SQL construit à partir des modèles, jamais à partir d'une saisie utilisateur.
- **Semgrep `dangerouslySetInnerHTML`** (`VisualBlock.tsx`) : le SVG passe par DOMPurify avant affichage.
- **Semgrep `path-join-resolve-traversal`** (`anzar-render.cjs`) : vérification `inside(root, file)` présente.
- **`/api/deepseek/tools/fetch`** : la page est récupérée par le service de DeepSeek, pas par ton serveur (pas de rebond SSRF vers le VPS).
- **`archive/mobile/`** : ~60 paquets vulnérables, mais l'app est gelée et n'est pas distribuée. À supprimer du dépôt quand tu veux.

## Non vérifiable d'ici

- Si les **secrets Apple** (signature + notarisation macOS) sont bien renseignés dans GitHub.
- Si le dépôt `Abdoulfataou/anzar-desktop` qui sert les **mises à jour** est public (sinon l'auto-update échoue chez les clients).
- `cargo audit` (Rust non installé ici ; OSV-Scanner a lu `Cargo.lock` à la place).
- Les tests (`pytest`, `npm run smoke`) n'ont pas été lancés dans cet audit.

## Suivi des corrections (23 novembre 2026, soir)

| # | État | Ce qui a été fait |
|---|---|---|
| 6 | ✅ Corrigé | `services/api/requirements.txt` : `certifi>=2026.10.18`, `anyio>=4.14.2`, `idna>=3.15`. 127 tests API OK (Python 3.11, comme le Dockerfile). **À faire par toi** : reconstruire l'image sur le VPS. |
| 12 | ✅ Corrigé | Déjà protégé en production (`docker-compose.yml` exige `ADMIN_DEFAULT_PASSWORD`). En plus, `db/admin.py` n'écrit plus jamais le mot de passe généré dans les logs : il va dans `data/ADMIN_MOT_DE_PASSE_INITIAL.txt` (droits 0600). Test ajouté : `tests/test_admin_initial_password.py`. |
| 4 | ✅ Déjà désactivé | **Correction du rapport** : le hub est déjà coupé par défaut (`enable_community_skills = False`, vérifié par `tests/test_surface.py`). Par précaution, `db/skills.py` ne renvoie plus l'e-mail des auteurs si le hub est réactivé un jour. |
| 5 | ✅ Corrigé | `apps/admin` : axios 1.21.1, react-router-dom 7.18.6, vite 8.3.8, postcss 8.5.33, esbuild 0.28.2 + mise à jour des dépendances indirectes. `tsc` et `vite build` OK. Alertes OSV : 11 paquets → 1 (`postcss-selector-parser`, outil de build seulement). **À faire par toi** : `cd apps/admin && npm install` sur ton Mac. |
| 8 | ✅ Corrigé | Les 19 actions des 3 workflows sont épinglées sur un SHA de commit (avec la version en commentaire) ; `toolchain: stable` ajouté pour `dtolnay/rust-toolchain`. YAML validé. |
| 7 | ✅ Corrigé | `Cargo.toml` : `zip` 0.6 → 9, `reqwest` 0.11 → 0.12 (supprime `h2` 0.3) + `cargo update`. Alertes OSV sur `Cargo.lock` : 19 crates → 6, toutes « non maintenues » sans faille exploitable, la plupart propres à Linux (gtk, zbus). `openssl` n'est compilé que sous Linux, pas dans les versions macOS/Windows. |
| 3 | ✅ Corrigé | Nouveau `src-tauri/src/command_policy.rs` : Rust garde les réglages d'isolation, de réseau, de filtrage et la liste des hôtes (fichier `command-policy.json` à la racine des données de l'app, hors du dossier `store` que la webview peut écrire). `tool_spawn` ignore désormais tout `sandbox:false`, `proxy:false` ou toute liste d'hôtes venant de l'interface ; l'interface peut seulement renforcer. Affaiblir un réglage ouvre une **fenêtre de confirmation native** (`command_policy_set`). Côté interface : `services/runtime/commandPolicy.ts`, branché dans `SettingsPage.tsx` et au démarrage (`App.tsx`). Corrige aussi un bug : les hôtes ajoutés étaient perdus pour la 1re commande (liste posée avant le démarrage du proxy). |
| 2 | ✅ Atténué | Windows : mode « Demander avant de modifier » par défaut pour les nouvelles installations (`settingsStore.ts`) et avertissement dans la carte d'accord des commandes (`WorkspaceView.tsx`). L'isolation complète (AppContainer, `docs/desktop/WINDOWS_SANDBOX.md`) reste à faire. |
| 14 | ✅ Corrigé | `security.py` : connexion et OTP (`auth`, `otp`) refusent en 503 si le compteur est en panne (fail-closed) ; les autres routes restent fail-open. Test ajouté dans `tests/test_rate_limit.py` (128 tests API OK). |
| 13 | ✅ Corrigé | `apps/admin/Dockerfile`, `apps/site/Dockerfile` : Caddy tourne sous l'utilisateur `web` + `HEALTHCHECK`. `deploy/docker-compose.yml` : `cap_add: NET_BIND_SERVICE` remplacé par `sysctls: net.ipv4.ip_unprivileged_port_start: 80` (port 80 inchangé, aucun changement côté Caddy de ShagoStore). Images testées avec Docker : uid 100 (`web`), pages 200, santé « healthy ». |
| 11 | ✅ Corrigé | `services/studio/browserTools.ts` : seuls les messages de l'iframe d'aperçu sont acceptés ; niveau et taille du message contrôlés. Test ajouté. |
| 10 | ✅ Corrigé | `tauri.conf.json` : `localhost` retiré de la CSP de production ; il reste autorisé en développement via `devCsp`. (Les vérifications de pages passent par Playwright, hors de la webview.) `docs/desktop/SECURITY.md` mis à jour. |
| 9 | ✅ Corrigé en partie | `npm update` + `vitest` 3 → 5 (corrige `tinypool` 9.5/10 et `@vitest/mocker`), `vite` 6.4.6. 368 tests + banc d'essai (15) + build OK. **Restent, acceptés** : `react-router` 6.30.6 (corrigé seulement en v7 ; failles visant le rendu serveur et les redirections vers des adresses externes, absents d'ANZAR), `katex` 0.16 (imposé par mermaid, 2.1/10), `glob`/`minimatch` (outil de build Sentry). |
| 1 | ⏳ À toi | Signature Windows : démarche Azure Artifact Signing ou certificat. |

**Vérifications de l'étape 5** (compilation Linux, comme la CI) : `cargo check`, `cargo clippy --all-targets -- -D warnings` sans avertissement, `cargo test` 32/32 (dont 7 nouveaux), `npm run smoke` : 367 tests sur 59 fichiers (dont 5 nouveaux), build Vite OK. **Non testé** : compilation et comportement réel sur macOS et Windows (fenêtre de confirmation, isolation).

**Changement visible** : un utilisateur qui avait désactivé l'isolation retrouve, après la mise à jour, l'isolation activée (valeur la plus sûre). Il peut la redésactiver dans les Paramètres, avec confirmation.

## Ordre de correction conseillé

1. **#6** (certifi, 5 min + rebuild) et **#12** (mot de passe admin) — rapides, côté serveur.
2. **#5** (admin web) et **#4** (fermer le hub de skills).
3. **#8** (épingler les actions) avant la prochaine release.
4. **#1** (signature Windows) — démarches à faire par toi (Azure ou certificat).
5. **#3**, **#2**, **#7** — chantier desktop.

Fichiers bruts des scans : `audit/scans/` (osv.json, semgrep.json, trivy.json).
