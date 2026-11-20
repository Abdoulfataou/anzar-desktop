/**
 * Briques communes du panneau : en-tête de page, onglets, cartes de chiffres, tableaux,
 * pagination, fenêtres modales, champs de formulaire.
 */
import { useEffect, useState } from 'react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './Button'
import { useAuthStore } from '@/stores/authStore'

// ── Droits ───────────────────────────────────────────────────────────────────

export function usePermissions() {
  const role = useAuthStore((s) => s.user?.role)
  return {
    role,
    isOwner: role === 'owner',
    canManageMoney: role === 'owner' || role === 'admin',
    canToggleUsers: role === 'owner' || role === 'admin' || role === 'support',
    canSeeAudit: role === 'owner' || role === 'admin',
  }
}

// ── Mise en page ─────────────────────────────────────────────────────────────

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground-primary">{title}</h1>
        {description && <p className="text-sm text-foreground-secondary mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Panel({ title, description, actions, children, className, padded = true }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean
}) {
  return (
    <section className={cn('rounded-lg border border-border bg-background-tertiary', className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-border-subtle">
          <div>
            {title && <h3 className="text-sm font-semibold text-foreground-primary">{title}</h3>}
            {description && <p className="text-xs text-foreground-secondary mt-0.5">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  )
}

// ── Onglets (synchronisés avec l'URL : ?tab=…) ───────────────────────────────

export type TabDef = { id: string; label: string; count?: number; hidden?: boolean }

export function useTab(tabs: TabDef[], param = 'tab'): [string, (id: string) => void] {
  const [sp, setSp] = useSearchParams()
  const visible = tabs.filter((t) => !t.hidden)
  const current = visible.find((t) => t.id === sp.get(param))?.id ?? visible[0]?.id ?? ''
  const set = (id: string) => {
    const next = new URLSearchParams(sp)
    next.set(param, id)
    next.delete('page')
    setSp(next, { replace: true })
  }
  return [current, set]
}

export function Tabs({ tabs, value, onChange }: { tabs: TabDef[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border mb-5" role="tablist">
      {tabs.filter((t) => !t.hidden).map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
            value === t.id
              ? 'border-accent-primary text-accent-primary'
              : 'border-transparent text-foreground-secondary hover:text-foreground-primary',
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cn('ml-2 rounded-full px-1.5 py-0.5 text-[10px]',
              value === t.id ? 'bg-accent-primary/15' : 'bg-background-secondary')}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

// ── Chiffres clés ────────────────────────────────────────────────────────────

export function Stat({ label, value, hint, icon, tone = 'default', onClick }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode
  tone?: 'default' | 'success' | 'warning' | 'error' | 'primary'; onClick?: () => void
}) {
  const toneCls = {
    default: 'text-foreground-primary',
    primary: 'text-accent-primary',
    success: 'text-accent-success',
    warning: 'text-accent-warning',
    error: 'text-accent-error',
  }[tone]
  return (
    <div
      onClick={onClick}
      className={cn('rounded-lg border border-border bg-background-tertiary p-4',
        onClick && 'cursor-pointer hover:border-border-strong transition-colors')}
    >
      <div className="flex items-center justify-between text-xs text-foreground-secondary">
        <span>{label}</span>
        {icon && <span className="text-foreground-muted">{icon}</span>}
      </div>
      <div className={cn('mt-2 text-2xl font-semibold tabular-nums', toneCls)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-foreground-muted">{hint}</div>}
    </div>
  )
}

// ── Tableaux ─────────────────────────────────────────────────────────────────

export type Column<T> = {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
}

export function DataTable<T>({ columns, rows, rowKey, loading, error, empty = 'Aucun résultat', onRowClick }: {
  columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string | number; loading?: boolean
  error?: string | null; empty?: string; onRowClick?: (row: T) => void
}) {
  if (error) return <ErrorBox message={error} />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-foreground-muted border-b border-border-subtle">
            {columns.map((c) => (
              <th key={c.key} className={cn('px-4 py-2.5 font-medium whitespace-nowrap',
                c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-4 py-10 text-center"><Spinner /></td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={columns.length}><Empty text={empty} /></td></tr>
          ) : rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cn('border-b border-border-subtle last:border-0',
                onRowClick && 'cursor-pointer hover:bg-background-secondary/60', loading && 'opacity-60')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('px-4 py-2.5 align-middle',
                  c.align === 'right' && 'text-right tabular-nums', c.align === 'center' && 'text-center', c.className)}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Pagination({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null
  const page = Math.floor(offset / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))
  return (
    <div className="flex items-center justify-between px-4 py-3 text-xs text-foreground-secondary border-t border-border-subtle">
      <span>{offset + 1}–{Math.min(offset + limit, total)} sur {total}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span>Page {page} / {pages}</span>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onChange(offset + limit)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-foreground-muted inline-block', className)} />
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-foreground-muted">
      <Inbox className="h-8 w-8 mb-2 opacity-60" />
      <p className="text-sm">{text}</p>
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-accent-error/30 bg-accent-error/10 p-4 text-sm text-accent-error">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="flex-1">{message}</div>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Réessayer</Button>}
    </div>
  )
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' }) {
  return (
    <div className={cn('rounded-lg border p-3 text-xs leading-relaxed',
      tone === 'warning'
        ? 'border-accent-warning/30 bg-accent-warning/10 text-accent-warning'
        : 'border-accent-primary/20 bg-accent-primary/5 text-foreground-secondary')}>
      {children}
    </div>
  )
}

// ── Formulaires ──────────────────────────────────────────────────────────────

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-foreground-secondary mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-foreground-muted mt-1">{hint}</span>}
    </label>
  )
}

const inputCls = 'w-full h-10 rounded-md border border-border bg-background-secondary px-3 text-sm text-foreground-primary placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-primary'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputCls, props.className)} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputCls, 'h-auto min-h-[72px] py-2', props.className)} />
}

export function Select({ options, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select {...props} className={cn(inputCls, 'pr-8', props.className)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

/** Valeur différée (recherche au clavier sans requête à chaque touche). */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

// ── Fenêtre modale ───────────────────────────────────────────────────────────

export function Modal({ open, title, onClose, children, footer, width = 'max-w-lg' }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div className={cn('w-full rounded-xl border border-border bg-background-secondary shadow-2xl', width)}
        onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground-primary" aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-4 border-t border-border-subtle">{footer}</div>}
      </div>
    </div>
  )
}

// ── Chargement de données ────────────────────────────────────────────────────

/** Charge une ressource ; se relance quand `deps` change. reload() pour rafraîchir. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): {
  data: T | null; loading: boolean; error: string | null; reload: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true)
    fn().then(
      (d) => { if (alive) { setData(d); setError(null) } },
      (e) => { if (alive) setError(e instanceof Error ? e.message : 'Erreur de chargement') },
    ).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { data, loading, error, reload: () => setTick((t) => t + 1) }
}
