/**
 * visualExport — enregistrer un visuel (SVG, PNG, HTML) via la boîte « Enregistrer sous ».
 */
import toast from 'react-hot-toast';
import { isTauri } from '@/lib/utils';

type Filter = { name: string; extensions: string[] };

async function saveBytes(defaultName: string, filter: Filter, data: Uint8Array | string): Promise<void> {
  if (!isTauri()) {
    const blob = new Blob([data as BlobPart]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = defaultName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  }
  const { save } = await import('@tauri-apps/api/dialog');
  const { downloadDir, join } = await import('@tauri-apps/api/path');
  const { writeBinaryFile, writeTextFile } = await import('@tauri-apps/api/fs');
  let defaultPath = defaultName;
  try { defaultPath = await join(await downloadDir(), defaultName); } catch { /* garde le nom seul */ }
  const path = await save({ defaultPath, filters: [filter] });
  if (!path) return;
  if (typeof data === 'string') await writeTextFile(path, data);
  else await writeBinaryFile(path, data);
  toast.success('Visuel enregistré');
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Ajoute xmlns et une taille explicite pour que le SVG s'ouvre partout. */
function standaloneSvg(svg: string): string {
  let out = svg.trim();
  if (!/xmlns=/.test(out)) out = out.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${out}`;
}

export async function exportSvg(svg: string, base = 'visuel'): Promise<void> {
  try {
    await saveBytes(`${base}-${stamp()}.svg`, { name: 'Image SVG', extensions: ['svg'] }, standaloneSvg(svg));
  } catch (e) {
    toast.error(`Enregistrement impossible : ${e instanceof Error ? e.message : e}`);
  }
}

/** Dessine le SVG sur un canevas (2×, fond selon le thème) puis l'enregistre en PNG. */
export async function exportPng(svg: string, base = 'visuel', background = '#ffffff'): Promise<void> {
  try {
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(standaloneSvg(svg))}`;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image illisible'));
      img.src = src;
    });
    const viewBox = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
    const w = img.naturalWidth || (viewBox ? Number(viewBox[1]) : 800);
    const h = img.naturalHeight || (viewBox ? Number(viewBox[2]) : 600);
    const scale = Math.min(4, Math.max(2, 1600 / Math.max(w, 1)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canevas indisponible');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('conversion PNG impossible'))), 'image/png'));
    await saveBytes(`${base}-${stamp()}.png`, { name: 'Image PNG', extensions: ['png'] }, new Uint8Array(await blob.arrayBuffer()));
  } catch (e) {
    toast.error(`Export PNG impossible : ${e instanceof Error ? e.message : e}`);
  }
}

export async function exportHtml(document: string, base = 'visuel'): Promise<void> {
  try {
    await saveBytes(`${base}-${stamp()}.html`, { name: 'Page HTML', extensions: ['html'] }, document);
  } catch (e) {
    toast.error(`Enregistrement impossible : ${e instanceof Error ? e.message : e}`);
  }
}
