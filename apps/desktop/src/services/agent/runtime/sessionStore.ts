/**
 * Sessions durables : l'historique API complet de chaque conversation (messages, appels
 * d'outils, résultats) et un journal d'événements sont écrits dans le dossier de données
 * de l'app (store/sessions/). Après un crash, une mise à jour ou un redémarrage, l'agent
 * reprend avec tout son contexte ; le journal permet de rejouer une session pour déboguer.
 *
 * Écritures en file par conversation (jamais deux en même temps), atomiques (fileStore).
 */
import type { APIMessage } from '@/types';
import { ensureDir, readText, removeEntry, storeRoot, writeText } from '@/lib/fileStore';
import { compactHistory } from '../engine/history';

const DIR = 'sessions';
const VERSION = 1;
/** Au-delà, une copie compactée est enregistrée (les vieux résultats d'outils raccourcis). */
const MAX_HISTORY_CHARS = 1_500_000;
const MAX_JOURNAL_LINES = 2_000;

export type SessionEvent =
  | { type: 'user'; chars: number; attachments: number }
  | { type: 'step'; step: number; text: number; toolCalls: string[] }
  | { type: 'tool'; name: string; isError: boolean; output: string }
  | { type: 'verify'; passed: boolean }
  | { type: 'done'; stopReason: string; costFCFA?: number }
  | { type: 'error'; message: string };

type Stamped = SessionEvent & { at: number };

const safeId = (id: string) => id.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);
const historyFile = (id: string) => `${DIR}/${safeId(id)}.json`;
const journalFile = (id: string) => `${DIR}/${safeId(id)}.events.jsonl`;

/** Les images (captures, pièces jointes) ne sont pas gardées : un marqueur les remplace. */
export function serializableHistory(messages: APIMessage[]): APIMessage[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const text = m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
    const images = m.content.filter((p) => p.type === 'image_url').length;
    return { ...m, content: images ? `${text}\n\n(${images} image${images > 1 ? 's' : ''} non conservée${images > 1 ? 's' : ''} dans l'historique)` : text };
  });
}

const queues = new Map<string, Promise<void>>();
function enqueue(id: string, job: () => Promise<void>): Promise<void> {
  const next = (queues.get(id) || Promise.resolve()).then(job).catch((e) => {
    console.warn('[session] écriture impossible', e);
  });
  queues.set(id, next);
  return next;
}

const pendingEvents = new Map<string, Stamped[]>();

/** Note un événement ; il est écrit au prochain enregistrement de la session. */
export function recordSessionEvent(conversationId: string, event: SessionEvent): void {
  const list = pendingEvents.get(conversationId) || [];
  list.push({ ...event, at: Date.now() });
  pendingEvents.set(conversationId, list);
}

/** Enregistre l'historique et les événements en attente de la conversation. */
export function saveSession(conversationId: string, messages: APIMessage[]): Promise<void> {
  // Copie immédiate : l'historique continue de changer pendant l'écriture.
  let copy = serializableHistory(messages.map((m) => ({ ...m })));
  const events = pendingEvents.get(conversationId) || [];
  pendingEvents.delete(conversationId);
  return enqueue(conversationId, async () => {
    if (!(await storeRoot())) return; // hors de l'app (navigateur, tests) : rien à écrire
    await ensureDir(DIR);
    let body = JSON.stringify({ version: VERSION, savedAt: Date.now(), messages: copy });
    if (body.length > MAX_HISTORY_CHARS) {
      compactHistory(copy, 4, 300);
      body = JSON.stringify({ version: VERSION, savedAt: Date.now(), compacted: true, messages: copy });
    }
    await writeText(historyFile(conversationId), body);
    if (events.length) {
      const previous = (await readText(journalFile(conversationId))) || '';
      const lines = [...previous.split('\n').filter(Boolean), ...events.map((e) => JSON.stringify(e))];
      await writeText(journalFile(conversationId), lines.slice(-MAX_JOURNAL_LINES).join('\n') + '\n');
    }
    copy = [];
  });
}

/** Historique enregistré d'une conversation, ou null s'il n'y en a pas (ou s'il est illisible). */
export async function loadSession(conversationId: string): Promise<APIMessage[] | null> {
  await queues.get(conversationId);
  const raw = await readText(historyFile(conversationId));
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data?.version !== VERSION || !Array.isArray(data.messages)) return null;
    return data.messages as APIMessage[];
  } catch {
    return null;
  }
}

/** Journal d'événements d'une conversation (le plus ancien en premier), pour le débogage. */
export async function readSessionJournal(conversationId: string): Promise<Stamped[]> {
  const raw = (await readText(journalFile(conversationId))) || '';
  return raw.split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l) as Stamped]; } catch { return []; }
  });
}

/** Supprime l'historique et le journal (conversation supprimée). */
export function deleteSession(conversationId: string): Promise<void> {
  pendingEvents.delete(conversationId);
  return enqueue(conversationId, async () => {
    await removeEntry(historyFile(conversationId));
    await removeEntry(journalFile(conversationId));
  });
}
