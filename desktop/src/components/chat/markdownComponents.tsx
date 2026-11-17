/**
 * Rendu Markdown des réponses de l'agent (titres, listes, tableaux, code, schémas).
 * Partagé par le chat et l'onglet Plan pour un affichage identique.
 */
import type { Components } from 'react-markdown';
import CodeBlock from './CodeBlock';
import { MermaidBlock, SvgBlock, WidgetBlock, getVisualKind } from './VisualBlock';
import { openExternalUrl } from '@/services/infra/externalLinks';
import { openFromChat } from '@/lib/openFromChat';

// ============================================================================
// CHEMINS DE FICHIERS CLIQUABLES dans le texte des réponses
// (« j'ai modifié index.html » → clic → ouvre l'éditeur / la visionneuse)
// ============================================================================

const FILE_PATH_RE = /(?:^|[\s(`«"]|→\s?)((?:\.?\/)?[\w@./-]+\.(?:html?|css|scss|js|jsx|ts|tsx|py|json|md|svg|png|jpe?g|webp|gif|mp4|webm|mov|m4v|csv|xlsx|pdf|txt|yml|yaml|toml|sh))(?=$|[\s).,;:!?`»"])/g;

/** Vrai si l'occurrence n'est PAS l'hôte d'une URL (précédée de ://). */
function isStandalonePath(text: string, matchIndex: number, pathStart: number): boolean {
  const before = text.slice(0, pathStart);
  return !before.endsWith('://') && !/https?$/.test(before.slice(-6));
}

/** Découpe les segments texte d'un nœud et rend les chemins cliquables. */
function linkifyNode(node: React.ReactNode, keyPrefix: string): React.ReactNode {
  if (typeof node === 'string') {
    const parts: React.ReactNode[] = [];
    let last = 0;
    FILE_PATH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = FILE_PATH_RE.exec(node)) !== null) {
      const path = m[1];
      const pathStart = m.index + m[0].indexOf(path);
      if (!isStandalonePath(node, m.index, pathStart)) continue;
      if (pathStart > last) parts.push(node.slice(last, pathStart));
      parts.push(
        <span
          key={`${keyPrefix}-f${i++}`}
          role="button"
          tabIndex={0}
          title={`Ouvrir ${path}`}
          onClick={() => void openFromChat(path)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openFromChat(path); } }}
          className="font-mono text-ui-sm text-link underline decoration-transparent underline-offset-2 hover:decoration-current cursor-pointer transition-colors"
        >
          {path}
        </span>
      );
      last = pathStart + path.length;
    }
    if (parts.length === 0) return node;
    if (last < node.length) parts.push(node.slice(last));
    return parts;
  }
  if (Array.isArray(node)) return node.map((child, i) => linkifyNode(child, `${keyPrefix}-${i}`));
  return node;
}

export function markdownComponents({ hideCodeActions = false }: { hideCodeActions?: boolean } = {}): Components {
  return {
  p: ({ children }) => (
    <p className="text-ui-base leading-[1.7] my-3 first:mt-0 last:mb-0">
      {linkifyNode(children, 'p')}
    </p>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="font-medium text-link no-underline decoration-dotted underline-offset-4 hover:underline"
      onClick={(e) => {
        // Grand public: empêcher la navigation interne, ouvrir via wrapper sécurisé
        e.preventDefault();
        if (href) void openExternalUrl(String(href));
      }}
    >
      {children}
    </a>
  ),
  // Un bloc ``` est rendu par CodeBlock : <pre> ne doit rien ajouter autour.
  pre: ({ children }) => <div className="my-3 first:mt-0 last:mb-0">{children}</div>,
  code: ({ className, children, node: _node, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : 'text';

    // react-markdown 9 ne transmet plus `inline` : un code sans langage
    // et sur une seule ligne est du code en ligne (`comme ceci`).
    const isInline = !match && !String(children).includes('\n');
    if (isInline) {
      return (
        <code className="mx-0.5 rounded-md bg-inline-code px-1.5 py-0.5 font-mono text-ui-sm text-text-primary" {...props}>
          {children}
        </code>
      );
    }

    const raw = String(children).replace(/\n$/, '');

    // ── Visuels : les blocs mermaid / svg / widget sont DESSINÉS, pas affichés en code ──
    const visualKind = getVisualKind(language, raw);
    if (visualKind === 'mermaid') return <MermaidBlock code={raw} />;
    if (visualKind === 'svg') return <SvgBlock code={raw} />;
    if (visualKind === 'widget') return <WidgetBlock code={raw} />;

    return (
      <CodeBlock
        language={language}
        code={raw}
        hideActions={hideCodeActions}
      />
    );
  },
  ul: ({ children }) => <ul className="my-3 first:mt-0 last:mb-0 list-outside list-disc space-y-1.5 pl-5 marker:text-text-muted [&_ul]:my-1.5 [&_ol]:my-1.5">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 first:mt-0 last:mb-0 list-inside list-decimal space-y-1.5 pl-0 marker:text-text-muted [&_ul]:my-1.5 [&_ol]:my-1.5">{children}</ol>,
  li: ({ children }) => <li className="pl-1 leading-[1.7] [&>p]:my-0 [&>p]:inline">{linkifyNode(children, 'li')}</li>,
  hr: () => <hr className="my-6 border-border-medium" />,
  strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-border-strong pl-3 text-text-secondary [&_p]:my-0 [&_p+p]:mt-2">{children}</blockquote>
  ),
  h1: ({ children }) => <h1 className="mt-6 mb-4 first:mt-0 text-ui-xl font-semibold text-text-primary">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-6 mb-4 first:mt-0 text-ui-lg font-semibold text-text-primary">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-6 mb-4 first:mt-0 text-ui-base font-semibold text-text-primary">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-6 mb-4 first:mt-0 text-ui-base font-semibold text-text-primary">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-6 mb-4 first:mt-0 text-ui-base font-medium text-text-primary">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-6 mb-4 first:mt-0 text-ui-base font-normal text-text-primary">{children}</h6>,
  table: ({ children }) => (
    <div className="my-3 first:mt-0 last:mb-0 w-full overflow-hidden rounded-xl border border-border-medium">
      <div className="w-full overflow-x-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-ui-base">{children}</table>
      </div>
    </div>
  ),
  tr: ({ children }) => <tr className="transition-colors last:[&>td]:border-b-0 hover:bg-hover-fill">{children}</tr>,
  th: ({ children }) => <th className="border-b border-border-medium px-3 py-2 text-left font-normal text-text-muted min-w-16 max-w-md whitespace-normal break-words">{children}</th>,
  td: ({ children }) => <td className="border-b border-border-medium px-3 py-2 align-top text-text-primary min-w-16 max-w-md whitespace-normal break-words">{children}</td>,
};
}
