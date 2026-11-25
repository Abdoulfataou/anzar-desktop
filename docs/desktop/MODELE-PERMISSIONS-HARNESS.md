# Le modèle de permissions de DeepSeek Harness

Référence lue : dépôt `deepseek-harness`, commit `4b399c39` (v0.2.3-alpha.2, MIT),
cloné dans `/tmp/dsh`. Ce document décrit **le code de Harness**, pas ANZAR.

## 1. Les profils de permissions

Harness sépare deux réglages indépendants :

- le **mode d'isolation** (`sandbox/mode`) : `read-only`, `workspace-write` ou
  `danger-full-access` ;
- la **politique d'accord** (`approval/policy`) : `ask` ou `never`.

Les profils (presets) ne sont qu'un emballage des deux. La table par défaut
(`packages/interaction/permission-presets/src/index.ts`, `Config`, lignes 160-201)
contient deux profils :

| Profil | Isolation | Accords | Ce que ça donne |
|---|---|---|---|
| `workspace-write` (défaut) | `workspace-write` | `ask` | Écriture dans l'espace de travail et les dossiers temporaires ; un élargissement hors de cette frontière demande un accord. |
| `danger-full-access` | `danger-full-access` | `never` | Aucune isolation de fichiers, aucune demande d'accord. |

`read-only` existe comme **mode d'isolation** (`SANDBOX_MODES` dans
`packages/sandbox/sandbox-policy/src/session-mode.ts`, lignes 37-48) mais n'est pas un
profil par défaut. Une session peut le choisir par le log (`sandbox/mode`), et
`workspace-write`/`danger-full-access` restent les deux presets proposés. Le preset
expérimental `auto` (review automatique) vaut `danger-full-access` + `ask`
(`AUTO_PRESET_SPEC`, lignes 91-94).

Le mode effectif est, dans l'ordre : l'élévation approuvée pour l'appel, le dernier
`sandbox/mode` de la session, puis le défaut du déploiement
(`docs/subsystems/sandbox.md`, lignes 75-87 et 204-242).

## 2. Ce que chaque profil autorise

### `read-only`

- Aucune écriture de fichier, nulle part. Seul `/dev/null` reste accessible en écriture
  pour les besoins du shell (`packages/shell/bash-sandbox/README.md`, lignes 36-40).
- Les lectures ne sont pas confinées.
- Le réseau n'est pas concerné par ce mode.

### `workspace-write`

- Écritures sous la racine de l'espace de travail, les racines supplémentaires
  explicitement accordées et la zone temporaire du backend
  (`docs/subsystems/sandbox.md`, lignes 9-21 ; `packages/sandbox/sandbox/src/roots.ts`).
- Les lectures ne sont pas confinées.
- Sur Windows, le backend ACL accorde la racine du workspace mais rapporte une
  application `partial` ; les racines supplémentaires ne sont honorées que par les
  outils fichiers, pas par les processus (`docs/subsystems/sandbox.md`, ligne 11).

### `danger-full-access`

- Aucune isolation : le provider de sandbox n'est même pas consulté, l'argv d'origine
  est lancé (`docs/subsystems/sandbox.md`, lignes 23-28 ;
  `packages/shell/bash-sandbox/README.md`, lignes 34-40 et 173).
- Aucune demande d'accord puisque le profil par défaut associe `never`.

## 3. Quand un accord est demandé

### 3.1 Politique `ask` / `never`

`packages/interaction/user-approval/src/index.ts` et `docs/subsystems/approval.md` :

- `ask` délègue aux canaux d'accord ; sans canal, l'issue est `unavailable` et
  l'action est refusée (`docs/subsystems/approval.md`, lignes 31-47).
- `never` ne demande jamais : toute demande devient `rejected` sans consulter personne.
- Les issues sont fermées : `allowed-once`, `rejected`, `cancelled`, `unavailable`.
  Seul `allowed-once` autorise, et pour cet appel seulement (lignes 21-29).

### 3.2 Ce qui déclenche réellement une demande

Il n'y a **pas** d'accord générique sur chaque écriture ou chaque commande dans le
cœur de Harness. Un outil écrit dans la limite de son mode sans demander. Les demandes
viennent de trois endroits :

1. **L'élévation de sandbox** : un outil `bash` ou un outil fichier refusé par
   l'isolation peut être relancé **une fois**, à l'identique, avec
   `sandbox_permissions` (le mode strictement plus large) et une `justification`
   (`packages/sandbox/sandbox/src/escalation.ts`, lignes 58-77, 88-98, 209-263 ;
   `packages/shell/tool-bash/src/index.ts`, lignes 262-284).
   - Depuis `read-only`, on peut demander `workspace-write` ou
     `danger-full-access`.
   - Depuis `workspace-write`, on peut demander `danger-full-access`.
   - Le mode demandé doit être **strictement plus large** ; répéter le mode courant ne
     demande rien.
2. **Une politique `tools/pre-execute` qui répond `ask`** : c'est un point d'extension.
   Le cœur n'en pose pas ; des plugins (hooks Claude Code, revue automatique, CUA)
   peuvent le faire (`docs/subsystems/tools.md`, lignes 541-572 et 828-845).
3. **L'entrée système de CUA** (expérimental) : la première action clavier/souris
   système peut demander un accord (`packages/experimental/cua/src/guidance.ts`).

Dans le profil `workspace-write`, une écriture **dans** le workspace ne demande donc
rien. Dans `danger-full-access`, rien ne demande rien.

### 3.3 Après un refus de l'isolation

Le refus est un **fait dans le résultat** : `sandbox: { mode, denied: true,
enforcement }`, et le texte ajoute exactement :

```
[sandbox: file access denied under <mode> mode]
[sandbox: escalation available — retry this exact command once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]
```

(`packages/sandbox/sandbox/src/escalation.ts`, lignes 100-134 ;
`packages/shell/bash-sandbox/README.md`, lignes 58-64 et 137-139.)

Le modèle peut alors relancer **la même commande** avec une justification. Rien ne
s'exécute avant l'accord. Si l'utilisateur refuse, l'action reste refusée ; si le canal
est absent, elle est refusée. Une élévation vers `danger-full-access` contourne
totalement le provider Seatbelt/bwrap/ACL : c'est un accès complet pour cet appel, pas
un profil plus large encore confiné.

### 3.4 Ce que l'isolation ne couvre pas

- **Fichiers en écriture uniquement.** Les lectures ne sont pas confinées ; les secrets,
  `.env`, clés SSH et identifiants sont lisibles si le processus a les droits du système.
- **Réseau : aucune politique.** Le réseau sortant n'est pas restreint par le sandbox
  (`packages/sandbox/sandbox/README.md`, ligne 166 ; `docs/subsystems/sandbox.md`,
  lignes 9-11). Il n'y a ni proxy obligatoire ni liste d'hôtes.
- **Processus : pas de garantie uniforme.** bwrap utilise `--unshare-pid`, Seatbelt et
  le backend Windows ne promettent pas la même visibilité ; ce n'est pas dans le
  vocabulaire du mode (`packages/sandbox/sandbox-local/src/profiles.ts`,
  lignes 16-23 ; `packages/sandbox/README.md`).
- **Git : aucune protection.** `.git/hooks` et `.git/config` sont des fichiers du
  workspace ; en `workspace-write`, ils sont écrivables. Il n'existe ni `GIT_PROTECT`
  ni refus de `git push`, `git config`, `git reset --hard` ou `git clean`.
- **Secrets : aucune liste.** Aucun refus de `.env`, `~/.ssh`, `~/.aws`, `~/.gnupg`,
  `~/.kube`, `~/.netrc` ou `~/.git-credentials`.
- **Commandes : aucune liste blanche ni liste noire.** Le shell accepte l'argv fourni ;
  `sudo`, `git push`, `npm publish`, `curl`, les pipes et les redirections ne sont pas
  filtrés par Harness (`packages/shell/tool-bash/src/index.ts`).
- **Programmes : aucune liste blanche.** Le shell résout `bash` et exécute ce que le
  modèle demande ; il n'y a pas de `commands.json` ni de `is_allowed_program`.
- **Accords : pas de carte par outil.** Les outils n'ont pas de `needsApproval` générique ;
  seule l'élévation (ou une politique `ask` ajoutée) déclenche une carte.

### 3.5 Application réelle (`full` / `partial`)

Le backend rapporte son niveau d'application. Sur Windows, le backend ACL est
`partial` : les liens durs, les lectures non confinées et les limites AppContainer
empêchent de promettre une frontière absolue (`docs/subsystems/sandbox.md`, lignes 30-38).
Quand aucun backend ne peut appliquer un mode confiné, Harness échoue avec
`SANDBOX_UNAVAILABLE` au lieu de lancer sans confinement
(`docs/subsystems/sandbox.md`, lignes 162-166 ; `packages/shell/bash-sandbox/README.md`,
lignes 92-98).

## 4. Conséquence pour ANZAR

Le modèle de Harness est **beaucoup plus ouvert** qu'ANZAR : écriture dans le workspace
sans accord, réseau et lectures libres, aucun refus de commande, aucune protection Git
ou de secrets. La seule restriction est l'écriture hors du workspace (et hors temp),
avec une élévation approuvée à usage unique. Le profil `danger-full-access` ne garde
rien. C'est ce modèle qu'il faut reprendre, pas une version plus prudente.
