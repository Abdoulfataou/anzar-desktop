/**
 * ChatInput - Barre de saisie unifiée ANZAR
 * Sélecteur de projet intégré + textarea + modèle + envoi
 * Inspiré TRAE SOLO mais design original ANZAR
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  Paperclip, Square, Zap, Brain, ArrowUp,
  FolderOpen, ChevronDown, Plus, Check,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, isTauri, generateId } from '@/lib/utils';
import { AIModel, Project, ChatAttachment, ChatAttachmentKind } from '@/types';
import { useProjectStore } from '@/stores/projectStore';
import { isAllowedProjectRoot, showPathNotAllowedMessage } from '@/lib/allowedProjectRoots';
import { readTextFile, readBinaryFile } from '@tauri-apps/api/fs';

interface ChatInputProps {
  onSendMessage: (message: string, attachments?: ChatAttachment[]) => Promise<void> | void;
  onStopGeneration?: () => void;
  isLoading?: boolean;
  isOnline?: boolean;
  selectedModel?: AIModel;
  onModelChange?: (model: AIModel) => void;
  selectedProjectId?: string | null;
  onSelectProject?: (projectId: string | null) => void;
  placeholder?: string;
  maxHeight?: number;
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
    // Set worker (local bundle first; CDN fallback)
    try {
      const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min?url')).default as string;
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    } catch {
      // Fallback: CDN (peut échouer offline)
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
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
    return pages.join('\n\n') || '[PDF sans texte extractible]';
  } catch {
    return '[Erreur lors de la lecture du PDF — essayez un fichier Word (.docx) pour de meilleurs résultats]';
  }
}

/* ===== Project Selector Dropdown ===== */
function ProjectSelector({
  selectedProjectId,
  onSelectProject,
  projects,
  onOpenFolder,
}: {
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  projects: Project[];
  onOpenFolder: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
          'border shadow-sm',
          'focus:outline-none focus:ring-1 focus:ring-accent-primary/40',
          selectedProject
            ? 'bg-accent-primary/15 border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20'
            : 'bg-surface-default/80 border-border-medium text-text-secondary hover:text-text-primary hover:bg-surface-hover'
        )}
      >
        <FolderOpen size={13} />
        <span className="max-w-[120px] truncate">
          {selectedProject ? selectedProject.name : 'Projet'}
        </span>
        <ChevronDown size={12} className={cn('transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute bottom-full mb-2 left-0 w-56 bg-bg-secondary border border-border-medium rounded-xl shadow-2xl z-50 overflow-hidden py-1">
            {/* No project option */}
            <button
              onClick={() => { onSelectProject(null); setIsOpen(false); }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left',
                !selectedProjectId
                  ? 'bg-accent-primary/10 text-accent-primary'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              )}
            >
              {!selectedProjectId && <Check size={12} className="flex-shrink-0" />}
              {selectedProjectId && <div className="w-3" />}
              <span>Aucun projet</span>
            </button>

            {projects.length > 0 && (
              <div className="h-px bg-border-subtle mx-2 my-1" />
            )}

            {/* Project list */}
            <div className="max-h-48 overflow-y-auto">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => { onSelectProject(project.id); setIsOpen(false); }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left',
                    selectedProjectId === project.id
                      ? 'bg-accent-primary/10 text-accent-primary'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                  )}
                >
                  {selectedProjectId === project.id ? <Check size={12} className="flex-shrink-0" /> : <div className="w-3" />}
                  <FolderOpen size={12} className="text-accent-secondary flex-shrink-0" />
                  <span className="truncate flex-1">{project.name}</span>
                  <span className={cn(
                    'w-1.5 h-1.5 rounded-full flex-shrink-0',
                    project.status === 'complete' ? 'bg-accent-success' :
                    project.status === 'generating' ? 'bg-accent-info' :
                    'bg-accent-warning'
                  )} />
                </button>
              ))}
            </div>

            <div className="h-px bg-border-subtle mx-2 my-1" />

            {/* Add folder */}
            <button
              onClick={() => { onOpenFolder(); setIsOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors text-left"
            >
              <div className="w-3" />
              <Plus size={12} />
              <span>Ajouter un dossier...</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ===== Model Toggle (visible pill) ===== */
function ModelToggle({
  selectedModel,
  onModelChange,
}: {
  selectedModel: AIModel;
  onModelChange: (model: AIModel) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-bg-tertiary/80 border border-border-subtle">
      <button
        onClick={() => onModelChange('fast')}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200',
          selectedModel === 'fast'
            ? 'bg-accent-primary text-white shadow-sm'
            : 'text-text-muted hover:text-text-secondary'
        )}
      >
        <Zap size={13} />
        Rapide
      </button>
      <button
        onClick={() => onModelChange('thinking')}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200',
          selectedModel === 'thinking'
            ? 'bg-accent-secondary text-white shadow-sm'
            : 'text-text-muted hover:text-text-secondary'
        )}
      >
        <Brain size={13} />
        Réflexion
      </button>
    </div>
  );
}

/* ===== Main ChatInput ===== */
export default function ChatInput({
  onSendMessage,
  onStopGeneration,
  isLoading = false,
  isOnline = true,
  selectedModel = 'fast',
  onModelChange,
  selectedProjectId = null,
  onSelectProject,
  placeholder = 'Décris ta tâche, ANZAR s\'en occupe...',
  maxHeight = MAX_HEIGHT,
}: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const pendingAutoSendRef = useRef(false);
  const pendingAutoSendTextRef = useRef<string>('');
  const projects = useProjectStore((s) => s.projects);

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
      await onSendMessage(contentToSend, attachments);
      setMessage('');
      setAttachments([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleOpenFolder = async () => {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Ajouter un projet',
      });
      if (selected && typeof selected === 'string') {
        const allowed = await isAllowedProjectRoot(selected);
        if (!allowed) {
          toast.error('Dossier non autorisé. Choisis un dossier dans ton répertoire personnel.');
          return;
        }
        const folderName = selected.split(/[/\\]/).pop() || 'Projet';
        const { createProject, updateProject } = useProjectStore.getState();
        const project = createProject(folderName, `Projet: ${selected}`, 'fast');
        updateProject(project.id, {
          status: 'complete',
          metadata: { localPath: selected, imported: true },
        });
        onSelectProject?.(project.id);
      }
    } catch (err) {
      console.error('Failed to open folder:', err);
      toast.error('Impossible d\'ouvrir le dossier — vérifie les permissions');
    }
  };

  const hasMessage = message.trim().length > 0 || attachments.length > 0;
  const MAX_BYTES_PDF = 12 * 1024 * 1024;   // 12MB
  const MAX_BYTES_DOCX = 10 * 1024 * 1024;  // 10MB
  const MAX_BYTES_XLSX = 8 * 1024 * 1024;   // 8MB
  const MAX_ATTACH_TEXT = 180000;            // ~45K tokens — assez pour un mémoire entier (jusqu'à ~90 pages)

  return (
    <div className="relative z-40 bg-bg-primary">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-4 pt-2">
        {/* Input container */}
        <div className={cn(
          'rounded-2xl border transition-all duration-300 overflow-hidden',
          'bg-surface-default/80 backdrop-blur-md',
          isFocused
            ? 'glow-border-active shadow-lg'
            : 'border-border-subtle hover:border-border-medium'
        )}>
          {/* Textarea area */}
          <div className="flex items-end gap-2 px-4 pt-4 pb-2">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder={placeholder}
              disabled={isLoading}
              rows={1}
              className={cn(
                'flex-1 bg-transparent border-none outline-none resize-none',
                'text-text-primary placeholder-text-muted',
                'text-sm leading-relaxed',
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
            <div className="px-4 pb-2 flex flex-wrap gap-2">
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
          <div className="flex items-center justify-between px-3 py-2 border-t border-border-subtle/50">
            {/* Left side: Project selector + attachment */}
            <div className="flex items-center gap-2">
              <ProjectSelector
                selectedProjectId={selectedProjectId}
                onSelectProject={onSelectProject || (() => {})}
                projects={projects}
                onOpenFolder={handleOpenFolder}
              />

              <div className="w-px h-4 bg-border-subtle" />

              <button
                ref={attachButtonRef}
                disabled={isLoading}
                onClick={async () => {
                  try {
                    const baseAttachments = attachments;
                    const newItems: ChatAttachment[] = [];
                    // Essayer Tauri dialog en premier
                    if (isTauri()) {
                      const { open: openDialog } = await import('@tauri-apps/api/dialog');
                      const selected = await openDialog({
                        multiple: true,
                        title: 'Joindre des fichiers',
                        filters: [
                          { name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'txt', 'md', 'rtf'] },
                          { name: 'Données', extensions: ['csv', 'tsv', 'xlsx', 'xls', 'json', 'xml'] },
                          { name: 'Code', extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'html', 'css', 'yaml', 'sql'] },
                          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
                          { name: 'Tous', extensions: ['*'] },
                        ],
                      });
                      if (selected) {
                        const files = Array.isArray(selected) ? selected : [selected];
                        const loadingToast = toast.loading('Lecture des fichiers…');
                        let added = 0;
                        for (const filePath of files) {
                          const name = (filePath as string).split(/[/\\]/).pop() || 'fichier';
                          const kind = detectAttachmentKind(name);
                          try {
                            if (kind === 'pdf') {
                              const bytes = await readBinaryFile(filePath);
                              if (bytes.byteLength > MAX_BYTES_PDF) {
                                newItems.push({ id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: '[Fichier trop volumineux pour extraction automatique (>12MB).]' });
                                added++;
                                continue;
                              }
                              const text = await extractPdfText(bytes);
                              newItems.push({ id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: truncateMiddle(text, MAX_ATTACH_TEXT) });
                              added++;
                            } else if (kind === 'docx') {
                              const bytes = await readBinaryFile(filePath);
                              if (bytes.byteLength > MAX_BYTES_DOCX) {
                                newItems.push({ id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: '[Fichier trop volumineux pour extraction automatique (>10MB).]' });
                                added++;
                                continue;
                              }
                              const text = await extractDocxText(bytes);
                              newItems.push({ id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: truncateMiddle(text, MAX_ATTACH_TEXT) });
                              added++;
                            } else if (kind === 'pptx') {
                              const bytes = await readBinaryFile(filePath);
                              if (bytes.byteLength > MAX_BYTES_DOCX) {
                                newItems.push({ id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: '[Fichier trop volumineux pour extraction automatique (>10MB).]' });
                                added++;
                                continue;
                              }
                              const text = await extractPptxText(bytes);
                              newItems.push({ id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: truncateMiddle(text, MAX_ATTACH_TEXT) });
                              added++;
                            } else if (kind === 'xlsx') {
                              const bytes = await readBinaryFile(filePath);
                              if (bytes.byteLength > MAX_BYTES_XLSX) {
                                newItems.push({ id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: '[Fichier trop volumineux pour extraction automatique (>8MB).]' });
                                added++;
                                continue;
                              }
                              const text = await extractExcelText(bytes);
                              newItems.push({ id: generateId(), name, kind, sizeBytes: bytes.byteLength, excerpt: truncateMiddle(text, MAX_ATTACH_TEXT) });
                              added++;
                            } else if (kind === 'csv' || kind === 'tsv') {
                              const content = await readTextFile(filePath);
                              newItems.push({ id: generateId(), name, kind, excerpt: truncateMiddle(content, MAX_ATTACH_TEXT) });
                              added++;
                            } else {
                              // Try reading as text file, otherwise keep as binary attachment
                              const content = await readTextFile(filePath);
                              newItems.push({ id: generateId(), name, kind: kind === 'binary' ? 'text' : kind, excerpt: truncateMiddle(content, 9000) });
                              added++;
                            }
                          } catch {
                            newItems.push({ id: generateId(), name, kind, excerpt: kind === 'image' ? '[Image jointe]' : '[Fichier joint]' });
                            added++;
                          }
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
                              } else {
                                webNewItems.push({ id: generateId(), name: file.name, kind, sizeBytes: file.size, excerpt: kind === 'image' ? '[Image jointe]' : '[Fichier joint]' });
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
              >
                <Paperclip size={15} />
              </button>
            </div>

            {/* Right side: Model selector + send */}
            <div className="flex items-center gap-2">
              {onModelChange && (
                <ModelToggle
                  selectedModel={selectedModel}
                  onModelChange={onModelChange}
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
                >
                  <Square size={16} />
                </button>
              ) : (
                <button
                  onClick={() => handleSubmit()}
                disabled={!hasMessage || !isOnline}
                  className={cn(
                    'p-2 rounded-xl transition-all duration-200',
                  hasMessage && isOnline
                      ? 'gradient-bg text-white shadow-md hover:opacity-90 active:scale-95'
                      : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                  )}
                title={isOnline ? 'Envoyer' : 'Hors ligne'}
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
