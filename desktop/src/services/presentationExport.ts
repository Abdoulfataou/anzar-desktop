/**
 * presentationExport.ts — Export AI responses as premium PowerPoint (.pptx)
 *
 * Flow:
 * 1. Appel IA (backend proxy) pour restructurer le contenu en slides JSON
 * 2. Generation PPTX premium avec 10+ layouts varies (PptxGenJS)
 * 3. Sauvegarde via Tauri dialog ou browser download
 *
 * Design: theme premium moderne, ombres, layouts varies, support memoire complet
 */
import PptxGenJS from 'pptxgenjs';
import { isTauri } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';

// PptxGenJS v4 shape constants with fallback
const RECT = PptxGenJS.ShapeType?.rect ?? ('rect' as any);
const RRECT = PptxGenJS.ShapeType?.roundRect ?? ('roundRect' as any);
const OVAL = PptxGenJS.ShapeType?.ellipse ?? ('ellipse' as any);

// =========================================================
// TYPES — Structured slide plan (from AI or fallback parser)
// =========================================================

interface SlideData {
  layout:
    | 'cover'
    | 'toc'
    | 'section'
    | 'bullets'
    | 'two-column'
    | 'three-cards'
    | 'stats'
    | 'timeline'
    | 'quote'
    | 'image-text'
    | 'comparison'
    | 'code'
    | 'closing';
  title: string;
  subtitle?: string;
  bullets?: string[];
  leftTitle?: string;
  rightTitle?: string;
  leftBullets?: string[];
  rightBullets?: string[];
  paragraph?: string;
  quote?: string;
  quoteAuthor?: string;
  code?: string;
  codeLang?: string;
  stats?: { value: string; label: string }[];
  steps?: { title: string; desc: string }[];
  cards?: { title: string; bullets: string[] }[];
  tocItems?: string[];
  compLeft?: { title: string; items: string[] };
  compRight?: { title: string; items: string[] };
  imageDesc?: string;
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
const CACHE_TTL = 10 * 60 * 1000;

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
// THEME — Premium modern palette (Midnight Executive)
// =========================================================

const T = {
  // Backgrounds
  bg:        '0B1120',   // Deep navy
  bgAlt:     '111B33',   // Slightly lighter navy
  surface:   '162040',   // Card surface
  surface2:  '1C2850',   // Lighter card
  surface3:  '243060',   // Hover state
  // Borders
  border:    '2A3A5E',
  borderSub: '1E2E50',
  // Text
  text:      'F8FAFC',   // Pure white
  textSub:   'CBD5E1',   // Light slate
  muted:     '8892A8',   // Muted slate
  dim:       '64748B',   // Very muted
  // Accents
  primary:   '6366F1',   // Indigo
  primaryLt: '818CF8',   // Light indigo
  primaryBg: '312E81',   // Dark indigo bg
  accent:    '06B6D4',   // Cyan
  accentLt:  '22D3EE',   // Light cyan
  accentBg:  '083344',   // Dark cyan bg
  success:   '10B981',   // Emerald
  successBg: '064E3B',   // Dark emerald bg
  warm:      'F59E0B',   // Amber
  warmBg:    '78350F',   // Dark amber bg
  rose:      'F43F5E',   // Rose
  roseBg:    '881337',   // Dark rose bg
  violet:    'A78BFA',   // Violet
  // Typography
  font:      'Calibri',
  fontAlt:   'Trebuchet MS',
  mono:      'Consolas',
};

// Color cycles for cards, stats, etc.
const CARD_COLORS = [
  { accent: T.primary, bg: T.primaryBg },
  { accent: T.accent,  bg: T.accentBg },
  { accent: T.success, bg: T.successBg },
  { accent: T.warm,    bg: T.warmBg },
  { accent: T.rose,    bg: T.roseBg },
];

// =========================================================
// SHADOW FACTORY — Fresh object each time (PptxGenJS mutates)
// =========================================================

const mkShadow = () => ({
  type: 'outer' as const,
  color: '000000',
  blur: 8,
  offset: 3,
  angle: 135,
  opacity: 0.25,
});

const mkSoftShadow = () => ({
  type: 'outer' as const,
  color: '000000',
  blur: 12,
  offset: 4,
  angle: 135,
  opacity: 0.18,
});

// =========================================================
// AI STRUCTURING — Call backend to transform content into slide plan
// =========================================================

const STRUCTURING_PROMPT = `Tu es un designer de presentations PowerPoint haut de gamme. Transforme le contenu suivant en un plan de slides structure, moderne et visuellement varie.

LAYOUTS DISPONIBLES:
- "cover": Premiere slide. Titre principal + sous-titre (accroche ou contexte).
- "toc": Table des matieres. tocItems = liste des grandes parties (4-8 items max).
- "section": Slide de transition entre grandes parties. Titre + subtitle.
- "bullets": Contenu principal. Titre + 4-6 bullets courts et percutants (max 15 mots chacun).
- "two-column": Comparaison ou 2 aspects. Titre + leftTitle + leftBullets + rightTitle + rightBullets (3-4 items par colonne).
- "three-cards": 3 concepts cles. cards = [{title, bullets: [2-3 items]}] exactement 3 cartes.
- "stats": Chiffres cles / donnees marquantes. stats = [{value: "85%", label: "Taux de reussite"}] (3-4 stats max).
- "timeline": Etapes chronologiques. steps = [{title: "Etape 1", desc: "Description courte"}] (3-5 etapes).
- "comparison": Comparaison structuree. compLeft = {title, items: [...]} + compRight = {title, items: [...]}.
- "quote": Citation marquante. quote + quoteAuthor.
- "image-text": Slide mixte (image placeholder + texte). title + bullets (3-4) + imageDesc (description de l'image suggeree).
- "code": Bloc de code technique (si pertinent). code + codeLang.
- "closing": Derniere slide. Titre (resume/remerciement) + subtitle.

REGLES DE DESIGN:
1. 15-25 slides pour un memoire/long document, 10-15 pour un contenu court
2. PREMIERE slide = "cover", DERNIERE = "closing"
3. Slide 2 = "toc" (sommaire) si le contenu a 3+ grandes parties
4. Alterner les layouts: JAMAIS 3 slides "bullets" consecutives. Intercaler stats, two-column, three-cards, timeline, quote.
5. Chaque grande partie commence par une slide "section"
6. Au moins 1 slide "stats" si le contenu contient des donnees chiffrees
7. Au moins 1 slide "quote" si le contenu contient une citation ou idee forte
8. Utiliser "three-cards" pour les listes de 3 concepts, avantages, ou categories
9. Utiliser "timeline" pour les processus, methodologies, etapes historiques
10. Utiliser "comparison" pour les pour/contre, avant/apres, methodeA/methodeB
11. Chaque bullet = MAX 15 mots, percutant et synthetique. Pas de phrases longues.
12. Extraire les IDEES CLES, ne pas copier le texte brut

POUR UN MEMOIRE:
- Cover = Titre du memoire + Sous-titre (filiere, annee, auteur si mentionne)
- TOC = Les grandes parties du memoire
- Introduction = bullets ou paragraph
- Revue de litterature = three-cards ou two-column ou timeline selon le contenu
- Methodologie = timeline ou bullets
- Resultats = stats + bullets ou two-column
- Discussion = comparison ou bullets
- Conclusion = bullets
- Closing = Merci + Perspectives

Reponds UNIQUEMENT en JSON valide, sans markdown, sans commentaire:
{
  "title": "Titre principal",
  "slides": [
    { "layout": "cover", "title": "...", "subtitle": "..." },
    { "layout": "toc", "title": "Sommaire", "tocItems": ["Intro", "Partie 1", "..."] },
    { "layout": "section", "title": "Introduction", "subtitle": "Contexte et problematique" },
    { "layout": "bullets", "title": "...", "bullets": ["...", "..."] },
    { "layout": "stats", "title": "Chiffres cles", "stats": [{"value": "85%", "label": "..."}] },
    { "layout": "three-cards", "title": "...", "cards": [{"title": "...", "bullets": ["..."]}] },
    { "layout": "timeline", "title": "Methodologie", "steps": [{"title": "...", "desc": "..."}] },
    { "layout": "two-column", "title": "...", "leftTitle": "...", "rightTitle": "...", "leftBullets": ["..."], "rightBullets": ["..."] },
    { "layout": "comparison", "title": "...", "compLeft": {"title": "...", "items": ["..."]}, "compRight": {"title": "...", "items": ["..."]} },
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

    // Send up to 30K chars for better structuring of long documents (memoires)
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
          { role: 'user', content: content.slice(0, 30000) },
        ],
        temperature: 0.3,
        max_completion_tokens: 6000,
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
  const tocItems: string[] = [];

  const flush = () => {
    if (bullets.length > 0) {
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
      tocItems.push(currentTitle);
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

  // Wrap with cover + toc + closing
  slides.unshift({ layout: 'cover', title: docTitle, subtitle: 'Genere par ANZAR' });
  if (tocItems.length >= 3) {
    slides.splice(1, 0, { layout: 'toc', title: 'Sommaire', tocItems });
  }
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
// BACKGROUND HELPERS
// =========================================================

/** Main slide background with subtle gradient-like effect */
function bgMain(slide: any) {
  slide.background = { color: T.bg };
  // Subtle radial glow top-right (simulates gradient)
  slide.addShape(OVAL, {
    x: 7, y: -3, w: 10, h: 8,
    fill: { color: T.primaryBg, transparency: 75 },
  });
  // Subtle glow bottom-left
  slide.addShape(OVAL, {
    x: -4, y: 4, w: 8, h: 6,
    fill: { color: T.accentBg, transparency: 80 },
  });
}

/** Accent background for section/special slides */
function bgAccent(slide: any) {
  slide.background = { color: T.bgAlt };
  slide.addShape(OVAL, {
    x: 8, y: -2, w: 9, h: 7,
    fill: { color: T.primaryBg, transparency: 65 },
  });
}

/** Footer bar */
function footer(slide: any, title: string, num: number, total: number) {
  const date = new Date().toLocaleDateString('fr-FR');
  // Thin top line
  slide.addShape(RECT, { x: 0, y: 7.08, w: 13.333, h: 0.015, fill: { color: T.border } });
  // Footer bg
  slide.addShape(RECT, { x: 0, y: 7.095, w: 13.333, h: 0.405, fill: { color: T.bg, transparency: 30 } });
  // Left: ANZAR branding
  slide.addText('ANZAR', { x: 0.6, y: 7.15, w: 1.5, h: 0.26, margin: 0, fontFace: T.font, fontSize: 9, bold: true, color: T.primary });
  // Center: title
  slide.addText(strip(title).slice(0, 55), { x: 2.5, y: 7.15, w: 8, h: 0.26, margin: 0, fontFace: T.font, fontSize: 8, color: T.dim, align: 'center' });
  // Right: page + date
  slide.addText(`${num} / ${total}  ·  ${date}`, { x: 10.5, y: 7.15, w: 2.5, h: 0.26, margin: 0, fontFace: T.font, fontSize: 8, color: T.dim, align: 'right' });
}

// =========================================================
// SLIDE RENDERERS
// =========================================================

// — Cover slide (hero)
function renderCover(pptx: PptxGenJS, s: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: T.bg };

  // Large accent glow
  slide.addShape(OVAL, {
    x: 5, y: -2, w: 12, h: 9,
    fill: { color: T.primaryBg, transparency: 60 },
  });
  slide.addShape(OVAL, {
    x: -3, y: 4, w: 10, h: 7,
    fill: { color: T.accentBg, transparency: 70 },
  });

  // Top bar accent
  slide.addShape(RECT, { x: 0, y: 0, w: 13.333, h: 0.06, fill: { color: T.primary } });

  // ANZAR logo text
  slide.addText('ANZAR', {
    x: 0.8, y: 0.6, w: 3, h: 0.5, margin: 0,
    fontFace: T.fontAlt, fontSize: 16, bold: true, color: T.primary,
    charSpacing: 6,
  });

  // Decorative pill
  slide.addShape(RRECT, {
    x: 0.8, y: 1.5, w: 0.5, h: 0.08, fill: { color: T.accent }, rectRadius: 0.04,
  });

  // Main title
  slide.addText(strip(s.title), {
    x: 0.8, y: 2.0, w: 11.5, h: 2.2, margin: 0,
    fontFace: T.fontAlt, fontSize: 42, bold: true, color: T.text,
    valign: 'top', lineSpacingMultiple: 1.1,
  });

  // Subtitle with left accent bar
  if (s.subtitle) {
    slide.addShape(RECT, { x: 0.8, y: 4.6, w: 0.06, h: 0.7, fill: { color: T.accent } });
    slide.addText(strip(s.subtitle), {
      x: 1.15, y: 4.55, w: 10, h: 0.8, margin: 0,
      fontFace: T.font, fontSize: 17, color: T.textSub,
      lineSpacingMultiple: 1.3,
    });
  }

  // Bottom bar with date
  slide.addShape(RECT, { x: 0, y: 6.8, w: 13.333, h: 0.02, fill: { color: T.border } });
  const dateStr = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
  slide.addText(dateStr, {
    x: 0.8, y: 6.95, w: 5, h: 0.35, margin: 0,
    fontFace: T.font, fontSize: 11, color: T.muted,
  });
  slide.addText('Genere par ANZAR', {
    x: 8, y: 6.95, w: 4.5, h: 0.35, margin: 0,
    fontFace: T.font, fontSize: 11, color: T.dim, align: 'right',
  });
}

// — Table of Contents
function renderToc(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bgMain(slide);

  // Title
  slide.addText(strip(s.title || 'Sommaire'), {
    x: 0.8, y: 0.45, w: 8, h: 0.7, margin: 0,
    fontFace: T.fontAlt, fontSize: 28, bold: true, color: T.text,
  });
  slide.addShape(RECT, { x: 0.8, y: 1.15, w: 2.5, h: 0.05, fill: { color: T.primary } });

  const items = (s.tocItems || s.bullets || []).slice(0, 10);
  const startY = 1.6;
  const rowH = 0.52;

  items.forEach((item, i) => {
    const y = startY + i * rowH;
    const clr = CARD_COLORS[i % CARD_COLORS.length];

    // Number circle
    slide.addShape(OVAL, {
      x: 1.0, y: y + 0.05, w: 0.38, h: 0.38,
      fill: { color: clr.bg },
    });
    slide.addText(`${i + 1}`, {
      x: 1.0, y: y + 0.05, w: 0.38, h: 0.38, margin: 0,
      fontFace: T.font, fontSize: 13, bold: true, color: clr.accent,
      align: 'center', valign: 'middle',
    });

    // Item text
    slide.addText(strip(item), {
      x: 1.6, y: y, w: 10, h: 0.48, margin: 0,
      fontFace: T.font, fontSize: 16, color: T.text, valign: 'middle',
    });

    // Subtle separator
    if (i < items.length - 1) {
      slide.addShape(RECT, { x: 1.6, y: y + rowH - 0.02, w: 10.5, h: 0.01, fill: { color: T.borderSub } });
    }
  });

  footer(slide, docTitle, num, total);
}

// — Section transition slide
function renderSection(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bgAccent(slide);

  // Large section number
  slide.addText(`${String(num).padStart(2, '0')}`, {
    x: 0.8, y: 1.0, w: 3, h: 2, margin: 0,
    fontFace: T.fontAlt, fontSize: 72, bold: true, color: T.primary, transparency: 40,
  });

  // Left accent bar
  slide.addShape(RECT, {
    x: 0.8, y: 3.2, w: 0.08, h: 1.8, fill: { color: T.primary },
  });

  // Section title
  slide.addText(strip(s.title), {
    x: 1.2, y: 3.1, w: 11, h: 1.2, margin: 0,
    fontFace: T.fontAlt, fontSize: 36, bold: true, color: T.text,
    valign: 'middle',
  });

  // Subtitle
  if (s.subtitle) {
    slide.addText(strip(s.subtitle), {
      x: 1.2, y: 4.3, w: 10, h: 0.7, margin: 0,
      fontFace: T.font, fontSize: 17, color: T.textSub,
    });
  }

  footer(slide, docTitle, num, total);
}

// — Bullets slide (main content)
function renderBullets(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bgMain(slide);

  // Title
  slide.addText(strip(s.title), {
    x: 0.8, y: 0.45, w: 11.7, h: 0.7, margin: 0,
    fontFace: T.fontAlt, fontSize: 26, bold: true, color: T.text,
  });
  // Accent pill under title
  slide.addShape(RRECT, { x: 0.8, y: 1.15, w: 2, h: 0.05, fill: { color: T.primary }, rectRadius: 0.025 });

  // Content card
  slide.addShape(RECT, {
    x: 0.8, y: 1.5, w: 11.7, h: 5.3,
    fill: { color: T.surface, transparency: 50 },
    shadow: mkSoftShadow(),
  });
  // Left accent strip on card
  slide.addShape(RECT, { x: 0.8, y: 1.5, w: 0.06, h: 5.3, fill: { color: T.primary } });

  // Bullets with colored numbers
  const items = (s.bullets || []).slice(0, 8);
  if (items.length > 0) {
    const bulletY = 1.8;
    const itemH = items.length <= 4 ? 1.1 : (items.length <= 6 ? 0.78 : 0.62);

    items.forEach((txt, i) => {
      const y = bulletY + i * itemH;
      const clr = CARD_COLORS[i % CARD_COLORS.length];

      // Number badge
      slide.addShape(RRECT, {
        x: 1.2, y: y + 0.08, w: 0.4, h: 0.4,
        fill: { color: clr.bg }, rectRadius: 0.08,
      });
      slide.addText(`${i + 1}`, {
        x: 1.2, y: y + 0.08, w: 0.4, h: 0.4, margin: 0,
        fontFace: T.font, fontSize: 13, bold: true, color: clr.accent,
        align: 'center', valign: 'middle',
      });

      // Text
      slide.addText(strip(txt), {
        x: 1.85, y: y, w: 10.2, h: itemH, margin: 0,
        fontFace: T.font, fontSize: 16, color: T.text,
        valign: 'middle', lineSpacingMultiple: 1.2,
      });
    });
  }

  // Paragraph text fallback
  if ((!items.length) && s.paragraph) {
    slide.addText(strip(s.paragraph), {
      x: 1.2, y: 1.8, w: 10.8, h: 4.7, margin: 0,
      fontFace: T.font, fontSize: 16, color: T.text, valign: 'top', lineSpacingMultiple: 1.5,
    });
  }

  footer(slide, docTitle, num, total);
}

// — Two-column layout
function renderTwoColumn(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bgMain(slide);

  // Title
  slide.addText(strip(s.title), {
    x: 0.8, y: 0.45, w: 11.7, h: 0.7, margin: 0,
    fontFace: T.fontAlt, fontSize: 26, bold: true, color: T.text,
  });
  slide.addShape(RRECT, { x: 0.8, y: 1.15, w: 2, h: 0.05, fill: { color: T.primary }, rectRadius: 0.025 });

  // Left card
  slide.addShape(RECT, {
    x: 0.8, y: 1.5, w: 5.65, h: 5.3,
    fill: { color: T.surface, transparency: 40 },
    shadow: mkShadow(),
  });
  slide.addShape(RECT, { x: 0.8, y: 1.5, w: 5.65, h: 0.06, fill: { color: T.primary } });

  // Left title
  if (s.leftTitle) {
    slide.addText(strip(s.leftTitle), {
      x: 1.1, y: 1.7, w: 5.0, h: 0.45, margin: 0,
      fontFace: T.font, fontSize: 15, bold: true, color: T.primaryLt,
    });
  }

  // Right card
  slide.addShape(RECT, {
    x: 6.85, y: 1.5, w: 5.65, h: 5.3,
    fill: { color: T.surface, transparency: 40 },
    shadow: mkShadow(),
  });
  slide.addShape(RECT, { x: 6.85, y: 1.5, w: 5.65, h: 0.06, fill: { color: T.accent } });

  // Right title
  if (s.rightTitle) {
    slide.addText(strip(s.rightTitle), {
      x: 7.15, y: 1.7, w: 5.0, h: 0.45, margin: 0,
      fontFace: T.font, fontSize: 15, bold: true, color: T.accentLt,
    });
  }

  const bulletStartY = s.leftTitle || s.rightTitle ? 2.3 : 1.8;

  // Left bullets
  const leftItems = (s.leftBullets || []).slice(0, 6);
  if (leftItems.length) {
    const rows = leftItems.map((txt) => ({
      text: strip(txt),
      options: { fontFace: T.font, fontSize: 14, color: T.text, bullet: true, paraSpaceAfter: 8, breakLine: true },
    }));
    slide.addText(rows as any, { x: 1.1, y: bulletStartY, w: 5.0, h: 4.2, valign: 'top', lineSpacingMultiple: 1.25 });
  }

  // Right bullets
  const rightItems = (s.rightBullets || []).slice(0, 6);
  if (rightItems.length) {
    const rows = rightItems.map((txt) => ({
      text: strip(txt),
      options: { fontFace: T.font, fontSize: 14, color: T.text, bullet: true, paraSpaceAfter: 8, breakLine: true },
    }));
    slide.addText(rows as any, { x: 7.15, y: bulletStartY, w: 5.0, h: 4.2, valign: 'top', lineSpacingMultiple: 1.25 });
  }

  footer(slide, docTitle, num, total);
}

// — Three cards layout
function renderThreeCards(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bgMain(slide);

  // Title
  slide.addText(strip(s.title), {
    x: 0.8, y: 0.45, w: 11.7, h: 0.7, margin: 0,
    fontFace: T.fontAlt, fontSize: 26, bold: true, color: T.text,
  });
  slide.addShape(RRECT, { x: 0.8, y: 1.15, w: 2, h: 0.05, fill: { color: T.primary }, rectRadius: 0.025 });

  const cards = (s.cards || []).slice(0, 3);
  const cardW = 3.6;
  const gap = 0.35;
  const startX = 0.8;
  const cardY = 1.5;
  const cardH = 5.3;

  cards.forEach((card, i) => {
    const x = startX + i * (cardW + gap);
    const clr = CARD_COLORS[i % CARD_COLORS.length];

    // Card background
    slide.addShape(RECT, {
      x, y: cardY, w: cardW, h: cardH,
      fill: { color: T.surface, transparency: 35 },
      shadow: mkShadow(),
    });

    // Top accent bar
    slide.addShape(RECT, { x, y: cardY, w: cardW, h: 0.06, fill: { color: clr.accent } });

    // Card number circle
    slide.addShape(OVAL, {
      x: x + cardW / 2 - 0.3, y: cardY + 0.3, w: 0.6, h: 0.6,
      fill: { color: clr.bg },
    });
    slide.addText(`${i + 1}`, {
      x: x + cardW / 2 - 0.3, y: cardY + 0.3, w: 0.6, h: 0.6, margin: 0,
      fontFace: T.font, fontSize: 18, bold: true, color: clr.accent,
      align: 'center', valign: 'middle',
    });

    // Card title
    slide.addText(strip(card.title), {
      x: x + 0.25, y: cardY + 1.1, w: cardW - 0.5, h: 0.55, margin: 0,
      fontFace: T.font, fontSize: 15, bold: true, color: T.text,
      align: 'center',
    });

    // Separator
    slide.addShape(RECT, {
      x: x + cardW / 2 - 0.8, y: cardY + 1.7, w: 1.6, h: 0.02,
      fill: { color: clr.accent, transparency: 50 },
    });

    // Card bullets
    const cardBullets = (card.bullets || []).slice(0, 4);
    if (cardBullets.length) {
      const rows = cardBullets.map((txt) => ({
        text: strip(txt),
        options: { fontFace: T.font, fontSize: 12, color: T.textSub, bullet: true, paraSpaceAfter: 6, breakLine: true },
      }));
      slide.addText(rows as any, {
        x: x + 0.25, y: cardY + 1.9, w: cardW - 0.5, h: 3.1,
        valign: 'top', lineSpacingMultiple: 1.2,
      });
    }
  });

  footer(slide, docTitle, num, total);
}

// — Stats slide (big numbers)
function renderStats(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bgAccent(slide);

  // Title
  slide.addText(strip(s.title), {
    x: 0.8, y: 0.45, w: 11.7, h: 0.7, margin: 0,
    fontFace: T.fontAlt, fontSize: 26, bold: true, color: T.text,
  });
  slide.addShape(RRECT, { x: 0.8, y: 1.15, w: 2, h: 0.05, fill: { color: T.accent }, rectRadius: 0.025 });

  const stats = (s.stats || []).slice(0, 4);
  const count = stats.length || 1;
  const cardW = count <= 2 ? 5 : (count === 3 ? 3.6 : 2.7);
  const gap = 0.4;
  const totalW = count * cardW + (count - 1) * gap;
  const startX = (13.333 - totalW) / 2;
  const cardY = 2.2;
  const cardH = 4.0;

  stats.forEach((stat, i) => {
    const x = startX + i * (cardW + gap);
    const clr = CARD_COLORS[i % CARD_COLORS.length];

    // Card
    slide.addShape(RECT, {
      x, y: cardY, w: cardW, h: cardH,
      fill: { color: T.surface, transparency: 30 },
      shadow: mkShadow(),
    });

    // Top accent
    slide.addShape(RECT, { x, y: cardY, w: cardW, h: 0.06, fill: { color: clr.accent } });

    // Big number
    slide.addText(strip(stat.value), {
      x: x + 0.2, y: cardY + 0.5, w: cardW - 0.4, h: 1.8, margin: 0,
      fontFace: T.fontAlt, fontSize: 48, bold: true, color: clr.accent,
      align: 'center', valign: 'middle',
    });

    // Separator
    slide.addShape(RECT, {
      x: x + cardW / 2 - 0.6, y: cardY + 2.4, w: 1.2, h: 0.02,
      fill: { color: clr.accent, transparency: 50 },
    });

    // Label
    slide.addText(strip(stat.label), {
      x: x + 0.2, y: cardY + 2.6, w: cardW - 0.4, h: 1.0, margin: 0,
      fontFace: T.font, fontSize: 14, color: T.textSub,
      align: 'center', valign: 'top', lineSpacingMultiple: 1.3,
    });
  });

  footer(slide, docTitle, num, total);
}

// — Timeline / steps slide
function renderTimeline(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bgMain(slide);

  // Title
  slide.addText(strip(s.title), {
    x: 0.8, y: 0.45, w: 11.7, h: 0.7, margin: 0,
    fontFace: T.fontAlt, fontSize: 26, bold: true, color: T.text,
  });
  slide.addShape(RRECT, { x: 0.8, y: 1.15, w: 2, h: 0.05, fill: { color: T.primary }, rectRadius: 0.025 });

  const steps = (s.steps || []).slice(0, 5);
  const count = steps.length || 1;

  // Horizontal timeline line
  const lineY = 3.2;
  const lineStartX = 1.5;
  const lineEndX = 11.8;
  slide.addShape(RECT, {
    x: lineStartX, y: lineY, w: lineEndX - lineStartX, h: 0.03,
    fill: { color: T.border },
  });

  const stepW = (lineEndX - lineStartX) / count;

  steps.forEach((step, i) => {
    const cx = lineStartX + i * stepW + stepW / 2;
    const clr = CARD_COLORS[i % CARD_COLORS.length];

    // Circle node on timeline
    slide.addShape(OVAL, {
      x: cx - 0.25, y: lineY - 0.22, w: 0.5, h: 0.5,
      fill: { color: clr.accent },
      shadow: mkShadow(),
    });
    slide.addText(`${i + 1}`, {
      x: cx - 0.25, y: lineY - 0.22, w: 0.5, h: 0.5, margin: 0,
      fontFace: T.font, fontSize: 14, bold: true, color: T.text,
      align: 'center', valign: 'middle',
    });

    // Step title (above for even, below for odd to stagger)
    const isAbove = i % 2 === 0;
    const titleY = isAbove ? 1.6 : 3.8;
    const descY = isAbove ? 2.1 : 4.3;

    slide.addText(strip(step.title), {
      x: cx - stepW / 2 + 0.1, y: titleY, w: stepW - 0.2, h: 0.5, margin: 0,
      fontFace: T.font, fontSize: 13, bold: true, color: clr.accent,
      align: 'center',
    });

    // Connector line from circle to text
    if (isAbove) {
      slide.addShape(RECT, { x: cx - 0.01, y: titleY + 0.5, w: 0.02, h: lineY - titleY - 0.5 - 0.22, fill: { color: T.borderSub } });
    } else {
      slide.addShape(RECT, { x: cx - 0.01, y: lineY + 0.28, w: 0.02, h: titleY - lineY - 0.28, fill: { color: T.borderSub } });
    }

    slide.addText(strip(step.desc), {
      x: cx - stepW / 2 + 0.1, y: descY, w: stepW - 0.2, h: 0.9, margin: 0,
      fontFace: T.font, fontSize: 11, color: T.textSub,
      align: 'center', lineSpacingMultiple: 1.2,
    });
  });

  footer(slide, docTitle, num, total);
}

// — Quote slide
function renderQuote(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bgAccent(slide);

  // Large decorative quote mark
  slide.addText('“', {
    x: 0.5, y: 0.8, w: 3, h: 2.5, margin: 0,
    fontFace: 'Georgia', fontSize: 140, color: T.primary, bold: true, transparency: 60,
  });

  // Quote card
  slide.addShape(RECT, {
    x: 1.5, y: 2.2, w: 10.3, h: 3.2,
    fill: { color: T.surface, transparency: 30 },
    shadow: mkSoftShadow(),
  });
  // Left accent on card
  slide.addShape(RECT, { x: 1.5, y: 2.2, w: 0.06, h: 3.2, fill: { color: T.primary } });

  // Quote text
  slide.addText(strip(s.quote || s.title), {
    x: 2.0, y: 2.5, w: 9.3, h: 2.0, margin: 0,
    fontFace: 'Georgia', fontSize: 20, italic: true, color: T.text,
    valign: 'middle', align: 'center', lineSpacingMultiple: 1.5,
  });

  // Author
  if (s.quoteAuthor) {
    slide.addShape(RRECT, {
      x: 5.5, y: 4.7, w: 2.3, h: 0.03, fill: { color: T.primary, transparency: 40 }, rectRadius: 0.015,
    });
    slide.addText(`— ${strip(s.quoteAuthor)}`, {
      x: 2.0, y: 4.9, w: 9.3, h: 0.4, margin: 0,
      fontFace: T.font, fontSize: 14, color: T.primaryLt, align: 'center',
    });
  }

  footer(slide, docTitle, num, total);
}

// — Comparison slide (before/after, pour/contre, etc.)
function renderComparison(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bgMain(slide);

  // Title
  slide.addText(strip(s.title), {
    x: 0.8, y: 0.45, w: 11.7, h: 0.7, margin: 0,
    fontFace: T.fontAlt, fontSize: 26, bold: true, color: T.text,
  });
  slide.addShape(RRECT, { x: 0.8, y: 1.15, w: 2, h: 0.05, fill: { color: T.primary }, rectRadius: 0.025 });

  const left = s.compLeft || { title: 'Option A', items: [] };
  const right = s.compRight || { title: 'Option B', items: [] };

  // Left card with primary accent
  slide.addShape(RECT, {
    x: 0.8, y: 1.5, w: 5.65, h: 5.3,
    fill: { color: T.surface, transparency: 40 },
    shadow: mkShadow(),
  });
  slide.addShape(RECT, { x: 0.8, y: 1.5, w: 5.65, h: 0.65, fill: { color: T.primaryBg, transparency: 30 } });
  slide.addText(strip(left.title), {
    x: 1.1, y: 1.55, w: 5.1, h: 0.55, margin: 0,
    fontFace: T.font, fontSize: 16, bold: true, color: T.primaryLt,
    valign: 'middle',
  });

  // Right card with accent
  slide.addShape(RECT, {
    x: 6.85, y: 1.5, w: 5.65, h: 5.3,
    fill: { color: T.surface, transparency: 40 },
    shadow: mkShadow(),
  });
  slide.addShape(RECT, { x: 6.85, y: 1.5, w: 5.65, h: 0.65, fill: { color: T.accentBg, transparency: 30 } });
  slide.addText(strip(right.title), {
    x: 7.15, y: 1.55, w: 5.1, h: 0.55, margin: 0,
    fontFace: T.font, fontSize: 16, bold: true, color: T.accentLt,
    valign: 'middle',
  });

  // VS circle in the middle
  slide.addShape(OVAL, {
    x: 6.05, y: 3.5, w: 1.2, h: 1.2,
    fill: { color: T.bg },
    shadow: mkShadow(),
  });
  slide.addText('VS', {
    x: 6.05, y: 3.5, w: 1.2, h: 1.2, margin: 0,
    fontFace: T.fontAlt, fontSize: 16, bold: true, color: T.muted,
    align: 'center', valign: 'middle',
  });

  // Left items
  (left.items || []).slice(0, 6).forEach((item, i) => {
    slide.addText(`·  ${strip(item)}`, {
      x: 1.1, y: 2.35 + i * 0.6, w: 5.0, h: 0.55, margin: 0,
      fontFace: T.font, fontSize: 14, color: T.text, valign: 'middle',
    });
  });

  // Right items
  (right.items || []).slice(0, 6).forEach((item, i) => {
    slide.addText(`·  ${strip(item)}`, {
      x: 7.15, y: 2.35 + i * 0.6, w: 5.0, h: 0.55, margin: 0,
      fontFace: T.font, fontSize: 14, color: T.text, valign: 'middle',
    });
  });

  footer(slide, docTitle, num, total);
}

// — Image + text layout (placeholder for image)
function renderImageText(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bgMain(slide);

  // Title
  slide.addText(strip(s.title), {
    x: 0.8, y: 0.45, w: 11.7, h: 0.7, margin: 0,
    fontFace: T.fontAlt, fontSize: 26, bold: true, color: T.text,
  });
  slide.addShape(RRECT, { x: 0.8, y: 1.15, w: 2, h: 0.05, fill: { color: T.primary }, rectRadius: 0.025 });

  // Image placeholder (left side)
  slide.addShape(RECT, {
    x: 0.8, y: 1.5, w: 5.5, h: 5.3,
    fill: { color: T.surface, transparency: 30 },
    shadow: mkShadow(),
  });
  // Placeholder icon (camera/image icon substitute)
  slide.addShape(RECT, {
    x: 2.5, y: 3.2, w: 2.1, h: 1.6,
    fill: { color: T.surface2, transparency: 20 },
  });
  slide.addShape(RECT, { x: 2.5, y: 3.2, w: 2.1, h: 0.04, fill: { color: T.primary, transparency: 50 } });
  slide.addText(strip(s.imageDesc || 'Image'), {
    x: 1.0, y: 5.0, w: 5.1, h: 0.5, margin: 0,
    fontFace: T.font, fontSize: 11, italic: true, color: T.dim,
    align: 'center',
  });

  // Text content (right side)
  slide.addShape(RECT, {
    x: 6.7, y: 1.5, w: 5.8, h: 5.3,
    fill: { color: T.surface, transparency: 50 },
    shadow: mkShadow(),
  });
  slide.addShape(RECT, { x: 6.7, y: 1.5, w: 0.06, h: 5.3, fill: { color: T.accent } });

  const items = (s.bullets || []).slice(0, 5);
  if (items.length) {
    const rows = items.map((txt) => ({
      text: strip(txt),
      options: { fontFace: T.font, fontSize: 14, color: T.text, bullet: true, paraSpaceAfter: 10, breakLine: true },
    }));
    slide.addText(rows as any, { x: 7.0, y: 1.8, w: 5.2, h: 4.7, valign: 'top', lineSpacingMultiple: 1.3 });
  }

  footer(slide, docTitle, num, total);
}

// — Code slide (terminal-style)
function renderCode(pptx: PptxGenJS, s: SlideData, num: number, total: number, docTitle: string) {
  const slide = pptx.addSlide();
  bgMain(slide);

  // Title
  slide.addText(strip(s.title), {
    x: 0.8, y: 0.45, w: 11.7, h: 0.7, margin: 0,
    fontFace: T.fontAlt, fontSize: 24, bold: true, color: T.text,
  });
  slide.addShape(RRECT, { x: 0.8, y: 1.1, w: 2, h: 0.05, fill: { color: T.accent }, rectRadius: 0.025 });

  // Terminal window
  slide.addShape(RECT, {
    x: 0.8, y: 1.35, w: 11.7, h: 5.45,
    fill: { color: '080C18' },
    shadow: mkSoftShadow(),
  });

  // Terminal top bar
  slide.addShape(RECT, { x: 0.8, y: 1.35, w: 11.7, h: 0.45, fill: { color: '0D1224' } });

  // Traffic light dots
  slide.addShape(OVAL, { x: 1.15, y: 1.48, w: 0.18, h: 0.18, fill: { color: 'FF5F57' } });
  slide.addShape(OVAL, { x: 1.45, y: 1.48, w: 0.18, h: 0.18, fill: { color: 'FEBC2E' } });
  slide.addShape(OVAL, { x: 1.75, y: 1.48, w: 0.18, h: 0.18, fill: { color: '28C840' } });

  // Language badge
  if (s.codeLang) {
    slide.addShape(RRECT, {
      x: 10.8, y: 1.43, w: 1.4, h: 0.28,
      fill: { color: T.surface, transparency: 40 }, rectRadius: 0.05,
    });
    slide.addText(s.codeLang, {
      x: 10.8, y: 1.43, w: 1.4, h: 0.28, margin: 0,
      fontFace: T.mono, fontSize: 9, color: T.muted, align: 'center', valign: 'middle',
    });
  }

  // Code text
  slide.addText((s.code || '').slice(0, 3000), {
    x: 1.1, y: 2.0, w: 11.1, h: 4.5, margin: 0,
    fontFace: T.mono, fontSize: 11, color: 'E2E8F0', valign: 'top',
    lineSpacingMultiple: 1.25,
  });

  footer(slide, docTitle, num, total);
}

// — Closing slide (thank you / summary)
function renderClosing(pptx: PptxGenJS, s: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: T.bg };

  // Dual glow
  slide.addShape(OVAL, {
    x: 3, y: 0, w: 10, h: 8,
    fill: { color: T.primaryBg, transparency: 55 },
  });
  slide.addShape(OVAL, {
    x: -2, y: 2, w: 8, h: 7,
    fill: { color: T.accentBg, transparency: 65 },
  });

  // Decorative accent line
  slide.addShape(RRECT, {
    x: 5.5, y: 2.0, w: 2.3, h: 0.06, fill: { color: T.primary }, rectRadius: 0.03,
  });

  // Main thank you text
  slide.addText(strip(s.title || 'Merci'), {
    x: 1, y: 2.4, w: 11.3, h: 1.5, margin: 0,
    fontFace: T.fontAlt, fontSize: 46, bold: true, color: T.text, align: 'center',
  });

  // Subtitle
  if (s.subtitle) {
    slide.addText(strip(s.subtitle), {
      x: 2, y: 4.0, w: 9.3, h: 0.8, margin: 0,
      fontFace: T.font, fontSize: 16, color: T.textSub, align: 'center',
      lineSpacingMultiple: 1.3,
    });
  }

  // Branding badge
  slide.addShape(RRECT, {
    x: 5.3, y: 5.3, w: 2.7, h: 0.5,
    fill: { color: T.surface, transparency: 40 },
    rectRadius: 0.1,
    shadow: mkShadow(),
  });
  slide.addShape(RECT, { x: 5.3, y: 5.3, w: 0.06, h: 0.5, fill: { color: T.primary } });
  slide.addText('Genere par ANZAR', {
    x: 5.5, y: 5.3, w: 2.4, h: 0.5, margin: 0,
    fontFace: T.font, fontSize: 11, color: T.textSub, align: 'center', valign: 'middle',
  });

  // Bottom bar
  slide.addShape(RECT, { x: 0, y: 7.0, w: 13.333, h: 0.06, fill: { color: T.primary } });
  slide.addText(new Date().toLocaleDateString('fr-FR'), {
    x: 5, y: 7.15, w: 3.3, h: 0.3, margin: 0,
    fontFace: T.font, fontSize: 10, color: T.muted, align: 'center',
  });
}

// =========================================================
// MAIN EXPORT — Public API
// =========================================================

export async function exportToPptx(content: string, filename?: string): Promise<void> {
  // Step 1: Try AI structuring, fallback to markdown parser
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
        renderCover(pptx, s);
        break;
      case 'toc':
        renderToc(pptx, s, num, total, docTitle);
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
      case 'three-cards':
        renderThreeCards(pptx, s, num, total, docTitle);
        break;
      case 'stats':
        renderStats(pptx, s, num, total, docTitle);
        break;
      case 'timeline':
        renderTimeline(pptx, s, num, total, docTitle);
        break;
      case 'quote':
        renderQuote(pptx, s, num, total, docTitle);
        break;
      case 'comparison':
        renderComparison(pptx, s, num, total, docTitle);
        break;
      case 'image-text':
        renderImageText(pptx, s, num, total, docTitle);
        break;
      case 'code':
        renderCode(pptx, s, num, total, docTitle);
        break;
      case 'closing':
        renderClosing(pptx, s);
        break;
      default:
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
