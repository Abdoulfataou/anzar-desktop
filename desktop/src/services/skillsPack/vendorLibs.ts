/**
 * vendorLibs — Bibliothèques d'animation VENDÉES dans l'app (GSAP 3.13 complet,
 * désormais 100 % gratuit — https://gsap.com/blog/3-13).
 *
 * L'outil agent `vendor_lib` les copie dans `libs/` du projet : capture
 * reproductible HORS LIGNE (pas de CDN flaky), même version à chaque fois.
 */
import gsapCore from './assets/gsap/gsap.min.js?raw';
import gsapSplitText from './assets/gsap/SplitText.min.js?raw';
import gsapDrawSVG from './assets/gsap/DrawSVGPlugin.min.js?raw';
import gsapMorphSVG from './assets/gsap/MorphSVGPlugin.min.js?raw';
import gsapScrambleText from './assets/gsap/ScrambleTextPlugin.min.js?raw';
import gsapFlip from './assets/gsap/Flip.min.js?raw';
import gsapCustomEase from './assets/gsap/CustomEase.min.js?raw';

export interface VendoredLib {
  /** Nom demandé par l'agent */
  name: string;
  /** Nom de fichier dans libs/ */
  file: string;
  content: string;
  /** Balise script à insérer (ordre des plugins après le core) */
  scriptTag: string;
  /** Plugins GSAP à enregistrer après chargement */
  register?: string;
}

export const VENDORED_LIBS: VendoredLib[] = [
  {
    name: 'gsap',
    file: 'libs/gsap.min.js',
    content: gsapCore,
    scriptTag: '<script src="libs/gsap.min.js"></script>',
  },
  {
    name: 'split-text',
    file: 'libs/SplitText.min.js',
    content: gsapSplitText,
    scriptTag: '<script src="libs/SplitText.min.js"></script>',
    register: 'SplitText',
  },
  {
    name: 'draw-svg',
    file: 'libs/DrawSVGPlugin.min.js',
    content: gsapDrawSVG,
    scriptTag: '<script src="libs/DrawSVGPlugin.min.js"></script>',
    register: 'DrawSVGPlugin',
  },
  {
    name: 'morph-svg',
    file: 'libs/MorphSVGPlugin.min.js',
    content: gsapMorphSVG,
    scriptTag: '<script src="libs/MorphSVGPlugin.min.js"></script>',
    register: 'MorphSVGPlugin',
  },
  {
    name: 'scramble-text',
    file: 'libs/ScrambleTextPlugin.min.js',
    content: gsapScrambleText,
    scriptTag: '<script src="libs/ScrambleTextPlugin.min.js"></script>',
    register: 'ScrambleTextPlugin',
  },
  {
    name: 'flip',
    file: 'libs/Flip.min.js',
    content: gsapFlip,
    scriptTag: '<script src="libs/Flip.min.js"></script>',
    register: 'Flip',
  },
  {
    name: 'custom-ease',
    file: 'libs/CustomEase.min.js',
    content: gsapCustomEase,
    scriptTag: '<script src="libs/CustomEase.min.js"></script>',
    register: 'CustomEase',
  },
];

/** Nom court accepté : « gsap », « gsap-split », « splittext »… */
function findLib(name: string): VendoredLib | undefined {
  const n = name.toLowerCase().replace(/[_\s]/g, '-');
  return VENDORED_LIBS.find((l) =>
    l.name === n ||
    (n === 'gsap-split' || n === 'splittext' || n === 'split' ? l.name === 'split-text' : false) ||
    (n === 'drawsvg' ? l.name === 'draw-svg' : false) ||
    (n === 'morphsvg' ? l.name === 'morph-svg' : false)
  );
}

/**
 * Copie les libs demandées dans libs/ du projet et renvoie la marche à suivre
 * pour l'agent (balises script + registerPlugin éventuels).
 */
export async function vendorLibs(
  projectRoot: string,
  names: string[]
): Promise<{ output: string; isError?: boolean }> {
  const { join, dirname } = await import('@tauri-apps/api/path');
  const { writeTextFile, createDir, exists } = await import('@tauri-apps/api/fs');
  const { isTauri } = await import('@/lib/utils');
  if (!isTauri()) return { output: "vendor_lib est disponible uniquement dans l'app desktop.", isError: true };

  const libsDir = await join(projectRoot, 'libs');
  if (!(await exists(libsDir))) await createDir(libsDir, { recursive: true });

  // « all » → tout le pack GSAP ; sinon résolution nom par nom
  const wanted = names.some((n) => /^all|gsap-complet|complet$/i.test(n))
    ? VENDORED_LIBS
    : names.map(findLib).filter(Boolean) as VendoredLib[];

  if (wanted.length === 0) {
    return {
      output: `Libs disponibles : ${VENDORED_LIBS.map((l) => l.name).join(', ')} (ou "all" pour tout GSAP).`,
      isError: true,
    };
  }

  // gsap.min.js d'abord, plugins ensuite
  const ordered = [...wanted].sort((a, b) => (a.name === 'gsap' ? -1 : b.name === 'gsap' ? 1 : 0));
  const written: string[] = [];
  for (const lib of ordered) {
    const dest = await join(projectRoot, lib.file);
    await createDir(await dirname(dest), { recursive: true }).catch(() => {});
    await writeTextFile(dest, lib.content);
    written.push(lib.file);
  }

  const plugins = ordered.map((l) => l.register).filter(Boolean);
  const scriptTags = ordered.map((l) => `  ${l.scriptTag}`).join('\n');
  const registerLine = plugins.length ? `  gsap.registerPlugin(${plugins.join(', ')});` : '';

  return {
    output:
      `Libs copiées dans le projet (hors ligne, version figée) :\n${written.map((w) => `- ${w}`).join('\n')}\n\n` +
      `Dans le <head> de la page :\n${scriptTags}\n` +
      (registerLine ? `Puis juste après :\n${registerLine}\n` : '') +
      `\nAttention : les chemins sont relatifs — si ta page est dans un sous-dossier (ex : pub/), utilise ../libs/gsap.min.js.`,
  };
}
