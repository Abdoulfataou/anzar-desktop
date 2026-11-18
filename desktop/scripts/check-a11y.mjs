#!/usr/bin/env node
/**
 * Garde-fou d'accessibilité (exécuté par `npm run lint`).
 * Vérifie les invariants structurants : dialogues, focus, landmarks et
 * absence de conteneurs cliquables non interactifs.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
const failures = [];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const files = walk(src);
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const required = [
  ['src/components/billing/RechargeModal.tsx', ['role="dialog"', 'aria-modal="true"', 'useFocusTrap']],
  ['src/components/workspace/WorktreesDialog.tsx', ['role="dialog"', 'aria-modal="true"', 'useFocusTrap']],
  ['src/components/ui/CommandPalette.tsx', ['role="dialog"', 'aria-modal="true"', 'useFocusTrap']],
  ['src/components/workspace/GitPanel.tsx', ['role="dialog"', 'aria-modal="true"', 'useFocusTrap']],
  ['src/components/chat/VisualBlock.tsx', ['role="dialog"', 'aria-modal="true"', 'useFocusTrap']],
  ['src/components/chat/MessageList.tsx', ['role="region"', 'aria-live="polite"']],
  ['src/components/layout/AppLayout.tsx', ['href="#main-content"', 'id="main-content"']],
  ['src/components/layout/Sidebar.tsx', ['aria-label="Navigation des projets et tâches"']],
];

for (const [file, markers] of required) {
  let text = '';
  try { text = read(file); } catch { failures.push(`${file} introuvable`); continue; }
  for (const marker of markers) {
    if (!text.includes(marker)) failures.push(`${file} : invariant manquant « ${marker} »`);
  }
}

// Conteneurs cliquables non interactifs : div/span avec onClick + cursor-pointer
// (les backdrops transparents sans cursor-pointer restent tolérés).
for (const file of files) {
  if (!file.endsWith('.tsx')) continue;
  const text = readFileSync(file, 'utf8');
  const tags = text.match(/<(div|span)\b[^>]*>/gs) || [];
  for (const tag of tags) {
    if (!tag.includes('onClick')) continue;
    if (!tag.includes('cursor-pointer') && !tag.startsWith('<span')) continue;
    if (/role=|tabIndex|aria-hidden/.test(tag)) continue;
    const line = text.slice(0, text.indexOf(tag)).split('\n').length;
    failures.push(`${relative(root, file)}:${line} : ${tag.slice(0, 40)}… cliquable sans rôle ni tabIndex`);
  }
}

if (failures.length) {
  console.error('\n✗ Contrôles d\'accessibilité en échec :\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('');
  process.exit(1);
}
console.log(`✓ Accessibilité : dialogues, focus, landmarks et conteneurs interactifs (${files.length} fichiers).`);
