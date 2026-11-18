import { describe, expect, it } from 'vitest';
import { ToolCallAssembler } from './toolCallAssembler';

describe('ToolCallAssembler', () => {
  it('assemble un appel fragmenté (nom + arguments)', () => {
    const assembler = new ToolCallAssembler();
    assembler.add([{
      index: 0,
      id: 'call_1',
      type: 'function',
      function: { name: 'read_', arguments: '{"path":' },
    } as any]);
    assembler.add([{
      index: 0,
      function: { name: 'file', arguments: '"src/a.ts"}' },
    } as any]);

    expect(assembler.hasCalls).toBe(true);
    expect(assembler.finish()).toEqual([{
      id: 'call_1',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":"src/a.ts"}' },
    }]);
  });

  it('trie plusieurs appels par index et génère un id manquant', () => {
    const assembler = new ToolCallAssembler();
    assembler.add([
      { index: 1, id: 'b', type: 'function', function: { name: 'edit_file', arguments: '{}' } } as any,
      { index: 0, type: 'function', function: { name: 'list_dir', arguments: '{}' } } as any,
    ]);

    const calls = assembler.finish();
    expect(calls.map((c) => c.function.name)).toEqual(['list_dir', 'edit_file']);
    expect(calls[0].id).toMatch(/^call_\d+_0$/);
    expect(calls[1].id).toBe('b');
  });

  it('reste vide sans fragment', () => {
    const assembler = new ToolCallAssembler();
    expect(assembler.hasCalls).toBe(false);
    expect(assembler.finish()).toEqual([]);
  });
});
