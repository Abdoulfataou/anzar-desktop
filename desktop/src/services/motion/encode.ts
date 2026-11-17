/**
 * Assemble des images (captures image par image) en vidéo MP4 ou en GIF, dans l'app même :
 * pas de ffmpeg à installer chez l'utilisateur. MP4 via WebCodecs (H.264), WebM en secours
 * si le système n'encode pas le H.264, GIF via gifenc.
 */
export type AnimFormat = 'mp4' | 'gif';
export interface Encoded { bytes: Uint8Array; format: 'mp4' | 'webm' | 'gif' }

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

export async function encodeFrames(
  frames: Blob[],
  opts: { fps: number; width: number; height: number; format: AnimFormat; onProgress?: (done: number) => void },
): Promise<Encoded> {
  if (!frames.length) throw new Error('aucune image à assembler');
  return opts.format === 'gif' ? encodeGif(frames, opts) : encodeVideo(frames, opts);
}

async function encodeVideo(frames: Blob[], opts: { fps: number; width: number; height: number; onProgress?: (n: number) => void }): Promise<Encoded> {
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
  const output = new mb.Output({
    format: format === 'mp4' ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(),
    target: new mb.BufferTarget(),
  });
  const source = new mb.CanvasSource(canvas, { codec, bitrate: mb.QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: opts.fps });
  await output.start();
  for (let i = 0; i < frames.length; i++) {
    await draw(ctx, frames[i], width, height);
    await source.add(i / opts.fps, 1 / opts.fps);
    opts.onProgress?.(i + 1);
  }
  await output.finalize();
  const buffer = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
  if (!buffer) throw new Error('vidéo vide');
  return { bytes: new Uint8Array(buffer), format };
}

async function encodeGif(frames: Blob[], opts: { fps: number; width: number; height: number; onProgress?: (n: number) => void }): Promise<Encoded> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  // Un GIF lourd ne se partage pas : largeur bornée à 720 px
  const scale = Math.min(1, 720 / opts.width);
  const width = Math.round(opts.width * scale);
  const height = Math.round(opts.height * scale);
  const { ctx } = canvasOf(width, height);
  const gif = GIFEncoder();
  const delay = Math.round(1000 / opts.fps);
  for (let i = 0; i < frames.length; i++) {
    await draw(ctx, frames[i], width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay });
    opts.onProgress?.(i + 1);
  }
  gif.finish();
  return { bytes: gif.bytes(), format: 'gif' };
}
