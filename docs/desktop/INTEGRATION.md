# Intégration réelle — 18 novembre 2026

## 1. Backend

```text
GET https://anzar-api.issalanhub.com/health → 200
{"status":"healthy","version":"1.3.0",
 "checks":{"database":"ok","deepseek":"configured"}}
```

Backend joignable, base de données et DeepSeek configurés.

## 2. Scénario agent réel

Prompt envoyé dans une nouvelle tâche sans projet :

> Crée un fichier integration-test.txt dans l'espace ANZAR contenant exactement : anzar-integration-ok. Ne crée rien d'autre. Ensuite termine.

### Premier passage — release installée du 18/11 à 04:54

- espace ANZAR ouvert automatiquement ;
- modèle et outils exécutés ;
- fichier créé puis supprimé :

```text
/Users/agahmadou/Documents/ANZAR/integration-test.txt
20 octets
anzar-integration-ok
```

### Second passage — release courante du 18/11 à 13:22

Même scénario, session restaurée, sortie dans le sous-dossier choisi par l'agent :

```text
/Users/agahmadou/Documents/ANZAR/fichiers/integration-test.txt
20 octets
anzar-integration-ok
```

Fichier vérifié puis supprimé. Deux conversations de test restent dans
l'historique de l'application.

Ces parcours valident de bout en bout : authentification, proxy backend,
streaming du modèle, moteur agent, outil `write_file`, espace ANZAR et affichage
du chat — y compris sur le build courant.

## 3. Keychain et signature

Le premier rebuild release (13:14) changeait la signature ad-hoc du binaire.
macOS le considérait comme une autre application pour le trousseau et demandait
une autorisation ; sans session restaurée, le scénario n'avait pas pu être rejoué.

La release du 13:22 a restauré la session et permis le second passage. Si macOS
redemande l'accès après une mise à jour, il faut l'autoriser une fois ou se
reconnecter.

## 4. Correction trouvée pendant l'intégration

`vault_key_get` et `vault_key_set` appelaient le trousseau **sur le thread
principal Tauri**. Quand macOS affichait une demande d'autorisation, la fenêtre
ne s'affichait pas et l'application semblait ne jamais démarrer.

Les deux commandes utilisent maintenant `tauri::async_runtime::spawn_blocking`.
Après correction, la fenêtre s'ouvre immédiatement, même si le trousseau attend
une autorisation ; le délai JavaScript de 5 s peut alors échouer proprement et
laisser l'application continuer.

Fichier concerné : [`src-tauri/src/main.rs`](src-tauri/src/main.rs).

## 5. Commandes de contrôle

```bash
curl -sS https://anzar-api.issalanhub.com/health
find "$HOME/Documents/ANZAR" -name integration-test.txt
```
