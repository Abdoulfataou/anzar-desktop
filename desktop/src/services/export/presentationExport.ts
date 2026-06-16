/**
 * presentationExport.ts
 * Export chat messages to PowerPoint (PPTX) format using pptxgenjs.
 */

import PptxGenJS from 'pptxgenjs';

// ─── Theme ───────────────────────────────────────────────────────────────────

const THEME = {
  bg: '0F1117',
  accent: '6366F1',
  accentLight: '818CF8',
  text: 'F8FAFC',
  textMuted: '94A3B8',
  surface: '1E2130',
  border: '2D3148',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function splitIntoSlides(content: string): Array<{ title: string; bullets: string[] }> {
  const slides: Array<{ title: string; bullets: string[] }> = [];
  const lines = content.split('\n');

  let currentTitle = 'Présentation';
  let currentBullets: string[] = [];

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)/);
    const h2 = line.match(/^##\s+(.+)/);
    const h3 = line.match(/^###\s+(.+)/);
    const bullet = line.match(/^[-*•]\s+(.+)/);
    const numbered = line.match(/^\d+\.\s+(.+)/);
    const plain = line.trim();

    if (h1) {
      if (currentBullets.length > 0 || slides.length > 0) {
        slides.push({ title: currentTitle, bullets: currentBullets });
      }
      currentTitle = h1[1];
      currentBullets = [];
    } else if (h2 || h3) {
      if (currentBullets.length > 0) {
        slides.push({ title: currentTitle, bullets: currentBullets });
        currentBullets = [];
      }
      currentTitle = (h2 || h3)![1];
    } else if (bullet) {
      currentBullets.push(bullet[1]);
    } else if (numbered) {
      currentBullets.push(numbered[1]);
    } else if (plain && plain.length > 0 && !plain.startsWith('```')) {
      // Add as bullet if no explicit bullet markers
      if (plain.length > 20) {
        currentBullets.push(plain);
      }
    }

    // Auto-split if too many bullets (max 6 per slide)
    if (currentBullets.length >= 6) {
      slides.push({ title: currentTitle, bullets: currentBullets });
      currentBullets = [];
    }
  }

  // Push remaining
  if (currentBullets.length > 0 || slides.length === 0) {
    slides.push({ title: currentTitle, bullets: currentBullets });
  }

  return slides.filter((s) => s.title || s.bullets.length > 0);
}

// ─── Export ──────────────────────────────────────────────────────────────────

export async function exportToPptx(content: string): Promise<void> {
  const pptx = new PptxGenJS();

  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'ANZAR';
  pptx.title = 'Présentation ANZAR';

  const slides = splitIntoSlides(content);

  // ── Title slide ──
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: THEME.bg };

  // Accent bar
  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: '100%',
    h: 0.06,
    fill: { color: THEME.accent },
    line: { color: THEME.accent },
  });

  // Title
  const mainTitle = slides[0]?.title || 'Présentation';
  titleSlide.addText(mainTitle, {
    x: 0.8,
    y: 2.2,
    w: '88%',
    h: 1.4,
    fontSize: 38,
    bold: true,
    color: THEME.text,
    fontFace: 'Calibri',
    align: 'center',
  });

  // Subtitle
  titleSlide.addText('Généré par ANZAR', {
    x: 0.8,
    y: 3.8,
    w: '88%',
    h: 0.5,
    fontSize: 16,
    color: THEME.textMuted,
    fontFace: 'Calibri',
    align: 'center',
  });

  // Bottom bar
  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 6.94,
    w: '100%',
    h: 0.06,
    fill: { color: THEME.accent },
    line: { color: THEME.accent },
  });

  // ── Content slides ──
  const contentSlides = slides.length > 1 ? slides.slice(1) : slides;

  contentSlides.forEach((slide, idx) => {
    const s = pptx.addSlide();
    s.background = { color: THEME.bg };

    // Top accent
    s.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: '100%',
      h: 0.06,
      fill: { color: THEME.accent },
      line: { color: THEME.accent },
    });

    // Slide number
    s.addText(`${idx + 1} / ${contentSlides.length}`, {
      x: 11.5,
      y: 6.6,
      w: 1.5,
      h: 0.3,
      fontSize: 10,
      color: THEME.textMuted,
      fontFace: 'Calibri',
      align: 'right',
    });

    // Title background
    s.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0.06,
      w: '100%',
      h: 1.1,
      fill: { color: THEME.surface },
      line: { color: THEME.surface },
    });

    // Title text
    s.addText(slide.title, {
      x: 0.5,
      y: 0.15,
      w: '94%',
      h: 0.9,
      fontSize: 24,
      bold: true,
      color: THEME.accentLight,
      fontFace: 'Calibri',
      valign: 'middle',
    });

    // Bullets
    if (slide.bullets.length > 0) {
      const bulletObjects = slide.bullets.map((b) => ({
        text: b,
        options: {
          fontSize: 18,
          color: THEME.text,
          bullet: { type: 'bullet' as const },
          paraSpaceBefore: 6,
        },
      }));

      s.addText(bulletObjects, {
        x: 0.5,
        y: 1.4,
        w: '92%',
        h: 5.2,
        fontFace: 'Calibri',
        valign: 'top',
      });
    }

    // Bottom bar
    s.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 6.94,
      w: '100%',
      h: 0.06,
      fill: { color: THEME.accent },
      line: { color: THEME.accent },
    });
  });

  await pptx.writeFile({ fileName: `anzar_presentation_${Date.now()}.pptx` });
}
