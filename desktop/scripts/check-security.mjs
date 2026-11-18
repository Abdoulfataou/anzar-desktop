#!/usr/bin/env node
/**
 * Garde-fou de sécurité (exécuté par `npm run lint`, donc par la CI).
 *
 * Vérifie deux régressions qui ont déjà coûté cher :
 *  1. le JWT ne doit jamais être écrit dans localStorage ;
 *  2. la CSP Tauri doit rester fermée (object-src/base-uri/frame-ancestors,
 *     et aucun ancien domaine Railway).
 *
 * Volontairement simple et sans dépendance : un test unitaire lourd serait
 * plus fragile que ces invariants, qui sont eux-mêmes la politique.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'src');
const failures = [];

/** Liste récursive des .ts/.tsx sous src/. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const files = walk(srcDir);

// ── 1. Aucun jeton écrit dans localStorage ──────────────────────────────────
const TOKEN_HINT = /(token|auth|jwt|tkn)/i;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (!line.includes('localStorage.setItem')) return;
    if (TOKEN_HINT.test(line)) {
      failures.push(`${relative(root, file)}:${i + 1} écrit un jeton dans localStorage`);
    }
  });
}

// Le coffre ne doit conserver aucune écriture localStorage, même obfusquée.
const secureStore = join(srcDir, 'services/infra/secureTokenStore.ts');
const secureText = readFileSync(secureStore, 'utf8');
if (secureText.includes('localStorage.setItem')) {
  failures.push('secureTokenStore.ts contient encore localStorage.setItem');
}
if (!secureText.includes('memoryToken')) {
  failures.push('secureTokenStore.ts ne conserve plus de repli mémoire explicite');
}

// ── 2. CSP Tauri fermée ─────────────────────────────────────────────────────
const confPath = join(root, 'src-tauri/tauri.conf.json');
let conf;
try {
  conf = JSON.parse(readFileSync(confPath, 'utf8'));
} catch (e) {
  failures.push(`tauri.conf.json illisible : ${e.message}`);
}

if (conf) {
  const csp = String(conf?.tauri?.security?.csp || '');
  for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'"]) {
    if (!csp.includes(directive)) failures.push(`CSP : directive manquante « ${directive} »`);
  }
  if (/railway\.app/i.test(csp)) failures.push('CSP : ancien domaine Railway encore autorisé');
}

// ── Résultat ────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error('\n✗ Contrôles de sécurité en échec :\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ Sécurité : aucun jeton en localStorage, CSP fermée (${files.length} fichiers vérifiés).`);
