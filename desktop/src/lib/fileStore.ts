/**
 * Stockage sur disque (dossier de données de l'app) — remplace localStorage
 * (limité à ~5 Mo) pour l'historique des tâches et la liste des projets.
 *
 *   <données app>/store/
 *     projects.json            liste des projets
 *     state.json               tâche active
 *     tasks/<id>.jsonl         une tâche par fichier : ligne 1 = infos, puis un message par ligne
 *     undo/<messageId>.json    contenus d'origine pour le bouton « Annuler »
 *
 * Hors Tauri (navigateur) ou si le dossier n'est pas accessible, on retombe
 * sur localStorage protégé : l'app fonctionne, avec l'ancienne limite.
 */
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import toast from 'react-hot-toast';
import { isTauri } from '@/lib/utils';
import type { Conversation, Message } from '@/types';

// ── Accès fichiers bas niveau ───────────────────────────────────────────────

let rootPromise: Promise<string | null> | null = null;

/** Dossier racine du stockage, ou null si indisponible (→ repli localStorage). */
export function storeRoot(): Promise<string | null> {
  if (!rootPromise) {
    rootPromise = (async () => {
      if (!isTauri()) return null;
      try {
        const { appDataDir } = await import('@tauri-apps/api/path');
        const { createDir, exists, writeTextFile } = await import('@tauri-apps/api/fs');
        const root = `${(await appDataDir()).replace(/[\\/]+$/, '')}/store`;
        for (const dir of [root, `${root}/tasks`, `${root}/undo`]) {
          if (!(await exists(dir))) await createDir(dir, { recursive: true });
        }
        await writeTextFile(`${root}/.probe`, 'ok'); // vérifie le droit d'écriture
        return root;
      } catch (err) {
        console.warn('[fileStore] dossier de données inaccessible, repli sur localStorage', err);
        return null;
      }
    })();
  }
  return rootPromise;
}

export async function readText(rel: string): Promise<string | null> {
  const root = await storeRoot();
  if (!root) return null;
  try {
    const { exists, readTextFile } = await import('@tauri-apps/api/fs');
    const path = `${root}/${rel}`;
    return (await exists(path)) ? await readTextFile(path) : null;
  } catch {
    return null;
  }
}

/** Écriture atomique : fichier temporaire puis renommage (pas de fichier à moitié écrit). */
export async function writeText(rel: string, text: string): Promise<void> {
  const root = await storeRoot();
  if (!root) throw new Error('stockage disque indisponible');
  const { writeTextFile, renameFile } = await import('@tauri-apps/api/fs');
  const path = `${root}/${rel}`;
  await writeTextFile(`${path}.tmp`, text);
  await renameFile(`${path}.tmp`, path);
}

export async function removeEntry(rel: string): Promise<void> {
  const root = await storeRoot();
  if (!root) return;
  try {
    const { exists, removeFile } = await import('@tauri-apps/api/fs');
    const path = `${root}/${rel}`;
    if (await exists(path)) await removeFile(path);
  } catch { /* déjà absent */ }
}

/** Crée un sous-dossier du stockage (et ses parents). */
export async function ensureDir(rel: string): Promise<void> {
  const root = await storeRoot();
  if (!root) throw new Error('stockage disque indisponible');
  const { createDir, exists } = await import('@tauri-apps/api/fs');
  const path = `${root}/${rel}`;
  if (!(await exists(path))) await createDir(path, { recursive: true });
}

/** Supprime un sous-dossier du stockage et son contenu. */
export async function removeDirEntry(rel: string): Promise<void> {
  const root = await storeRoot();
  if (!root) return;
  try {
    const { exists, removeDir } = await import('@tauri-apps/api/fs');
    const path = `${root}/${rel}`;
    if (await exists(path)) await removeDir(path, { recursive: true });
  } catch { /* déjà absent */ }
}

export async function listDir(rel: string): Promise<string[]> {
  const root = await storeRoot();
  if (!root) return [];
  try {
    const { readDir } = await import('@tauri-apps/api/fs');
    return (await readDir(`${root}/${rel}`)).map((e) => e.name || '').filter(Boolean);
  } catch {
    return [];
  }
}

// ── Utilitaires ─────────────────────────────────────────────────────────────

let warned = false;
function warnOnce(err: unknown) {
  console.warn('[fileStore] écriture impossible', err);
  if (warned) return;
  warned = true;
  toast.error("Impossible d'enregistrer l'historique sur le disque. Tes dernières tâches pourraient ne pas être gardées.", { duration: 8000 });
}

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch (e) { console.warn('[fileStore] localStorage plein', e); } };
const lsRemove = (k: string) => { try { localStorage.removeItem(k); } catch { /* rien */ } };

const safeName = (id: string) => id.replace(/[^\w-]/g, '_');
const MAX_TOOL_OUTPUT_ON_DISK = 2000;

/** Écritures en attente à vider quand la fenêtre se ferme ou passe en arrière-plan. */
const flushers: Array<() => Promise<void>> = [];
if (typeof window !== 'undefined') {
  const flushAll = () => { for (const f of flushers) void f(); };
  window.addEventListener('pagehide', flushAll);
  window.addEventListener('blur', flushAll);
}

// ── Stockage « un fichier JSON » (projets) ──────────────────────────────────

export function createJsonFileStorage<S>(file: string): PersistStorage<S> {
  let mode: 'files' | 'local' | null = null;
  let pending: StorageValue<S> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    if (timer) { clearTimeout(timer); timer = null; }
    const value = pending;
    if (!value) return;
    pending = null;
    try { await writeText(file, JSON.stringify(value)); } catch (err) { warnOnce(err); }
  };
  flushers.push(flush);

  return {
    getItem: async (name) => {
      if (!(await storeRoot())) {
        mode = 'local';
        const raw = lsGet(name);
        try { return raw ? JSON.parse(raw) : null; } catch { return null; }
      }
      mode = 'files';
      const text = await readText(file);
      if (text) {
        try { return JSON.parse(text); } catch { console.warn(`[fileStore] ${file} illisible, ignoré`); }
      }
      // Première fois : reprise de l'ancien stockage, puis libération de l'espace
      const legacy = lsGet(name);
      if (!legacy) return null;
      try {
        const value = JSON.parse(legacy) as StorageValue<S>;
        void writeText(file, legacy).then(() => lsRemove(name)).catch(warnOnce);
        return value;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      if (mode === 'local') { lsSet(name, JSON.stringify(value)); return; }
      if (mode === null) return; // pas encore chargé : ne rien écraser
      pending = value;
      if (!timer) timer = setTimeout(() => void flush(), 1000);
    },
    removeItem: (name) => {
      if (mode === 'local') lsRemove(name);
      else void removeEntry(file);
    },
  };
}

// ── Stockage des tâches : un fichier .jsonl par tâche ───────────────────────

interface ChatPersisted {
  conversations: Conversation[];
  activeConversationId: string | null;
}

function serializeTask(c: Conversation): string {
  const { messages, ...meta } = c;
  const lines = [JSON.stringify({ type: 'task', ...meta })];
  for (const m of messages) {
    const slim: Message = {
      ...m,
      isStreaming: false,
      notice: undefined,
      resumable: undefined, // la reprise ne survit pas au redémarrage
      toolEvents: m.toolEvents?.map((e) => ({ ...e, output: e.output?.slice(0, MAX_TOOL_OUTPUT_ON_DISK) })),
    };
    lines.push(JSON.stringify(slim));
  }
  return lines.join('\n') + '\n';
}

function parseTask(text: string): Conversation | null {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return null;
  try {
    const { type: _type, ...meta } = JSON.parse(lines[0]);
    if (!meta.id) return null;
    const messages: Message[] = [];
    for (const line of lines.slice(1)) {
      try { messages.push(JSON.parse(line)); } catch { /* ligne abîmée : on garde le reste */ }
    }
    return { ...meta, messages } as Conversation;
  } catch {
    return null;
  }
}

export function createTaskStorage(): PersistStorage<ChatPersisted> {
  let mode: 'files' | 'local' | null = null;
  /** Dernière version écrite de chaque tâche (comparaison par référence). */
  const saved = new Map<string, Conversation>();
  const dirty = new Map<string, Conversation>();
  const removed = new Set<string>();
  let activeId: string | null = null;
  let savedActiveId: string | null | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushing: Promise<void> = Promise.resolve();

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    flushing = flushing.then(async () => {
      const toWrite = [...dirty.values()];
      const toRemove = [...removed];
      dirty.clear();
      removed.clear();
      for (const c of toWrite) {
        try {
          await writeText(`tasks/${safeName(c.id)}.jsonl`, serializeTask(c));
          saved.set(c.id, c);
        } catch (err) { warnOnce(err); }
      }
      for (const id of toRemove) {
        await removeEntry(`tasks/${safeName(id)}.jsonl`);
        saved.delete(id);
      }
      if (savedActiveId !== activeId) {
        try {
          await writeText('state.json', JSON.stringify({ activeConversationId: activeId }));
          savedActiveId = activeId;
        } catch (err) { warnOnce(err); }
      }
    });
    return flushing;
  };
  flushers.push(flush);
  const schedule = () => { if (!timer) timer = setTimeout(() => void flush(), 800); };

  return {
    getItem: async (name) => {
      if (!(await storeRoot())) {
        mode = 'local';
        const raw = lsGet(name);
        try { return raw ? JSON.parse(raw) : null; } catch { return null; }
      }
      mode = 'files';
      const files = (await listDir('tasks')).filter((n) => n.endsWith('.jsonl'));

      if (files.length === 0) {
        // Première fois : on reprend l'ancien historique et on l'écrit en fichiers
        const legacy = lsGet(name);
        if (!legacy) return null;
        try {
          const value = JSON.parse(legacy) as StorageValue<ChatPersisted>;
          const convs = value?.state?.conversations || [];
          activeId = value?.state?.activeConversationId ?? null;
          for (const c of convs) if (c.messages?.length) dirty.set(c.id, c);
          // L'ancien stockage n'est effacé que si TOUTES les tâches sont bien sur le disque
          const expected = [...dirty.keys()];
          void flush().then(() => { if (expected.every((id) => saved.has(id))) lsRemove(name); });
          return value;
        } catch {
          return null;
        }
      }

      const conversations: Conversation[] = [];
      for (const file of files) {
        const text = await readText(`tasks/${file}`);
        const conv = text ? parseTask(text) : null;
        if (conv) { conversations.push(conv); saved.set(conv.id, conv); }
      }
      conversations.sort((a, b) => b.updatedAt - a.updatedAt);
      try {
        const st = JSON.parse((await readText('state.json')) || '{}');
        activeId = conversations.some((c) => c.id === st.activeConversationId) ? st.activeConversationId : null;
      } catch { activeId = null; }
      savedActiveId = activeId;
      return { state: { conversations, activeConversationId: activeId }, version: 0 };
    },

    setItem: (name, value) => {
      if (mode === 'local') { lsSet(name, JSON.stringify(value)); return; }
      if (mode === null) return; // pas encore chargé : ne rien écraser
      const convs = value.state.conversations || [];
      const seen = new Set<string>();
      for (const c of convs) {
        seen.add(c.id);
        // Une tâche vide n'est pas enregistrée ; seules les tâches modifiées sont réécrites
        if (c.messages.length > 0 && saved.get(c.id) !== c) dirty.set(c.id, c);
      }
      for (const id of saved.keys()) {
        if (!seen.has(id)) { removed.add(id); dirty.delete(id); }
      }
      activeId = value.state.activeConversationId ?? null;
      if (dirty.size > 0 || removed.size > 0 || savedActiveId !== activeId) schedule();
    },

    removeItem: (name) => {
      if (mode === 'local') lsRemove(name);
    },
  };
}
