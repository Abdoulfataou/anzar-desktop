# Mettre le serveur ANZAR en ligne (VPS Hetzner partagé avec ShagoStore)

Résultat : `https://anzar-api.issalanhub.com`, servi par le **même VPS** que ShagoStore, sans coût en plus.

- ANZAR a sa **propre pile Docker** dans `/root/anzar` : sa base PostgreSQL 18 (jamais exposée) et son API.
- Le **Caddy de ShagoStore** reçoit le HTTPS (certificat Let's Encrypt automatique) et transmet
  `anzar-api.issalanhub.com` à l'API d'ANZAR, qui rejoint son réseau Docker sous le nom `anzar-api`.
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
- `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID` : les mêmes que dans `/root/shagostore/deploy/.env` (sauvegardes).

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
| `network shagostore_default not found` | ShagoStore pas lancé ou nommé autrement | `docker network ls` ; lancer ShagoStore d'abord |
| `502` sur l'adresse ANZAR | API d'ANZAR arrêtée ou en erreur | `docker compose ps` puis `docker compose logs api` |
| Erreur de certificat | DNS pas encore propagé | attendre, puis `docker compose restart caddy` dans `/root/shagostore/deploy` |
| `FATAL: JWT_SECRET…` au démarrage | `.env` absent ou vide | relancer `./initialiser.sh` (seulement si la base est vide) |
