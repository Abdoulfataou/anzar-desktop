/** Fenêtres d'action partagées : créditer / retirer, valider / annuler un paiement. */
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from './ui/Button'
import { Field, Modal, Notice, Select, TextArea, TextInput } from './ui/kit'
import { api, PaymentIntent } from '@/api/backend'
import { fcfa, label, METHOD_LABELS } from '@/lib/format'

type CreditMode = 'credit' | 'debit'

export function CreditModal({ open, onClose, email, mode, balance, onDone }: {
  open: boolean; onClose: () => void; email: string; mode: CreditMode; balance?: number; onDone: () => void
}) {
  const [amount, setAmount] = useState('')
  const [txType, setTxType] = useState<'recharge' | 'bonus' | 'refund'>('recharge')
  const [description, setDescription] = useState('')
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)

  const value = Math.round(Number(amount.replace(/\s/g, '').replace(',', '.')) * 100) / 100
  const valid = value > 0 && value <= 10_000_000 && description.trim().length >= 3
  const after = balance !== undefined ? balance + (mode === 'credit' ? value || 0 : -(value || 0)) : undefined

  const close = () => { setAmount(''); setDescription(''); setRef(''); onClose() }

  const submit = async () => {
    if (!valid) return
    setBusy(true)
    try {
      if (mode === 'credit') {
        await api.credit(email, { amount: value, tx_type: txType, description: description.trim(), external_ref: ref.trim() })
        toast.success(`${fcfa(value)} crédités à ${email}`)
      } else {
        await api.debit(email, { amount: value, description: description.trim() })
        toast.success(`${fcfa(value)} retirés à ${email}`)
      }
      close()
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={mode === 'credit' ? 'Ajouter du crédit' : 'Retirer du crédit'}
      footer={<>
        <Button variant="ghost" onClick={close}>Annuler</Button>
        <Button variant={mode === 'credit' ? 'primary' : 'danger'} disabled={!valid} isLoading={busy} onClick={submit}>
          {mode === 'credit' ? 'Créditer' : 'Retirer'} {value > 0 ? fcfa(value) : ''}
        </Button>
      </>}
    >
      <p className="text-sm text-foreground-secondary">Compte : <span className="text-foreground-primary">{email}</span></p>
      <Field label="Montant (FCFA)">
        <TextInput autoFocus inputMode="decimal" placeholder="ex. 5000" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      {mode === 'credit' && (
        <>
          <Field label="Type" hint="Recharge : argent reçu du client. Bonus : crédit offert. Remboursement : retour d'un débit.">
            <Select value={txType} onChange={(e) => setTxType(e.target.value as typeof txType)} options={[
              { value: 'recharge', label: 'Recharge (paiement reçu)' },
              { value: 'bonus', label: 'Bonus (offert)' },
              { value: 'refund', label: 'Remboursement' },
            ]} />
          </Field>
          <Field label="Référence du paiement (facultatif)"
            hint="ID de transaction Orange Money / Wave. Une même référence ne peut créditer qu'une seule fois.">
            <TextInput placeholder="ex. MP2611.1532.A12345" value={ref} onChange={(e) => setRef(e.target.value)} />
          </Field>
        </>
      )}
      <Field label="Motif (obligatoire)" hint="Visible dans l'historique du client et dans le journal d'audit.">
        <TextArea placeholder={mode === 'credit' ? 'ex. Paiement Orange Money du 15/11' : 'ex. Correction : crédit ajouté par erreur'}
          value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {after !== undefined && value > 0 && (
        <Notice tone={after < 0 ? 'warning' : 'info'}>
          Solde actuel {fcfa(balance)} → nouveau solde <b>{fcfa(after)}</b>
          {after < 0 && ' : le compte sera en dette et bloqué jusqu\'à la prochaine recharge.'}
        </Notice>
      )}
    </Modal>
  )
}

export function MarkPaidModal({ intent, onClose, onDone, bonusPercent }: {
  intent: PaymentIntent | null; onClose: () => void; onDone: () => void; bonusPercent?: (amount: number) => number
}) {
  const [ref, setRef] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  if (!intent) return null
  const pct = bonusPercent ? bonusPercent(intent.amount_fcfa) : 0
  const total = intent.amount_fcfa + Math.round(intent.amount_fcfa * pct / 100)
  const close = () => { setRef(''); setDescription(''); onClose() }
  const submit = async () => {
    setBusy(true)
    try {
      await api.markPaid(intent.id, { provider_ref: ref.trim(), description: description.trim() })
      toast.success(`Paiement validé : ${fcfa(total)} crédités à ${intent.user_email}`)
      close()
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open title="Valider le paiement" onClose={close} footer={<>
      <Button variant="ghost" onClick={close}>Annuler</Button>
      <Button disabled={description.trim().length < 3} isLoading={busy} onClick={submit}>Valider et créditer {fcfa(total)}</Button>
    </>}>
      <Notice>
        <b>{intent.user_email}</b> · {fcfa(intent.amount_fcfa)} via {label(METHOD_LABELS, intent.method)}
        {pct > 0 && <> · bonus de recharge +{pct} % → <b>{fcfa(total)}</b> crédités</>}
      </Notice>
      <p className="text-xs text-foreground-secondary">
        Vérifie d'abord sur ton téléphone ou ton compte marchand que l'argent est bien arrivé.
      </p>
      <Field label="Référence de la transaction" hint="Recommandé : la même référence ne pourra pas valider une autre demande.">
        <TextInput autoFocus placeholder="ID Orange Money / Wave" value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
      <Field label="Motif (obligatoire)">
        <TextArea placeholder="ex. Reçu Orange Money de 5 000 F, n° 9X XX XX XX" value={description}
          onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </Modal>
  )
}

export function CancelPaymentModal({ intent, onClose, onDone }: { intent: PaymentIntent | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  if (!intent) return null
  const close = () => { setReason(''); onClose() }
  const submit = async () => {
    setBusy(true)
    try {
      await api.cancelPayment(intent.id, reason.trim())
      toast.success('Demande annulée')
      close()
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open title="Annuler la demande de paiement" onClose={close} footer={<>
      <Button variant="ghost" onClick={close}>Retour</Button>
      <Button variant="danger" disabled={reason.trim().length < 3} isLoading={busy} onClick={submit}>Annuler la demande</Button>
    </>}>
      <p className="text-sm text-foreground-secondary">
        {intent.user_email} · {fcfa(intent.amount_fcfa)}. Aucun crédit ne sera ajouté.
      </p>
      <Field label="Raison (obligatoire)">
        <TextArea autoFocus placeholder="ex. Paiement jamais reçu, doublon…" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  )
}

/** Bonus de recharge (« 5000:15,15000:25 ») → pourcentage applicable à un montant. */
export function bonusFromTiers(tiers: string | undefined) {
  const list = (tiers || '').split(',').map((t) => t.split(':').map(Number)).filter(([a, b]) => a > 0 && b > 0)
  return (amount: number) => list.reduce((pct, [min, p]) => (amount >= min && p > pct ? p : pct), 0)
}
