# Rapport d'alignement des permissions sur Harness

Branche : `refonte-agent` (créée depuis la refonte d'hier ; `main` remise à
`e058e56` comme demandé). Aucun push, aucun tag, aucune release.

Référence : `deepseek-harness` commit `4b399c39`, lu dans `/tmp/dsh`.

## 1. Ce qui a été supprimé

| Élément | Emplacement supprimé | Pourquoi |
|---|---|---|
| Liste blanche de programmes, programmes interdits, plafonds d'arguments | `policy/commands.json` (supprimé), `policy/commandPolicy.ts`, `tool_runner.rs` | Absent de Harness : le shell exécute l'argv demandé |
| Refus `node -e`, `python -c`, pipes/chaînements, curl/wget, sudo, `rm -rf` | `commands.json`, `commandPolicy.ts` | Absent de Harness |
| Refus `git push`, `git remote add`, `git config`, `git reset --hard`, `git clean -f` | `bashTool.shellRefusal`, `tool_runner.forbidden_shell_operation` | Absent de Harness |
| Refus des secrets (`.env`, `~/.ssh`, clés) dans les commandes | mêmes fichiers | Absent de Harness |
| Cartes d'accord installation / programme inconnu / script écrit / script de build / hooks Git | `policy/commandGuard.ts` (supprimé), `toolHost.ts`, `turnVerify.ts` | Absent de Harness : une écriture dans le workspace ne demande rien |
| Accord pour chaque écriture et commande en mode `ask` | `permissions.needsApproval`, `toolPolicy.ts` | Harness `workspace-write` écrit sans accord |
| Filtrage des outils en mode plan | `runtime/toolList.ts` | Le plan de Harness guide, il ne retire pas les outils |
| Accord après lecture d'un contenu externe | `toolPolicy.ts`, `toolHost.ts` | Absent de Harness ; l'encadrement du contenu reste comme donnée |
| Secrets illisibles sous Seatbelt | `sandbox.rs` (`PROFILE`) | Les lectures ne sont pas confinées dans Harness |
| Protection `.git/hooks` et `.git/config` | `sandbox.rs` (`GIT_PROTECT`), `tool_runner.rs` | `.git` est un fichier du workspace dans Harness |
| Réseau coupé, proxy obligatoire, liste d'hôtes, accords réseau | `netproxy.rs` (supprimé), `NETWORK_RULES`, `command_policy.rs`, `terminal.ts` | Harness ne restreint pas le réseau |
| Profil d'élévation qui gardait secrets/Git/réseau | `sandbox.rs` (`ESCALATED_PROFILE`, `wrap_escalated`) | L'élévation `danger-full-access` de Harness contourne le provider |
| Refus `.env`/clés/`.ssh` dans les outils fichiers | `capabilities/migrated.json`, `shared.isProtectedWritePath`, `patchTool` | Lectures et écritures suivent la frontière du projet |
| Refus des dossiers de secrets comme projet, fichiers déposés filtrés | `roots.rs` | Absent de Harness |
| Réglages réseau, hôtes, programmes de confiance | `settingsStore.ts`, `SettingsPage.tsx`, `commandPolicy.ts` | Devenus sans effet |
| Tests et helpers des règles supprimées | `commandGuard.test.ts`, `vibecoding.test.ts`, `commandPolicy.test.ts`, `installGrant.test.ts`, `sandboxHint.test.ts` | Code mort |

**Conséquence assumée :** `.env`, `~/.ssh`, `~/.aws`, les clés, `git push`, `git config`,
`sudo`, les hooks et le réseau ne sont plus bloqués par ANZAR. C'est le modèle de Harness.
L'avertissement d'Accès complet et `SECURITY.md` le disent maintenant sans détour.

## 2. Ce qui a été aligné

| Sujet | Avant | Après |
|---|---|---|
| Choix de permissions | `ask` demandait tout, `auto` demandait les risques, `plan` filtrait les outils | `ask` = workspace-write + accord pour élargir ; `auto` = workspace-write + refus sans carte ; `plan` = guide sans filtrage ; `full` = danger-full-access + aucune demande |
| Déclencheur d'accord | écritures, commandes, installations, risques, contenu externe | élévation de sandbox et connecteurs `alwaysAsk` uniquement |
| Refus d'isolation | profil d'élévation restreint | l'élévation approuvée lance sans Seatbelt, pour cet appel |
| Mode plan | liste d'outils en lecture seule | tous les outils, `propose_plan` en plus |
| Sous-agents hors Full | lecture seule | héritent de l'écriture et du shell du parent, sans récursion |
| Accords | booléen | `allowed-once`, `rejected`, `cancelled`, `unavailable` (déjà livré) |
| Windows | avertissement | avertissement conservé ; aucune garantie inventée |

Le sélecteur, les libellés, le prompt et les textes de refus ont été mis à jour pour ne
plus promettre « lecture seule », « liste blanche » ou « git push refusé ».

## 3. Ce qui est gardé, et pourquoi

| Gardé | Pourquoi |
|---|---|
| Ports 9876 (Blender), 9877 (GIMP), 4455 (OBS), tube Audacity bloqués pour les commandes | Fonctions propres à ANZAR : empêcher une commande de piloter les connecteurs |
| Outils MCP qui exécutent du code refusés, connecteurs `alwaysAsk` | Fonctions propres à ANZAR (connecteurs GIMP, Blender, Inkscape, Audacity, OBS) |
| Espace ANZAR (`Documents/ANZAR`) et ses outils | Fonction propre à ANZAR, fichiers de l'app |
| Fichiers de l'app (`vault-key.dat`, `store/mcp.json`, `*.hold`) | Fichiers de l'app ANZAR |
| Bouton Stop, arrêt des processus | Fonction, pas permission |
| Facturation, rapports d'erreurs, langue de réponse | Fonctions propres à ANZAR |
| Vérification lint/build/tests | Fonction de qualité, pas restriction |
| Encadrement du contenu externe comme donnée | Guidage du modèle, sans carte d'accord |

## 4. Tests et vérifications

Sur `refonte-agent` :

- `npx tsc --noEmit` : 0 erreur ;
- `npx vitest run` : **419 tests / 67 fichiers** ;
- `cargo test` : **22 tests** (dont les vrais tests Seatbelt macOS) ;
- `cargo clippy --all-targets -- -D warnings -A clippy::too_many_arguments` : 0 avertissement ;
- `node scripts/check-security.mjs` : OK ;
- `npx vite build` : OK.

Les tests qui vérifiaient les règles supprimées ont été supprimés ou réécrits pour
vérifier le nouveau comportement (écriture dans `.git`, `.env`, subagents qui écrivent,
mode plan sans filtrage, absence de carte générique).

## 5. Ce qui reste différent de Harness

1. **Windows** : l'isolation des écritures n'est pas implémentée (job object seulement).
   Harness a un backend ACL `partial`. ANZAR l'affiche clairement ; il ne le garantit pas.
2. **Pas de choix `read-only`** : Harness a un mode `read-only` ; ANZAR n'expose que
   workspace-write (`ask`/`auto`/`plan`) et danger-full-access (`full`).
3. **Caches** : ANZAR autorise les caches d'outils (`~/.npm`, `~/.cargo`, etc.) en plus du
   projet et des temporaires. C'est une permission plus large, pas une restriction.
4. **Connecteurs** : ports et outils MCP restent protégés ; Harness n'a pas cette notion.
5. **Espace ANZAR et registre de projets** : limités aux fichiers de l'app, par conception.
6. **Windows** garde `run_command` (un programme, sans shell) ; Harness utilise `pwsh`.
7. **Noms des modes** : ANZAR garde `ask`/`auto`/`plan`/`full` comme identifiants internes,
   avec des libellés expliquant l'équivalent Harness.
8. **Contenu externe** : ANZAR l'encadre encore ; Harness n'a pas cette défense, mais elle
   ne bloque plus aucune action.

Le dépôt est propre sur `refonte-agent` ; les commits sont locaux et rien n'a été poussé.
