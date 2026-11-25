import { afterEach, describe, expect, it } from 'vitest';
import { clearFileConflicts, fileConflict, noteFileRead, noteFileWrite } from './fileConflicts';

afterEach(() => clearFileConflicts());

describe('conflits d’écriture entre agents', () => {
  it('refuse à A d’écrire après une écriture de B depuis sa lecture', () => {
    noteFileRead('c1', 'A', 'src/app.ts');
    noteFileWrite('c1', 'B', 'src/app.ts');
    expect(fileConflict('c1', 'A', 'src/app.ts')).toContain('autre agent');
    expect(fileConflict('c1', 'A', 'src/app.ts')).toContain('Relis');
  });

  it('autorise après relecture, et pour le même auteur', () => {
    noteFileRead('c1', 'A', 'src/app.ts');
    noteFileWrite('c1', 'A', 'src/app.ts');
    expect(fileConflict('c1', 'A', 'src/app.ts')).toBeNull();
    noteFileWrite('c1', 'B', 'src/app.ts');
    expect(fileConflict('c1', 'B', 'src/app.ts')).toBeNull();
    noteFileRead('c1', 'A', 'src/app.ts');
    expect(fileConflict('c1', 'A', 'src/app.ts')).toBeNull();
  });

  it('laisse écrire un fichier jamais lu', () => {
    expect(fileConflict('c1', 'A', 'nouveau.ts')).toBeNull();
  });

  it('isole les conversations', () => {
    noteFileRead('c1', 'A', 'a.ts');
    noteFileWrite('c2', 'B', 'a.ts');
    expect(fileConflict('c1', 'A', 'a.ts')).toBeNull();
  });
});
