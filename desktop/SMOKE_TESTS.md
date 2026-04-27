# Smoke tests (ANZAR Desktop)

Objectif: vérifier rapidement les parcours critiques “grand public” après une release.

## Pré-requis
- App desktop lancée (Tauri)
- Connexion internet active (pour le chat)
- Un dossier projet prêt dans **Documents/ANZAR** (ou Bureau/ANZAR / Téléchargements/ANZAR)

---

## 1) Chat (baseline)
1. Ouvrir l’écran Chat
2. Envoyer: “Bonjour”
3. Vérifier:
   - Le message user apparaît immédiatement
   - La réponse assistant arrive (stream ou non)

## 2) Réseau instable / retry
1. Couper internet (mode avion / couper Wi‑Fi)
2. Envoyer un message
3. Vérifier:
   - L’app affiche “Hors ligne” (bandeau discret)
   - L’envoi est bloqué proprement (pas de freeze)
4. Rétablir internet
5. Vérifier:
   - Un réessai automatique peut se déclencher (toast discret)
6. Provoquer une erreur (ex: couper internet pendant la génération)
7. Cliquer “Réessayer” sur le message en erreur
8. Vérifier: la requête repart sans dupliquer la question

## 3) Import dossier (projet existant)
1. Cliquer “Importer un dossier”
2. Sélectionner un dossier dans **Documents/ANZAR/**…
3. Vérifier:
   - Toast succès
   - Confirmation “Ouvrir maintenant ?”
   - Si “Oui”: ouverture du workspace /projects/:id

## 4) Générer un projet (choix dossier)
1. Cliquer “Générer un projet”
2. Choisir l’emplacement (par défaut ou dossier autorisé)
3. Vérifier:
   - Le chemin de création est affiché dans le message
   - À la fin, une confirmation propose d’ouvrir le workspace

## 5) Apply changes (preview → apply)
1. Lancer un run qui génère un changeset (ex: diagnostic fix)
2. Ouvrir Runs → Preview → Appliquer
3. Vérifier:
   - Les fichiers sont modifiés sur disque (dans le dossier projet)
   - Auto-verify déclenché si activé

## 6) Run command (Command Cards)
1. Dans un projet sélectionné, obtenir une Command Card (ex: “npm run lint”)
2. Vérifier:
   - En mode normal: confirmation affichée pour commandes non-safe
   - Les commandes “danger” sont bloquées (rm -rf, git reset --hard, etc.)
3. Exécuter “npm run lint”
4. Vérifier:
   - Logs affichés
   - Status success/error correct

---

## Commande CI / smoke minimal
Dans `desktop/`:

```bash
npm run smoke
```

