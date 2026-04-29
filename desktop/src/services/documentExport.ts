/**
 * documentExport.ts — Export AI responses as Word (.docx) or PDF
 * Used by the Student Assistant and any AI message action.
 *
 * - DOCX: uses the `docx` npm package to build a proper Word document
 * - PDF:  renders HTML to PDF via html2pdf.js (client-side, no server needed)
 * - Tauri: uses save dialog to let user pick destination
 * - Web fallback: triggers browser download
 */

import { isTauri } from '@/lib/utils';

// ============================================================================
// MARKDOWN → STRUCTURED BLOCKS (simple parser)
// ============================================================================

interface Block {
  type: 'h1' | 'h2' | 'h3' | 'paragraph' | 'bullet' | 'numbered' | 'code';
  text: string;
  language?: string;
}

function markdownToBlocks(md: string): Block[] {
  const lines = md.split('\n');
  const blocks: Block[] = [];
  let inCode = false;
  let codeBuffer = '';
  let codeLang = '';

  for (const line of lines) {
    // Code block toggle
    if (line.startsWith('```')) {
      if (inCode) {
        blocks.push({ type: 'code', text: codeBuffer.trim(), language: codeLang });
        codeBuffer = '';
        codeLang = '';
        inCode = false;
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCode) {
      codeBuffer += line + '\n';
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    // Headings
    if (trimmed.startsWith('### ')) {
      blocks.push({ type: 'h3', text: trimmed.slice(4) });
    } else if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'h2', text: trimmed.slice(3) });
    } else if (trimmed.startsWith('# ')) {
      blocks.push({ type: 'h1', text: trimmed.slice(2) });
    }
    // Bullets
    else if (/^[-*•]\s/.test(trimmed)) {
      blocks.push({ type: 'bullet', text: trimmed.replace(/^[-*•]\s+/, '') });
    }
    // Numbered list
    else if (/^\d+[.)]\s/.test(trimmed)) {
      blocks.push({ type: 'numbered', text: trimmed.replace(/^\d+[.)]\s+/, '') });
    }
    // Paragraph
    else {
      blocks.push({ type: 'paragraph', text: trimmed });
    }
  }

  return blocks;
}

/** Strip markdown formatting from inline text */
function stripInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')  // bold
    .replace(/\*(.+?)\*/g, '$1')       // italic
    .replace(/`(.+?)`/g, '$1')         // inline code
    .replace(/\[(.+?)\]\(.+?\)/g, '$1'); // links
}

// ============================================================================
// CORRECTION CLEANING — Export propre (sans annotations pédagogiques)
// ============================================================================

/** Detect if content is a correction (has ~~strikethrough~~ or → patterns) */
export function isCorrection(content: string): boolean {
  const strikeCount = (content.match(/~~.+?~~/g) || []).length;
  const arrowCount = (content.match(/→/g) || []).length;
  return strikeCount >= 2 || (strikeCount >= 1 && arrowCount >= 1);
}

/**
 * Clean correction content for export:
 * - Remove ~~old text~~ (strikethrough = deleted)
 * - Remove (explanations in parentheses after corrections)
 * - Keep only the corrected text (bold → plain)
 * - Remove correction summary sections (score, recurring errors)
 */
export function cleanCorrectionForExport(content: string): string {
  let cleaned = content;

  // Remove "~~old text~~ → " patterns entirely (keep what follows)
  cleaned = cleaned.replace(/~~.+?~~\s*→\s*/g, '');

  // Remove standalone ~~strikethrough~~ (deleted text)
  cleaned = cleaned.replace(/~~.+?~~/g, '');

  // Remove inline explanations: (explication de la correction)
  // Only match parentheses that look like correction explanations
  cleaned = cleaned.replace(/\s*\((?:règle|amélioration|correction|cohérence|style|grammaire|orthographe|syntaxe|accord|conjugaison|ponctuation|registre|clarté|précision|redondance|répétition|formulation|concordance)[^)]{0,120}\)/gi, '');

  // Remove correction summary sections at the end
  cleaned = cleaned.replace(/\n---[\s\S]*?(corrections?|erreurs?\s+récurrentes|note\s+de\s+qualité|conseils?\s+pour)[\s\S]*$/i, '');

  // Clean up multiple blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

// ============================================================================
// EXPORT TO DOCX
// ============================================================================

export async function exportToDocx(content: string, filename?: string): Promise<void> {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    AlignmentType, BorderStyle,
  } = await import('docx');

  // Make TextRun available to buildTextRuns helper
  _TextRun = TextRun;

  const blocks = markdownToBlocks(content);
  const children: any[] = [];

  // Title
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'ANZAR — Document généré',
          bold: true,
          size: 28,
          color: '6C3AED',
          font: 'Calibri',
        }),
      ],
      spacing: { after: 200 },
      alignment: AlignmentType.CENTER,
    })
  );

  // Separator line
  children.push(
    new Paragraph({
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      },
      spacing: { after: 300 },
    })
  );

  // Content blocks
  let numberedIndex = 0;
  for (const block of blocks) {
    switch (block.type) {
      case 'h1':
        children.push(new Paragraph({
          text: stripInline(block.text),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        }));
        break;

      case 'h2':
        children.push(new Paragraph({
          text: stripInline(block.text),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 150 },
        }));
        break;

      case 'h3':
        children.push(new Paragraph({
          text: stripInline(block.text),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
        }));
        break;

      case 'bullet':
        children.push(new Paragraph({
          children: buildTextRuns(block.text),
          bullet: { level: 0 },
          spacing: { after: 80 },
        }));
        break;

      case 'numbered':
        numberedIndex++;
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${numberedIndex}. `, bold: true, font: 'Calibri', size: 22 }),
            ...buildTextRuns(block.text),
          ],
          spacing: { after: 80 },
        }));
        break;

      case 'code':
        children.push(new Paragraph({
          children: [
            new TextRun({
              text: block.text,
              font: 'Consolas',
              size: 18,
              color: '1E293B',
            }),
          ],
          shading: { fill: 'F1F5F9' },
          spacing: { before: 100, after: 100 },
        }));
        break;

      case 'paragraph':
      default:
        numberedIndex = 0;
        children.push(new Paragraph({
          children: buildTextRuns(block.text),
          spacing: { after: 120, line: 360 },
        }));
        break;
    }
  }

  // Footer
  children.push(
    new Paragraph({
      border: {
        top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      },
      spacing: { before: 400 },
    })
  );
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Généré par ANZAR — ${new Date().toLocaleDateString('fr-FR')}`,
          size: 16,
          color: '999999',
          italics: true,
          font: 'Calibri',
        }),
      ],
      alignment: AlignmentType.CENTER,
    })
  );

  const doc = new Document({
    sections: [{ children }],
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22 },
        },
      },
    },
  });

  const blob = await Packer.toBlob(doc);
  const name = filename || `anzar_document_${Date.now()}.docx`;
  await saveFile(blob, name, 'docx');
}

/** Build TextRun array from markdown inline formatting.
 *  Returns TextRun instances (imported dynamically within exportToDocx scope). */
let _TextRun: any = null;

function buildTextRuns(text: string): any[] {
  const TR = _TextRun;
  if (!TR) return []; // Safety — should never happen
  const runs: any[] = [];
  // Extended regex: ~~strikethrough~~ for track changes (deleted text),
  // **bold**, *italic*, `code`, and plain text
  const regex = /(~~(.+?)~~|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^~*`]+))/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      // Strikethrough = deleted text (red + barré) — track changes style
      runs.push(new TR({
        text: match[2],
        strike: true,
        color: 'DC2626',
        font: 'Calibri',
        size: 22,
      }));
    } else if (match[3]) {
      runs.push(new TR({ text: match[3], bold: true, font: 'Calibri', size: 22 }));
    } else if (match[4]) {
      runs.push(new TR({ text: match[4], italics: true, font: 'Calibri', size: 22 }));
    } else if (match[5]) {
      runs.push(new TR({ text: match[5], font: 'Consolas', size: 20, color: '6C3AED' }));
    } else if (match[6]) {
      runs.push(new TR({ text: match[6], font: 'Calibri', size: 22 }));
    }
  }

  return runs;
}

// ============================================================================
// EXPORT TO PDF
// ============================================================================

export async function exportToPdf(content: string, filename?: string): Promise<void> {
  const blocks = markdownToBlocks(content);

  // Build HTML from blocks
  let html = `
    <div style="font-family: 'Segoe UI', Calibri, Arial, sans-serif; color: #1a1a1a; padding: 40px; max-width: 700px; margin: 0 auto;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #6C3AED; font-size: 22px; margin: 0;">ANZAR</h1>
        <p style="color: #999; font-size: 11px; margin-top: 4px;">Document généré le ${new Date().toLocaleDateString('fr-FR')}</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 16px;">
      </div>
  `;

  for (const block of blocks) {
    const escaped = escapeHtml(stripInlineForHtml(block.text));
    switch (block.type) {
      case 'h1':
        html += `<h1 style="font-size: 20px; color: #111; margin-top: 28px; margin-bottom: 12px;">${escaped}</h1>`;
        break;
      case 'h2':
        html += `<h2 style="font-size: 17px; color: #333; margin-top: 22px; margin-bottom: 10px;">${escaped}</h2>`;
        break;
      case 'h3':
        html += `<h3 style="font-size: 14px; color: #555; margin-top: 16px; margin-bottom: 8px;">${escaped}</h3>`;
        break;
      case 'bullet':
        html += `<p style="font-size: 12px; line-height: 1.7; margin: 4px 0 4px 20px;">• ${escaped}</p>`;
        break;
      case 'numbered':
        html += `<p style="font-size: 12px; line-height: 1.7; margin: 4px 0 4px 20px;">${escaped}</p>`;
        break;
      case 'code':
        html += `<pre style="background: #f1f5f9; padding: 12px; border-radius: 6px; font-size: 11px; font-family: Consolas, monospace; overflow-x: auto; margin: 12px 0;">${escapeHtml(block.text)}</pre>`;
        break;
      case 'paragraph':
      default:
        html += `<p style="font-size: 12px; line-height: 1.8; margin: 8px 0;">${escaped}</p>`;
        break;
    }
  }

  html += `
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 32px;">
      <p style="text-align: center; font-size: 10px; color: #999; margin-top: 12px;">
        Généré par ANZAR — ${new Date().toLocaleDateString('fr-FR')}
      </p>
    </div>
  `;

  const name = filename || `anzar_document_${Date.now()}.pdf`;

  // Use html2pdf.js to convert — with offline graceful fallback
  let html2pdf: any;
  try {
    html2pdf = (await import('html2pdf.js')).default;
  } catch {
    // html2pdf.js not available (offline or bundle issue) — fallback to DOCX export
    console.warn('html2pdf.js unavailable — falling back to DOCX export');
    const toast = (await import('react-hot-toast')).default;
    toast.error('Export PDF indisponible hors ligne — export Word a la place.');
    await exportToDocx(content, name.replace(/\.pdf$/, '.docx'));
    return;
  }

  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const pdfBlob: Blob = await html2pdf()
      .set({
        margin: [10, 10, 10, 10],
        filename: name,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      })
      .from(container)
      .outputPdf('blob');

    await saveFile(pdfBlob, name, 'pdf');
  } finally {
    document.body.removeChild(container);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Convert markdown bold/italic/strikethrough to HTML */
function stripInlineForHtml(text: string): string {
  return text
    .replace(/~~(.+?)~~/g, '<del style="color:#DC2626;text-decoration:line-through;">$1</del>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:11px;">$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" style="color:#6C3AED;">$1</a>');
}

// ============================================================================
// FILE SAVING (Tauri save dialog or browser download)
// ============================================================================

async function saveFile(blob: Blob, filename: string, type: 'docx' | 'pdf'): Promise<void> {
  if (isTauri()) {
    try {
      const { save } = await import('@tauri-apps/api/dialog');
      const { writeBinaryFile } = await import('@tauri-apps/api/fs');
      const { documentDir } = await import('@tauri-apps/api/path');

      const defaultDir = await documentDir();
      const filePath = await save({
        defaultPath: `${defaultDir}${filename}`,
        filters: [
          type === 'docx'
            ? { name: 'Document Word', extensions: ['docx'] }
            : { name: 'Document PDF', extensions: ['pdf'] },
        ],
      });

      if (filePath) {
        const buffer = await blob.arrayBuffer();
        await writeBinaryFile(filePath, new Uint8Array(buffer));
        // Success — could show a toast here
        console.log(`Document saved to ${filePath}`);
      }
    } catch (err) {
      console.error('Tauri save failed, falling back to browser download:', err);
      browserDownload(blob, filename);
    }
  } else {
    browserDownload(blob, filename);
  }
}

function browserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
