'use strict';
/*
 * Moteur de rendu d'ANZAR : capture une page image par image avec une horloge VIRTUELLE.
 * requestAnimationFrame, performance.now, Date, setTimeout et setInterval sont remplacés par
 * une horloge qu'on avance nous-mêmes ; les animations CSS et Web Animations sont placées au
 * même instant. Résultat déterministe (même rendu quelle que soit la vitesse de l'ordinateur)
 * pour CSS, GSAP, canvas, three.js et le JavaScript maison.
 * Usage : node anzar-render.cjs <job.json>. Sortie : une ligne JSON par événement.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

function loadPlaywright() {
  const bins = (process.env.PATH || '').split(path.delimiter).filter((p) => /node_modules[\\/]\.bin$/.test(p));
  for (const b of bins) {
    try { return require(require.resolve('playwright-core', { paths: [path.dirname(b)] })); } catch (e) { /* suivant */ }
  }
  return require('playwright-core');
}

const VIRTUAL_TIME = `(() => {
  const W = window;
  if (W.__anzarSeek) return;
  let vnow = 0;
  const RealDate = Date;
  const origin = RealDate.now();
  const timers = new Map(); let tid = 1;
  const rafs = new Map(); let rid = 1;
  const born = new WeakMap();
  W.performance.now = () => vnow;
  function VDate(...a) {
    if (!(this instanceof VDate)) return new RealDate(origin + vnow).toString();
    return a.length ? new RealDate(...a) : new RealDate(origin + vnow);
  }
  VDate.prototype = RealDate.prototype;
  VDate.now = () => origin + vnow;
  VDate.parse = RealDate.parse; VDate.UTC = RealDate.UTC;
  W.Date = VDate;
  W.setTimeout = (fn, d, ...args) => { const id = tid++; timers.set(id, { at: vnow + Math.max(0, +d || 0), fn, args, every: 0 }); return id; };
  W.setInterval = (fn, d, ...args) => { const e = Math.max(1, +d || 0); const id = tid++; timers.set(id, { at: vnow + e, fn, args, every: e }); return id; };
  W.clearTimeout = W.clearInterval = (id) => { timers.delete(id); };
  W.requestAnimationFrame = (cb) => { const id = rid++; rafs.set(id, cb); return id; };
  W.cancelAnimationFrame = (id) => { rafs.delete(id); };
  const run = (fn, args) => { try { typeof fn === 'function' ? fn(...args) : (0, eval)(String(fn)); } catch (e) { console.error(e); } };
  const timersUntil = (t) => {
    for (let guard = 0; guard < 100000; guard++) {
      let next = null, nid = 0;
      for (const [id, tm] of timers) if (tm.at <= t && (!next || tm.at < next.at)) { next = tm; nid = id; }
      if (!next) return;
      vnow = Math.max(vnow, next.at);
      if (next.every) next.at += next.every; else timers.delete(nid);
      run(next.fn, next.args);
    }
  };
  const syncAnimations = () => {
    for (const a of document.getAnimations()) {
      if (!born.has(a)) { born.set(a, vnow); try { a.pause(); } catch (e) {} }
      try { a.currentTime = Math.max(0, vnow - born.get(a)); } catch (e) {}
    }
  };
  const frame = () => { const cbs = [...rafs.values()]; rafs.clear(); for (const cb of cbs) run(cb, [vnow]); };
  W.__anzarNow = () => vnow;
  // L'instant 0 affiché est celui du premier rafraîchissement d'écran (~17 ms), comme dans un
  // vrai navigateur : certaines bibliothèques (GSAP) n'appliquent l'état de départ qu'à ce moment.
  const ZERO = 1000 / 60;
  W.__anzarSeek = async (shown) => {
    const t = shown + ZERO;
    timersUntil(vnow);
    syncAnimations();
    const step = 1000 / 60;
    while (vnow < t) {
      const target = Math.min(t, vnow + step);
      timersUntil(target);
      vnow = target;
      frame();
      syncAnimations();
      await Promise.resolve();
    }
    return vnow - ZERO;
  };
})();`;

function inside(root, file) {
  const r = path.resolve(root) + path.sep;
  const f = path.resolve(file);
  return f.startsWith(r);
}

async function main() {
  const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const { chromium } = loadPlaywright();
  let url = job.url;
  if (job.file) {
    if (!job.root || !inside(job.root, job.file) || !fs.existsSync(job.file)) {
      out({ type: 'error', code: 'FILE', message: `Fichier introuvable ou hors du dossier de travail : ${job.file}` });
      return;
    }
    url = pathToFileURL(job.file).href;
  }
  if (!/^(https?|file):/i.test(url || '')) { out({ type: 'error', code: 'URL', message: `Adresse invalide : ${url}` }); return; }

  const args = process.env.ANZAR_RENDER_NO_SANDBOX ? ['--no-sandbox'] : [];
  let browser = null;
  for (const channel of ['chrome', undefined]) {
    try { browser = await chromium.launch({ channel, headless: true, args }); break; } catch (e) { /* suivant */ }
  }
  if (!browser) { out({ type: 'error', code: 'NO_BROWSER', message: 'Aucun navigateur : installe Google Chrome ou Chromium.' }); return; }
  try {
    const context = await browser.newContext({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
    // Fichiers locaux : seulement ceux du dossier de travail
    await context.route('file://**', (route) => {
      try {
        const p = require('url').fileURLToPath(route.request().url());
        return job.root && inside(job.root, p) ? route.continue() : route.abort();
      } catch (e) { return route.abort(); }
    });
    await context.addInitScript({ content: VIRTUAL_TIME });
    const page = await context.newPage();
    page.on('pageerror', (e) => out({ type: 'log', message: `Erreur JavaScript de la page : ${String(e && e.message || e).slice(0, 300)}` }));
    const load = async () => {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    };
    try { await load(); } catch (e) {
      const m = String(e && e.message || e);
      out({ type: 'error', code: /ERR_CONNECTION_REFUSED/.test(m) ? 'REFUSED' : 'LOAD', message: m.slice(0, 400) });
      return;
    }
    const times = job.times;
    fs.mkdirSync(job.outDir, { recursive: true });
    let current = 0;
    for (let i = 0; i < times.length; i++) {
      const t = Math.max(0, times[i]);
      if (t < current) { await load(); }
      current = await page.evaluate((x) => window.__anzarSeek(x), t);
      const file = path.join(job.outDir, `${String(i).padStart(5, '0')}.jpeg`);
      await page.screenshot({ path: file, type: 'jpeg', quality: job.quality || 90, fullPage: !!job.fullPage, animations: 'allow' });
      out({ type: 'frame', i, t, file });
    }
    out({ type: 'done', count: times.length });
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => { out({ type: 'error', code: 'CRASH', message: String(e && e.stack || e).slice(0, 800) }); process.exitCode = 1; });
