import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';
import {
  languageFor, loadedLanguages, neededLanguages, prepareTreeSitter, treeSitterSymbols,
} from './treeSitter';

// Vitest fournit un import.meta.url en http:// : on part du répertoire de travail.
const WASM = join(process.cwd(), 'public', 'wasm');

const loader = async (file: string) => readFileSync(join(WASM, file));

beforeAll(async () => {
  const ok = await prepareTreeSitter(['a.ts', 'a.tsx', 'a.py'], {
    runtimePath: join(WASM, 'tree-sitter.wasm'),
    load: loader,
  });
  expect(ok).toBe(true);
});

describe('tree-sitter — grammaires', () => {
  it('ne charge que les langages présents', () => {
    expect(neededLanguages(['a.ts', 'b.tsx', 'c.py', 'README.md'])).toEqual(['typescript', 'tsx', 'python']);
    expect(languageFor('a.tsx')).toBe('tsx');
    expect(languageFor('a.go')).toBeNull();
    expect(loadedLanguages()).toEqual(expect.arrayContaining(['typescript', 'tsx', 'python']));
  });

  it('extrait les déclarations TypeScript, y compris les constantes', () => {
    const code = [
      'export class Store {}',
      'export const x = 1;',
      'export function f(a: number) { return a; }',
      'interface Foo { a: string }',
      'export type T = string;',
      'export enum E { A }',
    ].join('\n');
    const symbols = treeSitterSymbols('a.ts', code) || [];
    const byName = Object.fromEntries(symbols.map((s) => [s.name, s]));
    expect(byName.Store).toMatchObject({ kind: 'class', exported: true });
    expect(byName.x).toMatchObject({ kind: 'const', exported: true });
    expect(byName.f).toMatchObject({ kind: 'function', exported: true });
    expect(byName.Foo).toMatchObject({ kind: 'interface', exported: false });
    expect(byName.T).toMatchObject({ kind: 'type', exported: true });
    expect(byName.E).toMatchObject({ kind: 'enum', exported: true });
    expect(byName.f.line).toBe(3);
  });

  it('reconnaît composants et hooks en TSX', () => {
    const code = 'export default function Card() {}\nexport function useThing() {}\n';
    const symbols = treeSitterSymbols('a.tsx', code) || [];
    expect(symbols.find((s) => s.name === 'Card')?.kind).toBe('component');
    expect(symbols.find((s) => s.name === 'useThing')?.kind).toBe('hook');
  });

  it('extrait fonctions et classes Python', () => {
    const code = 'class A:\n    pass\n\ndef main():\n    pass\n';
    const symbols = treeSitterSymbols('a.py', code) || [];
    expect(symbols.map((s) => `${s.kind}:${s.name}`)).toEqual(['class:A', 'function:main']);
  });

  it('renvoie null pour un langage non chargé (repli regex)', () => {
    expect(treeSitterSymbols('a.go', 'package main')).toBeNull();
  });
});
