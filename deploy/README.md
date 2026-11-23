# Mettre le serveur ANZAR en ligne (VPS Hetzner partagé avec ShagoStore)

Résultat : `https://anzar-api.issalanhub.com`, servi par le **même VPS** que ShagoStore, sans coût en plus.

- ANZAR a sa **propre pile Docker** dans `/root/anzar` : sa base PostgreSQL 18 (jamais exposée) et son API.
- Le **Caddy de ShagoStore** reçoit le HTTPS (certificat Let's Encrypt automatique) et transmet
  `anzar-api.issalanhub.com` à l'API d'ANZAR, qui rejoint le réseau Docker `issalan_passerelle` sous le nom
  `anzar-api`. Sur ce réseau il n'y a que ce Caddy : ANZAR ne voit ni la base ni l'API ShagoStore, et
  inversement (contrôle : `bash /root/shagostore/deploy/audit-serveur.sh`, partie « Cloison »).
- Sauvegarde quotidienne gardée 14 jours, copiée chiffrée sur Telegram comme ShagoStore.

Durée : 20 à 30 minutes. Prérequis : ShagoStore tourne déjà sur le VPS (`/root/shagostore`).

---

## 1. Le domaine (Cloudflare)

Cloudflare → `issalanhub.com` → **DNS** → **Add record** :

| Type | Nom | Valeur | Proxy |
|---|---|---|---|
| A | `anzar-api` | IP du VPS (la même que `shagostore-api`) | **comme l'enregistrement `shagostore-api`** |

Vérification : `ping anzar-api.issalanhub.com` répond avec l'IP du VPS (quelques minutes).

## 2. Caddy de ShagoStore : ajouter ANZAR

Le Caddyfile de ShagoStore contient déjà le bloc ANZAR (commit « Caddy : ANZAR sur le même serveur »).
Sur le Mac, pousse le dépôt ShagoStore (`git push origin main`), puis sur le VPS :

```bash
ssh root@IP_DU_VPS
cd /root/shagostore/deploy
git -C .. pull --ff-only
docker compose restart caddy
```

Rien ne change pour ShagoStore. Tant qu'ANZAR n'est pas lancé, son adresse répond « 502 » : c'est normal.

## 3. Récupérer le code d'ANZAR (clé de lecture dédiée)

Une clé de déploiement GitHub ne sert qu'à **un** dépôt : ANZAR a donc la sienne, à côté de celle de ShagoStore.

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/anzar_deploy -C "vps-anzar"
cat ~/.ssh/anzar_deploy.pub
```

Copie la ligne affichée → GitHub → dépôt `anzar-desktop` → **Settings → Deploy keys → Add deploy key**
(titre « VPS », **ne coche pas** « Allow write access »). Puis :

```bash
cat >> ~/.ssh/config <<'FIN'
Host github-anzar
  HostName github.com
  User git
  IdentityFile ~/.ssh/anzar_deploy
  IdentitiesOnly yes
FIN
cd /root
git clone git@github-anzar:Abdoulfataou/anzar-desktop.git anzar
cd anzar/deploy
```

(Réponds `yes` à la question sur l'empreinte de github.com.)

## 4. Configurer et démarrer

```bash
./initialiser.sh
nano .env
```

Dans `.env`, remplis :
- `DEEPSEEK_API_KEY` : ta clé DeepSeek (platform.deepseek.com → API keys) ;
- `BREVO_API_KEY` : la même clé Brevo que ShagoStore (codes de connexion par e-mail) ;
- `ADMIN_REQUIRE_MFA` : laisser `false` le temps d'enrôler les admins, puis passer `true` pour exiger la double
  authentification avant tout accès admin ;
- `ADMIN_ALLOWED_IPS` : liste CIDR séparée par des virgules (ex. `203.0.113.10/32,10.0.0.0/8`). Vide = pas de
  restriction réseau, à réserver au développement ;
- `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID` : de préférence un bot à part (créé avec @BotFather), pour pouvoir
  couper l'un sans l'autre. Même conseil pour `BREVO_API_KEY` : une clé Brevo par projet. Ne jamais reprendre
  un mot de passe, `JWT_SECRET` ou `CLE_SAUVEGARDE` de ShagoStore.

Les mots de passe sont générés tout seuls. **Garde une copie de `.env`** dans ton gestionnaire de mots de passe :
`cat .env`. `ADMIN_DEFAULT_PASSWORD` est le mot de passe du compte administrateur `abdul@issalanhub.com`.

```bash
docker compose up -d --build
docker compose logs -f api        # Ctrl+C pour quitter
```

La première construction prend 2 à 4 minutes. Quand les journaux affichent « Uvicorn running », vérifie :

```bash
curl https://anzar-api.issalanhub.com/health
```

Réponse attendue : `{"status":"healthy", … "database":"ok","deepseek":"configured" …}`.

## 5. Sauvegarde quotidienne

```bash
crontab -e
```

Ajoute la ligne (3 h 15, après celle de ShagoStore à 3 h) :

```
15 3 * * * /root/anzar/deploy/sauvegarde.sh >> /var/log/anzar-sauvegarde.log 2>&1
```

Test immédiat : `./sauvegarde.sh` (un fichier chiffré doit arriver dans ta conversation Telegram).
Restaurer : `docker compose exec -T db pg_restore -U anzar -d anzar --clean --if-exists < sauvegardes/FICHIER.dump`

## 6. Mettre à jour plus tard

Après chaque `git push` depuis le Mac :

```bash
/root/anzar/deploy/mettre-a-jour.sh
```

(sauvegarde, récupération du code, reconstruction, redémarrage)

## 7. Basculer l'app et arrêter Railway

1. L'app pointe déjà vers `https://anzar-api.issalanhub.com` : reconstruis-la (`npm run tauri build`).
   Une installation qui avait gardé l'ancienne adresse Railway bascule toute seule.
2. **Base neuve** : crée à nouveau ton compte dans l'app (code par e-mail). Le bonus de bienvenue est crédité.
3. Quand tout marche : Railway → ton projet → **Settings → Delete project**.

## En cas de problème

| Symptôme | Cause probable | Solution |
|---|---|---|
| `network issalan_passerelle not found` | ShagoStore pas encore à jour (c'est lui qui crée ce réseau) | mettre ShagoStore à jour d'abord : `/root/shagostore/deploy/mettre-a-jour.sh` |
| `502` sur l'adresse ANZAR | API d'ANZAR arrêtée ou en erreur | `docker compose ps` puis `docker compose logs api` |
| Erreur de certificat | DNS pas encore propagé | attendre, puis `docker compose restart caddy` dans `/root/shagostore/deploy` |
| `FATAL: JWT_SECRET…` au démarrage | `.env` absent ou vide | relancer `./initialiser.sh` (seulement si la base est vide) |


## Paiements automatiques et multidevise

Le solde reste en FCFA côté serveur (1 crédit = 1 F, grand livre inchangé). L'utilisateur
voit son solde en crédits et paie dans **sa** monnaie : la devise est choisie selon sa
préférence (Réglages de l'app), sinon son pays (en-tête Cloudflare `CF-IPCountry`).
Le prix est toujours recalculé par le serveur.

Sans clé, un fournisseur reste invisible. Chaque fournisseur s'active dès que sa clé
secrète est dans `/root/anzar/deploy/.env`, puis `./mettre-a-jour.sh`.

| Fournisseur | Devises (voir `services/api/services/payments/capabilities.json`) |
|---|---|
| FedaPay | XOF (mobile money, Afrique de l'Ouest) |
| Paystack | NGN, GHS, ZAR, KES, XOF |
| Flutterwave | NGN, GHS, KES, UGX, TZS, RWF, ZAR, XAF, XOF, ZMW, MWK |
| Stripe | ~135 devises (cartes) ; sert aussi de **repli en USD** quand aucun autre n'accepte la devise |

**FedaPay** — tableau de bord FedaPay :
1. *Développeurs → Clés API* : clé secrète (`sk_sandbox_…` pour tester, `sk_live_…` ensuite).
2. *Développeurs → Webhooks → Ajouter* : URL `https://anzar-api.issalanhub.com/api/payments/webhook/fedapay`,
   événements `transaction.*`. Copie la clé secrète du webhook.
3. Dans `.env` :
   ```
   FEDAPAY_SECRET_KEY=sk_sandbox_...
   FEDAPAY_WEBHOOK_SECRET=wh_sandbox_...
   FEDAPAY_ENVIRONMENT=sandbox        # live quand le compte est validé
   ```

**Stripe** — dashboard Stripe :
1. *Développeurs → Clés API* : clé secrète (`sk_test_…`, puis `sk_live_…`).
2. *Développeurs → Webhooks → Ajouter une destination* : URL
   `https://anzar-api.issalanhub.com/api/payments/webhook/stripe`, événements
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `charge.refunded`, `charge.dispute.created`. Copie le `whsec_…`.
3. Dans `.env` :
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
   `STRIPE_CURRENCY` et `STRIPE_FCFA_PER_UNIT` ne servent plus (devise et taux viennent des
   tables de devises) : tu peux les retirer de `.env`.

**Paystack** — dashboard Paystack :
1. *Settings → API Keys & Webhooks* : clé secrète (`sk_test_…`, puis `sk_live_…`).
2. Même page, *Webhook URL* : `https://anzar-api.issalanhub.com/api/payments/webhook/paystack`.
   Paystack signe ses webhooks avec la clé secrète elle-même : aucune autre variable.
3. Dans `.env` : `PAYSTACK_SECRET_KEY=sk_test_...`

**Flutterwave** — dashboard Flutterwave :
1. *Settings → API Keys* : clé secrète (`FLWSECK_TEST-…`, puis `FLWSECK-…`).
2. *Settings → Webhooks* : URL `https://anzar-api.issalanhub.com/api/payments/webhook/flutterwave`,
   et choisis un **Secret hash** (longue chaîne aléatoire, par ex. `openssl rand -hex 32`).
3. Dans `.env` :
   ```
   FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-...
   FLUTTERWAVE_WEBHOOK_HASH=<le même secret hash>
   ```

Paystack et Flutterwave ont été testés contre des réponses simulées : fais un premier paiement
en mode test (clés `…TEST…`) avant de passer aux clés de production.

Sécurité : le serveur ne crédite jamais sur la seule foi du webhook. Il vérifie sa signature,
relit le statut chez le fournisseur, compare le montant **en unités mineures entières** et la
devise à ce qu'il a lui-même facturé, puis crédite une seule fois. Si un webhook se perd, l'app
(pendant l'attente) et un rattrapage toutes les 5 minutes relisent le statut ; dans l'admin,
« Vérifier » fait la même chose à la demande.

### Taux de change et prix

- Taux d'affichage téléchargés **une fois par jour** (ExchangeRate-API en accès libre, puis
  Frankfurter en secours), sans clé. `FX_AUTO_REFRESH=false` désactive la mise à jour automatique.
- L'euro et les francs CFA (XOF, XAF), ainsi que KMF, CVE, BAM et XPF, ont une **parité fixe**
  (1 € = 655,957 F) jamais téléchargée.
- Panne des sources : le dernier taux connu reste utilisé, avec sa date. Une variation de plus
  de 25 % en un jour n'est pas appliquée seule ; l'admin la voit et peut forcer le taux.
- Admin → **Devises et prix** : devises proposées, grille de packs à prix ronds par devise,
  marge de change des prix calculés (3 % par défaut), journal des taux, totaux par devise.
  Sans grille, une devise affiche la grille XOF convertie (marge comprise, arrondie vers le haut).
- Grilles de départ à **prix ronds** (migration 0002) pour EUR, USD, GBP, CAD, NGN, GHS, KES,
  ZAR, MAD, UGX, TZS, RWF et XAF, par ex. 1 €, 3 €, 8 €, 25 €, 80 €. Les crédits ont été calculés
  au cours du 23/11/2026, moins 3 % de marge, plus le bonus du palier. Si une devise bouge
  beaucoup, la colonne « Écart au marché » de la grille le montre : ajuste alors ses crédits.

### Migrations de base de données

Les migrations versionnées s'appliquent seules au démarrage de l'API. Pour les consulter ou
revenir en arrière (avant de redéployer une version précédente du code) :
```
docker compose exec api python -m db.migrations status
docker compose exec api python -m db.migrations down 0001_multidevise
```
Le retour arrière ne retire que les tables et colonnes multidevise ; soldes et historique sont intacts.


## Sécuriser `/api/admin`

Deux barrières indépendantes :

1. **MFA TOTP** — dans le panneau : `Paramètres → Double authentification`, génère le secret,
   ajoute-le dans Google Authenticator / 1Password / Aegis, puis valide un code. La connexion
   admin demandera ensuite ce code. Une fois tous les admins enrôlés, mets :
   ```
   ADMIN_REQUIRE_MFA=true
   ```
   Un admin sans MFA est alors bloqué sur toutes les routes métier, y compris l'enrôlement :
   enrôle tous les comptes avant d'activer le drapeau. Pour ajouter un admin ensuite, désactive
   temporairement `ADMIN_REQUIRE_MFA`, fais-le enrôler, puis réactive.
2. **Restriction réseau** — `ADMIN_ALLOWED_IPS` filtre `/api/admin/*` côté FastAPI. Pour une
   défense en profondeur, restreins aussi le chemin dans le Caddy de ShagoStore :
   ```
   @anzar_admin path /api/admin/*
   handle @anzar_admin {
       @allowed remote_ip 203.0.113.10
       handle @allowed {
           reverse_proxy anzar-api:8000
       }
       respond 403
   }
   ```
   Adapte l'IP ou le réseau VPN. Si tu utilises un reverse proxy, `get_client_ip` ne fait confiance
   à `X-Forwarded-For` que depuis les réseaux privés/loopback.

Sans `ADMIN_ALLOWED_IPS` ni règle Caddy, `/api/admin/*` reste exposé à Internet ; la MFA demeure
la protection principale.


## Vitrine getanzar.com

Le dossier `apps/site/` contient la vitrine et la page de téléchargement (`/telecharger/`). Le conteneur
`anzar-site` les sert ; le Caddy de ShagoStore les publie sur `getanzar.com` (et redirige `www`).

1. **DNS (Cloudflare)** : ajoute `getanzar.com` à Cloudflare (offre gratuite), puis remplace chez Turbify
   les serveurs de noms par ceux que Cloudflare indique. Ensuite, dans Cloudflare → DNS :
   - `A` `getanzar.com` → IP du VPS, **nuage gris (DNS only)** ;
   - `CNAME` `www` → `getanzar.com`, **nuage gris**.
   Le nuage gris laisse Caddy obtenir le certificat HTTPS lui-même.
2. **ShagoStore** : pousse le dépôt ShagoStore (bloc getanzar.com du Caddyfile), puis sur le VPS
   `cd /root/shagostore/deploy && git -C .. pull --ff-only && docker compose restart caddy`.
3. **ANZAR** : `./mettre-a-jour.sh` construit et lance le conteneur `site`.

La page de téléchargement lit la dernière version publiée sur GitHub
(`Abdoulfataou/anzar-desktop`, la même que la mise à jour automatique) : publier une version
suffit, la page suit. Le dépôt et ses versions doivent être publics.
