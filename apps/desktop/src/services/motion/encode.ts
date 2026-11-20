/**
 * Assemble des images (captures image par image) en vidéo MP4 ou en GIF, dans l'app même :
 * pas de ffmpeg à installer chez l'utilisateur. MP4 via WebCodecs (H.264), WebM en secours
 * si le système n'encode pas le H.264, GIF via gifenc.
 *
 * L'assemblage se fait AU FUR ET À MESURE (createStreamEncoder) : chaque image est encodée
 * puis oubliée, donc la mémoire reste faible quelle que soit la durée de la vidéo.
 */
export type AnimFormat = 'mp4' | 'gif';
export interface Encoded {
  bytes: Uint8Array;
  format: 'mp4' | 'webm' | 'gif';
  /** Bande-son incluse ; sinon `audioNote` explique pourquoi */
  hasAudio: boolean;
  audioNote?: string;
}
export interface StreamEncoder {
  /** Format réel (webm si le H.264 n'est pas disponible) */
  format: 'mp4' | 'webm' | 'gif';
  add(frame: Blob): Promise<void>;
  finish(): Promise<Encoded>;
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas indisponible');
  return { canvas, ctx };
}

async function draw(ctx: CanvasRenderingContext2D, frame: Blob, width: number, height: number) {
  const bitmap = await createImageBitmap(frame);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
}

export interface EncoderOptions { fps: number; width: number; height: number; format: AnimFormat; audio?: AudioBuffer }

export async function createStreamEncoder(opts: EncoderOptions): Promise<StreamEncoder> {
  return opts.format === 'gif' ? gifEncoder(opts) : videoEncoder(opts);
}

let aacPolyfill: Promise<void> | null = null;
/** AAC : encodeur du système si possible, sinon encodeur WebAssembly de secours (chargé une fois). */
async function ensureAac(mb: typeof import('mediabunny'), channels: number, sampleRate: number): Promise<boolean> {
  const cfg = { numberOfChannels: channels, sampleRate, bitrate: 128_000 };
  if (await mb.canEncodeAudio('aac', cfg)) return true;
  aacPolyfill ??= import('@mediabunny/aac-encoder').then((m) => m.registerAacEncoder());
  await aacPolyfill;
  return mb.canEncodeAudio('aac', cfg);
}

/** Toutes les images d'un coup (petites vidéos, navigateur intégré en secours). */
export async function encodeFrames(
  frames: Blob[],
  opts: EncoderOptions & { onProgress?: (done: number) => void },
): Promise<Encoded> {
  if (!frames.length) throw new Error('aucune image à assembler');
  const enc = await createStreamEncoder(opts);
  for (let i = 0; i < frames.length; i++) {
    await enc.add(frames[i]);
    opts.onProgress?.(i + 1);
  }
  return enc.finish();
}

async function videoEncoder(opts: EncoderOptions): Promise<StreamEncoder> {
  const mb = await import('mediabunny');
  const width = even(opts.width);
  const height = even(opts.height);
  let format: 'mp4' | 'webm' = 'mp4';
  let codec: 'avc' | 'vp9' | 'vp8' = 'avc';
  if (!(await mb.canEncodeVideo('avc', { width, height }))) {
    if (await mb.canEncodeVideo('vp9', { width, height })) { format = 'webm'; codec = 'vp9'; }
    else if (await mb.canEncodeVideo('vp8', { width, height })) { format = 'webm'; codec = 'vp8'; }
    else throw new Error("ce système ne sait pas encoder de vidéo : exporte en GIF (format: \"gif\")");
  }
  const { canvas, ctx } = canvasOf(width, height);
  const target = new mb.BufferTarget();
  const output = new mb.Output({
    format: format === 'mp4' ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(),
    target,
  });
  // Qualité moyenne : nette sur téléphone, et un fichier assez léger pour WhatsApp
  const source = new mb.CanvasSource(canvas, { codec, bitrate: mb.QUALITY_MEDIUM, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: opts.fps });

  // Bande-son : AAC dans le MP4, Opus dans le WebM de secours
  let audioSource: InstanceType<typeof mb.AudioBufferSource> | null = null;
  let audioNote: string | undefined;
  if (opts.audio) {
    const a = opts.audio;
    const ok = format === 'mp4'
      ? await ensureAac(mb, a.numberOfChannels, a.sampleRate).catch(() => false)
      : await mb.canEncodeAudio('opus', { numberOfChannels: a.numberOfChannels, sampleRate: a.sampleRate, bitrate: 128_000 });
    if (ok) {
      audioSource = new mb.AudioBufferSource({ codec: format === 'mp4' ? 'aac' : 'opus', bitrate: 128_000 });
      output.addAudioTrack(audioSource);
    } else {
      audioNote = "ce système ne sait pas encoder le son : vidéo enregistrée sans la musique";
    }
  }
  await output.start();
  let n = 0;
  return {
    format,
    async add(frame) {
      await draw(ctx, frame, width, height);
      await source.add(n / opts.fps, 1 / opts.fps);
      n++;
    },
    async finish() {
      if (!n) throw new Error('aucune image à assembler');
      if (audioSource && opts.audio) {
        const { trimBuffer } = await import('./audio');
        await audioSource.add(trimBuffer(opts.audio, n / opts.fps));
        audioSource.close();
      }
      await output.finalize();
      if (!target.buffer) throw new Error('vidéo vide');
      return { bytes: new Uint8Array(target.buffer), format, hasAudio: !!audioSource, audioNote };
    },
  };
}

async function gifEncoder(opts: EncoderOptions): Promise<StreamEncoder> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  // Un GIF lourd ne se partage pas : largeur bornée à 720 px
  const scale = Math.min(1, 720 / opts.width);
  const width = Math.round(opts.width * scale);
  const height = Math.round(opts.height * scale);
  const { ctx } = canvasOf(width, height);
  const gif = GIFEncoder();
  const delay = Math.round(1000 / opts.fps);
  let n = 0;
  return {
    format: 'gif',
    async add(frame) {
      await draw(ctx, frame, width, height);
      const { data } = ctx.getImageData(0, 0, width, height);
      const palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay });
      n++;
    },
    async finish() {
      if (!n) throw new Error('aucune image à assembler');
      gif.finish();
      return { bytes: gif.bytes(), format: 'gif', hasAudio: false, audioNote: opts.audio ? 'un GIF ne contient pas de son' : undefined };
    },
  };
}
