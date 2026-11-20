/**
 * Outils motion design : export d'animations/vidéos, images fixes, bibliothèques vendées.
 */
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { vendorLibs } from '@/services/skills/pack/vendorLibs';
import { resolvePath } from './shared';
import { ToolExecutionContext, ToolResult } from './types';

const ANIM_SIZES: Record<string, [number, number]> = {
  story: [1080, 1920], carre: [1080, 1080], portrait: [1080, 1350], paysage: [1920, 1080], a4: [2480, 3508],
};

/**
 * Garde-fou qualité pour les pages animées exportées :
 * - un <script>/<link> externe (CDN) = capture cassée si le réseau flanche → refus
 *   avec la marche à suivre (vendor_lib). Les polices Google sont autorisées.
 * - Math.random() nu = vidéo non reproductible après retouche → avertissement.
 */
async function checkMotionHtml(absFile: string): Promise<{ output?: string; isError?: boolean; note?: string }> {
  try {
    const { readTextFile } = await import('@/lib/tauri/fs');
    const html = await readTextFile(absFile);
    const externals: string[] = [];
    const re = /<(script|link)\b[^>]*?(?:src|href)=["'](https?:\/\/[^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const u = m[2];
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/i.test(u)) continue;      // serveur local du projet
      if (/fonts\.(googleapis|gstatic)\.com/i.test(u)) continue;                     // polices : autorisées
      externals.push(u);
    }
    if (externals.length) {
      return {
        isError: true,
        output:
          `La page charge des ressources externes (interdit : une capture coupée par le réseau ruine la vidéo) :\n` +
          externals.map((u) => `- ${u}`).join('\n') +
          `\nRemédiation : appelle vendor_lib (ex : ["gsap","split-text"]) et remplace ces balises par les <script src="libs/…"> locaux renvoyés.`,
      };
    }
    if (/Math\.random\s*\(/.test(html) && !/mulberry32|seedrandom|xorshift/i.test(html)) {
      return { note: 'Math.random() détecté sans PRNG seedé : la vidéo ne sera pas identique après retouche. Utilise mulberry32 (skill motion-system).' };
    }
    return {};
  } catch {
    return {}; // fichier illisible : le renderer donnera l'erreur réelle
  }
}

export async function execExportAnimation(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const [{ captureFrames }, { devServerUrl }, { createStreamEncoder }, renderer] = await Promise.all([
    import('./browserCheck'), import('./devServer'), import('@/services/motion/encode'), import('@/services/motion/renderer'),
  ]);
  const file = typeof args.file === 'string' && args.file.trim() ? await resolvePath(ctx.projectRoot, args.file) : undefined;
  const url = file ? undefined : typeof args.url === 'string' && args.url.trim() ? args.url.trim() : devServerUrl(ctx.projectRoot);
  if (!url && !file) return { output: 'Indique file (fichier HTML du projet) ou url.', isError: true };
  if (file) {
    const guard = await checkMotionHtml(file);
    if (guard.isError && guard.output) return { output: guard.output, isError: true };
  }
  const [dw, dh] = ANIM_SIZES[String(args.size || 'story')] || ANIM_SIZES.story;
  const width = Math.min(3840, Math.max(64, Math.round(Number(args.width) || dw)));
  const height = Math.min(3840, Math.max(64, Math.round(Number(args.height) || dh)));
  if (args.format === 'png') return exportStill({ url, file, width, height, at: Number(args.duration_ms) || 1500, output: args.output, ctx });
  const format: 'mp4' | 'gif' = args.format === 'gif' ? 'gif' : 'mp4';
  const maxMs = format === 'gif' ? 20_000 : 60_000;
  const durationMs = Math.min(maxMs, Math.max(200, Number(args.duration_ms) || 4000));
  const fps = Math.min(60, Math.max(1, Math.round(Number(args.fps) || (format === 'gif' ? 15 : 30))));
  const count = Math.max(1, Math.round((durationMs / 1000) * fps));
  if (count > 1800) return { output: `Trop d'images (${count}, 1800 au plus) : réduis la durée ou les fps (60 s à 30 images/s au plus).`, isError: true };
  let rel = String(args.output || `export/animation.${format}`).replace(/\\/g, '/');
  if (!/\.(mp4|webm|gif)$/i.test(rel)) rel += `.${format}`;

  // Musique de fond (fichier fourni par l'utilisateur), préparée à la durée exacte de la vidéo
  let audio: AudioBuffer | undefined;
  let musicNote = '';
  if (typeof args.music === 'string' && args.music.trim()) {
    if (format === 'gif') {
      musicNote = 'Un GIF ne contient pas de son : la musique n\'a pas été ajoutée (exporte en mp4 pour l\'avoir).';
    } else {
      try {
        const musicAbs = await resolvePath(ctx.projectRoot, args.music);
        const { readBinaryFile } = await import('@/lib/tauri/fs');
        const bytes = await readBinaryFile(musicAbs);
        if (bytes.byteLength > 80 * 1048576) throw new Error('fichier audio trop lourd (80 Mo au plus)');
        const { prepareSoundtrack } = await import('@/services/motion/audio');
        audio = await prepareSoundtrack(bytes, {
          durationSec: count / fps,
          startMs: Number(args.music_start_ms) || 0,
          volume: args.music_volume === undefined ? 1 : Number(args.music_volume),
          fadeOutMs: args.fade_out_ms === undefined ? undefined : Number(args.fade_out_ms),
        });
      } catch (e: any) {
        return { output: `Musique inutilisable (${args.music}) : ${e?.message || e}`, isError: true };
      }
    }
  }

  let enc;
  try {
    enc = await createStreamEncoder({ fps, width, height, format, audio });
  } catch (e: any) {
    return { output: `Assemblage de la vidéo impossible : ${e?.message || e}`, isError: true };
  }
  // Assemblage au fur et à mesure : chaque image est encodée puis oubliée (mémoire faible, même à 60 s)
  const picks = new Set([0, Math.floor(count / 3), Math.floor((2 * count) / 3), count - 1]);
  const keyFrames = new Map<number, Blob>();
  let added = 0;
  let encodeError = '';
  let chain: Promise<void> = Promise.resolve();
  const { removeFile, writeBinaryFile, createDir } = await import('@/lib/tauri/fs');
  const addFrame = (i: number, blob: Blob) => {
    if (picks.has(i)) keyFrames.set(i, blob);
    return enc.add(blob).then(() => { added++; });
  };

  let realTime = false;
  let warning = '';
  const times = Array.from({ length: count }, (_, i) => (i * 1000) / fps);
  const r = await renderer.renderFrames({ url, file, root: ctx.projectRoot, width, height, times }, {
    signal: ctx.signal,
    onFrame: (i, path) => {
      chain = chain.then(async () => {
        if (encodeError) return;
        await addFrame(i, await renderer.readFrame(path));
        void removeFile(path).catch(() => {});
      }).catch((e: any) => { encodeError = String(e?.message || e); });
    },
  });
  await chain;
  await renderer.cleanupRender(r);
  if (r.pageErrors.length) warning = `erreurs JavaScript de la page : ${r.pageErrors.slice(0, 3).join(' | ')}`;
  if (r.error) {
    if (renderer.isPageError(r.code) || file || !url || r.code === 'ABORT') return { output: r.error, isError: true };
    // Moteur indisponible : navigateur intégré en secours (plus lent, 20 s au plus)
    if (durationMs > 20_000) return { output: `${r.error}\nSans le moteur de rendu, 20 s au plus : réduis la durée.`, isError: true };
    const shot = await captureFrames({ url, width, height, durationMs, fps, signal: ctx.signal });
    if (shot.error && !shot.frames.length) return { output: shot.error, isError: true };
    realTime = shot.realTime;
    if (shot.error) warning = shot.error;
    for (let i = 0; i < shot.frames.length && !encodeError; i++) {
      try { await addFrame(i, shot.frames[i]); } catch (e: any) { encodeError = String(e?.message || e); }
    }
  }
  if (encodeError) return { output: `Assemblage de la vidéo impossible : ${encodeError}`, isError: true };
  if (!added) return { output: 'Aucune image enregistrée.', isError: true };

  let encoded;
  try {
    encoded = await enc.finish();
  } catch (e: any) {
    return { output: `Assemblage de la vidéo impossible : ${e?.message || e}`, isError: true };
  }
  if (encoded.format === 'webm') rel = rel.replace(/\.mp4$/i, '.webm');
  const abs = await resolvePath(ctx.projectRoot, rel);
  await createDir(abs.replace(/[\\/][^\\/]+$/, ''), { recursive: true }).catch(() => {});
  const existed = await fileSystemService.exists(abs);
  await writeBinaryFile(abs, encoded.bytes);
  ctx.onFileChanged?.(rel, '', existed ? 'edit' : 'create');

  // Quatre images clés pour que l'agent vérifie le résultat
  const { imageToDataUrl } = await import('@/lib/imageAttach');
  const images = await Promise.all([...keyFrames.entries()].sort((x, y) => x[0] - y[0]).map(async ([n, blob]) => ({
    label: `${encoded.format.toUpperCase()}, image à ${Math.round((n * 1000) / fps)} ms`,
    dataUrl: await imageToDataUrl(blob),
  })));
  const mo = (encoded.bytes.byteLength / 1048576).toFixed(1).replace('.', ',');
  return {
    output: `Vidéo créée : ${rel} (${encoded.format.toUpperCase()}, ${width}×${height}, ${(added / fps).toFixed(1)} s, ${fps} images/s, ${mo} Mo).` +
      (encoded.format === 'webm' ? ' Ce système n\'encode pas le H.264 : vidéo enregistrée en WebM.' : '') +
      (audio && encoded.hasAudio ? ` Musique incluse (${args.music}).` : '') +
      (encoded.audioNote ? ` Son : ${encoded.audioNote}.` : '') +
      (musicNote ? ` ${musicNote}` : '') +
      (realTime ? ' Attention : animations non figeables, capturées en temps réel : le rythme peut être irrégulier.' : '') +
      (warning ? ` À signaler : ${warning}` : '') +
      ' Les images clés te sont montrées : vérifie le début, le milieu et la fin. La vidéo s\'affiche déjà dans la conversation avec un lecteur : ne la décris pas en détail, donne juste son nom. Si tu modifies encore la page, réexporte la vidéo avant de finir.',
    images,
    media: { path: abs, kind: encoded.format === 'gif' ? 'image' : 'video' },
  };
}

/** Export d'une image PNG unique (visuel, affiche, publication) à l'instant `at`. */
async function exportStill(o: { url?: string; file?: string; width: number; height: number; at: number; output?: string; ctx: ToolExecutionContext }): Promise<ToolResult> {
  if (o.file) {
    const guard = await checkMotionHtml(o.file);
    if (guard.isError && guard.output) return { output: guard.output, isError: true };
  }
  const { renderFrames, cleanupRender } = await import('@/services/motion/renderer');
  let rel = String(o.output || 'export/visuel.png').replace(/\\/g, '/');
  if (!/\.png$/i.test(rel)) rel = rel.replace(/\.[a-z0-9]+$/i, '') + '.png';
  const r = await renderFrames({ url: o.url, file: o.file, root: o.ctx.projectRoot, width: o.width, height: o.height, times: [Math.max(0, o.at)], imageType: 'png' }, { signal: o.ctx.signal });
  try {
    if (r.error || !r.files[0]) return { output: r.error || 'Aucune image produite.', isError: true };
    const { readBinaryFile, writeBinaryFile, createDir } = await import('@/lib/tauri/fs');
    const bytes = await readBinaryFile(r.files[0]);
    const abs = await resolvePath(o.ctx.projectRoot, rel);
    await createDir(abs.replace(/[\\/][^\\/]+$/, ''), { recursive: true }).catch(() => {});
    const existed = await fileSystemService.exists(abs);
    await writeBinaryFile(abs, bytes);
    o.ctx.onFileChanged?.(rel, '', existed ? 'edit' : 'create');
    const { imageToDataUrl } = await import('@/lib/imageAttach');
    const preview = await imageToDataUrl(new Blob([bytes as unknown as BlobPart], { type: 'image/png' }));
    return {
      output: `Image créée : ${rel} (PNG, ${o.width}×${o.height}, ${Math.max(1, Math.round(bytes.byteLength / 1024))} Ko). Elle t'est montrée : vérifie-la. Elle s'affiche déjà dans la conversation : donne juste son nom.` +
        (r.pageErrors.length ? ` Erreurs JavaScript de la page : ${r.pageErrors.slice(0, 3).join(' | ')}` : ''),
      images: [{ label: `PNG ${o.width}×${o.height}`, dataUrl: preview }],
      media: { path: abs, kind: 'image' },
    };
  } finally {
    await cleanupRender(r);
  }
}

export async function execVendorLib(args: Record<string, any>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const names = Array.isArray(args.libs) ? args.libs.map(String) : [];
  if (!names.length) return { output: "Indique libs, ex : ['gsap','split-text'] ou ['all'].", isError: true };
  return vendorLibs(ctx.projectRoot, names);
}
