/**
 * visualFrame — exécution isolée des visuels interactifs (blocs ```widget).
 *
 * Pourquoi un fichier servi par le protocole « asset » de Tauri plutôt qu'une iframe srcdoc :
 * une iframe srcdoc (ou blob:, data:) HÉRITE de la politique de sécurité de l'application
 * (script-src 'self'), qui bloquerait le JavaScript du visuel. Un document chargé depuis
 * asset:// a sa propre politique, définie ci-dessous, beaucoup plus stricte que l'app.
 *
 * Trois protections cumulées :
 *  1. iframe sandbox="allow-scripts" SANS allow-same-origin : origine opaque, aucun accès à
 *     l'application, à son stockage, à ses jetons ni aux autres fichiers.
 *  2. Politique de sécurité injectée en tête du document : aucune requête réseau (fetch,
 *     images, formulaires), scripts limités au code inline et à deux CDN publics.
 *  3. Dossier dédié <données app>/visuals, seul dossier servi par le protocole asset.
 */
import { isTauri } from '@/lib/utils';

export const WIDGET_HEIGHT_MESSAGE = 'anzar-widget-height';

/** CDN autorisés pour les bibliothèques de visualisation (Chart.js, D3…). */
const SCRIPT_CDNS = 'https://cdnjs.cloudflare.com https://cdn.jsdelivr.net';

const CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' ${SCRIPT_CDNS}`,
  `style-src 'unsafe-inline' ${SCRIPT_CDNS}`,
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

export type WidgetTheme = 'dark' | 'light';

const THEME_VARS: Record<WidgetTheme, string> = {
  dark: '--fg:#ECECEF;--muted:#9A9AA5;--accent:#4F8CFF;--border:rgba(255,255,255,.12);--surface:rgba(255,255,255,.04);color-scheme:dark;',
  light: '--fg:#1C1C22;--muted:#6B6B76;--accent:#2563EB;--border:rgba(0,0,0,.12);--surface:rgba(0,0,0,.03);color-scheme:light;',
};

/** Document complet autour du fragment écrit par le modèle. */
export function buildWidgetDocument(fragment: string, token: string, theme: WidgetTheme): string {
  // Le modèle écrit un fragment ; s'il a quand même écrit un document complet, on garde
  // seulement l'intérieur de <body> (et ses <style>/<script> de <head>).
  let body = fragment;
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(fragment);
  if (bodyMatch) {
    const headMatch = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(fragment);
    const headKeep = headMatch
      ? (headMatch[1].match(/<(style|script)\b[\s\S]*?<\/\1>/gi) || []).join('\n')
      : '';
    body = headKeep + bodyMatch[1];
  }
  // Toute balise <meta http-equiv> du modèle est retirée (elle ne pourrait que s'ajouter
  // à notre politique, mais autant ne rien laisser d'ambigu).
  body = body.replace(/<meta[^>]*http-equiv[^>]*>/gi, '');

  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{${THEME_VARS[theme]}}
html,body{margin:0;padding:0;background:transparent;color:var(--fg);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
body{padding:12px;overflow-x:auto}
*{box-sizing:border-box}
button,input,select,textarea{font:inherit;color:inherit}
button{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:6px 12px;cursor:pointer}
button:hover{border-color:var(--accent)}
input,select,textarea{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:6px 10px}
canvas,svg,img{max-width:100%}
</style>
</head><body>
${body}
<script>
(function(){
  var token=${JSON.stringify(token)};
  function send(){
    var h=Math.ceil(Math.max(document.documentElement.scrollHeight,document.body.scrollHeight));
    parent.postMessage({type:${JSON.stringify(WIDGET_HEIGHT_MESSAGE)},token:token,height:h},'*');
  }
  window.addEventListener('load',send);
  if(window.ResizeObserver){new ResizeObserver(send).observe(document.body);}
  setTimeout(send,50);setTimeout(send,500);
  window.addEventListener('error',function(e){
    parent.postMessage({type:${JSON.stringify(WIDGET_HEIGHT_MESSAGE)},token:token,error:String(e.message||e)},'*');
  });
})();
</script>
</body></html>`;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }
  // Repli (contexte sans crypto.subtle) : deux FNV-1a 64 bits, suffisant pour un nom de fichier
  let h1 = 0xcbf29ce484222325n, h2 = 0x84222325cbf29ce4n;
  for (const b of data) {
    h1 = ((h1 ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
    h2 = ((h2 ^ BigInt(b ^ 0x5a)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h1.toString(16).padStart(16, '0') + h2.toString(16).padStart(16, '0');
}

let dirPromise: Promise<string> | null = null;

/** Dossier des visuels, vidé à chaque lancement (les fichiers sont recréés à la demande). */
function visualsDir(): Promise<string> {
  if (!dirPromise) {
    dirPromise = (async () => {
      const { appDataDir, join } = await import('@tauri-apps/api/path');
      const { createDir, exists, removeDir } = await import('@tauri-apps/api/fs');
      const dir = await join(await appDataDir(), 'visuals');
      try {
        if (await exists(dir)) await removeDir(dir, { recursive: true });
      } catch { /* dossier en cours d'utilisation : on le réutilise */ }
      if (!(await exists(dir))) await createDir(dir, { recursive: true });
      return dir;
    })();
    dirPromise.catch(() => { dirPromise = null; });
  }
  return dirPromise;
}

const urlCache = new Map<string, string>();

/**
 * Adresse à charger dans l'iframe pour ce visuel. Le jeton sert à reconnaître les messages
 * de hauteur envoyés par CE visuel (et pas par un autre de la conversation).
 */
export async function widgetUrl(fragment: string, theme: WidgetTheme): Promise<{ url: string; token: string }> {
  const token = await sha256Hex(`${theme}\n${fragment}`);
  const cached = urlCache.get(token);
  if (cached) return { url: cached, token };

  const html = buildWidgetDocument(fragment, token, theme);
  let url: string;
  if (isTauri()) {
    const { join } = await import('@tauri-apps/api/path');
    const { writeTextFile } = await import('@tauri-apps/api/fs');
    const { convertFileSrc } = await import('@tauri-apps/api/tauri');
    const path = await join(await visualsDir(), `${token}.html`);
    await writeTextFile(path, html);
    url = convertFileSrc(path);
  } else {
    // Navigateur (développement) : pas de politique héritée bloquante côté Vite
    url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  }
  urlCache.set(token, url);
  return { url, token };
}

export function currentTheme(): WidgetTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}
