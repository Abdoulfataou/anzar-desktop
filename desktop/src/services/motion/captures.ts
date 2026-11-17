/**
 * Captures d'écran pour l'agent via le moteur de rendu (horloge virtuelle). Retourne null si le
 * moteur lui-même n'a pas pu tourner : l'appelant bascule alors sur le navigateur intégré.
 */
import { cleanupRender, isPageError, readFrame, renderFrames } from './renderer';

const VIEWPORTS = {
  desktop: { width: 1280, height: 800, label: 'ordinateur 1280×800' },
  mobile: { width: 390, height: 844, label: 'téléphone 390×844' },
} as const;
export type Viewport = keyof typeof VIEWPORTS;

/** Sans instants précis : capture après les animations d'entrée courantes. */
const SETTLED_MS = 1500;
const MAX_IMAGES = 8;

export const CRITIQUE =
  "Examine-les comme un directeur artistique exigeant : texte qui déborde ou se chevauche, contraste insuffisant, " +
  "alignements, espacements irréguliers, hiérarchie peu claire, éléments coupés sur téléphone, mouvement saccadé ou incohérent. " +
  'Corrige ce qui ne va pas, puis recapture pour vérifier (deux rounds de corrections au plus).';

export async function captureWithRenderer(opts: {
  url?: string; file?: string; root?: string; viewports?: Viewport[]; frames?: number[]; fullPage?: boolean; signal?: AbortSignal;
}): Promise<{ output: string; isError: boolean; images: { label: string; dataUrl: string }[] } | null> {
  const views = (opts.viewports?.length ? opts.viewports : (['desktop', 'mobile'] as Viewport[]))
    .filter((v, i, all) => VIEWPORTS[v] && all.indexOf(v) === i);
  const frames = (opts.frames || []).filter((n) => Number.isFinite(n) && n >= 0 && n <= 60_000).slice(0, 6).sort((a, b) => a - b);
  const { imageToDataUrl } = await import('@/lib/imageAttach');
  const images: { label: string; dataUrl: string }[] = [];
  const pageErrors = new Set<string>();

  for (const v of views) {
    const vp = VIEWPORTS[v];
    const times = frames.length ? frames : [SETTLED_MS];
    const r = await renderFrames({
      url: opts.url, file: opts.file, root: opts.root, width: vp.width, height: vp.height, times,
      fullPage: !frames.length && !!opts.fullPage,
    }, { signal: opts.signal });
    try {
      if (r.error) {
        if (isPageError(r.code) || opts.file) {
          return { output: r.code === 'REFUSED' ? `${r.error}\nLe serveur est-il lancé ? Sinon, donne file (chemin du fichier HTML) au lieu de url.` : r.error, isError: true, images: [] };
        }
        return null; // moteur indisponible : le navigateur intégré prend le relais
      }
      r.pageErrors.forEach((e) => pageErrors.add(e));
      for (let i = 0; i < r.files.length && images.length < MAX_IMAGES; i++) {
        if (!r.files[i]) continue;
        images.push({
          label: frames.length ? `${vp.label}, ${times[i]} ms` : `${vp.label}${opts.fullPage ? ', page entière' : ''}`,
          dataUrl: await imageToDataUrl(await readFrame(r.files[i])),
        });
      }
    } finally {
      await cleanupRender(r);
    }
  }
  if (!images.length) return { output: 'Aucune capture prise.', isError: true, images: [] };
  const list = images.map((im, i) => `${i + 1}. ${im.label}`).join('\n');
  return {
    output: `${images.length} capture(s) prise(s) ; elles te sont montrées juste après ce résultat :\n${list}` +
      (pageErrors.size ? `\n\nErreurs JavaScript de la page :\n${[...pageErrors].map((e) => `- ${e}`).join('\n')}` : '') +
      `\n\n${CRITIQUE}`,
    isError: false,
    images,
  };
}
