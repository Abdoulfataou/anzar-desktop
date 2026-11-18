/**
 * ChatInput - Barre de saisie unifiée ANZAR
 * Sélecteur de projet intégré + textarea + modèle + envoi
 * Inspiré TRAE SOLO mais design original ANZAR
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  Paperclip, Square, Zap, Brain, ArrowUp,
  ChevronDown, Plus, Check, Shield,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, isTauri, generateId } from '@/lib/utils';
import { AIModel, Project, ChatAttachment, ChatAttachmentKind } from '@/types';
import {
  findSuggestionQuery, rankFiles, rankCommands, SuggestionMenu,
  type SlashCommand, type SuggestionItem,
} from './composerSuggestions';
import { isAllowedProjectRoot, showPathNotAllowedMessage } from '@/lib/allowedProjectRoots';
import { imageToDataUrl, imageMimeFromName } from '@/lib/imageAttach';
import { readTextFile, readBinaryFile } from '@/lib/tauriFs';

interface ChatInputProps {
  /** Texte placé dans le champ (ex. idée saisie avant la connexion, non envoyée faute de crédit) */
  draft?: string;
  onSendMessage: (message: string, attachments?: ChatAttachment[]) => Promise<void> | void;
  onStopGeneration?: () => void;
  isLoading?: boolean;
  isOnline?: boolean;
  selectedModel?: AIModel;
  onModelChange?: (model: AIModel) => void;
  permissionMode?: PermissionMode;
  onPermissionChange?: (mode: PermissionMode) => void;
  placeholder?: string;
  maxHeight?: number;
  /** Fichiers du projet proposés après « @ » (chemins relatifs) */
  mentionFiles?: string[];
  /** Commandes proposées après « / » en début de message */
  commands?: SlashCommand[];
  /** Commande qui déclenche une action de l'app (ex. /plan) */
  onCommand?: (command: SlashCommand) => void;
}

const MAX_HEIGHT = 200;
const MIN_HEIGHT = 48;

function truncateMiddle(text: string, maxChars: number): string {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.65);
  const tail = Math.floor(maxChars * 0.25);
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n\n[... tronqué: ${omitted} caractères ...]\n\n${text.slice(text.length - tail)}`;
}

function detectAttachmentKind(filename: string): ChatAttachmentKind {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx' || ext === 'doc') return 'docx';
  if (ext === 'pptx' || ext === 'ppt') return 'pptx';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (ext === 'csv') return 'csv';
  if (ext === 'tsv') return 'tsv';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'].includes(ext)) return 'audio';
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'html', 'css', 'json', 'yaml', 'yml', 'md', 'txt', 'sql', 'xml'].includes(ext)) return 'code';
  return 'binary';
}

/** Extract text from a .docx file (ZIP containing XML) */
async function extractDocxText(bytes: Uint8Array): Promise<string> {
  try {
    // docx is a ZIP — we look for word/document.xml inside it
    // Minimal ZIP parser: find PK signatures, locate document.xml
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);
    const docXml = zip.file('word/document.xml');
    if (!docXml) return '[Impossible de lire le contenu du fichier Word]';
    const xml = await docXml.async('string');
    // Strip XML tags, keep text content
    const text = xml
      .replace(/<w:br[^>]*\/>/gi, '\n')
      .replace(/<w:p[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return text || '[Document Word vide]';
  } catch {
    return '[Erreur lors de la lecture du fichier Word]';
  }
}

/** Extract data from an Excel file (.xlsx) as CSV-like text */
async function extractExcelText(bytes: Uint8Array): Promise<string> {
  try {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);

    // xlsx stores sheets in xl/worksheets/sheet1.xml, sheet2.xml, etc.
    // Grand public: on lit plusieurs feuilles si présentes (limité)
    const sheetFolder = zip.folder('xl/worksheets');
    const sheetFiles = sheetFolder
      ? Object.keys(sheetFolder.files)
        .filter((p) => /xl\/worksheets\/sheet\d+\.xml$/i.test(p))
        .sort((a, b) => {
          const na = Number((a.match(/sheet(\d+)\.xml/i)?.[1]) || 0);
          const nb = Number((b.match(/sheet(\d+)\.xml/i)?.[1]) || 0);
          return na - nb;
        })
      : [];

    const sheetsToRead = sheetFiles.slice(0, 3); // max 3 feuilles pour éviter freeze
    const stringsFile = zip.file('xl/sharedStrings.xml');

    if (sheetsToRead.length === 0) return '[Impossible de lire le fichier Excel]';

    // Parse shared strings (Excel stores text in a shared strings table)
    let sharedStrings: string[] = [];
    if (stringsFile) {
      const ssXml = await stringsFile.async('string');
      const matches = ssXml.match(/<t[^>]*>([^<]*)<\/t>/g) || [];
      sharedStrings = matches.map((m) => m.replace(/<[^>]+>/g, ''));
    }

    const blocks: string[] = [];
    const MAX_ROWS_PER_SHEET = 120;

    for (const path of sheetsToRead) {
      const file = zip.file(path);
      if (!file) continue;
      const sheetXml = await file.async('string');
      const rows: string[][] = [];
      const rowMatches = sheetXml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];

      for (const rowXml of rowMatches) {
        const cells: string[] = [];
        const cellMatches = rowXml.match(/<c[^>]*>[\s\S]*?<\/c>|<c[^/]*\/>/g) || [];

        for (const cellXml of cellMatches) {
          const isSharedString = /t="s"/.test(cellXml);
          const valueMatch = cellXml.match(/<v>([^<]*)<\/v>/);
          if (valueMatch) {
            const val = valueMatch[1];
            if (isSharedString && sharedStrings[parseInt(val)]) {
              cells.push(sharedStrings[parseInt(val)]);
            } else {
              cells.push(val);
            }
          } else {
            cells.push('');
          }
        }
        if (cells.some((c) => c.trim())) rows.push(cells);
        if (rows.length >= MAX_ROWS_PER_SHEET) break;
      }

      const sheetNum = Number((path.match(/sheet(\d+)\.xml/i)?.[1]) || 0) || 1;
      if (rows.length === 0) {
        blocks.push(`Feuille ${sheetNum}: [vide]`);
        continue;
      }
      const text = rows.map((row) => row.join('\t')).join('\n');
      blocks.push(`Feuille ${sheetNum} — aperçu (${rows.length} lignes)\n${text}`);
    }

    const moreSheets = sheetFiles.length - sheetsToRead.length;
    const suffix = moreSheets > 0 ? `\n\n[... ${moreSheets} feuille(s) supplémentaire(s) non chargée(s) ...]` : '';
    return `${blocks.join('\n\n---\n\n')}${suffix}`;
  } catch {
    return '[Erreur lors de la lecture du fichier Excel — essayez de l\'exporter en CSV]';
  }
}

/** Extract text from a PowerPoint (.pptx) file (ZIP containing XML slide files) */
async function extractPptxText(bytes: Uint8Array): Promise<string> {
  try {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);

    // Find all slide XML files (ppt/slides/slide1.xml, slide2.xml, ...)
    const slideFiles = Object.keys(zip.files)
      .filter((p) => /ppt\/slides\/slide\d+\.xml$/i.test(p))
      .sort((a, b) => {
        const na = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
        const nb = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
        return na - nb;
      });

    if (slideFiles.length === 0) return '[Impossible de lire le fichier PowerPoint]';

    const slideTexts: string[] = [];
    const maxSlides = Math.min(slideFiles.length, 80);

    for (let i = 0; i < maxSlides; i++) {
      const slideXml = await zip.file(slideFiles[i])?.async('string');
      if (!slideXml) continue;
      // Extract text content from XML: <a:t>text</a:t> tags
      const texts: string[] = [];
      const regex = /<a:t[^>]*>([^<]*)<\/a:t>/gi;
      let match;
      while ((match = regex.exec(slideXml)) !== null) {
        if (match[1].trim()) texts.push(match[1]);
      }
      if (texts.length > 0) {
        slideTexts.push(`--- Slide ${i + 1} ---\n${texts.join(' ')}`);
      }
    }

    if (slideFiles.length > maxSlides) {
      slideTexts.push(`\n[... ${slideFiles.length - maxSlides} slides supplementaires non incluses ...]`);
    }

    // Also try to extract notes (ppt/notesSlides/)
    const notesFiles = Object.keys(zip.files)
      .filter((p) => /ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(p))
      .sort();

    if (notesFiles.length > 0) {
      const noteTexts: string[] = [];
      for (const nf of notesFiles.slice(0, 30)) {
        const noteXml = await zip.file(nf)?.async('string');
        if (!noteXml) continue;
        const texts: string[] = [];
        const regex2 = /<a:t[^>]*>([^<]*)<\/a:t>/gi;
        let m;
        while ((m = regex2.exec(noteXml)) !== null) {
          if (m[1].trim() && !/^\d+$/.test(m[1].trim())) texts.push(m[1]);
        }
        if (texts.length > 0) noteTexts.push(texts.join(' '));
      }
      if (noteTexts.length > 0) {
        slideTexts.push(`\n--- Notes de l'orateur ---\n${noteTexts.join('\n')}`);
      }
    }

    return slideTexts.join('\n\n') || '[Presentation PowerPoint vide]';
  } catch {
    return '[Erreur lors de la lecture du fichier PowerPoint]';
  }
}

/** Extract text from a PDF (basic extraction via pdf.js or fallback) */
async function extractPdfText(bytes: Uint8Array): Promise<string> {
  try {
    // Use pdfjs-dist for text extraction
    const pdfjsLib = await import('pdfjs-dist');
    // Worker local uniquement : jamais de script CDN pour parser un document non fiable.
    const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min?url')).default as string;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pages: string[] = [];
    const maxPages = Math.min(doc.numPages, 50); // Limit to 50 pages
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      if (pageText.trim()) pages.push(pageText);
    }
    if (doc.numPages > 50) {
      pages.push(`\n[... ${doc.numPages - 50} pages supplémentaires non incluses ...]`);
    }

    const extracted = pages.join('\n\n');

    // ── PDF SCANNÉ (photo de document, sans couche texte) → OCR ──
    // Cas très fréquent pour les documents administratifs scannés.
    if (extracted.trim().length < 80) {
      const ocrText = await ocrPdfPages(doc, Math.min(doc.numPages, 5));
      if (ocrText) {
        return `[Texte reconnu par OCR — document scanné, la précision peut varier]\n\n${ocrText}`;
      }
      return '[PDF scanné sans texte : la reconnaissance OCR a échoué (connexion internet requise au premier usage). Réessaie en ligne, ou envoie une photo/capture du document à la place.]';
    }

    return extracted || '[PDF sans texte extractible]';
  } catch {
    return '[Erreur lors de la lecture du PDF — essayez un fichier Word (.docx) pour de meilleurs résultats]';
  }
}

/**
 * OCR des pages d'un PDF scanné via tesseract.js (fra+eng).
 * Best-effort : rend chaque page en canvas puis reconnaît le texte.
 * Retourne '' si l'OCR est indisponible (offline, worker non chargé…).
 */
async function ocrPdfPages(doc: any, maxPages: number): Promise<string> {
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker(['fra', 'eng']);
    const results: string[] = [];
    try {
      for (let i = 1; i <= maxPages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 2 }); // 2x pour la précision OCR
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const { data } = await worker.recognize(canvas);
        const text = (data?.text || '').trim();
        if (text) results.push(`— Page ${i} —\n${text}`);
      }
    } finally {
      await worker.terminate();
    }
    if (doc.numPages > maxPages && results.length > 0) {
      results.push(`[... OCR limité aux ${maxPages} premières pages sur ${doc.numPages} ...]`);
    }
    return results.join('\n\n');
  } catch {
    return '';
  }
}

// ============================================================================
// PIPELINE D'EXTRACTION PARTAGÉ (bouton trombone + drag & drop)
// ============================================================================

const MAX_BYTES_PDF = 12 * 1024 * 1024;   // 12MB
const MAX_BYTES_DOCX = 10 * 1024 * 1024;  // 10MB
const MAX_BYTES_XLSX = 8 * 1024 * 1024;   // 8MB
const MAX_ATTACH_TEXT = 180000;            // ~45K tokens — assez pour un mémoire entier

/** Formats Office pré-2007 (binaires) : non extractibles côté client */
const LEGACY_OFFICE_EXTS = ['doc', 'ppt', 'xls'];

/**
 * Lit et extrait un fichier (par chemin Tauri) en ChatAttachment.
 * Utilisé par le bouton trombone ET le drag & drop.
 */
async function processFilePath(filePath: string): Promise<ChatAttachment> {
  // Le chemin d'origine permet ensuite d'en placer une copie dans le projet (agent)
  return { ...(await extractFromPath(filePath)), sourcePath: filePath };
}

async function extractFromPath(filePath: string): Promise<ChatAttachment> {
  const name = filePath.split(/[/\\]/).pop() || 'fichier';
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const kind = detectAttachmentKind(name);

  // ── Formats anciens .doc/.ppt/.xls : message clair au lieu d'un extrait vide ──
  if (LEGACY_OFFICE_EXTS.includes(ext)) {
    return {
      id: generateId(), name, kind,
      excerpt: `[Format ancien .${ext} non pris en charge. Ouvre le fichier dans Word/Excel/PowerPoint, fais "Enregistrer sous" au format .${ext}x (format moderne), puis rejoins-le.]`,
    };
  }

  try {
    if (kind === 'audio') {
      // Musique : rien à lire en texte ; une copie est placée dans le dossier de travail pour l'agent
      return { id: generateId(), name, kind, excerpt: '[Fichier audio joint : utilisable comme musique de fond d\'une vidéo (export_animation, paramètre music).]' };
    }
    if (kind === 'image') {
      const bytes = await readBinaryFile(filePath);
      const dataUrl = await imageToDataUrl(new Blob([bytes as unknown as BlobPart], { type: imageMimeFromName(name) }));
      return { id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: '[Image jointe]', dataUrl };
    }
    if (kind === 'pdf') {
      const bytes = await readBinaryFile(filePath);
      if (bytes.byteLength > MAX_BYTES_PDF) {
        return { id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: '[Fichier trop volumineux pour extraction automatique (>12MB).]' };
      }
      const text = await extractPdfText(bytes);
      return { id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: truncateMiddle(text, MAX_ATTACH_TEXT) };
    }
    if (kind === 'docx') {
      const bytes = await readBinaryFile(filePath);
      if (bytes.byteLength > MAX_BYTES_DOCX) {
        return { id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: '[Fichier trop volumineux pour extraction automatique (>10MB).]' };
      }
      const text = await extractDocxText(bytes);
      return { id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: truncateMiddle(text, MAX_ATTACH_TEXT) };
    }
    if (kind === 'pptx') {
      const bytes = await readBinaryFile(filePath);
      if (bytes.byteLength > MAX_BYTES_DOCX) {
        return { id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: '[Fichier trop volumineux pour extraction automatique (>10MB).]' };
      }
      const text = await extractPptxText(bytes);
      return { id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: truncateMiddle(text, MAX_ATTACH_TEXT) };
    }
    if (kind === 'xlsx') {
      const bytes = await readBinaryFile(filePath);
      if (bytes.byteLength > MAX_BYTES_XLSX) {
        return { id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: '[Fichier trop volumineux pour extraction automatique (>8MB).]' };
      }
      const text = await extractExcelText(bytes);
      return { id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: truncateMiddle(text, MAX_ATTACH_TEXT) };
    }
    if (kind === 'csv' || kind === 'tsv') {
      const content = await readTextFile(filePath);
      return { id: generateId(), name, kind, excerpt: truncateMiddle(content, MAX_ATTACH_TEXT) };
    }
    // Texte/code — sinon binaire gardé comme pièce jointe simple
    const content = await readTextFile(filePath);
    return { id: generateId(), name, kind: kind === 'binary' ? 'text' : kind, excerpt: truncateMiddle(content, 9000) };
  } catch {
    return { id: generateId(), name, kind, excerpt: kind === 'image' ? '[Image jointe]' : '[Fichier joint]' };
  }
}

/* ===== Project Selector Dropdown ===== */
/** Modes de permission de l'agent (qui décide avant d'agir). */
export type PermissionMode = 'ask' | 'auto' | 'plan' | 'full';

const PERMISSIONS: { id: PermissionMode; label: string; hint: string }[] = [
  { id: 'ask',  label: 'Demander avant de modifier', hint: "Chaque modification et chaque commande attend ton accord" },
  { id: 'auto', label: 'Modifier automatiquement',   hint: "Les fichiers sont modifiés sans demander ; les commandes attendent ton accord" },
  { id: 'plan', label: 'Mode plan',                  hint: "L'agent lit et propose un plan, sans rien modifier" },
  { id: 'full', label: 'Accès complet',              hint: "L'agent modifie et exécute sans demander" },
];

const MODELS: { id: AIModel; label: string; hint: string }[] = [
  { id: 'auto',     label: 'Auto',      hint: "ANZAR choisit pour chaque demande le réglage le moins cher qui suffit, et monte d'un cran si l'agent bute" },
  { id: 'fast',     label: 'Rapide',    hint: 'Réflexion courte : questions, petites modifications. Le moins cher' },
  { id: 'thinking', label: 'Réflexion', hint: "Le bon réglage pour la plupart des tâches d'agent" },
  { id: 'max',      label: 'Max',       hint: 'Réflexion maximale pour les tâches difficiles. Plus lent et plus cher' },
  { id: 'pro',      label: 'Pro',       hint: 'Le modèle le plus puissant (DeepSeek V4 Pro), pour les tâches les plus dures. Environ 3 à 4 fois plus cher' },
];

/** Menu déroulant de la barre du composer (s'ouvre vers le haut). */
function ToolbarMenu<T extends string>({
  value, options, onChange, icon, tone, align = 'left',
}: {
  value: T;
  options: { id: T; label: string; hint: string }[];
  onChange: (v: T) => void;
  icon: React.ReactNode;
  tone?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const current = options.find((o) => o.id === value) ?? options[0];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${current.label} — changer`}
        className={cn(
          'flex items-center gap-1.5 h-7 px-2 rounded-lg text-ui-base transition-colors hover:bg-surface-hover',
          tone ?? 'text-text-secondary'
        )}
      >
        {icon}
        <span className="whitespace-nowrap">{current.label}</span>
        <ChevronDown size={12} className="opacity-60" />
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute bottom-full mb-1.5 w-72 p-1 flex flex-col gap-0.5 rounded-lg border border-border-medium bg-surface-elevated shadow-md z-50',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitemradio"
              aria-checked={o.id === value}
              onClick={() => { onChange(o.id); setOpen(false); }}
              className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left hover:bg-surface-hover transition-colors"
            >
              <span className="flex-1 min-w-0">
                <span className="block text-ui-base text-text-primary">{o.label}</span>
                <span className="block text-ui-sm text-text-muted leading-snug">{o.hint}</span>
              </span>
              {o.id === value && <Check size={14} className="text-text-primary mt-0.5 flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChatInput({
  onSendMessage,
  onStopGeneration,
  isLoading = false,
  isOnline = true,
  selectedModel = 'fast',
  onModelChange,
  permissionMode = 'auto',
  onPermissionChange,
  placeholder = 'Décris ta tâche, ANZAR s\'en occupe...',
  maxHeight = MAX_HEIGHT,
  mentionFiles = [],
  commands = [],
  onCommand,
  draft,
}: ChatInputProps) {
  const [message, setMessage] = useState(draft ?? '');
  useEffect(() => { if (draft) setMessage(draft); }, [draft]);
  const [isFocused, setIsFocused] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const pendingAutoSendRef = useRef(false);
  const pendingAutoSendTextRef = useRef<string>('');

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      const newHeight = Math.min(Math.max(scrollHeight, MIN_HEIGHT), maxHeight);
      textarea.style.height = `${newHeight}px`;
    }
  }, [message, maxHeight]);

  // Permet à d'autres composants (ex: menus) d'ouvrir directement le sélecteur de fichiers
  useEffect(() => {
    const onOpen = () => {
      if (isLoading) return;
      attachButtonRef.current?.click();
    };
    window.addEventListener('anzar:open-file-dialog', onOpen);
    return () => window.removeEventListener('anzar:open-file-dialog', onOpen);
  }, [isLoading]);

  // Compose flow: pré-remplir le message + ouvrir le picker + (optionnel) auto-send après sélection
  useEffect(() => {
    const onCompose = (e: Event) => {
      try {
        const detail = (e as CustomEvent)?.detail || {};
        const text = typeof detail.text === 'string' ? detail.text : '';
        const autoSend = !!detail.autoSend;
        pendingAutoSendRef.current = autoSend;
        pendingAutoSendTextRef.current = text;
        if (text) setMessage(text);
        // Ouvrir le picker
        if (!isLoading) attachButtonRef.current?.click();
        // Focus input
        setTimeout(() => textareaRef.current?.focus(), 50);
      } catch {
        // ignore
      }
    };
    window.addEventListener('anzar:compose-with-attachments', onCompose);
    return () => window.removeEventListener('anzar:compose-with-attachments', onCompose);
  }, [isLoading]);

  // ── DRAG & DROP de fichiers (événements natifs Tauri) ──
  // L'utilisateur dépose un document n'importe où dans la fenêtre :
  // même pipeline d'extraction que le trombone (PDF+OCR, Word, Excel…).
  const [isDropHover, setIsDropHover] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    const unsubs: Array<() => void> = [];
    let mounted = true;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const u1 = await listen('tauri://file-drop-hover', () => setIsDropHover(true));
        const u2 = await listen('tauri://file-drop-cancelled', () => setIsDropHover(false));
        const u3 = await listen<string[]>('tauri://file-drop', async (event) => {
          setIsDropHover(false);
          const paths = (event.payload || []).slice(0, 8);
          if (paths.length === 0) return;
          const loadingToast = toast.loading('Lecture des fichiers…');
          const items: ChatAttachment[] = [];
          for (const p of paths) {
            items.push(await processFilePath(p));
          }
          setAttachments(prev => [...prev, ...items].slice(0, 8));
          toast.dismiss(loadingToast);
          toast.success(`${items.length} fichier${items.length > 1 ? 's' : ''} joint${items.length > 1 ? 's' : ''} — pose ta question !`);
          textareaRef.current?.focus();
        });
        if (mounted) unsubs.push(u1, u2, u3);
        else { u1(); u2(); u3(); }
      } catch { /* web mode : pas de drop natif */ }
    })();
    return () => { mounted = false; unsubs.forEach(u => u()); };
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!isOnline) {
      toast.error("Hors ligne - impossible d’envoyer pour le moment.");
      return;
    }
    const hasText = message.trim().length > 0;
    const hasAttachments = attachments.length > 0;
    if ((hasText || hasAttachments) && !isLoading) {
      // Si fichier sans texte, demander à l’utilisateur ce qu’il veut
      let contentToSend = message.trim();
      if (!hasText && hasAttachments) {
        const fileNames = attachments.map((a) => a.name || "fichier").join(", ");
        contentToSend = `Voici mon document (${fileNames}). Analyse-le et propose-moi les options suivantes :\n1) Correction complete (orthographe, grammaire, syntaxe)\n2) Reformulation et amelioration du style\n3) Resume des points cles\n4) Evaluation avec points forts et points faibles\n\nQuelle option souhaites-tu ?`;
      }
      // On vide le composer tout de suite : l'envoi dure tout le temps de travail de l'agent.
      const sentAttachments = attachments;
      setMessage('');
      setAttachments([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      await onSendMessage(contentToSend, sentAttachments);
    }
  };

  // ── Suggestions « @ fichier » et « / commande » ──
  const [caret, setCaret] = useState(0);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [suggestionsClosed, setSuggestionsClosed] = useState(false);
  const suggestionQuery = isFocused && !suggestionsClosed ? findSuggestionQuery(message, caret) : null;
  const fileMatches = suggestionQuery?.kind === 'mention' ? rankFiles(mentionFiles, suggestionQuery.query) : [];
  const commandMatches = suggestionQuery?.kind === 'slash' ? rankCommands(commands, suggestionQuery.query) : [];
  const suggestionItems: SuggestionItem[] = suggestionQuery?.kind === 'mention'
    ? fileMatches.map((f) => ({ key: f, label: f.split('/').pop() || f, detail: f, icon: 'file' as const }))
    : commandMatches.map((c) => ({ key: c.name, label: `/${c.name}`, detail: c.description, icon: c.custom ? 'custom' as const : 'command' as const }));
  const showSuggestions = suggestionItems.length > 0;
  useEffect(() => { setActiveSuggestion(0); }, [suggestionQuery?.kind, suggestionQuery?.query]);

  const updateCaret = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? el.value.length);

  const placeCaret = (pos: number) => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const pickSuggestion = (index: number) => {
    if (!suggestionQuery) return;
    if (suggestionQuery.kind === 'mention') {
      const path = fileMatches[index];
      if (!path) return;
      const insert = `@${path} `;
      const next = message.slice(0, suggestionQuery.start) + insert + message.slice(caret);
      setMessage(next);
      placeCaret(suggestionQuery.start + insert.length);
      return;
    }
    const cmd = commandMatches[index];
    if (!cmd) return;
    if (cmd.action) {
      setMessage(message.slice(caret).trimStart());
      onCommand?.(cmd);
      placeCaret(0);
      return;
    }
    const text = cmd.prompt || `/${cmd.name}`;
    setMessage(text);
    placeCaret(text.length);
  };

  /** Capture d'écran collée (⌘V) : jointe comme image, envoyée au modèle */
  const handlePasteImages = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.items || [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length === 0) return; // texte : collage normal
    e.preventDefault();
    const stamp = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
    const items: ChatAttachment[] = [];
    for (const [i, file] of files.entries()) {
      try {
        const dataUrl = await imageToDataUrl(file);
        items.push({ id: generateId(), name: `capture-${stamp}${files.length > 1 ? `-${i + 1}` : ''}.png`, kind: 'image', sizeBytes: file.size, excerpt: '[Image jointe]', dataUrl });
      } catch (err: any) {
        toast.error(`Image non jointe : ${err?.message || 'format illisible'}`);
      }
    }
    if (items.length) setAttachments((prev) => [...prev, ...items].slice(0, 8));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSuggestion((i) => (i + 1) % suggestionItems.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSuggestion((i) => (i - 1 + suggestionItems.length) % suggestionItems.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickSuggestion(activeSuggestion); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSuggestionsClosed(true); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasMessage = message.trim().length > 0 || attachments.length > 0;

  return (
    <div className="relative z-40 bg-bg-primary">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-4 pt-2">
        {/* Overlay drag & drop */}
        {isDropHover && (
          <div className="fixed inset-0 z-[100] bg-bg-primary/70 backdrop-blur-sm flex items-center justify-center pointer-events-none">
            <div className="px-10 py-8 rounded-2xl border-2 border-dashed border-accent-primary bg-surface-default shadow-2xl text-center">
              <Paperclip className="mx-auto mb-3 text-accent-primary" size={26} />
              <p className="text-sm font-semibold text-text-primary mb-1">Dépose tes fichiers ici</p>
              <p className="text-xs text-text-muted">PDF (même scannés), Word, Excel, PowerPoint, images, code…</p>
            </div>
          </div>
        )}

        {/* Input container */}
        <div className={cn(
          'relative flex flex-col gap-3 rounded-2xl border-[0.5px] bg-input p-3 shadow-composer transition-colors',
          isFocused
            ? 'border-input-border-hover'
            : 'border-input-border hover:border-input-border-hover'
        )}>
          {/* Suggestions « @ » / « / » au-dessus de la saisie */}
          {showSuggestions && (
            <SuggestionMenu
              items={suggestionItems}
              activeIndex={activeSuggestion}
              onPick={pickSuggestion}
              onHover={setActiveSuggestion}
              title={suggestionQuery?.kind === 'mention' ? 'Fichiers du projet' : 'Commandes'}
            />
          )}

          {/* Textarea area */}
          <div className="flex items-end gap-2 px-1">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => { setMessage(e.target.value); updateCaret(e.target); setSuggestionsClosed(false); }}
              onSelect={(e) => updateCaret(e.currentTarget)}
              onKeyDown={handleKeyDown}
              onPaste={(e) => { void handlePasteImages(e); }}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder={placeholder}
              aria-label={placeholder || 'Message à envoyer'}
              disabled={isLoading}
              rows={1}
              className={cn(
                'flex-1 bg-transparent border-none outline-none resize-none',
                'text-text-primary placeholder-text-muted',
                'text-ui-base leading-relaxed',
                'disabled:opacity-60 disabled:cursor-not-allowed',
              )}
              style={{
                minHeight: `${MIN_HEIGHT}px`,
                maxHeight: `${maxHeight}px`,
                scrollbarWidth: 'thin',
              }}
            />
          </div>

          {/* Attachments chips */}
          {attachments.length > 0 && (
            <div className="px-1 flex flex-wrap gap-2">
              {attachments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 max-w-full px-2.5 py-1.5 rounded-full border border-border-subtle bg-bg-tertiary/60 text-xs text-text-secondary"
                  title={a.name}
                >
                  <span className="truncate max-w-[260px]">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                    aria-label={`Retirer ${a.name}`}
                    className="p-0.5 rounded-full hover:bg-surface-hover text-text-muted hover:text-text-primary"
                    title="Retirer"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between -mx-1 -mb-1">
            {/* Left side: Project selector + attachment */}
            <div className="flex items-center gap-1">
              <button
                ref={attachButtonRef}
                disabled={isLoading}
                onClick={async () => {
                  try {
                    const baseAttachments = attachments;
                    const newItems: ChatAttachment[] = [];
                    // Essayer Tauri dialog en premier
                    if (isTauri()) {
                      const { open: openDialog } = await import('@/lib/tauriDialog');
                      const selected = await openDialog({
                        multiple: true,
                        title: 'Joindre des fichiers',
                        filters: [
                          { name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'txt', 'md', 'rtf'] },
                          { name: 'Données', extensions: ['csv', 'tsv', 'xlsx', 'xls', 'json', 'xml'] },
                          { name: 'Code', extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'html', 'css', 'yaml', 'sql'] },
                          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
                          { name: 'Musique', extensions: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'] },
                          { name: 'Tous', extensions: ['*'] },
                        ],
                      });
                      if (selected) {
                        const files = Array.isArray(selected) ? selected : [selected];
                        const loadingToast = toast.loading('Lecture des fichiers…');
                        let added = 0;
                        // Pipeline partagé avec le drag & drop (extraction + legacy + OCR)
                        for (const filePath of files) {
                          newItems.push(await processFilePath(filePath as string));
                          added++;
                        }
                        if (newItems.length > 0) {
                          const merged = [...baseAttachments, ...newItems].slice(0, 8);
                          setAttachments(merged);
                          // Auto-send si demandé par le menu (ex: correction de document)
                          if (pendingAutoSendRef.current) {
                            const text = (pendingAutoSendTextRef.current || message || 'Voici mon document.').trim() || 'Voici mon document.';
                            pendingAutoSendRef.current = false;
                            pendingAutoSendTextRef.current = '';
                            await onSendMessage(text, merged);
                            setMessage('');
                            setAttachments([]);
                            if (textareaRef.current) textareaRef.current.style.height = 'auto';
                          }
                        }
                        toast.dismiss(loadingToast);
                        if (added > 0) toast.success(`${added} fichier(s) ajouté(s)`);
                      }
                    } else {
                      // Fallback web: input file caché
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.multiple = true;
                      input.accept = '.pdf,.docx,.doc,.pptx,.ppt,.txt,.md,.rtf,.csv,.tsv,.xlsx,.xls,.json,.xml,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.html,.css,.png,.jpg,.jpeg,.svg';
                      input.onchange = async () => {
                        if (input.files) {
                          const loadingToast = toast.loading('Lecture des fichiers…');
                          let added = 0;
                          const webNewItems: ChatAttachment[] = [];
                          for (const file of Array.from(input.files)) {
                            const kind = detectAttachmentKind(file.name);
                            try {
                              if (kind === 'pdf') {
                                if (file.size > MAX_BYTES_PDF) {
                                  webNewItems.push({ id: generateId(), name: file.name, kind, sizeBytes: file.size, excerpt: '[Fichier trop volumineux pour extraction automatique (>12MB).]' });
                                  added++;
                                  continue;
                                }
                                const buffer = await file.arrayBuffer();
                                const text = await extractPdfText(new Uint8Array(buffer));
                                webNewItems.push({ id: generateId(), name: file.name, kind, sizeBytes: file.size, excerpt: truncateMiddle(text, MAX_ATTACH_TEXT) });
                                added++;
                              } else if (kind === 'docx') {
                                if (file.size > MAX_BYTES_DOCX) {
                                  webNewItems.push({ id: generateId(), name: file.name, kind, sizeBytes: file.size, excerpt: '[Fichier trop volumineux pour extraction automatique (>10MB).]' });
                                  added++;
                                  continue;
                                }
                                const buffer = await file.arrayBuffer();
                                const text = await extractDocxText(new Uint8Array(buffer));
                                webNewItems.push({ id: generateId(), name: file.name, kind, sizeBytes: file.size, excerpt: truncateMiddle(text, MAX_ATTACH_TEXT) });
                                added++;
                              } else if (kind === 'pptx') {
                                if (file.size > MAX_BYTES_DOCX) {
                                  webNewItems.push({ id: generateId(), name: file.name, kind, sizeBytes: file.size, excerpt: '[Fichier trop volumineux pour extraction automatique (>10MB).]' });
                                  added++;
                                  continue;
                                }
                                const buffer = await file.arrayBuffer();
                                const text = await extractPptxText(new Uint8Array(buffer));
                                webNewItems.push({ id: generateId(), name: file.name, kind, sizeBytes: file.size, excerpt: truncateMiddle(text, MAX_ATTACH_TEXT) });
                                added++;
                              } else if (kind === 'xlsx') {
                                if (file.size > MAX_BYTES_XLSX) {
                                  webNewItems.push({ id: generateId(), name: file.name, kind, sizeBytes: file.size, excerpt: '[Fichier trop volumineux pour extraction automatique (>8MB).]' });
                                  added++;
                                  continue;
                                }
                                const buffer = await file.arrayBuffer();
                                const text = await extractExcelText(new Uint8Array(buffer));
                                webNewItems.push({ id: generateId(), name: file.name, kind, sizeBytes: file.size, excerpt: truncateMiddle(text, MAX_ATTACH_TEXT) });
                                added++;
                              } else if (kind === 'csv' || kind === 'tsv') {
                                const content = await file.text();
                                webNewItems.push({ id: generateId(), name: file.name, kind, sizeBytes: file.size, excerpt: truncateMiddle(content, MAX_ATTACH_TEXT) });
                                added++;
                              } else if (file.type.startsWith('text/') || kind === 'code' || kind === 'text') {
                                const content = await file.text();
                                webNewItems.push({ id: generateId(), name: file.name, kind: kind === 'binary' ? 'text' : kind, sizeBytes: file.size, excerpt: truncateMiddle(content, 9000) });
                                added++;
                              } else if (kind === 'image') {
                                const dataUrl = await imageToDataUrl(file);
                                webNewItems.push({ id: generateId(), name: file.name, kind, sizeBytes: file.size, excerpt: '[Image jointe]', dataUrl });
                                added++;
                              } else {
                                webNewItems.push({ id: generateId(), name: file.name, kind, sizeBytes: file.size, excerpt: '[Fichier joint]' });
                                added++;
                              }
                            } catch {
                              webNewItems.push({ id: generateId(), name: file.name, kind, sizeBytes: file.size, excerpt: '[Fichier joint]' });
                              added++;
                            }
                          }
                          if (webNewItems.length > 0) {
                            const merged = [...baseAttachments, ...webNewItems].slice(0, 8);
                            setAttachments(merged);
                            if (pendingAutoSendRef.current) {
                              const text = (pendingAutoSendTextRef.current || message || 'Voici mon document.').trim() || 'Voici mon document.';
                              pendingAutoSendRef.current = false;
                              pendingAutoSendTextRef.current = '';
                              await onSendMessage(text, merged);
                              setMessage('');
                              setAttachments([]);
                              if (textareaRef.current) textareaRef.current.style.height = 'auto';
                            }
                          }
                          toast.dismiss(loadingToast);
                          if (added > 0) toast.success(`${added} fichier(s) ajouté(s)`);
                        }
                      };
                      input.click();
                    }
                  } catch (err) {
                    console.error('Failed to attach file:', err);
                    toast.error('Impossible de joindre le fichier');
                  }
                }}
                className={cn(
                  'p-1.5 rounded-lg transition-all duration-200',
                  isLoading
                    ? 'text-text-muted cursor-not-allowed'
                    : 'text-text-muted hover:bg-bg-tertiary hover:text-text-secondary'
                )}
                title="Joindre un fichier"
                aria-label="Joindre un fichier"
              >
                <Plus size={16} />
              </button>

              {onPermissionChange && (
                <ToolbarMenu
                  value={permissionMode}
                  options={PERMISSIONS}
                  onChange={onPermissionChange}
                  icon={<Shield size={14} />}
                  tone={permissionMode === 'full' ? 'text-credit' : undefined}
                />
              )}
            </div>

            {/* Right side: Model selector + send */}
            <div className="flex items-center gap-2">
              {onModelChange && (
                <ToolbarMenu
                  value={selectedModel}
                  options={MODELS}
                  onChange={onModelChange}
                  icon={selectedModel === 'fast' ? <Zap size={14} /> : <Brain size={14} />}
                  align="right"
                />
              )}

              {/* Send / Stop */}
              {isLoading ? (
                <button
                  onClick={onStopGeneration}
                  className={cn(
                    'p-2 rounded-xl transition-all duration-200',
                    'bg-accent-error/15 text-accent-error',
                    'hover:bg-accent-error/25'
                  )}
                  title="Arrêter"
                  aria-label="Arrêter la génération"
                >
                  <Square size={16} />
                </button>
              ) : (
                <button
                  onClick={() => handleSubmit()}
                disabled={!hasMessage || !isOnline}
                  className={cn(
                    'p-2 rounded-full transition-all duration-200',
                  hasMessage && isOnline
                      ? 'bg-primary-btn text-primary-btn-fg hover:opacity-90 active:scale-95'
                      : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                  )}
                title={isOnline ? 'Envoyer' : 'Hors ligne'}
                aria-label={isOnline ? 'Envoyer le message' : 'Hors ligne'}
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
