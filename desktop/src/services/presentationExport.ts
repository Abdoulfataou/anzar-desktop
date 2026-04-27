/**
 * presentationExport.ts — Export AI responses as PowerPoint (.pptx)
 *
 * Objectif: export "design premium" (fond, typographie, hiérarchie, footer)
 * à partir d'un contenu markdown-ish (titres, listes, paragraphes).
 *
 * Tech: pptxgenjs (client-side)
 * - Tauri: save dialog + writeBinaryFile
 * - Web fallback: download
 */
import PptxGenJS from 'pptxgenjs';
import { isTauri } from '@/lib/utils';

type Block =
  | { type: 'h1' | 'h2' | 'h3'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; text: string; language?: string };

function markdownToBlocks(md: string): Block[] {
  const lines = (md || '').split('\n');
  const blocks: Block[] = [];
  let inCode = false;
  let codeLang = '';
  let codeBuf: string[] = [];

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        blocks.push({ type: 'code', text: codeBuf.join('\n').trim(), language: codeLang || undefined });
        inCode = false;
        codeLang = '';
        codeBuf = [];
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('# ')) blocks.push({ type: 'h1', text: trimmed.slice(2).trim() });
    else if (trimmed.startsWith('## ')) blocks.push({ type: 'h2', text: trimmed.slice(3).trim() });
    else if (trimmed.startsWith('### ')) blocks.push({ type: 'h3', text: trimmed.slice(4).trim() });
    else if (/^[-*•]\s+/.test(trimmed)) blocks.push({ type: 'bullet', text: trimmed.replace(/^[-*•]\s+/, '') });
    else if (/^\d+[.)]\s+/.test(trimmed)) blocks.push({ type: 'numbered', text: trimmed.replace(/^\d+[.)]\s+/, '') });
    else blocks.push({ type: 'paragraph', text: trimmed });
  }

  // Close dangling code block if any
  if (inCode && codeBuf.length) {
    blocks.push({ type: 'code', text: codeBuf.join('\n').trim(), language: codeLang || undefined });
  }

  return blocks;
}

function stripInline(text: string): string {
  return (text || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1');
}

// =========================================================
// THEME (premium)
// =========================================================

const THEME = {
  // Palette "premium dark"
  bg: '0B0B10',
  panel: '141421',
  panel2: '10101A',
  border: '24243A',
  text: 'F8FAFC',
  muted: 'A1A1AA',
  accent: '7C3AED', // violet
  accent2: '3B82F6', // blue
  good: '10B981',
};

type SlideKind = 'cover' | 'content';

function addBackground(slide: any, kind: SlideKind) {
  slide.background = { color: THEME.bg };
  // subtle gradient-ish bands using shapes
  slide.addShape(PptxGenJS.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: THEME.bg } });
  slide.addShape(PptxGenJS.ShapeType.rect, { x: -1, y: -1, w: 9, h: 4, fill: { color: THEME.panel2, transparency: 55 } });
  slide.addShape(PptxGenJS.ShapeType.rect, { x: 8.5, y: 4.2, w: 6, h: 4.5, fill: { color: THEME.panel, transparency: 55 } });
  if (kind === 'cover') {
    slide.addShape(PptxGenJS.ShapeType.roundRect, {
      x: 0.75, y: 0.85, w: 11.8, h: 0.12,
      fill: { color: THEME.accent, transparency: 40 },
      line: { color: THEME.accent, transparency: 60 },
    });
  }
}

function addFooter(slide: any, title?: string) {
  const date = new Date().toLocaleDateString('fr-FR');
  slide.addShape(PptxGenJS.ShapeType.rect, {
    x: 0, y: 7.18, w: 13.333, h: 0.32,
    fill: { color: THEME.panel, transparency: 20 },
    line: { color: THEME.border, transparency: 30 },
  });
  slide.addText('ANZAR', {
    x: 0.55, y: 7.23, w: 2.0, h: 0.22,
    fontFace: 'Calibri',
    fontSize: 10,
    color: THEME.muted,
  });
  slide.addText(title ? stripInline(title).slice(0, 44) : '', {
    x: 2.3, y: 7.23, w: 8.5, h: 0.22,
    fontFace: 'Calibri',
    fontSize: 10,
    color: THEME.muted,
  });
  slide.addText(date, {
    x: 11.2, y: 7.23, w: 1.6, h: 0.22,
    align: 'right',
    fontFace: 'Calibri',
    fontSize: 10,
    color: THEME.muted,
  });
}

function chunkBullets(items: string[], maxPerSlide: number) {
  const chunks: string[][] = [];
  for (let i = 0; i < items.length; i += maxPerSlide) chunks.push(items.slice(i, i + maxPerSlide));
  return chunks;
}

// =========================================================
// EXPORT
// =========================================================

export async function exportToPptx(content: string, filename?: string): Promise<void> {
  const blocks = markdownToBlocks(content);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'ANZAR';

  const docTitle =
    blocks.find((b) => b.type === 'h1')?.text ||
    blocks.find((b) => b.type === 'h2')?.text ||
    'Présentation';

  // ---- Cover slide
  {
    const slide = pptx.addSlide();
    addBackground(slide, 'cover');

    slide.addText('ANZAR', {
      x: 0.9, y: 1.25, w: 4, h: 0.5,
      fontFace: 'Calibri',
      fontSize: 20,
      color: THEME.muted,
    });

    slide.addText(stripInline(docTitle), {
      x: 0.9, y: 2.0, w: 11.6, h: 1.3,
      fontFace: 'Calibri',
      fontSize: 42,
      bold: true,
      color: THEME.text,
    });

    slide.addShape(PptxGenJS.ShapeType.roundRect, {
      x: 0.9, y: 3.35, w: 5.3, h: 0.55,
      fill: { color: THEME.accent, transparency: 10 },
      line: { color: THEME.accent, transparency: 30 },
    });
    slide.addText('Document généré automatiquement', {
      x: 1.1, y: 3.48, w: 5.0, h: 0.3,
      fontFace: 'Calibri',
      fontSize: 14,
      color: THEME.text,
    });

    addFooter(slide, docTitle);
  }

  // Build slides from blocks
  // Strategy:
  // - Each H1/H2 starts a new slide with that title
  // - Subsequent bullets/paragraphs fill the slide; overflow creates additional slides
  const MAX_LINES = 10;
  const BULLETS_PER_SLIDE = 8;

  let currentTitle = 'Contenu';
  let bufferBullets: string[] = [];
  let bufferParagraphs: string[] = [];

  const flush = () => {
    const bulletsChunks = chunkBullets(bufferBullets, BULLETS_PER_SLIDE);
    const paraText = bufferParagraphs.map(stripInline).join('\n\n').trim();
    const hasBullets = bulletsChunks.length > 0 && bulletsChunks[0].length > 0;
    const hasPara = !!paraText;

    const makeSlide = (title: string, bullets: string[], para?: string, suffix?: string) => {
      const slide = pptx.addSlide();
      addBackground(slide, 'content');

      // Title
      slide.addText(stripInline(title) + (suffix ? ` ${suffix}` : ''), {
        x: 0.75, y: 0.6, w: 11.8, h: 0.6,
        fontFace: 'Calibri',
        fontSize: 28,
        bold: true,
        color: THEME.text,
      });
      slide.addShape(PptxGenJS.ShapeType.rect, {
        x: 0.75, y: 1.2, w: 11.8, h: 0.04,
        fill: { color: THEME.border, transparency: 15 },
        line: { color: THEME.border, transparency: 15 },
      });

      // Content panel
      slide.addShape(PptxGenJS.ShapeType.roundRect, {
        x: 0.75, y: 1.45, w: 11.8, h: 5.5,
        fill: { color: THEME.panel, transparency: 18 },
        line: { color: THEME.border, transparency: 35 },
      });

      const contentX = 1.05;
      const contentW = 11.2;
      let y = 1.75;

      if (para) {
        slide.addText(para, {
          x: contentX, y, w: contentW, h: 1.8,
          fontFace: 'Calibri',
          fontSize: 15,
          color: THEME.text,
          valign: 'top',
        });
        y += 1.9;
      }

      if (bullets.length) {
        const bulletRuns = bullets.map((t) => ({
          text: stripInline(t),
          options: { bullet: { indent: 18 }, hanging: 6 },
        }));
        slide.addText(bulletRuns as any, {
          x: contentX, y, w: contentW, h: 4.9,
          fontFace: 'Calibri',
          fontSize: 16,
          color: THEME.text,
          valign: 'top',
          lineSpacingMultiple: 1.15,
        });
      }

      addFooter(slide, docTitle);
    };

    // No content -> nothing
    if (!hasBullets && !hasPara) return;

    if (hasBullets) {
      bulletsChunks.forEach((chunk, idx) => {
        makeSlide(currentTitle, chunk, idx === 0 ? paraText : undefined, bulletsChunks.length > 1 ? `(${idx + 1}/${bulletsChunks.length})` : undefined);
      });
    } else {
      makeSlide(currentTitle, [], paraText);
    }

    bufferBullets = [];
    bufferParagraphs = [];
  };

  for (const b of blocks) {
    if (b.type === 'h1' || b.type === 'h2') {
      flush();
      currentTitle = b.text || currentTitle;
      continue;
    }
    if (b.type === 'h3') {
      // treat as emphasized paragraph heading inside same section
      bufferParagraphs.push(stripInline(b.text));
      continue;
    }
    if (b.type === 'bullet' || b.type === 'numbered') {
      bufferBullets.push(b.text);
      if (bufferBullets.length >= MAX_LINES) flush();
      continue;
    }
    if (b.type === 'code') {
      // Code block -> its own slide (premium code panel)
      flush();
      const slide = pptx.addSlide();
      addBackground(slide, 'content');
      slide.addText(stripInline(currentTitle) + ' — Code', {
        x: 0.75, y: 0.6, w: 11.8, h: 0.6,
        fontFace: 'Calibri',
        fontSize: 26,
        bold: true,
        color: THEME.text,
      });
      slide.addShape(PptxGenJS.ShapeType.roundRect, {
        x: 0.75, y: 1.45, w: 11.8, h: 5.5,
        fill: { color: THEME.panel, transparency: 10 },
        line: { color: THEME.border, transparency: 35 },
      });
      slide.addShape(PptxGenJS.ShapeType.roundRect, {
        x: 1.05, y: 1.75, w: 11.2, h: 5.0,
        fill: { color: '0F172A', transparency: 10 },
        line: { color: THEME.border, transparency: 25 },
      });
      slide.addText((b.text || '').slice(0, 3500), {
        x: 1.25, y: 1.95, w: 10.8, h: 4.6,
        fontFace: 'Consolas',
        fontSize: 12,
        color: 'E2E8F0',
        valign: 'top',
      });
      addFooter(slide, docTitle);
      continue;
    }
    // paragraph
    bufferParagraphs.push(stripInline(b.text));
    if (bufferParagraphs.join(' ').length > 900) flush();
  }
  flush();

  // Write
  const name = filename || `anzar_presentation_${Date.now()}.pptx`;
  const out = await pptx.write({ outputType: 'uint8array' });
  const bytes = normalizeToBytes(out);
  await saveBytes(bytes, name);
}

function normalizeToBytes(out: string | ArrayBuffer | Blob | Uint8Array): Uint8Array {
  if (out instanceof Uint8Array) return out;
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (typeof out === 'string') {
    // fallback: base64 string (rare) -> bytes
    const binary = atob(out);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  // Blob
  // Note: in browsers/Tauri, Blob#arrayBuffer exists
  // This helper is sync; blob case should not happen with outputType:uint8array but we handle safely
  throw new Error('Sortie PPTX inattendue (Blob).');
}

async function saveBytes(bytes: Uint8Array, filename: string): Promise<void> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/api/dialog');
    const { writeBinaryFile } = await import('@tauri-apps/api/fs');
    const { documentDir } = await import('@tauri-apps/api/path');
    const dir = await documentDir();
    const filePath = await save({
      defaultPath: `${dir}${filename}`,
      filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
    });
    if (filePath) {
      await writeBinaryFile(filePath, bytes);
    }
    return;
  }

  // Web fallback
  // Crée une copie pour garantir un ArrayBuffer standard (évite SharedArrayBuffer / ArrayBufferLike)
  const blob = new Blob([new Uint8Array(bytes).buffer], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
