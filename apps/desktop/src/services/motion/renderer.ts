/**
 * Lance le moteur de rendu d'ANZAR (anzar-render.cjs) : Playwright piloté directement, avec
 * une horloge virtuelle. Bien plus rapide que de passer par le navigateur intégré de l'agent,
 * et déterministe pour toutes les animations (CSS, GSAP, canvas, three.js, JavaScript maison).
 * Ouvre aussi un fichier HTML local du dossier de travail, sans serveur.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import RENDER_SCRIPT from './anzar-render.cjs?raw';

/** Même version que celle du navigateur intégré (@playwright/mcp) : Chromium déjà téléchargé est réutilisé. */
const PLAYWRIGHT_CORE = 'playwright-core@1.66.0-alpha-2026-11-09';
const MAX_MS = 10 * 60_000;
let counter = 0;

export interface RenderJob {
  /** Adresse http(s), ou… */
  url?: string;
  /** …fichier HTML (chemin absolu) dans le dossier de travail `root` */
  file?: string;
  root?: string;
  width: number;
  height: number;
  /** Instants à capturer, en ms, dans l'ordre */
  times: number[];
  fullPage?: boolean;
  /** jpeg (défaut, léger) ou png (export d'image finale) */
  imageType?: 'jpeg' | 'png';
}

export interface RenderResult {
  files: string[];
  error?: string;
  /** NO_BROWSER, REFUSED, LOAD, FILE, URL, CRASH, SPAWN, TIMEOUT, ABORT */
  code?: string;
  /** Erreurs JavaScript de la page, à signaler à l'agent */
  pageErrors: string[];
  /** Dossier temporaire à supprimer une fois les images lues */
  workDir: string;
}

const join = (a: string, b: string) => `${a.replace(/[\\/]+$/, '')}/${b}`;

export interface RenderOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Appelé pour chaque image dès qu'elle est prête, dans l'ordre (assemblage au fur et à mesure) */
  onFrame?: (index: number, file: string) => void;
}

async function renderOnce(job: RenderJob, opts: RenderOptions): Promise<RenderResult> {
  const { appDataDir } = await import('@tauri-apps/api/path');
  const { createDir, writeTextFile } = await import('@/lib/tauri/fs');
  const base = join(await appDataDir(), 'render');
  const workDir = join(base, `job-${Date.now()}-${++counter}`);
  await createDir(join(workDir, 'frames'), { recursive: true });
  const script = join(base, 'anzar-render.cjs');
  await writeTextFile(script, RENDER_SCRIPT);
  const jobFile = join(workDir, 'job.json');
  await writeTextFile(jobFile, JSON.stringify({ ...job, outDir: join(workDir, 'frames') }));

  const id = `render-${Date.now()}-${counter}`;
  const files: string[] = [];
  const pageErrors: string[] = [];
  const logs: string[] = [];
  const unlisten: UnlistenFn[] = [];
  return new Promise<RenderResult>((resolve) => {
    let finished = false;
    const finish = (r: Partial<RenderResult>) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      unlisten.forEach((u) => u());
      void invoke('mcp_stop', { id }).catch(() => {});
      resolve({ files, pageErrors, workDir, ...r });
    };
    const timer = setTimeout(() => finish({ error: 'Rendu trop long (10 minutes au plus).', code: 'TIMEOUT' }), MAX_MS);
    opts.signal?.addEventListener('abort', () => finish({ error: 'Rendu interrompu.', code: 'ABORT' }), { once: true });

    void (async () => {
      unlisten.push(await listen<{ id: string; line: string }>('mcp://message', (e) => {
        if (e.payload.id !== id) return;
        let msg: any;
        try { msg = JSON.parse(e.payload.line); } catch { return; }
        if (msg.type === 'frame' && typeof msg.file === 'string') {
          files[msg.i] = msg.file;
          opts.onFrame?.(msg.i, msg.file);
          opts.onProgress?.(files.filter(Boolean).length, job.times.length);
        } else if (msg.type === 'log') {
          if (pageErrors.length < 10) pageErrors.push(String(msg.message));
        } else if (msg.type === 'done') {
          finish({});
        } else if (msg.type === 'error') {
          finish({ error: String(msg.message || 'erreur inconnue'), code: String(msg.code || 'CRASH') });
        }
      }));
      unlisten.push(await listen<{ id: string; line: string }>('mcp://log', (e) => {
        if (e.payload.id === id && logs.length < 40) logs.push(e.payload.line);
      }));
      unlisten.push(await listen<{ id: string; code: number | null }>('mcp://exit', (e) => {
        if (e.payload.id !== id) return;
        // Laisse arriver les dernières lignes de sortie avant de conclure
        setTimeout(() => finish({
          error: `Le moteur de rendu s'est arrêté (code ${e.payload.code ?? '?'}). ${logs.slice(-3).join(' ').slice(0, 400)}`,
          code: 'SPAWN',
        }), 300);
      }));
      try {
        await invoke('mcp_spawn', {
          id, serverId: null, command: 'npx', args: ['-y', '-p', PLAYWRIGHT_CORE, 'node', script, jobFile],
          env: {}, cwd: null, framing: 'line',
        });
      } catch (err: any) {
        finish({ error: `Lancement impossible : ${err?.message || err}. Node.js doit être installé.`, code: 'SPAWN' });
      }
    })();
  });
}

/** Rend les images demandées ; télécharge Chromium une fois si aucun navigateur n'est installé. */
export async function renderFrames(job: RenderJob, opts: RenderOptions = {}): Promise<RenderResult> {
  const { ensureNode } = await import('@/services/runtime/nodeRuntime');
  const node = await ensureNode({ reason: 'créer des captures et des vidéos' });
  if (!node.ok) return { files: [], pageErrors: [], workDir: '', error: node.message, code: 'NO_NODE' };
  const first = await renderOnce(job, opts);
  if (first.code !== 'NO_BROWSER') return first;
  await cleanupRender(first);
  const { hooks } = await import('@/services/agent/tools/browserCheck');
  if (!(await hooks.installChromium())) return first;
  return renderOnce(job, opts);
}

export async function readFrame(path: string): Promise<Blob> {
  const { readBinaryFile } = await import('@/lib/tauri/fs');
  const bytes = await readBinaryFile(path);
  return new Blob([bytes as unknown as BlobPart], { type: 'image/jpeg' });
}

export async function cleanupRender(r: Pick<RenderResult, 'workDir'>): Promise<void> {
  if (!r.workDir) return;
  try {
    const { removeDir } = await import('@/lib/tauri/fs');
    await removeDir(r.workDir, { recursive: true });
  } catch { /* dossier temporaire : sans importance */ }
}

/** Erreurs qui viennent de la page elle-même (inutile de réessayer autrement). */
export const isPageError = (code?: string) => code === 'REFUSED' || code === 'LOAD' || code === 'FILE' || code === 'URL' || code === 'NO_NODE';
