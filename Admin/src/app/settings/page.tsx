import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorBox, Field, Notice, PageHeader, Panel, Spinner, Tabs, TextInput, useLoad, useTab } from '@/components/ui/kit'
import { api } from '@/api/backend'
import { dateTime, fcfa, label, ROLE_LABELS } from '@/lib/format'
import { useAuthStore } from '@/stores/authStore'

export default function SettingsPage() {
  const mustChange = useAuthStore((s) => !!s.user?.must_change_password)
  const tabs = [
    { id: 'profile', label: 'Mon profil', hidden: mustChange },
    { id: 'security', label: 'Mot de passe' },
    { id: 'mfa', label: 'Double authentification', hidden: mustChange },
    { id: 'platform', label: 'Plateforme', hidden: mustChange },
  ]
  const [tab, setTab] = useTab(tabs)
  return (
    <div className="max-w-4xl">
      <PageHeader title="Paramètres" />
      {mustChange && (
        <div className="mb-4">
          <Notice tone="warning">Première connexion : choisis ton propre mot de passe pour accéder au panneau.</Notice>
        </div>
      )}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'profile' && <Profile />}
      {tab === 'security' && <Security />}
      {tab === 'mfa' && <MfaSettings />}
      {tab === 'platform' && <Platform />}
    </div>
  )
}

function Profile() {
  const me = useLoad(() => api.me(), [])
  const updateUser = useAuthStore((s) => s.updateUser)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (me.data) { setName(me.data.name); setEmail(me.data.email) } }, [me.data])
  if (me.loading && !me.data) return <Spinner />
  if (me.error || !me.data) return <ErrorBox message={me.error ?? 'Erreur'} />
  const save = async () => {
    setBusy(true)
    try {
      const r = await api.updateMe({ name: name.trim(), email: email.trim() })
      updateUser({ name: r.name, email: r.email })
      toast.success('Profil enregistré')
      me.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title="Mon profil">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="E-mail de connexion"><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-foreground-secondary">
        <Badge variant="secondary">{label(ROLE_LABELS, me.data.role)}</Badge>
        <span>Compte créé le {dateTime(me.data.created_at)}</span>
        <span>· Dernière connexion {dateTime(me.data.last_login)}</span>
      </div>
      <div className="mt-5"><Button isLoading={busy} onClick={save} disabled={!name.trim() || !email.includes('@')}>Enregistrer</Button></div>
    </Panel>
  )
}

function Security() {
  const navigate = useNavigate()
  const updateUser = useAuthStore((s) => s.updateUser)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const tooShort = next.length > 0 && next.length < 12
  const mismatch = confirm.length > 0 && confirm !== next
  const valid = current && next.length >= 12 && next === confirm && next !== current
  const save = async () => {
    setBusy(true)
    try {
      await api.changePassword(current, next)
      updateUser({ must_change_password: false })
      toast.success('Mot de passe modifié')
      setCurrent(''); setNext(''); setConfirm('')
      navigate('/dashboard')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title="Changer mon mot de passe" description="12 caractères minimum. Garde-le dans ton gestionnaire de mots de passe.">
      <div className="grid gap-4 max-w-md">
        <Field label="Mot de passe actuel"><TextInput type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <Field label="Nouveau mot de passe" hint={tooShort ? 'Au moins 12 caractères' : undefined}>
          <TextInput type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirmer" hint={mismatch ? 'Les deux mots de passe ne correspondent pas' : undefined}>
          <TextInput type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <div><Button disabled={!valid} isLoading={busy} onClick={save}>Changer le mot de passe</Button></div>
      </div>
    </Panel>
  )
}

function MfaSettings() {
  const navigate = useNavigate()
  const clearSession = useAuthStore((s) => s.clearSession)
  const me = useLoad(() => api.me(), [])
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string; recovery_codes: string[] } | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const finish = (message: string) => {
    toast.success(message)
    clearSession()
    navigate('/login')
  }

  const start = async () => {
    setBusy(true)
    try { setSetup(await api.mfaSetup()) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Échec') }
    finally { setBusy(false) }
  }

  const enable = async () => {
    setBusy(true)
    try { await api.mfaEnable(code); finish('MFA activée. Reconnecte-toi avec ton code.') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Code invalide') }
    finally { setBusy(false) }
  }

  const disable = async () => {
    setBusy(true)
    try { await api.mfaDisable(password, code); finish('MFA désactivée. Reconnecte-toi.') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Échec') }
    finally { setBusy(false) }
  }

  if (me.loading && !me.data) return <Spinner />
  if (me.error || !me.data) return <ErrorBox message={me.error ?? 'Erreur'} />
  const enabled = !!me.data.mfa_enabled

  return (
    <Panel title="Double authentification (TOTP)"
      description="Un code à 6 chiffres protège la connexion admin, en plus du mot de passe.">
      {enabled ? (
        <div className="grid gap-4 max-w-md">
          <Notice tone="info">MFA active sur ce compte.</Notice>
          <Field label="Mot de passe actuel"><TextInput type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Code TOTP actuel" hint="6 chiffres générés par ton application d'authentification.">
            <TextInput inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </Field>
          <div><Button variant="danger" disabled={!password || code.length !== 6} isLoading={busy} onClick={disable}>Désactiver la MFA</Button></div>
        </div>
      ) : (
        <div className="grid gap-4 max-w-lg">
          <Notice>
            Utilise Google Authenticator, 1Password, Aegis ou une application compatible TOTP.
            La MFA est fortement recommandée pour les rôles owner et admin.
          </Notice>
          {!setup ? (
            <div><Button isLoading={busy} onClick={start}>Générer mon secret MFA</Button></div>
          ) : (
            <>
              <Field label="Secret à saisir dans ton application">
                <code className="block break-all rounded-md border border-border bg-background-secondary p-3 font-mono text-sm">{setup.secret}</code>
              </Field>
              <Field label="URI otpauth">
                <code className="block break-all text-xs text-foreground-secondary">{setup.otpauth_uri}</code>
              </Field>
              <Notice tone="warning">
                Conserve ces codes de secours hors ligne. Chaque code ne fonctionne qu'une fois et permet
                de te connecter si tu perds ton téléphone.
              </Notice>
              <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-background-secondary p-3 font-mono text-sm">
                {setup.recovery_codes.map((c) => <span key={c}>{c}</span>)}
              </div>
              <Field label="Code de vérification" hint="Saisis le code affiché par ton application.">
                <TextInput inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              </Field>
              <div><Button disabled={code.length !== 6} isLoading={busy} onClick={enable}>Activer la MFA</Button></div>
            </>
          )}
        </div>
      )}
    </Panel>
  )
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0 text-sm">
      <span className="text-foreground-secondary">{k}</span><span className="text-right">{v}</span>
    </div>
  )
}

function Platform() {
  const s = useLoad(() => api.settings(), [])
  if (s.loading && !s.data) return <Spinner />
  if (s.error || !s.data) return <ErrorBox message={s.error ?? 'Erreur'} />
  const d = s.data
  const ok = (b: boolean) => <Badge variant={b ? 'success' : 'default'}>{b ? 'Configuré' : 'Non configuré'}</Badge>
  const perM = (usd: number) => `${usd.toFixed(3)} $ → ${fcfa(usd * d.usd_to_fcfa * d.margin, true)}`
  return (
    <div className="space-y-4">
      <Notice>
        Lecture seule. Ces réglages se changent dans le fichier <span className="font-mono">/root/anzar/deploy/.env</span> du serveur,
        puis <span className="font-mono">mettre-a-jour.sh</span>.
      </Notice>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Facturation">
          <Row k="Marge (prix de vente = coût ×)" v={d.margin} />
          <Row k="Taux de change" v={`1 $ = ${d.usd_to_fcfa} F`} />
          <Row k="Heures creuses" v={`× ${d.offpeak_factor} hors ${d.peak_windows_utc} h UTC (jours ouvrés)`} />
          <Row k="Recherche / lecture web" v={`${fcfa(d.web_tool_cost_fcfa, true)} par appel réussi`} />
          <Row k="Bonus de bienvenue" v={<Badge variant={d.welcome_bonus_fcfa ? 'warning' : 'success'}>{d.welcome_bonus_fcfa ? fcfa(d.welcome_bonus_fcfa) : 'Aucun'}</Badge>} />
          <Row k="Bonus de recharge" v={d.recharge_bonus_tiers.split(',').map((t) => {
            const [min, p] = t.split(':'); return `+${p} % dès ${fcfa(Number(min))}`
          }).join(' · ')} />
        </Panel>
        <Panel title="Prix de vente par million de jetons" description="Prix DeepSeek → prix facturé au client (heures pleines)">
          <Row k={`${d.models.default} · entrée (cache)`} v={perM(d.pricing_usd_per_million.flash.cache_hit)} />
          <Row k={`${d.models.default} · entrée`} v={perM(d.pricing_usd_per_million.flash.cache_miss)} />
          <Row k={`${d.models.default} · sortie`} v={perM(d.pricing_usd_per_million.flash.output)} />
          <Row k={`${d.models.pro} · entrée (cache)`} v={perM(d.pricing_usd_per_million.pro.cache_hit)} />
          <Row k={`${d.models.pro} · entrée`} v={perM(d.pricing_usd_per_million.pro.cache_miss)} />
          <Row k={`${d.models.pro} · sortie`} v={perM(d.pricing_usd_per_million.pro.output)} />
        </Panel>
        <Panel title="Services">
          <Row k="DeepSeek" v={ok(d.providers.deepseek)} />
          <Row k="E-mails (Brevo)" v={ok(d.providers.email)} />
          <Row k="Anciennes routes IA" v={<Badge variant={d.legacy_ai_routes ? 'warning' : 'success'}>{d.legacy_ai_routes ? 'Activées' : 'Désactivées'}</Badge>} />
          <Row k="Version du serveur" v={d.version} />
        </Panel>
        <Panel title="Limites et sessions">
          <Row k="Requêtes IA simultanées par compte" v={d.max_concurrent_ai_per_user} />
          <Row k="Requêtes par adresse IP" v={`${d.rate_limit.per_minute} / min · ${d.rate_limit.per_day} / jour`} />
          <Row k="Session application" v={`${d.jwt_expiry_hours} h (renouvelée automatiquement)`} />
          <Row k="Session admin" v={`${d.admin_jwt_expiry_hours} h`} />
        </Panel>
      </div>
    </div>
  )
}
