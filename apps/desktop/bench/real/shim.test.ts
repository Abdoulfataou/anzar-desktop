/**
 * Fidélité du shim du banc — vérifie que les comportements de sécurité qui font la
 * différence entre « avant » (e058e56) et « après » (refonte) sont réellement reproduits :
 * gates de la liste blanche, refus git, exception `git init`, isolation Seatbelt.
 *
 * Ces tests ne coûtent aucun crédit : ils n'appellent jamais le modèle.
 */
import { mkdirSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { installTauriShim, type TauriShim } from './tauriHost';
import { sandboxAvailable } from './seatbelt';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Politique « avant » : copie de commands.json à e058e56 (voir commands-avant.json). */
const COMMANDS_AVANT = join(HERE, 'commands-avant.json');
/**
 * Dossiers de test dans le home : validate_dir (comme Rust) refuse tout dossier hors du
 * répertoire utilisateur, et /var/folders — où vitest met ses temporaires — est dehors.
 */
const TEST_ROOT = join(homedir(), 'Desktop', 'banc', 'shim-tests');
mkdirSync(TEST_ROOT, { recursive: true });

const tmpDirs: string[] = [];
const newDir = () => {
  const d = mkdtempSync(join(TEST_ROOT, 't-'));
  tmpDirs.push(d);
  return d;
};
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

const install = (variant: 'avant' | 'apres', dir: string) =>
  installTauriShim({
    variant,
    appDataDir: newDir(),
    allowedRoots: [dir],
    commandsJsonPath: variant === 'avant' ? COMMANDS_AVANT : undefined,
  });

let seq = 0;
const spawnIn = async (shim: TauriShim, dir: string, args: Record<string, unknown>) => {
  const id = `bench-shim-${Date.now()}-${++seq}`;
  const pid = await (globalThis as any).window.__TAURI_INTERNALS__.invoke('tool_spawn', {
    id, cwd: dir, root: dir, sandbox: true, ...args,
  });
  return { id, pid };
};
const wait = (shim: TauriShim, id: string) => (globalThis as any).window.__TAURI_INTERNALS__.invoke('tool_wait', { id });

describe('shim du banc · variante avant (e058e56)', () => {
  it('refuse npm install sans accord, l\'accepte avec l\'accord enregistré', async () => {
    const dir = newDir();
    const shim = install('avant', dir);
    await expect(spawnIn(shim, dir, { program: 'npm', args: ['install'] })).rejects.toThrow(/accord/);
    // `approved: true` est ce que l'app envoie APRÈS la carte d'accord.
    const { pid } = await spawnIn(shim, dir, { program: 'npm', args: ['--version'], approved: true });
    expect(typeof pid).toBe('number');
  });

  it('refuse git config et les options qui déplacent le dépôt', async () => {
    const dir = newDir();
    const shim = install('avant', dir);
    await expect(spawnIn(shim, dir, { program: 'git', args: ['config', 'user.name', 'x'] })).rejects.toThrow(/git config/);
    await expect(spawnIn(shim, dir, { program: 'git', args: ['--git-dir', '/tmp/x', 'status'] })).rejects.toThrow(/Option git refusée/);
    await expect(spawnIn(shim, dir, { program: 'git', args: ['init', '--separate-git-dir', '/tmp/x'] })).rejects.toThrow(/Option git refusée/);
  });

  it('refuse python -c, permet git init simple à la racine', async () => {
    const dir = newDir();
    const shim = install('avant', dir);
    await expect(spawnIn(shim, dir, { program: 'python3', args: ['-c', 'print(1)'] })).rejects.toThrow(/python -c est refusé/);
    // git init simple : accepté (l'exception de la protection des hooks).
    const { id } = await spawnIn(shim, dir, { program: 'git', args: ['init'] });
    await wait(shim, id);
    expect(existsSync(join(dir, '.git')), 'git init a tourné sous sandbox').toBe(true);
  });

  it('bloque l\'écriture hors projet via le shell — isolation Seatbelt réelle', async () => {
    if (!existsSync('/usr/bin/sandbox-exec')) return;
    const dir = newDir();
    const shim = install('apres', dir);
    const cible = join(homedir(), `.anzar-bench-shim-${Date.now()}.txt`);
    // Règles d'écriture du profil communes aux deux variantes : le projet oui, le home non.
    const { id } = await spawnIn(shim, dir, { program: 'bash', args: [], shell: true, shellCommand: `echo x > '${cible}'` });
    await wait(shim, id);
    expect(existsSync(cible), 'aucun fichier hors projet ne doit exister').toBe(false);
    rmSync(cible, { force: true });
  });

  // Le shell confiné n'existe que sous macOS (Seatbelt) : ignoré ailleurs, par ex. la CI Linux.
  it.skipIf(!sandboxAvailable())('variante après : écrit dans le projet via le shell confiné, pas de liste blanche', async () => {
    const dir = newDir();
    const shim = install('apres', dir);
    writeFileSync(join(dir, 'a.txt'), 'A');
    const { id } = await spawnIn(shim, dir, { program: 'bash', args: [], shell: true, shellCommand: 'cp a.txt b.txt && echo ok' });
    const r = await wait(shim, id);
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, 'b.txt'))).toBe(true);
  });

  // Le shell confiné n'existe que sous macOS (Seatbelt) : ignoré ailleurs, par ex. la CI Linux.
  it.skipIf(!sandboxAvailable())('le shell confiné n\'existe qu\'en « après »', async () => {
    const dir = newDir();
    const shimApres = install('apres', dir);
    const { pid } = await spawnIn(shimApres, dir, { program: 'bash', args: [], shell: true, shellCommand: 'true' });
    expect(typeof pid).toBe('number');
    const shimAvant = install('avant', dir);
    await expect(spawnIn(shimAvant, dir, { program: 'bash', args: [], shell: true, shellCommand: 'true' }))
      .rejects.toThrow(/shell confiné n'est pas disponible/);
  });
});
