/**
 * VisualBlock — Rendu inline des visuels générés par l'IA (chaînon manquant).
 *
 * Le prompt "visuel" (routé vers Kimi) fait générer du Mermaid/SVG au modèle,
 * mais l'utilisateur voyait le CODE BRUT. Ces composants dessinent réellement :
 *  - MermaidBlock : flowcharts, séquences, ER, Gantt, camemberts, mindmaps…
 *  - SvgBlock     : illustrations/infographies SVG (sanitisées)
 *
 * Chaque bloc offre un toggle Diagramme ⇄ Code et la copie du source.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Code2, Eye, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import CodeBlock from './CodeBlock';

// ============================================================================
// HELPERS
// ============================================================================

let mermaidIdCounter = 0;

/** Sanitisation SVG : retire scripts, handlers d'événements et liens js. */
function sanitizeSvg(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/(href|xlink:href)\s*=\s*"(javascript|data:text\/html)[^"]*"/gi, '$1="#"');
}

const BlockShell: React.FC<{
  label: string;
  showCode: boolean;
  onToggle: () => void;
  onCopy: () => void;
  copied: boolean;
  children: React.ReactNode;
}> = ({ label, showCode, onToggle, onCopy, copied, children }) => (
  <div className="my-2 rounded-xl border border-border-subtle overflow-hidden bg-surface-default">
    <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-tertiary/60 border-b border-border-subtle">
      <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">{label}</span>
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          {showCode ? <Eye size={11} /> : <Code2 size={11} />}
          {showCode ? 'Visuel' : 'Code'}
        </button>
        <button
          onClick={onCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
        </button>
      </div>
    </div>
    {children}
  </div>
);

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

// ============================================================================
// MERMAID
// ============================================================================

export const MermaidBlock: React.FC<{ code: string }> = ({ code }) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [showCode, setShowCode] = useState(false);
  const [copied, copy] = useCopy(code);
  const idRef = useRef(`anzar-mermaid-${++mermaidIdCounter}`);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // @ts-ignore — mermaid est déclaré dans package.json ; le @ts-ignore
        // permet de compiler même avant le premier `npm install` local.
        const mermaid = (await import('mermaid')).default;
        const isDark = document.documentElement.classList.contains('dark');
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDark ? 'dark' : 'neutral',
          fontFamily: 'inherit',
        });
        const { svg: rendered } = await mermaid.render(idRef.current, code);
        if (!cancelled) { setSvg(rendered); setError(''); }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Syntaxe Mermaid invalide');
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  return (
    <BlockShell label="Diagramme" showCode={showCode} onToggle={() => setShowCode(v => !v)} onCopy={copy} copied={copied}>
      {showCode ? (
        <CodeBlock language="mermaid" code={code} hideActions />
      ) : error ? (
        <div className="px-3 py-3">
          <div className="flex items-center gap-2 text-[11px] text-amber-400 mb-2">
            <AlertTriangle size={12} />
            Diagramme non rendu ({error.slice(0, 80)}) — code source :
          </div>
          <CodeBlock language="mermaid" code={code} hideActions />
        </div>
      ) : !svg ? (
        <div className="flex items-center justify-center gap-2 py-8 text-text-muted text-xs">
          <Loader2 size={14} className="animate-spin" />
          Rendu du diagramme…
        </div>
      ) : (
        <div
          className="px-3 py-3 overflow-x-auto flex justify-center [&_svg]:max-w-full [&_svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </BlockShell>
  );
};

// ============================================================================
// SVG
// ============================================================================

export const SvgBlock: React.FC<{ code: string }> = ({ code }) => {
  const [showCode, setShowCode] = useState(false);
  const [copied, copy] = useCopy(code);
  const clean = sanitizeSvg(code);
  const looksValid = /<svg[\s>]/i.test(clean);

  return (
    <BlockShell label="Illustration" showCode={showCode} onToggle={() => setShowCode(v => !v)} onCopy={copy} copied={copied}>
      {showCode || !looksValid ? (
        <CodeBlock language="svg" code={code} hideActions />
      ) : (
        <div
          className="px-3 py-3 overflow-x-auto flex justify-center bg-white/[0.02] [&_svg]:max-w-full [&_svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: clean }}
        />
      )}
    </BlockShell>
  );
};

/** Détecte si un bloc de code doit être rendu visuellement. */
export function getVisualKind(language: string | undefined, code: string): 'mermaid' | 'svg' | null {
  const lang = (language || '').toLowerCase();
  if (lang === 'mermaid') return 'mermaid';
  if (lang === 'svg') return 'svg';
  if ((lang === 'html' || lang === 'xml' || lang === '') && /^\s*<svg[\s>]/i.test(code)) return 'svg';
  return null;
}
