/**
 * Devises et prix — multidevise.
 *
 * Le FCFA reste l'unité du grand livre (1 crédit = 1 FCFA). Ici on règle seulement
 * ce que l'utilisateur voit et paie : devises proposées, grille de packs à prix ronds
 * par devise, marge de change des prix calculés, taux d'affichage et leur date.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  DataTable, Field, Modal, Notice, PageHeader, Panel, Select, Tabs, TextInput, useLoad, usePermissions, useTab,
} from '@/components/ui/kit'
import { api, AdminCurrency, AdminPack } from '@/api/backend'
import { ago, dateTime, fcfa, label, minor, PROVIDER_LABELS } from '@/lib/format'

const TABS = [
  { id: 'currencies', label: 'Devises' },
  { id: 'packs', label: 'Grille de packs' },
  { id: 'rates', label: 'Taux' },
  { id: 'settings', label: 'Réglages' },
]

function rateText(c: AdminCurrency): string {
  if (c.fcfa_per_unit == null) return '—'
  const v = c.fcfa_per_unit >= 10 ? c.fcfa_per_unit.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
    : c.fcfa_per_unit.toLocaleString('fr-FR', { maximumFractionDigits: 5 })
  return `${v} F`
}

export default function CurrenciesPage() {
  const [tab, setTab] = useTab(TABS)
  return (
    <div>
      <PageHeader
        title="Devises et prix"
        description="Les soldes restent en FCFA (1 crédit = 1 F). Ici : les monnaies proposées au paiement, la grille de packs de chaque devise, la marge de change et les taux d'affichage."
      />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'currencies' && <CurrenciesTab />}
      {tab === 'packs' && <PacksTab />}
      {tab === 'rates' && <RatesTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

// ── Devises ──────────────────────────────────────────────────────────────────

function CurrenciesTab() {
  const perms = usePermissions()
  const data = useLoad(() => api.currencies(), [])
  const [filter, setFilter] = useState<'active' | 'payable' | 'all'>('active')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<AdminCurrency | null>(null)

  const rows = useMemo(() => (data.data?.currencies ?? []).filter((c) =>
    (filter === 'all' || (filter === 'active' ? c.active : c.providers.length > 0))
    && (!q || `${c.code} ${c.name}`.toLowerCase().includes(q.toLowerCase()))), [data.data, filter, q])

  const toggle = async (c: AdminCurrency) => {
    try {
      await api.updateCurrency(c.code, { active: !c.active })
      toast.success(`${c.code} ${c.active ? 'désactivée' : 'activée'}`)
      data.reload()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Échec') }
  }

  return (
    <Panel padded={false}>
      <div className="p-4 border-b border-border-subtle flex flex-wrap items-center gap-3">
        <TextInput className="max-w-xs" placeholder="Code ou nom…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-[240px]" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}
          options={[
            { value: 'active', label: 'Actives' },
            { value: 'payable', label: 'Acceptées par un fournisseur' },
            { value: 'all', label: 'Toutes (ISO 4217)' },
          ]} />
        {data.data && <span className="text-xs text-foreground-secondary">Marge globale : {data.data.settings.margin_pct} %</span>}
      </div>
      <DataTable<AdminCurrency>
        rows={rows}
        rowKey={(r) => r.code}
        loading={data.loading}
        error={data.error}
        columns={[
          { key: 'code', header: 'Devise', render: (c) => (
            <span><span className="font-mono font-medium">{c.code}</span>
              <span className="block text-xs text-foreground-secondary">{c.name} · {c.decimals} déc.</span></span>
          ) },
          { key: 'active', header: 'Proposée', render: (c) => (
            perms.canManageMoney
              ? <Button size="sm" variant={c.active ? 'primary' : 'secondary'} onClick={() => void toggle(c)}>{c.active ? 'Oui' : 'Non'}</Button>
              : <Badge variant={c.active ? 'success' : 'default'}>{c.active ? 'Oui' : 'Non'}</Badge>
          ) },
          { key: 'rate', header: 'Taux (pour 1 unité)', align: 'right', render: (c) => (
            <span>{rateText(c)}
              <span className="block text-xs text-foreground-secondary">
                {c.rate_fixed ? 'Parité fixe' : c.rate_at ? `${c.rate_source} · ${ago(c.rate_at)}` : 'Aucun taux'}
                {c.rate_stale && !c.rate_fixed ? ' · périmé' : ''}
              </span></span>
          ) },
          { key: 'margin', header: 'Marge', align: 'right', render: (c) => c.margin_pct == null ? <span className="text-foreground-muted">globale</span> : `${c.margin_pct} %` },
          { key: 'packs', header: 'Prix', render: (c) => c.packs > 0 ? `Grille (${c.packs})` : <span className="text-foreground-secondary">Calculés</span> },
          { key: 'prov', header: 'Fournisseurs', render: (c) => c.providers.length === 0
            ? <span className="text-foreground-muted">aucun → repli</span>
            : <span className="flex flex-wrap gap-1">{c.providers.map((p) => (
                <Badge key={p.id} variant={p.enabled ? 'success' : 'default'}>{label(PROVIDER_LABELS, p.id)}{p.enabled ? '' : ' (sans clé)'}</Badge>
              ))}</span> },
          { key: 'act', header: '', align: 'right', render: (c) => perms.canManageMoney && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Modifier</Button>
          ) },
        ]}
      />
      <CurrencyModal currency={editing} onClose={() => setEditing(null)} onDone={data.reload} />
    </Panel>
  )
}

function CurrencyModal({ currency, onClose, onDone }: { currency: AdminCurrency | null; onClose: () => void; onDone: () => void }) {
  const [margin, setMargin] = useState('')
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)
  if (!currency) return null
  const save = async () => {
    setBusy(true)
    try {
      if (margin.trim() === '') await api.updateCurrency(currency.code, { clear_margin: true })
      else await api.updateCurrency(currency.code, { margin_pct: Number(margin.replace(',', '.')) })
      if (rate.trim()) await api.forceRate(currency.code, Number(rate.replace(',', '.')))
      toast.success(`${currency.code} enregistrée`)
      onDone(); onClose(); setMargin(''); setRate('')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Échec') } finally { setBusy(false) }
  }
  return (
    <Modal open title={`${currency.code} — ${currency.name}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button onClick={() => void save()} disabled={busy}>Enregistrer</Button></>}>
      <Field label="Marge de change (%)" hint={`Vide = marge globale. Actuelle : ${currency.margin_pct ?? 'globale'}. Ne s'applique qu'aux prix calculés (sans grille).`}>
        <TextInput inputMode="decimal" placeholder="ex. 5" value={margin} onChange={(e) => setMargin(e.target.value)} />
      </Field>
      {!currency.rate_fixed && (
        <Field label="Forcer le taux (FCFA pour 1 unité)" hint={`Actuel : ${rateText(currency)}. À utiliser si une variation légitime a été rejetée ; la prochaine mise à jour automatique le remplacera.`}>
          <TextInput inputMode="decimal" placeholder="laisser vide pour ne pas changer" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
      )}
    </Modal>
  )
}

// ── Grille de packs ──────────────────────────────────────────────────────────

function PacksTab() {
  const perms = usePermissions()
  const list = useLoad(() => api.currencies(), [])
  const active = (list.data?.currencies ?? []).filter((c) => c.active)
  const [code, setCode] = useState('XOF')
  const cur = active.find((c) => c.code === code)
  const grid = useLoad(() => api.packs(code), [code])
  const preview = useLoad(() => api.pricingPreview(code), [code, grid.data])
  const [adding, setAdding] = useState(false)

  const toggle = async (p: AdminPack) => {
    try { await api.updatePack(p.id, { active: !p.active }); grid.reload() } catch (e) { toast.error(e instanceof Error ? e.message : 'Échec') }
  }
  const remove = async (p: AdminPack) => {
    if (!window.confirm(`Supprimer le pack ${p.price} ${p.currency} ?`)) return
    try { await api.deletePack(p.id); toast.success('Pack supprimé'); grid.reload() } catch (e) { toast.error(e instanceof Error ? e.message : 'Échec') }
  }

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Devise">
            <Select className="min-w-[260px]" value={code} onChange={(e) => setCode(e.target.value)}
              options={active.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))} />
          </Field>
          {perms.canManageMoney && <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Ajouter un pack</Button>}
        </div>
        <p className="mt-3 text-xs text-foreground-secondary">
          Chaque pack a un prix rond dans la devise et crédite un montant fixe en FCFA (bonus compris). Sans grille, l'app
          affiche la grille XOF convertie au taux du jour, marge comprise, arrondie vers le haut.
          {code === 'XOF' && ' La grille XOF sert aussi de base aux prix calculés des autres devises.'}
        </p>
      </Panel>

      <Panel padded={false} title={`Grille ${code}`}>
        <DataTable<AdminPack>
          rows={grid.data?.packs ?? []}
          rowKey={(p) => p.id}
          loading={grid.loading}
          error={grid.error}
          empty="Aucune grille : les prix sont calculés depuis la grille XOF"
          columns={[
            { key: 'label', header: 'Pack', render: (p) => p.label || '—' },
            { key: 'price', header: 'Prix', align: 'right', render: (p) => <span className="font-medium">{minor(p.price_minor, p.currency, grid.data?.decimals ?? 0)}</span> },
            { key: 'credit', header: 'Crédite', align: 'right', render: (p) => fcfa(p.credit_fcfa) },
            { key: 'dev', header: 'Écart au marché', align: 'right', render: (p) => {
              if (p.deviation_pct == null) return '—'
              const generous = p.deviation_pct > 0
              return (
                <span className={generous ? 'text-accent-warning' : 'text-foreground-secondary'}
                  title={`Taux implicite ${p.implied_fcfa_per_unit?.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} F, marché ${p.market_fcfa_per_unit?.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} F`}>
                  {p.deviation_pct > 0 ? '+' : ''}{p.deviation_pct.toLocaleString('fr-FR')} %
                  {generous && <span className="block text-[11px]">plus généreux que le cours</span>}
                </span>
              )
            } },
            { key: 'issues', header: '', render: (p) => p.issues.length > 0 && (
              <span className="flex items-start gap-1 text-xs text-accent-warning"><AlertTriangle className="h-3.5 w-3.5 mt-0.5" />{p.issues.join(' · ')}</span>
            ) },
            { key: 'act', header: '', align: 'right', render: (p) => perms.canManageMoney && (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant={p.active ? 'secondary' : 'primary'} onClick={() => void toggle(p)}>{p.active ? 'Désactiver' : 'Activer'}</Button>
                <Button size="sm" variant="ghost" aria-label="Supprimer" onClick={() => void remove(p)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ) },
          ]}
        />
      </Panel>

      <Panel title="Ce que l'app affiche" description="Offre réelle renvoyée par le serveur pour cette devise.">
        {preview.data ? (
          <div className="space-y-2 text-sm">
            {preview.data.fallback_reason && (
              <Notice tone="warning">Repli : la devise n'est pas payable ({preview.data.fallback_reason}). L'app propose {preview.data.currency}.</Notice>
            )}
            <div className="text-xs text-foreground-secondary">
              {preview.data.pricing_source === 'grid' ? 'Grille saisie' : preview.data.pricing_source === 'computed' ? 'Prix calculés' : '—'}
              {preview.data.providers.length > 0 && ` · ${preview.data.providers.map((p) => p.label).join(', ')}`}
              {preview.data.rate_as_of && !preview.data.rate_fixed && ` · taux du ${dateTime(preview.data.rate_as_of)}`}
            </div>
            <div className="flex flex-wrap gap-2">
              {preview.data.packs.map((p) => (
                <span key={p.id} className="rounded-md border border-border px-3 py-2">
                  <span className="block font-medium">{minor(p.price_minor, preview.data!.currency, preview.data!.decimals)}</span>
                  <span className="block text-xs text-foreground-secondary">{fcfa(p.credit_fcfa)}{p.bonus_pct ? ` · +${p.bonus_pct} %` : ''}</span>
                </span>
              ))}
            </div>
          </div>
        ) : <span className="text-xs text-foreground-muted">{preview.error || 'Chargement…'}</span>}
      </Panel>

      {cur && <PackModal open={adding} currency={cur} onClose={() => setAdding(false)} onDone={grid.reload} />}
    </div>
  )
}

function PackModal({ open, currency, onClose, onDone }: { open: boolean; currency: AdminCurrency; onClose: () => void; onDone: () => void }) {
  const [price, setPrice] = useState('')
  const [credit, setCredit] = useState('')
  const [lbl, setLbl] = useState('')
  const [sort, setSort] = useState('0')
  const [busy, setBusy] = useState(false)
  const implied = Number(credit) > 0 && Number(price.replace(',', '.')) > 0 ? Number(credit) / Number(price.replace(',', '.')) : null
  const save = async () => {
    setBusy(true)
    try {
      await api.createPack({ currency: currency.code, price, credit_fcfa: Math.round(Number(credit)), label: lbl, sort: Number(sort) || 0 })
      toast.success('Pack ajouté')
      setPrice(''); setCredit(''); setLbl('')
      onDone(); onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Échec') } finally { setBusy(false) }
  }
  return (
    <Modal open={open} title={`Nouveau pack ${currency.code}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button onClick={() => void save()} disabled={busy || !price || !credit}>Ajouter</Button></>}>
      <Field label={`Prix en ${currency.code}`} hint={`${currency.decimals} décimale(s) au plus. Ex. ${currency.decimals === 0 ? '5000' : currency.decimals === 3 ? '1.250' : '5.00'}`}>
        <TextInput inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
      <Field label="Crédits accordés (FCFA, bonus compris)"
        hint={implied && currency.fcfa_per_unit ? `Taux implicite ${implied.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} F, cours ${currency.fcfa_per_unit.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} F (${((implied / currency.fcfa_per_unit - 1) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %)` : undefined}>
        <TextInput inputMode="numeric" value={credit} onChange={(e) => setCredit(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nom (facultatif)"><TextInput value={lbl} onChange={(e) => setLbl(e.target.value)} placeholder="Pro" /></Field>
        <Field label="Ordre"><TextInput inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

// ── Taux ─────────────────────────────────────────────────────────────────────

function RatesTab() {
  const perms = usePermissions()
  const fx = useLoad(() => api.fx(), [])
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    setBusy(true)
    try {
      const r = await api.refreshFx()
      if (r.ok) toast.success(`${r.updated} taux mis à jour depuis ${r.source}${Object.keys(r.rejected).length ? ` · ${Object.keys(r.rejected).length} variation(s) rejetée(s)` : ''}`)
      else toast.error(`Échec : ${r.message || 'toutes les sources sont indisponibles'}. Les derniers taux sont conservés.`)
      fx.reload()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Échec') } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <Panel title="Mise à jour des taux"
        description="Automatique une fois par jour. En cas de panne de toutes les sources, les derniers taux connus restent utilisés avec leur date. L'euro, le franc CFA (XOF, XAF) et les autres parités fixes ne sont jamais téléchargés."
        actions={perms.canManageMoney && <Button leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => void refresh()} disabled={busy}>Mettre à jour maintenant</Button>}>
        <div className="text-sm">
          Dernier succès : <span className="font-medium">{fx.data?.last_success_at ? `${dateTime(fx.data.last_success_at)} (${ago(fx.data.last_success_at)})` : 'jamais'}</span>
          <span className="block text-xs text-foreground-secondary mt-1">Sources, dans l'ordre : {fx.data?.sources.join(' → ') ?? '…'}</span>
        </div>
      </Panel>
      <Panel padded={false} title="Journal">
        <DataTable
          rows={fx.data?.log ?? []}
          rowKey={(l) => l.id}
          loading={fx.loading}
          error={fx.error}
          empty="Aucune mise à jour pour le moment"
          columns={[
            { key: 'at', header: 'Date', className: 'whitespace-nowrap', render: (l) => dateTime(l.at) },
            { key: 'ok', header: 'Résultat', render: (l) => <Badge variant={l.ok ? 'success' : 'warning'}>{l.ok ? `${l.updated} taux` : 'Échec'}</Badge> },
            { key: 'src', header: 'Source', render: (l) => l.source },
            { key: 'msg', header: 'Détails', render: (l) => <span className="text-xs text-foreground-secondary">{l.message || '—'}</span> },
          ]}
        />
      </Panel>
    </div>
  )
}

// ── Réglages ─────────────────────────────────────────────────────────────────

function SettingsTab() {
  const perms = usePermissions()
  const s = useLoad(() => api.pricingSettings(), [])
  const [form, setForm] = useState<Record<string, string>>({})
  const v = (k: keyof NonNullable<typeof s.data>) => form[k] ?? s.data?.[k] ?? ''
  const save = async () => {
    try {
      await api.updatePricingSettings(form)
      toast.success('Réglages enregistrés')
      setForm({}); s.reload()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Échec') }
  }
  return (
    <Panel title="Réglages de prix">
      <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
        <Field label="Marge de change globale (%)" hint="Ajoutée aux prix calculés depuis le taux du jour (couvre le change et les frais). Une devise peut avoir sa propre marge.">
          <TextInput inputMode="decimal" value={v('margin_pct')} disabled={!perms.canManageMoney} onChange={(e) => setForm({ ...form, margin_pct: e.target.value })} />
        </Field>
        <Field label="Variation journalière maximale (%)" hint="Au-delà, un nouveau taux n'est pas appliqué automatiquement : il apparaît dans le journal et se force à la main.">
          <TextInput inputMode="decimal" value={v('max_daily_change_pct')} disabled={!perms.canManageMoney} onChange={(e) => setForm({ ...form, max_daily_change_pct: e.target.value })} />
        </Field>
        <Field label="Âge maximal d'un taux (jours)" hint="Au-delà, les prix calculés de la devise sont suspendus (repli). Les grilles saisies restent valables.">
          <TextInput inputMode="decimal" value={v('max_rate_age_days')} disabled={!perms.canManageMoney} onChange={(e) => setForm({ ...form, max_rate_age_days: e.target.value })} />
        </Field>
        <Field label="Devise de repli" hint="Proposée quand aucun fournisseur n'accepte la devise du client (paiement par carte via Stripe).">
          <TextInput value={v('fallback_currency')} maxLength={3} disabled={!perms.canManageMoney} onChange={(e) => setForm({ ...form, fallback_currency: e.target.value.toUpperCase() })} />
        </Field>
      </div>
      {perms.canManageMoney && (
        <div className="mt-4"><Button onClick={() => void save()} disabled={Object.keys(form).length === 0}>Enregistrer</Button></div>
      )}
    </Panel>
  )
}
