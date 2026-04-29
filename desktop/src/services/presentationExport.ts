/**
 * presentationExport.ts — Export AI responses as premium PowerPoint (.pptx)
 *
 * Flow:
 * 1. Appel IA (backend proxy) pour restructurer le contenu en slides JSON
 * 2. Generation PPTX premium avec layouts varies (PptxGenJS)
 * 3. Sauvegarde via Tauri dialog ou browser download
 *
 * Design: dark premium, layouts varies, numerotation, transitions de section
 */
import PptxGenJS from 'pptxgenjs';
import { isTauri } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';

// PptxGenJS v4 shape constants with fallback
const RECT = PptxGenJS.ShapeType?.rect ?? ('rect' as any);
const RRECT = PptxGenJS.ShapeType?.roundRect ?? ('roundRect' as any);

// =========================================================
// TYPES — Structured slide plan (from AI or fallback parser)
// =========================================================

interface SlideData {
  layout: 'cover' | 'section' | 'bullets' | 'two-column' | 'quote' | 'code' | 'closing';
  title: string;
  subtitle?: string;
  bullets?: string[];
  leftBullets?: string[];
  rightBullets?: string[];
  paragraph?: string;
  quote?: string;
  quoteAuthor?: string;
  code?: string;
  codeLang?: string;
  notes?: string;
}

interface SlidePlan {
  title: string;
  slides: SlideData[];
}

// =========================================================
// CACHE — Avoid redundant AI calls for same content
// =========================================================
const _planCache = new Map<string, { plan: SlidePlan; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function hashContent(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}

function getCachedPlan(content: string): SlidePlan | null {
  const key = hashContent(content);
  const entry = _planCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.plan;
  if (entry) _planCache.delete(key);
  return null;
}

function cachePlan(content: string, plan: SlidePlan): void {
  const key = hashContent(content);
  _planCache.set(key, { plan, timestamp: Date.now() });
  if (_planCache.size > 20) {
    const oldest = _planCache.keys().next().value;
    if (oldest) _planCache.delete(oldest);
  }
}

// =========================================================
// THEME — Premium dark palette
// =========================================================

const T = {
  bg:       '0C0C14',
  surface:  '14142A',
  surface2: '1A1A36',
  border:   '2A2A4A',
  text:     'F0F2F8',
  textSub:  'B0B4C8',
  muted:    '7A7E96',
  accent:   '7C3AED',
  accent2:  '3B82F6',
  success:  '10B981',
  warm:     'F59E0B',
  font:     'Calibri',
  mono:     'Consolas',
};

// =========================================================
// AI STRUCTURING — Call backend to transform content into slide plan
// =========================================================

const STRUCTURING_PROMPT = `Tu es un expert en presentations professionnelles. Transforme le contenu suivant en un plan de slides PowerPoint structure.

REGLES:
- Maximum 12-15 slides (pas plus)
- Chaque slide a un layout parmi: "cover", "section", "bullets", "two-column", "quote", "code", "closing"
- Cover: titre principal + sous-titre
- Section: slide de transition entre les grandes parties (titre + subtitle)
- Bullets: titre + 4-6 points cles (pas plus de 6)
- Two-column: titre + leftBullets + rightBullets (2-4 items par colonne)
- Quote: citation marquante extraite du contenu + auteur si connu
- Code: bloc de code (si pertinent)
- Closing: slide de fin (titre = "Merci" ou resume, subtitle = message de cloture)
- Chaque bullet doit etre COURT (max 12 mots), percutant, synthétique
- Extrais les IDEES CLES, ne copie pas le texte brut
- La premiere slide est TOUJOURS "cover"
- La derniere slide est TOUJOURS "closing"
- Ajoute des slides "section" entre les grandes parties pour structurer

Reponds UNIQUEMENT en JSON valide, sans markdown, sans commentaire:
{
  "title": "Titre principal",
  "slides": [
    { "layout": "cover", "title": "...", "subtitle": "..." },
    { "layout": "section", "title": "Partie 1", "subtitle": "..." },
    { "layout": "bullets", "title": "...", "bullets": ["...", "..."] },
    { "layout": "two-column", "title": "...", "leftBullets": ["..."], "rightBullets": ["..."] },
    { "layout": "quote", "quote": "...", "quoteAuthor": "..." },
    { "layout": "closing", "title": "Merci", "subtitle": "..." }
  ]
}`;

async function structureWithAI(content: string): Promise<SlidePlan | null> {
  try {
    const store = useSettingsStore.getState();
    const backendUrl = store.getBackendUrl();
    const token = store.getAuthToken();
    if (!backendUrl || !token) return null;

    const res = await fetch(`${backendUrl}/api/deepseek/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: STRUCTURING_PROMPT },
          { role: 'user', content: content.slice(0, 12000) },
        ],
        temperature: 0.3,
        max_completion_tokens: 4000,
        response_format: { type: 'json_object' },
        stream: false,
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return null;

    const plan = JSON.parse(raw) as SlidePlan;
    if (!plan.slides || !Array.isArray(plan.slides) || plan.slides.length < 2) return null;

    return plan;
  } catch (err) {
    console.warn('AI structuring failed, using fallback:', err);
    return null;
  }
}

// =========================================================
// FALLBACK — Parse markdown into slides without AI
// =========================================================

function fallbackParsePlan(content: string): SlidePlan {
  const lines = (content || '').split('\n');
  const slides: SlideData[] = [];
  let docTitle = 'Presentation';
  let currentTitle = 'Contenu';
  let bullets: string[] = [];

  const flush = () => {
    if (bullets.length > 0) {
      // Split into chunks of 6
      for (let i = 0; i < bullets.length; i += 6) {
        slides.push({ layout: 'bullets', title: currentTitle, bullets: bullets.slice(i, i + 6) });
      }
      bullets = [];
    }
  };

  let inCode = false;
  let codeBuf: string[] = [];

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        flush();
        slides.push({ layout: 'code', title: currentTitle + ' — Code', code: codeBuf.join('\n').trim() });
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    const t = line.trim();
    if (!t) continue;

    if (t.startsWith('# ')) {
      flush();
      docTitle = strip(t.slice(2));
      currentTitle = docTitle;
    } else if (t.startsWith('## ')) {
      flush();
      currentTitle = strip(t.slice(3));
      slides.push({ layout: 'section', title: currentTitle });
    } else if (t.startsWith('### ')) {
      flush();
      currentTitle = strip(t.slice(4));
    } else if (/^[-*•]\s+/.test(t) || /^\d+[.)]\s+/.test(t)) {
      bullets.push(strip(t.replace(/^[-*•\d.)\s]+/, '')));
    } else {
      bullets.push(strip(t));
    }
  }
  flush();

  // Wrap with cover + closing
  slides.unshift({ layout: 'cover', title: docTitle, subtitle: 'Genere par ANZAR' });
  slides.push({ layout: 'closing', title: 'Merci', subtitle: 'Document genere automatiquement par ANZAR' });

  return { title: docTitle, slides };
}

function strip(text: string): string {
  return (text || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1');
}

// =========================================================
// SLIDE RENDERERS — Premium design
// =========================================================

function bg(slide: any) {
  slide.background = { color: T.bg };
  // Ambient shapes
  slide.addShape(RECT, { x: -2, y: -2, w: 10, h: 5, fill: { color: T.surface, transparency: 60 } });
  slide.addShape(RECT, { x: 7, y: 3.5, w: 8, h: 5, fill: { color: T.surface2, transparency: 60 } });
}

function footer(slide: any, title: string, num: number, total: number) {
  const date = new Date().toLocaleDateString('fr-FR');
  slide.addShape(RECT, { x: 0, y: 7.12, w: 13.333, h: 0.38, fill: { color: T.surface, transparency: 20 } });
  // Left: ANZAR branding
  slide.addText('ANZAR', { x: 0.6, y: 7.18, w: 1.5, h: 0.26, fontFace: T.font, fontSize: 9, bold: true, color: T.accent });
  // Center: title
  slide.addText(strip(title).slice(0, 50), { x: 2.5, y: 7.18, w: 8, h: 0.26, fontFace: T.font, fontSize: 9, color: T.muted, align: 'center' });
  // Right: page number + date
  slide.addText(`${num}/${total}  •  ${date}`, { x: 10.5, y: 7.18, w: 2.5, h: 0.26, fontFace: T.font, fontSize: 9, color: T.muted, align: 'right' });
}

// — Cover slide
function renderCover(pptx: PptxGenJS, s: SlideData, _n: number, _t: number, docTitle: string) {
  const slide = pptx.addSlide();
  bg(slide);

  // Top accent line
  slide.addShape(RRECT, { x: 0.8, y: 1.0, w: 11.7, h: 0.08, fill: { color: T.accent } });

  // Logo text
  slide.addText('ANZAR', { x: 0.9, y: 1.4, w: 3, h: 0.5, fontFace: T.font, fontSize: 18, bold: true, color: T.accent });

  // Main title
  slide.addText(strip(s.title), {
    x: 0.9, y: 2.2, w: 11.5, h: 1.8,
    fontFace: T.font, fontSize: 44, bold: true, color: T.text,
    valign: 'top',
  });

  // Subtitle badge
  if (s.subtitle) {
    slide.addShape(RRECT, {
      x: 0.9, y: 4.3, w: 6, h: 0.6,
      fill: { color: T.accent, transparency: 80 },
      line: { color: T.accent, transparency: 40, width: 1 },
      rectRadius: 0.1,
    });
    slide.addText(strip(s.subtitle), {
      x: 1.1, y: 4.35, w: 5.6, h: 0.5,
      fontFace: T.font, fontSize: 15, color: T.textSub,
    });
  }

  // Bottom accent line
  slide.addShape(RECT, { x: 0.8, y: 6.6, w: 11.7, h: 0.04, fill: { color: T.border } });

  // Date
  slide.addText(new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }), {
    x: 0.9, y: 6.8, w: 4, h: 0.3, fontFace: T.font, fontSize: 12, color: T.muted,
  });
}

// — Section transition slide
function renderSection(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bg(slide);

  // Big accent block on the left
  slide.addShape(RRECT, {
    x: 0.6, y: 1.5, w: 0.25, h: 3.5,
    fill: { color: T.accent },
    rectRadius: 0.08,
  });

  // Section title
  slide.addText(strip(s.title), {
    x: 1.4, y: 2.0, w: 11, h: 1.2,
    fontFace: T.font, fontSize: 38, bold: true, color: T.text,
  });

  // Subtitle
  if (s.subtitle) {
    slide.addText(strip(s.subtitle), {
      x: 1.4, y: 3.4, w: 10, h: 0.8,
      fontFace: T.font, fontSize: 18, color: T.textSub,
    });
  }

  footer(slide, docTitle, num, total);
}

// — Bullets slide (main content layout)
function renderBullets(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bg(slide);

  // Title
  slide.addText(strip(s.title), {
    x: 0.8, y: 0.5, w: 11.7, h: 0.7,
    fontFace: T.font, fontSize: 26, bold: true, color: T.text,
  });
  // Accent underline
  slide.addShape(RECT, { x: 0.8, y: 1.2, w: 3, h: 0.05, fill: { color: T.accent } });

  // Content panel
  slide.addShape(RRECT, {
    x: 0.8, y: 1.5, w: 11.7, h: 5.3,
    fill: { color: T.surface, transparency: 40 },
    line: { color: T.border, transparency: 50 },
    rectRadius: 0.15,
  });

  // Bullets
  const items = (s.bullets || []).slice(0, 8);
  if (items.length > 0) {
    const bulletRows = items.map((txt) => ({
      text: strip(txt),
      options: {
        fontFace: T.font, fontSize: 17, color: T.text,
        bullet: { type: 'number' as const, style: 'arabicPeriod' as const },
        paraSpaceAfter: 8,
      },
    }));
    slide.addText(bulletRows as any, {
      x: 1.2, y: 1.8, w: 10.8, h: 4.7,
      valign: 'top', lineSpacingMultiple: 1.25,
    });
  }

  // Paragraph text (if no bullets)
  if ((!items.length) && s.paragraph) {
    slide.addText(strip(s.paragraph), {
      x: 1.2, y: 1.8, w: 10.8, h: 4.7,
      fontFace: T.font, fontSize: 16, color: T.text, valign: 'top', lineSpacingMultiple: 1.4,
    });
  }

  footer(slide, docTitle, num, total);
}

// — Two-column layout
function renderTwoColumn(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bg(slide);

  // Title
  slide.addText(strip(s.title), {
    x: 0.8, y: 0.5, w: 11.7, h: 0.7,
    fontFace: T.font, fontSize: 26, bold: true, color: T.text,
  });
  slide.addShape(RECT, { x: 0.8, y: 1.2, w: 3, h: 0.05, fill: { color: T.accent } });

  // Left panel
  slide.addShape(RRECT, {
    x: 0.8, y: 1.5, w: 5.65, h: 5.3,
    fill: { color: T.surface, transparency: 35 },
    line: { color: T.border, transparency: 50 },
    rectRadius: 0.15,
  });

  // Right panel
  slide.addShape(RRECT, {
    x: 6.85, y: 1.5, w: 5.65, h: 5.3,
    fill: { color: T.surface2, transparency: 35 },
    line: { color: T.border, transparency: 50 },
    rectRadius: 0.15,
  });

  // Left bullets
  const leftItems = (s.leftBullets || []).slice(0, 5);
  if (leftItems.length) {
    const rows = leftItems.map((txt) => ({
      text: strip(txt),
      options: { fontFace: T.font, fontSize: 15, color: T.text, bullet: true, paraSpaceAfter: 6 },
    }));
    slide.addText(rows as any, { x: 1.1, y: 1.8, w: 5.0, h: 4.7, valign: 'top', lineSpacingMultiple: 1.2 });
  }

  // Right bullets
  const rightItems = (s.rightBullets || []).slice(0, 5);
  if (rightItems.length) {
    const rows = rightItems.map((txt) => ({
      text: strip(txt),
      options: { fontFace: T.font, fontSize: 15, color: T.text, bullet: true, paraSpaceAfter: 6 },
    }));
    slide.addText(rows as any, { x: 7.15, y: 1.8, w: 5.0, h: 4.7, valign: 'top', lineSpacingMultiple: 1.2 });
  }

  footer(slide, docTitle, num, total);
}

// — Quote slide
function renderQuote(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bg(slide);

  // Large quote mark
  slide.addText('“', {
    x: 0.5, y: 1.0, w: 2, h: 2,
    fontFace: 'Georgia', fontSize: 120, color: T.accent, bold: true,
    transparency: 30,
  });

  // Quote panel
  slide.addShape(RRECT, {
    x: 1.5, y: 2.0, w: 10.3, h: 3.5,
    fill: { color: T.surface, transparency: 30 },
    line: { color: T.accent, transparency: 60, width: 1 },
    rectRadius: 0.2,
  });

  // Quote text
  slide.addText(strip(s.quote || s.title), {
    x: 2.0, y: 2.3, w: 9.3, h: 2.2,
    fontFace: 'Georgia', fontSize: 22, italic: true, color: T.text,
    valign: 'middle', align: 'center', lineSpacingMultiple: 1.4,
  });

  // Author
  if (s.quoteAuthor) {
    slide.addText(`— ${strip(s.quoteAuthor)}`, {
      x: 2.0, y: 4.6, w: 9.3, h: 0.5,
      fontFace: T.font, fontSize: 14, color: T.accent, align: 'center',
    });
  }

  footer(slide, docTitle, num, total);
}

// — Code slide
function renderCode(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bg(slide);

  // Title
  slide.addText(strip(s.title), {
    x: 0.8, y: 0.5, w: 11.7, h: 0.7,
    fontFace: T.font, fontSize: 24, bold: true, color: T.text,
  });
  slide.addShape(RECT, { x: 0.8, y: 1.15, w: 2.5, h: 0.05, fill: { color: T.accent2 } });

  // Code panel (terminal-style)
  slide.addShape(RRECT, {
    x: 0.8, y: 1.4, w: 11.7, h: 5.4,
    fill: { color: '0A0E1A' },
    line: { color: T.border, transparency: 30 },
    rectRadius: 0.15,
  });

  // Terminal dots
  slide.addShape(RRECT, { x: 1.1, y: 1.6, w: 0.18, h: 0.18, fill: { color: 'FF5F57' }, rectRadius: 0.09 });
  slide.addShape(RRECT, { x: 1.4, y: 1.6, w: 0.18, h: 0.18, fill: { color: 'FEBC2E' }, rectRadius: 0.09 });
  slide.addShape(RRECT, { x: 1.7, y: 1.6, w: 0.18, h: 0.18, fill: { color: '28C840' }, rectRadius: 0.09 });

  // Language badge
  if (s.codeLang) {
    slide.addText(s.codeLang, {
      x: 10.5, y: 1.55, w: 1.5, h: 0.3,
      fontFace: T.mono, fontSize: 9, color: T.muted, align: 'right',
    });
  }

  // Code text
  slide.addText((s.code || '').slice(0, 3000), {
    x: 1.1, y: 2.0, w: 11.1, h: 4.5,
    fontFace: T.mono, fontSize: 11, color: 'E2E8F0', valign: 'top',
    lineSpacingMultiple: 1.2,
  });

  footer(slide, docTitle, num, total);
}

// — Closing slide
function renderClosing(pptx: PptxGenJS, s: SlideData, _n: number, _t: number, _d: string) {
  const slide = pptx.addSlide();
  bg(slide);

  // Accent line top
  slide.addShape(RECT, { x: 4.5, y: 2.0, w: 4.3, h: 0.06, fill: { color: T.accent } });

  // Thank you text
  slide.addText(strip(s.title || 'Merci'), {
    x: 1, y: 2.4, w: 11.3, h: 1.5,
    fontFace: T.font, fontSize: 48, bold: true, color: T.text, align: 'center',
  });

  // Subtitle
  if (s.subtitle) {
    slide.addText(strip(s.subtitle), {
      x: 2, y: 4.0, w: 9.3, h: 0.8,
      fontFace: T.font, fontSize: 16, color: T.textSub, align: 'center',
    });
  }

  // ANZAR branding
  slide.addShape(RRECT, {
    x: 5.1, y: 5.2, w: 3.1, h: 0.55,
    fill: { color: T.accent, transparency: 80 },
    line: { color: T.accent, transparency: 50, width: 1 },
    rectRadius: 0.1,
  });
  slide.addText('Genere par ANZAR', {
    x: 5.2, y: 5.25, w: 2.9, h: 0.45,
    fontFace: T.font, fontSize: 12, color: T.textSub, align: 'center',
  });

  // Date
  slide.addText(new Date().toLocaleDateString('fr-FR'), {
    x: 5, y: 5.9, w: 3.3, h: 0.3,
    fontFace: T.font, fontSize: 10, color: T.muted, align: 'center',
  });
}

// =========================================================
// MAIN EXPORT — Public API
// =========================================================

export async function exportToPptx(content: string, filename?: string): Promise<void> {
  // Step 1: Try AI structuring, fallback to markdown parser
  // Check cache first to avoid redundant AI calls
  let plan = getCachedPlan(content);
  if (!plan) {
    plan = await structureWithAI(content);
    if (plan) cachePlan(content, plan);
  }
  if (!plan) {
    plan = fallbackParsePlan(content);
  }

  // Step 2: Generate PPTX
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'ANZAR';
  pptx.title = strip(plan.title);

  const total = plan.slides.length;
  const docTitle = plan.title;

  for (let i = 0; i < plan.slides.length; i++) {
    const s = plan.slides[i];
    const num = i + 1;

    switch (s.layout) {
      case 'cover':
        renderCover(pptx, s, num, total, docTitle);
        break;
      case 'section':
        renderSection(pptx, s, num, total, docTitle);
        break;
      case 'bullets':
        renderBullets(pptx, s, num, total, docTitle);
        break;
      case 'two-column':
        renderTwoColumn(pptx, s, num, total, docTitle);
        break;
      case 'quote':
        renderQuote(pptx, s, num, total, docTitle);
        break;
      case 'code':
        renderCode(pptx, s, num, total, docTitle);
        break;
      case 'closing':
        renderClosing(pptx, s, num, total, docTitle);
        break;
      default:
        // Fallback: render as bullets
        renderBullets(pptx, { ...s, layout: 'bullets' }, num, total, docTitle);
    }
  }

  // Step 3: Save
  const name = filename || `anzar_presentation_${Date.now()}.pptx`;

  if (isTauri()) {
    await savePptxTauri(pptx, name);
  } else {
    await (pptx as any).writeFile({ fileName: name });
  }
}

// =========================================================
// FILE SAVING — Tauri save dialog
// =========================================================

async function savePptxTauri(pptx: PptxGenJS, filename: string): Promise<void> {
  let blob: Blob;
  try {
    blob = await (pptx.write as any)('blob') as Blob;
  } catch {
    const ab = await (pptx.write as any)('arraybuffer') as ArrayBuffer;
    blob = new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  }

  const { save } = await import('@tauri-apps/api/dialog');
  const { writeBinaryFile } = await import('@tauri-apps/api/fs');

  let defaultPath = filename;
  try {
    const { documentDir } = await import('@tauri-apps/api/path');
    const dir = await documentDir();
    defaultPath = `${dir}${filename}`;
  } catch {
    // documentDir may fail — use filename alone
  }

  const filePath = await save({
    defaultPath,
    filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
  });

  if (filePath) {
    const buffer = await blob.arrayBuffer();
    await writeBinaryFile(filePath, new Uint8Array(buffer));
  }
}
