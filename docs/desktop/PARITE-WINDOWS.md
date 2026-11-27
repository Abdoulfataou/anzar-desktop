# Parité Windows ↔ Mac

ANZAR Windows doit faire tout ce que fait ANZAR Mac, et les deux évoluent ensemble.
Ce document tient la matrice à jour ; le plan complet (6 phases) est dans le document
« Plan — ANZAR Windows au même niveau que Mac ».

## Matrice des capacités

| Capacité | Mac | Windows | Phase qui comble l'écart |
| --- | --- | --- | --- |
| Isolation des commandes | Seatbelt, écritures limitées au projet | Aucune : « fail closed » | 3 |
| Terminal de l'agent | `bash` (pipes, arrière-plan, `job_output`, bascule au délai) | `powershell`, même contrat que `bash` ; sans isolation : Accès complet ou accord par commande | 2 (fait) |
| Mode auto | Commandes dans le bac à sable | Commandes refusées | 4 |
| Mode « ask » | Accord seulement pour sortir du bac à sable | Accord à chaque commande | 4 |
| `start_dev_server` | Oui | Refusé hors Accès complet | 4 |
| Tickets en parallèle, sous-agents | Avec commandes | Sans commandes hors Accès complet | 4 |
| Signature de l'installateur | Signé et notarisé | Non signé | 5 |
| Tests automatiques | Vitest + Rust | Vitest + Rust + bout en bout | 1 (fait) |
| Interface, comptes, crédits, skills, agents | — | Identique | — |

Mettre cette matrice à jour **dans le même commit** que toute fonction qui crée ou comble
un écart, et le signaler dans `apps/desktop/NOUVEAUTES.md`.

## Règles

1. Une fonction n'est finie que si elle passe les tests Mac **et** Windows ; sinon elle est
   marquée « Mac seulement » ici, volontairement.
2. Un seul contrat par fonction, deux implémentations (ex. `terminal.execShellYield`).
3. Chaque test Vitest tourne sous les trois plateformes simulées (`ANZAR_TEST_PLATFORM`).
   Un test propre à une plateforme le dit dans son nom et force sa plateforme lui-même.
4. Les jobs Windows de la CI sont bloquants, au même titre que Mac.
5. Même numéro de version, même jour, un seul `latest.json`.

## Lancer les tests

Plateformes simulées (n'importe quel ordinateur) :

```bash
cd apps/desktop
ANZAR_TEST_PLATFORM=linux   npx vitest run src/
ANZAR_TEST_PLATFORM=mac     npx vitest run src/
ANZAR_TEST_PLATFORM=windows npx vitest run src/
```

Vrai Windows, sans PC Windows : pousser la branche (`main` ou `windows-*`), puis
regarder le job **Desktop Windows (Vitest, build, bout en bout)** dans l'onglet Actions.
Le job **Desktop Rust (Windows ARM)** se lance à la demande : Actions → CI → « Run workflow ».
En cas d'échec d'un test de bout en bout, les captures d'écran sont dans l'artefact
`e2e-captures-windows`.

## Tests de bout en bout (`apps/desktop/e2e`)

La vraie application (Rust + WebView2) pilotée par WebDriver via `tauri-driver`.
Windows et Linux seulement : macOS n'a pas de pilote WebDriver pour WKWebView.

Sur une machine Windows (ou la machine virtuelle de test) :

```powershell
cd apps/desktop
npm ci
npx tauri build --debug --no-bundle
cargo install tauri-driver --locked
./e2e/scripts/prepare-edgedriver.ps1      # affiche MSEDGEDRIVER=<chemin>
$env:MSEDGEDRIVER = "<chemin affiché>"
cd e2e
npm ci
npm test
```

Parcours couverts aujourd'hui (`e2e/specs/demarrage.e2e.js`) : démarrage sans session en
moins de 30 s (réglages, politique de commandes côté Rust, lecture du coffre Windows),
titre de la fenêtre, saisie d'une idée, ouverture du formulaire de connexion.
Les parcours connectés (envoi d'un message, approbation d'une commande, ticket complet)
viendront avec une session de test, en phase 4.
