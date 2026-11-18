# Intégration réelle — 18 novembre 2026

## 1. Backend

```text
GET https://anzar-api.issalanhub.com/health → 200
{"status":"healthy","version":"1.3.0",
 "checks":{"database":"ok","deepseek":"configured"}}
```

Backend joignable, base de données et DeepSeek configurés.

## 2. Scénario agent réel

Application macOS release lancée avec une session authentifiée existante.

Prompt envoyé dans une nouvelle tâche sans projet :

> Crée un fichier integration-test.txt dans l'espace ANZAR contenant exactement : anzar-integration-ok. Ne crée rien d'autre. Ensuite termine.

Résultat observé :

- l'espace ANZAR s'est ouvert automatiquement (demande de création) ;
- le modèle a répondu et appelé les outils ;
- le fichier a été créé sur disque :

```text
/Users/agahmadou/Documents/ANZAR/integration-test.txt
20 octets
anzar-integration-ok
```

Le fichier de test a ensuite été supprimé. Une conversation de test reste dans
l'historique de l'application.

Ce parcours valide de bout en bout : authentification, proxy backend, streaming
du modèle, moteur agent, outil `write_file`, espace ANZAR et affichage du chat.

## 3. Limite importante : build testé

Le bundle utilisé pour ce scénario est le release installé du **18/11 à 04:54**,
antérieur aux refontes du moteur (`agentSession`, `toolPolicy`, etc.).

Le rebuild release du **18/11 à 13:14** change la signature ad-hoc du binaire.
macOS considère donc le nouveau binaire comme une application différente pour le
trousseau : il demande une autorisation Keychain, et sans session restaurée le
scénario agent n'a pas pu être rejoué sur ce build.

Pour rejouer l'intégration sur le code actuel :

1. lancer le rebuild release ;
2. autoriser l'accès Keychain quand macOS le demande (ou se reconnecter) ;
3. relancer le prompt ci-dessus.

## 4. Correction trouvée pendant l'intégration

`vault_key_get` et `vault_key_set` appelaient le trousseau **sur le thread
principal Tauri**. Quand macOS affiche une demande d'autorisation, la fenêtre ne
s'affiche pas et l'application semble ne jamais démarrer.

Les deux commandes utilisent maintenant `tauri::async_runtime::spawn_blocking`.
Après correction, la fenêtre s'ouvre immédiatement au lieu de rester absente.
En revanche, sur le rebuild, l'arbre d'accessibilité est resté vide après le
refus Keychain : le scénario agent n'a pas pu être rejoué sur ce build. Une
autorisation Keychain ou une reconnexion reste nécessaire.

Fichier concerné : [`src-tauri/src/main.rs`](src-tauri/src/main.rs).

## 5. Commandes de contrôle

```bash
curl -sS https://anzar-api.issalanhub.com/health
cat "$HOME/Documents/ANZAR/integration-test.txt"
```
