# Isolation des commandes — Windows

État : **novembre 2026**. Aujourd'hui, sur Windows, une commande de l'agent tourne dans un
*job object* (`src-tauri/src/winjob.rs`) : arrêt de toute l'arborescence de processus, presse-papiers
et réglages système inaccessibles. **Les écritures de fichiers ne sont pas confinées** : une
commande peut écrire partout où l'utilisateur peut écrire.

Ce document décrit l'implémentation cible et ce qu'il faut valider avant de l'activer. Il existe
parce que le code ne peut pas être écrit depuis macOS : la compilation croisée échoue sur `ring`
(en-têtes du SDK Windows), donc du Win32 non testé serait du code non vérifié — inacceptable sur
le chemin qui exécute des commandes.

## 1. Modèle cible : AppContainer

| Contrôle | macOS (existant) | Windows (cible) |
|---|---|---|
| Écriture | Seatbelt : dossier projet, temporaires, caches | AppContainer : dossier projet, temporaires, caches, via ACE |
| Secrets | `~/.ssh`, `~/.aws`, … illisibles | AppContainer : aucun accès par défaut ; ne pas accorder |
| Réseau | proxy local avec liste d'hôtes, imposé par Seatbelt | proxy local **coopératif** (variables d'environnement) ; AppContainer + `internetClient` plus tard |
| Arrêt de l'arbre | groupe de processus | job object (déjà en place) |

L'AppContainer donne au processus un **SID dédié** ; par défaut il n'a accès à rien. On accorde
explicitement une ACE sur :

- le dossier du projet (`root`),
- le dossier temporaire (`%TEMP%`),
- les caches nécessaires : `%LOCALAPPDATA%\npm-cache`, `%LOCALAPPDATA%\pnpm`, `%USERPROFILE%\.cargo`,
  `%LOCALAPPDATA%\Yarn`, et le dossier de données d'ANZAR si l'outil y écrit.

## 2. Pourquoi ce n'est pas un petit changement

`std::process::Command` ne permet **ni** de choisir un jeton, **ni** de passer des attributs
`STARTUPINFOEX`. L'AppContainer impose donc de créer le processus avec `CreateProcessW` :

1. `CreateAppContainerProfile(name, …)` (ou `DeriveAppContainerSidFromAppContainerName` si le
   profil existe) → SID du paquet ;
2. `SetEntriesInAclW` + `SetNamedSecurityInfoW` : ACE « autoriser » pour ce SID sur chaque dossier
   accordé ;
3. `CreatePipe` ×3 (stdin/stdout/stderr), `SetHandleInformation(HANDLE_FLAG_INHERIT, 0)` sur les
   extrémités parentes ;
4. `InitializeProcThreadAttributeList` + `UpdateProcThreadAttribute(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES)`
   + `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` (empêche l'héritage d'autres handles) ;
5. `CreateProcessW` avec `EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_NO_WINDOW` ;
6. `AssignProcessToJobObject` **avant** `ResumeThread` : le processus ne doit pas avoir tourné une
   seule instruction hors job ;
7. reprise : `ResumeThread`, puis lecture des tuyaux par les threads existants.

Le point 6 est la raison pour laquelle on ne peut pas simplement « assigner après coup » comme
aujourd'hui : entre `spawn` et `assign`, le processus a déjà pu écrire.

Fonctions `windows-sys` à ajouter dans `Cargo.toml` (`[target.'cfg(windows)'.dependencies]`) :
`Win32_Security_Isolation`, `Win32_Security_Authorization`, `Win32_System_Pipes`,
`Win32_System_ProcessStatus` (déjà partiellement), `Win32_System_Memory`.
`Win32_System_Threading` et `Win32_System_JobObjects` sont déjà présents.

## 3. Structure de code prévue

```text
src-tauri/src/sandbox/
├── mod.rs          # API commune : prepare(root) -> Sandbox, wrap(cmd) -> Confined
├── macos.rs        # Seatbelt (déplacé depuis sandbox.rs)
└── windows/
    ├── mod.rs      # orchestration, cache du SID par dossier
    ├── appcontainer.rs  # profil, SID, ACE
    └── spawn.rs    # CreateProcessW + tuyaux + job object
```

`tool_runner.rs` ne changerait que d'un cran : `let child = sandbox::spawn(&spec)?` au lieu de
`Command::new(...).spawn()`. Toute la comptabilité (stdout/stderr, `tool_wait`, `tool_kill`) est
inchangée.

## 4. Repli et activation

- **Repli** : si la création du profil, l'ACE ou `CreateProcessW` échoue, la commande tourne
  comme aujourd'hui (job object seul) et l'échec est journalisé une fois. Une isolation qui
  échoue ne doit jamais empêcher l'utilisateur de travailler.
- **Activation progressive** : drapeau `sandbox_windows` (réglage existant « Isoler les
  commandes », aujourd'hui sans effet sur Windows). Défaut `false` jusqu'à validation, puis `true`.

## 5. Validation à exécuter sur une machine Windows

À faire une fois, avant d'activer par défaut :

1. `npm install` dans le projet : doit réussir (réseau + `%LOCALAPPDATA%\npm-cache`).
2. `npm run build` : doit écrire `dist/` du projet uniquement.
3. Script `node write.mjs` qui écrit dans `%USERPROFILE%\Desktop\test.txt` : **doit échouer**
   (accès refusé), avec un message que l'agent comprend.
4. `node read.mjs` qui lit `%USERPROFILE%\.ssh\id_ed25519` : **doit échouer**.
5. `git status` et `git commit` : doivent fonctionner (accès à `.git` en écriture).
6. `cargo build` sur un projet Rust : doit fonctionner (accès `%USERPROFILE%\.cargo`).
7. Arrêt d'une commande longue : toute l'arborescence doit mourir (job object, déjà testé).
8. Fermeture d'ANZAR pendant une commande : rien ne doit survivre.
9. Espace sans droits : `%ProgramFiles%` en écriture → refus.
10. Aucun handle fuit entre deux commandes (observateur de handles, ou `cargo test` répété 100×).

## 6. Où en est le dépôt

- **Fait** : job object (arrêt d'arbre, restrictions UI), chemins canonicalisés pour les outils de
  fichiers, permissions `0600` sur les secrets, et **CI Windows** (`rust-windows` dans
  `.github/workflows/ci.yml`) qui compile et exécute désormais le code `#[cfg(windows)]` à chaque
  PR — prérequis pour écrire cette isolation sans casser la release.
- **À faire** : ce document, section 2 à 5, sur une machine Windows.
