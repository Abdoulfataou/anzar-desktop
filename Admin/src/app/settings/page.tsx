import { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { anzarApi } from '@/api/backend'
import { useAuthStore } from '@/stores/authStore'
import { LogOut, RefreshCw, Server, User } from 'lucide-react'

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)
  const clearSession = useAuthStore((s) => s.clearSession)

  const [backendUrl] = useState(anzarApi.backendUrl)

  const maskedToken = useMemo(() => {
    if (!token) return '—'
    if (token.length <= 16) return token
    return `${token.slice(0, 10)}…${token.slice(-6)}`
  }, [token])

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground-primary">Settings</h1>
          <p className="text-foreground-secondary mt-1">Paramètres de la console Admin (client).</p>
        </div>
        <Button variant="secondary" leftIcon={<LogOut className="h-4 w-4" />} onClick={() => clearSession()}>
          Se déconnecter
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5 text-accent-primary" />
              Backend
            </CardTitle>
            <CardDescription>URL utilisée par l’app Admin.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground-primary">VITE_BACKEND_URL</label>
              <Input value={backendUrl} readOnly />
              <p className="text-xs text-foreground-secondary">
                Pour changer: configure la variable d’environnement <code>VITE_BACKEND_URL</code> puis rebuild.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                leftIcon={<RefreshCw className="h-4 w-4" />}
                onClick={() => window.location.reload()}
              >
                Recharger l’app
              </Button>
              <Button variant="outline" onClick={() => void anzarApi.health()}>
                Ping /health
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-accent-secondary" />
              Session
            </CardTitle>
            <CardDescription>Informations locales (token + user).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground-secondary">Utilisateur</span>
              <Badge variant="outline">{user?.email || '—'}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground-secondary">Nom</span>
              <Badge variant="outline">{user?.name || '—'}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground-secondary">Token</span>
              <Badge variant="secondary">{maskedToken}</Badge>
            </div>
            <p className="text-xs text-foreground-secondary">
              Le token est stocké via Zustand persist (localStorage) sous la clé{' '}
              <code>anzar-admin-auth</code>.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
