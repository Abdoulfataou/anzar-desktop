/**
 * Skills servies par le serveur ANZAR (GET /api/agent/skills).
 *
 * Elles s'améliorent sans republier l'app. Pour les connexions lentes : une copie locale est
 * gardée, et l'app ne retélécharge que si le contenu a changé (ETag → 304, quelques octets).
 * Sans réseau, la copie locale sert ; sans copie, l'agent fonctionne avec les skills intégrées.
 */
import { useSettingsStore } from '@/stores/settingsStore';

export interface RemoteSkill { name: string; description: string; markdown: string }
interface Cached { etag: string; at: number; skills: RemoteSkill[] }

const KEY = 'anzar.remoteSkills.v1';
const FRESH_MS = 6 * 3600_000;

function readCache(): Cached | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    return c && Array.isArray(c.skills) ? c : null;
  } catch { return null; }
}

function writeCache(c: Cached) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* stockage plein : on garde la version en mémoire */ }
}

function valid(s: any): s is RemoteSkill {
  return s && typeof s.name === 'string' && /^[a-z0-9][a-z0-9-]{1,63}$/.test(s.name)
    && typeof s.description === 'string' && typeof s.markdown === 'string' && s.markdown.length < 200_000;
}

let inflight: Promise<RemoteSkill[]> | null = null;

async function refresh(cached: Cached | null): Promise<RemoteSkill[]> {
  const st = useSettingsStore.getState();
  const token = st.getAuthToken();
  if (!token) return cached?.skills ?? [];
  const res = await fetch(`${st.getBackendUrl()}/api/agent/skills`, {
    headers: { Authorization: `Bearer ${token}`, ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}) },
  });
  if (res.status === 304 && cached) {
    writeCache({ ...cached, at: Date.now() });
    return cached.skills;
  }
  if (!res.ok) throw new Error(`skills ${res.status}`);
  const data = await res.json();
  const skills = (Array.isArray(data?.skills) ? data.skills : []).filter(valid);
  writeCache({ etag: res.headers.get('etag') || '', at: Date.now(), skills });
  return skills;
}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('délai dépassé')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Skills du serveur : copie locale si récente ; sinon mise à jour, sans jamais bloquer longtemps. */
export async function getRemoteSkills(): Promise<RemoteSkill[]> {
  const cached = readCache();
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.skills;
  inflight ??= refresh(cached).finally(() => { inflight = null; });
  // La mise à jour continue en arrière-plan si elle dépasse le délai
  return within(inflight, cached ? 800 : 3000).catch(() => cached?.skills ?? []);
}

/** Au démarrage : met la copie locale à jour sans attendre. */
export function prefetchRemoteSkills(): void {
  void getRemoteSkills().catch(() => {});
}
