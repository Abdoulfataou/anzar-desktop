/** Formats d'affichage (fr-FR). */

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

export function fcfa(v: number | null | undefined, precise = false): string {
  const n = Number(v || 0)
  const abs = Math.abs(n)
  const f = precise || (abs > 0 && abs < 10) ? nf2 : nf0
  return `${f.format(n)} F`
}

export function num(v: number | null | undefined): string {
  return nf0.format(Number(v || 0))
}

export function compact(v: number | null | undefined): string {
  return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(v || 0))
}

/** Le serveur renvoie des dates UTC sans fuseau : on les lit comme UTC. */
export function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v.replace(' ', 'T')}Z`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export function dateTime(v: string | null | undefined): string {
  const d = parseDate(v)
  return d ? d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

export function dateOnly(v: string | null | undefined): string {
  const d = parseDate(v)
  return d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
}

export function ago(v: string | null | undefined): string {
  const d = parseDate(v)
  if (!d) return 'jamais'
  const s = Math.round((Date.now() - d.getTime()) / 1000)
  if (s < 60) return "à l'instant"
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  if (s < 30 * 86400) return `il y a ${Math.floor(s / 86400)} j`
  return dateOnly(v)
}

export const TX_LABELS: Record<string, string> = {
  recharge: 'Recharge',
  bonus: 'Bonus',
  refund: 'Remboursement',
  usage: 'Consommation',
}

export const PAYMENT_LABELS: Record<string, string> = {
  pending: 'En attente',
  paid: 'Payé',
  cancelled: 'Annulé',
  failed: 'Échoué',
}

export const METHOD_LABELS: Record<string, string> = {
  wave: 'Wave',
  orange_money: 'Orange Money',
  airtel_money: 'Airtel Money',
  flooz: 'Flooz (Moov)',
  mpesa: 'M-Pesa',
  nita_transfert: 'Dépôt Nita',
  amana_transfert: 'Dépôt Amana',
  mobile_money: 'Mobile money',
  card: 'Carte bancaire',
}

export const PROVIDER_LABELS: Record<string, string> = {
  fedapay: 'FedaPay',
  stripe: 'Stripe',
  paystack: 'Paystack',
  flutterwave: 'Flutterwave',
}

/** Montant au format local, avec les décimales ISO de la devise (0 pour XOF, 3 pour KWD…). */
export function money(amount: number | string, currency: string, decimals?: number): string {
  const n = Number(amount || 0)
  const code = (currency || 'XOF').toUpperCase()
  try {
    const o: Intl.NumberFormatOptions = { style: 'currency', currency: code }
    if (typeof decimals === 'number') { o.minimumFractionDigits = decimals; o.maximumFractionDigits = decimals }
    return new Intl.NumberFormat('fr-FR', o).format(n)
  } catch {
    return `${n.toLocaleString('fr-FR')} ${code}`
  }
}

/** Unités mineures ISO → montant formaté (840, EUR, 2 → « 8,40 € »). */
export function minor(m: number, currency: string, decimals: number): string {
  return money(m / 10 ** decimals, currency, decimals)
}

/** Décimales ISO connues du navigateur pour une devise (repli 2). */
export function isoDecimals(currency: string): number {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

export const ROLE_LABELS: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  support: 'Support',
  readonly: 'Lecture seule',
}

export const TASK_LABELS: Record<string, string> = {
  chat: 'Chat',
  chat_stream: 'Chat (flux)',
  chat_estimated: 'Chat (estimé)',
  chat_stream_estimated: 'Chat flux (estimé)',
  web_search: 'Recherche web',
  web_fetch: 'Lecture de page',
  billing_failed: 'Échec de débit',
}

export const ACTION_LABELS: Record<string, string> = {
  login_success: 'Connexion',
  login_failed: 'Connexion refusée',
  grant_credits: 'Crédit ajouté',
  debit_credits: 'Crédit retiré',
  update_user: 'Utilisateur modifié',
  disable_user: 'Compte désactivé',
  enable_user: 'Compte réactivé',
  mark_payment_paid: 'Paiement validé',
  cancel_payment: 'Paiement annulé',
  create_admin: 'Admin créé',
  update_admin: 'Admin modifié',
  reset_admin_password: 'Mot de passe admin réinitialisé',
  change_password: 'Mot de passe changé',
  update_profile: 'Profil modifié',
  currency_update: 'Devise modifiée',
  fx_refresh: 'Taux mis à jour',
  fx_force_rate: 'Taux forcé',
  pricing_settings: 'Réglages de prix modifiés',
  pack_create: 'Pack créé',
  pack_update: 'Pack modifié',
  pack_delete: 'Pack supprimé',
}

export function label(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return '—'
  return map[key] ?? key
}
