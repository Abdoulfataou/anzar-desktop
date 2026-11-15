import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, KeyRound, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, Field, Modal, Notice, PageHeader, Panel, Select, TextInput, useLoad } from '@/components/ui/kit'
import { AdminAccount, api, Role } from '@/api/backend'
import { ago, label, ROLE_LABELS } from '@/lib/format'
import { useAuthStore } from '@/stores/authStore'

const ROLE_OPTIONS = [
  { value: 'support', label: 'Support : voir, désactiver / réactiver des comptes' },
  { value: 'readonly', label: 'Lecture seule : tout voir, rien modifier' },
  { value: 'admin', label: 'Administrateur : crédits, paiements, utilisateurs' },
  { value: 'owner', label: 'Propriétaire : tout, y compris les admins' },
]

export default function AdminsPage() {
  const me = useAuthStore((s) => s.user)
  const list = useLoad(() => api.admins(), [])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<AdminAccount | null>(null)
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null)

  const reset = async (a: AdminAccount) => {
    try {
      const r = await api.resetAdminPassword(a.id)
      setSecret({ email: a.email, password: r.temporary_password })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec')
    }
  }

  return (
    <div>
      <PageHeader title="Administrateurs" description="Qui peut accéder au panneau, et avec quels droits."
        actions={<Button leftIcon={<UserPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>Ajouter un admin</Button>} />
      <Panel padded={false}>
        <DataTable<AdminAccount>
          rows={list.data?.admins ?? []}
          rowKey={(a) => a.id}
          loading={list.loading}
          error={list.error}
          columns={[
            { key: 'e', header: 'Compte', render: (a) => (
              <div>
                <p className="font-medium">{a.email}{a.id === me?.admin_id && <span className="text-xs text-foreground-muted"> (toi)</span>}</p>
                <p className="text-xs text-foreground-muted">{a.name}</p>
              </div>
            ) },
            { key: 'r', header: 'Rôle', render: (a) => <Badge variant={a.role === 'owner' ? 'secondary' : a.role === 'admin' ? 'primary' : 'default'}>{label(ROLE_LABELS, a.role)}</Badge> },
            { key: 's', header: 'État', render: (a) => (
              <div className="flex gap-1">
                {a.is_active === false ? <Badge variant="error">Désactivé</Badge> : <Badge variant="success">Actif</Badge>}
                {a.must_change_password && <Badge variant="warning">Mot de passe provisoire</Badge>}
              </div>
            ) },
            { key: 'l', header: 'Dernière connexion', render: (a) => <span className="text-foreground-secondary">{ago(a.last_login)}</span> },
            { key: 'x', header: '', align: 'right', render: (a) => a.id !== me?.admin_id && (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(a)}>Modifier</Button>
                <Button size="sm" variant="ghost" leftIcon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => reset(a)}>Réinitialiser</Button>
              </div>
            ) },
          ]}
        />
      </Panel>
      <CreateAdminModal open={creating} onClose={() => setCreating(false)}
        onCreated={(email, password) => { setSecret({ email, password }); list.reload() }} />
      {editing && <EditAdminModal admin={editing} onClose={() => setEditing(null)} onDone={list.reload} />}
      <Modal open={!!secret} title="Mot de passe provisoire" onClose={() => setSecret(null)}
        footer={<Button onClick={() => setSecret(null)}>J'ai noté le mot de passe</Button>}>
        <p className="text-sm text-foreground-secondary">
          Transmets-le à <b className="text-foreground-primary">{secret?.email}</b> par un canal privé. Il ne sera plus jamais affiché ;
          l'admin devra le changer à sa première connexion sur <span className="font-mono">anzar-admin.issalanhub.com</span>.
        </p>
        <div className="flex items-center gap-2 rounded-md border border-border bg-background-primary px-3 py-2">
          <code className="flex-1 font-mono text-sm break-all">{secret?.password}</code>
          <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(secret?.password ?? ''); toast.success('Copié') }}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function CreateAdminModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (email: string, pw: string) => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('support')
  const [busy, setBusy] = useState(false)
  const close = () => { setEmail(''); setName(''); setRole('support'); onClose() }
  const submit = async () => {
    setBusy(true)
    try {
      const r = await api.createAdmin({ email: email.trim(), name: name.trim(), role })
      toast.success('Admin créé')
      close()
      onCreated(r.admin.email, r.temporary_password)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} title="Ajouter un admin" onClose={close} footer={<>
      <Button variant="ghost" onClick={close}>Annuler</Button>
      <Button disabled={!email.includes('@')} isLoading={busy} onClick={submit}>Créer</Button>
    </>}>
      <Field label="E-mail"><TextInput autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Nom"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Rôle"><Select value={role} onChange={(e) => setRole(e.target.value as Role)} options={ROLE_OPTIONS} /></Field>
      <Notice>Donne le rôle le plus limité possible. Un mot de passe provisoire est généré ; il faut le changer à la première connexion.</Notice>
    </Modal>
  )
}

function EditAdminModal({ admin, onClose, onDone }: { admin: AdminAccount; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(admin.name)
  const [role, setRole] = useState<Role>(admin.role)
  const [active, setActive] = useState(admin.is_active !== false)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await api.updateAdmin(admin.id, { name: name.trim(), role, is_active: active })
      toast.success('Admin modifié : effet immédiat')
      onClose()
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open title={`Modifier ${admin.email}`} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>Annuler</Button>
      <Button isLoading={busy} onClick={submit}>Enregistrer</Button>
    </>}>
      <Field label="Nom"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Rôle"><Select value={role} onChange={(e) => setRole(e.target.value as Role)} options={ROLE_OPTIONS} /></Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Compte actif (décocher coupe l'accès immédiatement)
      </label>
    </Modal>
  )
}
