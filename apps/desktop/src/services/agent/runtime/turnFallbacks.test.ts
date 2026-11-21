import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/ai/ai', () => ({ aiService: { chatStream: vi.fn() } }));

import { aiService } from '@/services/ai/ai';
import { runExportRescue, type TurnSink } from './turnFallbacks';

async function* stream(...deltas: any[]) {
  for (const delta of deltas) yield delta;
}

const call = (name: string, id = 'c1') => ({
  index: 0,
  id,
  type: 'function' as const,
  function: { name, arguments: '{}' },
});

const makeSink = (): TurnSink => ({
  appendContent: vi.fn(),
  flush: vi.fn(),
  flushLive: vi.fn(),
  addToolEvent: vi.fn(),
  addModelCost: vi.fn(),
  onModelCall: vi.fn(),
  addPromptTokens: vi.fn(),
  addCompletionTokens: vi.fn(),
});

const run = (sink: TurnSink, executeTool = vi.fn().mockResolvedValue({ output: 'ok' }), onToolCall = vi.fn()) =>
  runExportRescue({
    apiHistory: [{ role: 'user', content: 'fais une vidéo' }],
    signal: new AbortController().signal,
    callModel: () => 'fast',
    sink,
    executeTool,
    onToolCall,
  });

describe('runExportRescue — mode du moteur, pas chemin parallèle', () => {
  beforeEach(() => {
    vi.mocked(aiService.chatStream).mockReset();
  });

  it('exécute export_animation par l’hôte d’outils du tour', async () => {
    vi.mocked(aiService.chatStream)
      .mockReturnValueOnce(stream({ tool_calls: [call('export_animation')] }) as any)
      .mockReturnValueOnce(stream({ content: 'Vidéo exportée' }) as any);
    const sink = makeSink();
    const executeTool = vi.fn().mockResolvedValue({ output: 'export ok' });
    const onToolCall = vi.fn();

    const result = await run(sink, executeTool, onToolCall);

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool.mock.calls[0][0].function.name).toBe('export_animation');
    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(result.answered).toBe(true);
    expect(sink.appendContent).toHaveBeenCalledWith('Vidéo exportée');
  });

  it('refuse tout autre outil : la liste est restreinte à l’export', async () => {
    vi.mocked(aiService.chatStream)
      .mockReturnValueOnce(stream({ tool_calls: [call('write_file')] }) as any)
      .mockReturnValueOnce(stream({ content: 'Je ne peux pas écrire ici' }) as any);
    const sink = makeSink();
    const executeTool = vi.fn();

    const result = await run(sink, executeTool);

    expect(executeTool).not.toHaveBeenCalled();
    expect(result.answered).toBe(true);
  });

  it('rend la main au parent quand le budget d’étapes est épuisé', async () => {
    // Toujours un appel d'outil : le moteur s'arrête au plafond de 4 étapes sans réponse.
    vi.mocked(aiService.chatStream).mockImplementation((() => stream({ tool_calls: [call('export_animation')] })) as any);
    const sink = makeSink();
    const executeTool = vi.fn().mockResolvedValue({ output: 'coût' });

    const result = await run(sink, executeTool);

    expect(result.answered).toBe(false);
  });
});
