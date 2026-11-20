import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = new Map<string, string>();
vi.mock('@/lib/fileStore', () => ({
  storeRoot: async () => '/store',
  ensureDir: async () => {},
  readText: async (rel: string) => files.get(rel) ?? null,
  writeText: async (rel: string, text: string) => { files.set(rel, text); },
  removeEntry: async (rel: string) => { files.delete(rel); },
}));

import { deleteSession, loadSession, readSessionJournal, recordSessionEvent, saveSession, serializableHistory } from './sessionStore';
import type { APIMessage } from '@/types';

const history: APIMessage[] = [
  { role: 'system', content: 'SYSTEM' },
  { role: 'user', content: 'Ajoute un bouton' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"App.tsx"}' } }] },
  { role: 'tool', tool_call_id: 'c1', content: 'export default function App() {}' },
];

describe('sessions durables', () => {
  beforeEach(() => files.clear());

  it("rend l'historique complet après un redémarrage", async () => {
    await saveSession('conv-1', history);
    expect(await loadSession('conv-1')).toEqual(history);
  });

  it("n'a rien pour une conversation inconnue", async () => {
    expect(await loadSession('inconnue')).toBeNull();
  });

  it('retire les images (trop lourdes) en gardant le texte', () => {
    const [m] = serializableHistory([{ role: 'user', content: [
      { type: 'text', text: 'Regarde' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA', detail: 'auto' } },
    ] } as APIMessage]);
    expect(m.content).toContain('Regarde');
    expect(m.content).toContain('1 image non conservée');
  });

  it('compacte un historique trop gros', async () => {
    const big: APIMessage[] = [...history];
    for (let i = 0; i < 40; i++) {
      big.push({ role: 'assistant', content: null, tool_calls: [{ id: `x${i}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] });
      big.push({ role: 'tool', tool_call_id: `x${i}`, content: 'x'.repeat(60_000) });
    }
    await saveSession('conv-big', big);
    const raw = files.get('sessions/conv-big.json')!;
    expect(raw.length).toBeLessThan(1_500_000);
    expect(JSON.parse(raw).compacted).toBe(true);
  });

  it('journalise les événements dans l’ordre', async () => {
    recordSessionEvent('conv-2', { type: 'user', chars: 12, attachments: 0 });
    recordSessionEvent('conv-2', { type: 'tool', name: 'read_file', isError: false, output: 'ok' });
    await saveSession('conv-2', history);
    recordSessionEvent('conv-2', { type: 'done', stopReason: 'task_done' });
    await saveSession('conv-2', history);
    const journal = await readSessionJournal('conv-2');
    expect(journal.map((e) => e.type)).toEqual(['user', 'tool', 'done']);
  });

  it('supprime historique et journal avec la conversation', async () => {
    recordSessionEvent('conv-3', { type: 'user', chars: 1, attachments: 0 });
    await saveSession('conv-3', history);
    await deleteSession('conv-3');
    expect(await loadSession('conv-3')).toBeNull();
    expect(await readSessionJournal('conv-3')).toEqual([]);
  });
});
