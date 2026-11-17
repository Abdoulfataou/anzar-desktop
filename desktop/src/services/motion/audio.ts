/**
 * Prépare la bande-son d'une vidéo à partir d'un fichier fourni par l'utilisateur (MP3, M4A,
 * WAV…) : début choisi, durée exacte de la vidéo, boucle si la musique est trop courte, volume,
 * fondu d'entrée et de sortie. Tout se fait dans l'app (Web Audio, rendu hors temps réel).
 */
const SAMPLE_RATE = 48_000;

export interface SoundtrackOptions {
  durationSec: number;
  /** Où commencer dans la musique (ms) */
  startMs?: number;
  /** 0 à 1 */
  volume?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  /** Rejouer la musique si elle est plus courte que la vidéo (défaut : oui) */
  loop?: boolean;
}

export async function prepareSoundtrack(bytes: Uint8Array, o: SoundtrackOptions): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(o.durationSec * SAMPLE_RATE));
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);
  let decoded: AudioBuffer;
  try {
    // Copie : decodeAudioData détache le tampon qu'on lui donne
    decoded = await ctx.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
  } catch {
    throw new Error('format audio non lu par ce système : utilise un fichier MP3, M4A (AAC) ou WAV');
  }
  const start = Math.min(Math.max(0, (o.startMs || 0) / 1000), Math.max(0, decoded.duration - 0.05));
  const volume = Math.min(1, Math.max(0, o.volume ?? 1));
  const d = o.durationSec;
  const fadeIn = Math.min(d / 2, Math.max(0, (o.fadeInMs ?? 150) / 1000));
  const fadeOut = Math.min(d / 2, Math.max(0, (o.fadeOutMs ?? 800) / 1000));

  const source = ctx.createBufferSource();
  source.buffer = decoded;
  if ((o.loop ?? true) && decoded.duration - start < d) {
    source.loop = true;
    source.loopStart = start;
    source.loopEnd = decoded.duration;
  }
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(fadeIn > 0 ? 0 : volume, 0);
  if (fadeIn > 0) gain.gain.linearRampToValueAtTime(volume, fadeIn);
  gain.gain.setValueAtTime(volume, Math.max(fadeIn, d - fadeOut));
  if (fadeOut > 0) gain.gain.linearRampToValueAtTime(0, d);
  source.connect(gain).connect(ctx.destination);
  source.start(0, start);
  return ctx.startRendering();
}

/** Raccourcit une bande-son (vidéo interrompue avant la fin). */
export function trimBuffer(buf: AudioBuffer, durationSec: number): AudioBuffer {
  const length = Math.min(buf.length, Math.max(1, Math.round(durationSec * buf.sampleRate)));
  if (length === buf.length) return buf;
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(0, length), c);
  return out;
}
