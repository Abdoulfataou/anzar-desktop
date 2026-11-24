// Vérifie que les fichiers de mise à jour (.sig) produits par la construction sont signés
// avec la clé dont la partie publique est inscrite dans tauri.conf.json.
// Sinon, les apps déjà installées refuseraient la mise à jour (« Installation impossible »).
// N'affiche que des identifiants de clé publics, jamais de secret.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const racine = 'apps/desktop/src-tauri'
const idCle = (b64) => {
  // Format minisign : ligne 1 = commentaire, ligne 2 = base64(algo[2] + id[8] + …)
  const ligne = Buffer.from(b64.trim(), 'base64').toString('utf8').split('\n')[1]
  return Buffer.from(ligne, 'base64').subarray(2, 10).reverse().toString('hex').toUpperCase()
}

const conf = JSON.parse(readFileSync(join(racine, 'tauri.conf.json'), 'utf8'))
const attendu = idCle(conf.plugins.updater.pubkey)

const cible = join(racine, 'target')
const dossiers = [join(cible, 'release', 'bundle')]
if (existsSync(cible)) {
  for (const d of readdirSync(cible)) dossiers.push(join(cible, d, 'release', 'bundle'))
}
const sigs = []
const parcourir = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) parcourir(p)
    else if (n.endsWith('.sig')) sigs.push(p)
  }
}
for (const d of dossiers) if (existsSync(d)) parcourir(d)

if (sigs.length === 0) {
  console.error('::error::Aucun fichier .sig trouvé : la construction n\'a pas produit de mise à jour signée.')
  process.exit(1)
}
let ok = true
for (const s of sigs) {
  const obtenu = idCle(readFileSync(s, 'utf8'))
  const bon = obtenu === attendu
  ok &&= bon
  console.log(`${bon ? '✓' : '✗'} ${s} — clé ${obtenu}`)
}
if (!ok) {
  console.error(`::error::Mise à jour signée avec une autre clé que celle de l'app (${attendu}). ` +
    'Mets la bonne clé privée dans le secret TAURI_SIGNING_PRIVATE_KEY. Ne publie pas ce brouillon.')
  process.exit(1)
}
console.log(`✓ Toutes les mises à jour sont signées avec la clé de l'app (${attendu}).`)
