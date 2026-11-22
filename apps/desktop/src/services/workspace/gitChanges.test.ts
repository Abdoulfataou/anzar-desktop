import { describe, expect, it } from 'vitest';
import { parseNumstat, parseStatus } from './gitChanges';

/**
 * Le format porcelain v1 en mode -z est la source de vérité de la carte : il inclut ce que
 * les commandes ont modifié. Les analyseurs sont testés sur les cas réels (nouveaux fichiers,
 * suppressions, binaires, chemins avec espaces).
 */
describe('parseStatus', () => {
  it('classe créés, modifiés et supprimés', () => {
    const out = parseStatus('?? src/a.ts\0 M src/b.ts\0 D src/c.ts\0');
    expect(out).toEqual([
      { path: 'src/a.ts', kind: 'created' },
      { path: 'src/b.ts', kind: 'modified' },
      { path: 'src/c.ts', kind: 'deleted' },
    ]);
  });

  it('ignore les entrées vides et garde les espaces', () => {
    expect(parseStatus('\0\0')).toEqual([]);
    expect(parseStatus(' M dossier/fichier avec espace.ts\0')).toEqual([
      { path: 'dossier/fichier avec espace.ts', kind: 'modified' },
    ]);
  });
});

describe('parseNumstat', () => {
  it('lit ajouts et suppressions', () => {
    const map = parseNumstat('3\t1\tsrc/a.ts\0');
    expect(map.get('src/a.ts')).toEqual({ added: 3, removed: 1 });
  });

  it('traite les binaires comme zéro ligne', () => {
    const map = parseNumstat('-\t-\tpublic/logo.png\0');
    expect(map.get('public/logo.png')).toEqual({ added: 0, removed: 0 });
  });
});

// ============================================================================
// Séquence complète, avec un faux git en mémoire
// ============================================================================
import { beforeEach, vi } from 'vitest';

const gitState = vi.hoisted(() => ({
  tree: new Map<string, string>(),
  index: new Map<string, string>(),
  committed: new Map<string, string>(),
  calls: [] as string[][],
}));

vi.mock('@/lib/fileStore', () => ({
  storeRoot: async () => '/store',
  ensureDir: async () => undefined,
  writeText: async () => undefined,
}));

vi.mock('@/services/runtime/terminal', () => ({
  terminalService: {
    execArgs: async (_program: string, args: string[]) => {
      // On ignore l'en-tête --git-dir/--work-tree.
      const rest = args.slice(4);
      gitState.calls.push(rest);
      const lineDelta = (before: string, after: string) => {
        const counts = new Map<string, number>();
        for (const l of before.split('\n')) counts.set(l, (counts.get(l) || 0) + 1);
        let added = 0;
        for (const l of after.split('\n')) {
          const n = counts.get(l) || 0;
          if (n > 0) counts.set(l, n - 1);
          else added++;
        }
        let removed = 0;
        for (const n of counts.values()) removed += n;
        return [added, removed];
      };
      if (rest[0] === 'status') {
        const entries: string[] = [];
        for (const [path, content] of gitState.tree) {
          const before = gitState.committed.get(path);
          if (before === undefined) entries.push(`?? ${path}`);
          else if (before !== content) entries.push(` M ${path}`);
        }
        for (const path of gitState.committed.keys()) {
          if (!gitState.tree.has(path)) entries.push(` D ${path}`);
        }
        return { success: true, exitCode: 0, stdout: entries.join('\0') + (entries.length ? '\0' : ''), stderr: '', durationMs: 0 };
      }
      if (rest[0] === 'add') {
        gitState.index = new Map(gitState.tree);
        return { success: true, exitCode: 0, stdout: '', stderr: '', durationMs: 0 };
      }
      if (rest[0] === 'commit') {
        gitState.committed = new Map(gitState.index);
        return { success: true, exitCode: 0, stdout: '', stderr: '', durationMs: 0 };
      }
      if (rest[0] === 'diff') {
        const out: string[] = [];
        for (const [path, content] of gitState.index) {
          const before = gitState.committed.get(path);
          if (before === undefined) {
            out.push(`${content.split('\n').length}\t0\t${path}`);
          } else if (before !== content) {
            const [a, r] = lineDelta(before, content);
            out.push(`${a}\t${r}\t${path}`);
          }
        }
        for (const path of gitState.committed.keys()) {
          if (!gitState.index.has(path)) out.push(`0\t${gitState.committed.get(path)!.split('\n').length}\t${path}`);
        }
        return { success: true, exitCode: 0, stdout: out.join('\0') + (out.length ? '\0' : ''), stderr: '', durationMs: 0 };
      }
      return { success: true, exitCode: 0, stdout: '', stderr: '', durationMs: 0 };
    },
  },
}));

describe('beginTurn / endTurn', () => {
  beforeEach(() => {
    gitState.tree = new Map([['src/a.ts', 'ligne 1\nligne 2\n']]);
    gitState.index = new Map();
    gitState.committed = new Map();
    gitState.calls = [];
  });

  it('voit un fichier modifié par une commande, pas seulement par un outil', async () => {
    const { beginTurn, endTurn } = await import('./gitChanges');
    await beginTurn('/projet');

    // Ce que fait `npm install` : réécrit un fichier existant et en crée un autre,
    // sans passer par les outils de fichiers.
    gitState.tree.set('src/a.ts', 'ligne 1\nligne 2\nligne 3\nligne 4\n');
    gitState.tree.set('package.json', '{\n  "dependencies": {}\n}\n');

    const changes = await endTurn('/projet');
    expect(changes).toEqual([
      // 4 « lignes » : le fichier finit par un saut de ligne (même convention que l'ancien
      // calcul par snapshots), donc split('\n') en compte une de plus.
      { path: 'package.json', kind: 'created', added: 4, removed: 0 },
      { path: 'src/a.ts', kind: 'modified', added: 2, removed: 0 },
    ]);
  });

  it('renvoie une liste vide quand rien n’a changé', async () => {
    const { beginTurn, endTurn } = await import('./gitChanges');
    await beginTurn('/projet');
    expect(await endTurn('/projet')).toEqual([]);
  });
});
