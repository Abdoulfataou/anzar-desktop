/**
 * VisualBlock — visuels dessinés dans les réponses (au lieu du code brut) :
 *  - MermaidBlock : diagrammes (flowchart, séquence, ER, Gantt, camembert, mindmap…)
 *  - SvgBlock     : illustrations SVG (nettoyées par DOMPurify, sans script)
 *  - WidgetBlock  : visuels HTML interactifs, exécutés dans une iframe isolée (voir visualFrame)
 *
 * Chaque bloc : bascule Visuel ⇄ Code, copie, plein écran, enregistrement (SVG, PNG, HTML).
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Code2, Copy, Download, Eye, Loader2, Maximize2, X } from 'lucide-react';
import DOMPurify from 'dompurify';
import CodeBlock from './CodeBlock';
import { buildWidgetDocument, currentTheme, widgetUrl, WIDGET_HEIGHT_MESSAGE } from '@/lib/visualFrame';
import { exportHtml, exportPng, exportSvg } from '@/lib/visualExport';
import { useFocusTrap } from '@/hooks/useFocusTrap';

// ============================================================================
// OUTILS
// ============================================================================

let mermaidIdCounter = 0;

/** SVG généré par un modèle = contenu non fiable : liste blanche DOMPurify, sans script. */
const SVG_SANITIZE_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'embed', 'object'],
  FORBID_ATTR: ['style'],
};

function sanitizeSvg(raw: string): string {
  return DOMPurify.sanitize(raw, SVG_SANITIZE_CONFIG);
}

/** Sortie Mermaid : même contenu non fiable que le SVG du modèle. */
export function sanitizeMermaid(raw: string): string {
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'embed', 'object'],
  });
}

function useCopy(code: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return [copied, copy];
}

/** Valeur stabilisée : pendant que le modèle écrit, on attend que le code ne bouge plus. */
function useSettled<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const pngBackground = () => (currentTheme() === 'dark' ? '#16161a' : '#ffffff');

// ============================================================================
// CADRE COMMUN
// ============================================================================

type ExportAction = { label: string; run: () => void };

const ToolButton: React.FC<{ onClick: () => void; title: string; children: React.ReactNode }> = ({ onClick, title, children }) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
  >
    {children}
  </button>
);

const ExportMenu: React.FC<{ actions: ExportAction[] }> = ({ actions }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  if (actions.length === 0) return null;
  return (
    <div className="relative" ref={ref}>
      <ToolButton onClick={() => setOpen((v) => !v)} title="Enregistrer"><Download size={11} /></ToolButton>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[150px] rounded-lg border border-border-subtle bg-surface-default shadow-lg py-1">
          {actions.map((a) => (
            <button key={a.label} onClick={() => { setOpen(false); a.run(); }}
              className="block w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:bg-surface-hover hover:text-text-primary">
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const FullscreenOverlay: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  const titleId = useId();
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);
  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/70 backdrop-blur-sm p-6" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex flex-col flex-1 min-h-0 rounded-xl border border-border-subtle bg-surface-default overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-4 py-2 border-b border-border-subtle">
          <span id={titleId} className="text-xs font-semibold text-text-secondary">{title}</span>
          <button onClick={onClose} className="ml-auto p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover" aria-label="Fermer">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
};

const BlockShell: React.FC<{
  label: string;
  showCode: boolean;
  onToggle: () => void;
  code: string;
  exports?: ExportAction[];
  onFullscreen?: () => void;
  children: React.ReactNode;
}> = ({ label, showCode, onToggle, code, exports = [], onFullscreen, children }) => {
  const [copied, copy] = useCopy(code);
  return (
    <div className="my-2 rounded-xl border border-border-subtle overflow-hidden bg-surface-default">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-tertiary/60 border-b border-border-subtle">
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">{label}</span>
        <div className="ml-auto flex items-center gap-1">
          <ToolButton onClick={onToggle} title={showCode ? 'Voir le visuel' : 'Voir le code'}>
            {showCode ? <Eye size={11} /> : <Code2 size={11} />}
            {showCode ? 'Visuel' : 'Code'}
          </ToolButton>
          {onFullscreen && !showCode && (
            <ToolButton onClick={onFullscreen} title="Plein écran"><Maximize2 size={11} /></ToolButton>
          )}
          <ExportMenu actions={exports} />
          <ToolButton onClick={copy} title="Copier le code">
            {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
          </ToolButton>
        </div>
      </div>
      {children}
    </div>
  );
};

const Rendering: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-center justify-center gap-2 py-8 text-text-muted text-xs">
    <Loader2 size={14} className="animate-spin" />
    {text}
  </div>
);

const RenderError: React.FC<{ message: string; language: string; code: string }> = ({ message, language, code }) => (
  <div className="px-3 py-3">
    <div className="flex items-center gap-2 text-[11px] text-amber-400 mb-2">
      <AlertTriangle size={12} />
      Visuel non affiché ({message.slice(0, 100)}) — code source :
    </div>
    <CodeBlock language={language} code={code} hideActions />
  </div>
);

const SvgView: React.FC<{ svg: string; large?: boolean }> = ({ svg, large }) => (
  <div
    className={large
      ? 'p-6 h-full flex items-center justify-center [&_svg]:max-w-full [&_svg]:max-h-full [&_svg]:h-auto [&_svg]:w-auto'
      : 'px-3 py-3 overflow-x-auto flex justify-center [&_svg]:max-w-full [&_svg]:h-auto'}
    dangerouslySetInnerHTML={{ __html: svg }}
  />
);

// ============================================================================
// MERMAID
// ============================================================================

export const MermaidBlock: React.FC<{ code: string }> = ({ code }) => {
  const settled = useSettled(code, 400);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [full, setFull] = useState(false);
  const idRef = useRef(`anzar-mermaid-${++mermaidIdCounter}`);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: currentTheme() === 'dark' ? 'dark' : 'neutral',
          fontFamily: 'inherit',
        });
        const { svg: rendered } = await mermaid.render(idRef.current, settled);
        // Mermaid reste un parseur complexe : on ne fait pas confiance à sa sortie.
        // On garde les styles (couleurs du thème) mais on retire scripts/iframes/foreignObject.
        if (!cancelled) { setSvg(sanitizeMermaid(rendered)); setError(''); }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Syntaxe Mermaid invalide');
      }
    })();
    return () => { cancelled = true; };
  }, [settled]);

  const exports: ExportAction[] = svg ? [
    { label: 'Image PNG', run: () => exportPng(svg, 'diagramme', pngBackground()) },
    { label: 'Image SVG', run: () => exportSvg(svg, 'diagramme') },
  ] : [];

  return (
    <BlockShell label="Diagramme" showCode={showCode} onToggle={() => setShowCode((v) => !v)} code={code}
      exports={exports} onFullscreen={svg ? () => setFull(true) : undefined}>
      {showCode ? <CodeBlock language="mermaid" code={code} hideActions />
        : error ? <RenderError message={error} language="mermaid" code={code} />
        : !svg ? <Rendering text="Rendu du diagramme…" />
        : <SvgView svg={svg} />}
      {full && svg && <FullscreenOverlay title="Diagramme" onClose={() => setFull(false)}><SvgView svg={svg} large /></FullscreenOverlay>}
    </BlockShell>
  );
};

// ============================================================================
// SVG
// ============================================================================

export const SvgBlock: React.FC<{ code: string }> = ({ code }) => {
  const [showCode, setShowCode] = useState(false);
  const [full, setFull] = useState(false);
  const clean = sanitizeSvg(code);
  const complete = /<\/svg>\s*$/i.test(code.trim());
  const looksValid = /<svg[\s>]/i.test(clean);

  const exports: ExportAction[] = looksValid && complete ? [
    { label: 'Image PNG', run: () => exportPng(clean, 'illustration', pngBackground()) },
    { label: 'Image SVG', run: () => exportSvg(clean, 'illustration') },
  ] : [];

  return (
    <BlockShell label="Illustration" showCode={showCode} onToggle={() => setShowCode((v) => !v)} code={code}
      exports={exports} onFullscreen={looksValid ? () => setFull(true) : undefined}>
      {showCode || !looksValid ? <CodeBlock language="svg" code={code} hideActions /> : <SvgView svg={clean} />}
      {full && <FullscreenOverlay title="Illustration" onClose={() => setFull(false)}><SvgView svg={clean} large /></FullscreenOverlay>}
    </BlockShell>
  );
};

// ============================================================================
// WIDGET HTML INTERACTIF
// ============================================================================

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 1400;

const WidgetFrame: React.FC<{ code: string; fill?: boolean; onError: (msg: string) => void }> = ({ code, fill, onError }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<{ url: string; token: string } | null>(null);
  const [height, setHeight] = useState(240);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    widgetUrl(code, currentTheme()).then(
      (r) => { if (!cancelled) setSrc(r); },
      (e) => { if (!cancelled) setFailed(e instanceof Error ? e.message : String(e)); },
    );
    return () => { cancelled = true; };
  }, [code]);

  useEffect(() => {
    if (!src) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; token?: string; height?: number; error?: string } | null;
      if (!d || d.type !== WIDGET_HEIGHT_MESSAGE || d.token !== src.token) return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (typeof d.height === 'number') setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, d.height)));
      if (d.error) onError(d.error);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [src, onError]);

  if (failed) return <RenderError message={failed} language="html" code={code} />;
  if (!src) return <Rendering text="Préparation du visuel…" />;
  return (
    <iframe
      ref={iframeRef}
      src={src.url}
      title="Visuel interactif"
      // Origine opaque : jamais allow-same-origin (avec allow-scripts, l'isolation sauterait)
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className="block w-full border-0 bg-transparent"
      style={{ height: fill ? '100%' : height }}
    />
  );
};

export const WidgetBlock: React.FC<{ code: string }> = ({ code }) => {
  // Pendant l'écriture du modèle, on n'exécute pas un document à moitié écrit
  const settled = useSettled(code, 700);
  const writing = settled !== code;
  const [showCode, setShowCode] = useState(false);
  const [full, setFull] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');
  const onError = React.useCallback((msg: string) => setRuntimeError(msg), []);
  useEffect(() => setRuntimeError(''), [settled]);

  const exports: ExportAction[] = [
    { label: 'Page HTML', run: () => exportHtml(buildWidgetDocument(settled, 'export', currentTheme()), 'visuel') },
  ];

  return (
    <BlockShell label="Visuel interactif" showCode={showCode} onToggle={() => setShowCode((v) => !v)} code={code}
      exports={writing ? [] : exports} onFullscreen={writing ? undefined : () => setFull(true)}>
      {showCode ? <CodeBlock language="html" code={code} hideActions />
        : writing ? <Rendering text="Écriture du visuel…" />
        : <WidgetFrame code={settled} onError={onError} />}
      {runtimeError && !showCode && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border-subtle text-[11px] text-amber-400">
          <AlertTriangle size={12} /> Erreur dans le visuel : {runtimeError.slice(0, 160)}
        </div>
      )}
      {full && (
        <FullscreenOverlay title="Visuel interactif" onClose={() => setFull(false)}>
          <WidgetFrame code={settled} fill onError={onError} />
        </FullscreenOverlay>
      )}
    </BlockShell>
  );
};

// ============================================================================
// DÉTECTION
// ============================================================================

export type VisualKind = 'mermaid' | 'svg' | 'widget';

/** Bloc de code à dessiner plutôt qu'à afficher (```html reste du code : c'est souvent du code de projet). */
export function getVisualKind(language: string | undefined, code: string): VisualKind | null {
  const lang = (language || '').toLowerCase();
  if (lang === 'mermaid') return 'mermaid';
  if (lang === 'svg') return 'svg';
  if (lang === 'widget' || lang === 'visuel' || lang === 'html-widget') return 'widget';
  if ((lang === 'html' || lang === 'xml' || lang === '') && /^\s*<svg[\s>]/i.test(code)) return 'svg';
  return null;
}
