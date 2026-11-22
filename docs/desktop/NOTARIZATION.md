# Signature et notarisation macOS

Distribution hors App Store : macOS refuse d'ouvrir une application téléchargée qui n'est
pas signée par un **Developer ID** et **notariée** par Apple. Sans ça, l'utilisateur lit
« développeur non identifié » — ou pire, « l'application est endommagée » — et doit
contourner Gatekeeper à la main.

Ce document décrit la configuration déjà présente dans le dépôt et ce qu'il reste à faire
côté Apple (une fois).

## Ce qui est déjà en place

| Élément | Fichier |
|---|---|
| Entitlements du hardened runtime (`allow-jit` pour WebKit) | `apps/desktop/src-tauri/Entitlements.plist` |
| `hardenedRuntime`, `entitlements`, `minimumSystemVersion: 10.15` | `apps/desktop/src-tauri/tauri.conf.json` |
| Variables Apple lues par `tauri-action` | `.github/workflows/release.yml` |
| Contrôle bloquant après le build (signature, agrafage, `spctl`) | `.github/workflows/release.yml` |

La signature de **mise à jour** (clé minisign, `TAURI_SIGNING_PRIVATE_KEY`) est un autre
sujet : elle garantit qu'une mise à jour vient de toi. Les deux sont nécessaires.

## Ce qu'il faut créer (une fois)

1. **Compte Apple Developer** (99 $/an) et certificat **Developer ID Application**
   (Certificates, Identifiers & Profiles → Certificates → + → Developer ID Application).
2. Depuis le trousseau macOS, exporter le certificat **et sa clé privée** en `.p12`,
   avec un mot de passe.
3. Récupérer l'identité exacte :
   ```bash
   security find-identity -v -p codesigning
   # « Developer ID Application: Prénom Nom (TEAMID) »
   ```
4. Créer un **mot de passe d'application** Apple (appleid.apple.com → Sécurité), pas le
   mot de passe du compte : la notarisation l'exige.
5. Renseigner les secrets GitHub du dépôt :

| Secret | Contenu |
|---|---|
| `APPLE_CERTIFICATE` | `.p12` encodé en base64 (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | mot de passe du `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Prénom Nom (TEAMID)` |
| `APPLE_ID` | adresse Apple Developer |
| `APPLE_PASSWORD` | mot de passe d'application (pas celui du compte) |
| `APPLE_TEAM_ID` | identifiant d'équipe (10 caractères) |

## Ce qui se passe ensuite

`tauri-action` signe l'app et le DMG, envoie le paquet à Apple, attend le ticket, l'agrafé
(`stapler`) puis publie. La release est créée en **brouillon** : tu peux vérifier avant
publication.

Le job échoue volontairement si l'app n'est pas signée « Developer ID Application », si le
ticket n'est pas agrafé ou si `spctl` refuse — mieux vaut une release bloquée qu'un binaire
inouvrable chez les utilisateurs.

## Vérifier à la main (après téléchargement)

```bash
codesign -dv --verbose=4 /Applications/ANZAR.app   # Authority: Developer ID Application
xcrun stapler validate /Applications/ANZAR.app
spctl --assess --verbose=2 --type execute /Applications/ANZAR.app
# → accepted, source=Notarized Developer ID
```

## Erreurs fréquentes

| Symptôme | Cause |
|---|---|
| « app endommagée » | non notariée, ou ticket non agrafé (téléchargement hors ligne) |
| `spctl` : `rejected (the code is valid but does not seem to be an app)` | mauvais `--type` |
| Notarisation refusée : code non signé | un binaire embarqué (sidecar) n'est pas signé |
| Notarisation refusée : hardened runtime absent | `hardenedRuntime` non activé dans le bundle |
| Webview blanche au lancement | entitlement `allow-jit` retiré |

## Pendant la bêta fermée

La notarisation n'est pas nécessaire pour 10 à 20 testeurs : distribuer le DMG tel quel et
indiquer **clic droit → Ouvrir** (ou Réglages → Confidentialité → Ouvrir quand même). À
faire avant toute distribution large.

## Windows (équivalent)

SmartScreen affiche « Windows a protégé votre PC » pour un exécutable non signé. Un
certificat de signature de code (OV/EV) règle le problème ; l'EV achète la réputation
immédiate. Ce n'est pas encore configuré dans `release.yml`.
