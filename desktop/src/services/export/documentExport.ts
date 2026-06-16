/**
 * documentExport.ts
 * Export chat messages to DOCX and PDF formats.
 */

import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';

// ─── Correction detection ────────────────────────────────────────────────────

/**
 * Returns true if the content looks like a correction with annotations.
 */
export function isCorrection(content: string): boolean {
  return (
    content.includes('~~') ||
    content.includes('**Correction**') ||
    content.includes('[CORRECTION]') ||
    content.includes('❌') ||
    content.includes('✅') ||
    /\[avant\]/i.test(content) ||
    /\[après\]/i.test(content)
  );
}

/**
 * Strip correction annotations from content for a clean export.
 */
export function cleanCorrectionForExport(content: string): string {
  return content
    .replace(/~~[^~]*~~/g, '') // remove strikethrough (deleted text)
    .replace(/\[avant\].*?\[après\]/gis, (m) => {
      // keep only the "après" (corrected) part
      const after = m.match(/\[après\]([\s\S]*?)($|\[avant\])/i);
      return after ? after[1].trim() : '';
    })
    .replace(/❌[^\n]*/g, '')
    .replace(/✅/g, '')
    .replace(/\*\*Correction\*\*/gi, '')
    .replace(/\[CORRECTION\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Markdown → docx paragraphs ─────────────────────────────────────────────

function markdownToParagraphs(markdown: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const lines = markdown.split('\n');

  for (const line of lines) {
    if (/^#{1}\s/.test(line)) {
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^#\s/, ''),
          heading: HeadingLevel.HEADING_1,
        })
      );
    } else if (/^#{2}\s/.test(line)) {
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^##\s/, ''),
          heading: HeadingLevel.HEADING_2,
        })
      );
    } else if (/^#{3}\s/.test(line)) {
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^###\s/, ''),
          heading: HeadingLevel.HEADING_3,
        })
      );
    } else if (line.trim() === '') {
      paragraphs.push(new Paragraph({ text: '' }));
    } else {
      // Parse inline bold/italic
      const runs: TextRun[] = [];
      const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
      for (const part of parts) {
        if (part.startsWith('**') && part.endsWith('**')) {
          runs.push(new TextRun({ text: part.slice(2, -2), bold: true }));
        } else if (part.startsWith('*') && part.endsWith('*')) {
          runs.push(new TextRun({ text: part.slice(1, -1), italics: true }));
        } else if (part.startsWith('`') && part.endsWith('`')) {
          runs.push(new TextRun({ text: part.slice(1, -1), font: 'Courier New' }));
        } else if (part) {
          runs.push(new TextRun({ text: part }));
        }
      }
      paragraphs.push(
        new Paragraph({
          children: runs,
          alignment: AlignmentType.LEFT,
        })
      );
    }
  }

  return paragraphs;
}

// ─── DOCX export ────────────────────────────────────────────────────────────

export async function exportToDocx(content: string, filename: string): Promise<void> {
  const paragraphs = markdownToParagraphs(content);

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}

// ─── PDF export ─────────────────────────────────────────────────────────────

export async function exportToPdf(content: string, filename: string): Promise<void> {
  // Dynamically import html2pdf to avoid SSR issues
  const html2pdf = (await import('html2pdf.js')).default;

  // Convert markdown to minimal HTML
  const html = content
    .split('\n')
    .map((line) => {
      if (/^# /.test(line)) return `<h1>${line.slice(2)}</h1>`;
      if (/^## /.test(line)) return `<h2>${line.slice(3)}</h2>`;
      if (/^### /.test(line)) return `<h3>${line.slice(4)}</h3>`;
      if (line.trim() === '') return '<br/>';
      return `<p>${line
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`;
    })
    .join('\n');

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'font-family: Arial, sans-serif; font-size: 12px; padding: 20px; color: #000;';
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);

  try {
    await html2pdf()
      .set({
        margin: [15, 15, 15, 15],
        filename,
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      })
      .from(wrapper)
      .save();
  } finally {
    document.body.removeChild(wrapper);
  }
}
