import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { anzarApi } from '@/api/backend'
import { useAuthStore } from '@/stores/authStore'
import { LogOut, RefreshCw, Server, User, Shield, AlertCircle } from 'lucide-react'

interface AdminProfile {
  id: number
  email: string
  name: string
  role: string
  created_at?: string
  last_login?: string | null
  must_change_password?: boolean
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const clearSession = useAuthStore((s) => s.clearSession)
  const updateUser = useAuthStore((s) => s.updateUser)

  const [backendUrl] = useState(anzarApi.backendUrl)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<AdminProfile | null>(null)

  // Profile editing state
  const [editingName, setEditingName] = useState(false)
  const [newName, setNewName] = useState('')
  const [savingName, setSavingName] = useState(false)

  // Password change state
  const [changingPassword, setChangingPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPasswordLoading, setChangingPasswordLoading] = useState(false)

  // Backend health state
  const [healthStatus, setHealthStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const profileData = await anzarApi.getProfile()
        if (!alive) return
        setProfile(profileData)
        setNewName(profileData.name)
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Erreur chargement profil')
      } finally {
        if (!alive) return
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (user?.must_change_password) {
      setChangingPassword(true)
    }
  }, [user?.must_change_password])

  const handleSaveName = async () => {
    if (!newName.trim()) {
      setError('Le nom ne peut pas être vide')
      return
    }
    setSavingName(true)
    setError(null)
    try {
      await anzarApi.updateProfile({ name: newName.trim() })
      if (profile) {
        setProfile({ ...profile, name: newName.trim() })
      }
      setEditingName(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur mise à jour nom')
    } finally {
      setSavingName(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      setError('Veuillez remplir tous les champs')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas')
      return
    }
    if (newPassword.length < 8) {
      setError('Le mot de passe doit faire au moins 8 caractères')
      return
    }
    setChangingPasswordLoading(true)
    setError(null)
    try {
      await anzarApi.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setChangingPassword(false)
      updateUser({ must_change_password: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur changement mot de passe')
    } finally {
      setChangingPasswordLoading(false)
    }
  }

  const handleLogout = async () => {
    clearSession()
    navigate('/login')
  }

  const handleHealthCheck = async () => {
    setHealthStatus('loading')
    try {
      await anzarApi.health()
      setHealthStatus('ok')
    } catch (err) {
      setHealthStatus('error')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground-primary">Paramètres</h1>
          <p className="text-foreground-secondary mt-1">Gestion du profil administrateur et paramètres système.</p>
        </div>
        <Button variant="secondary" leftIcon={<LogOut className="h-4 w-4" />} onClick={handleLogout}>
          Se déconnecter
        </Button>
      </div>

      {error && (
        <Card className="border-accent-error/30">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-accent-error flex-shrink-0 mt-0.5" />
            <p className="text-sm text-accent-error">{error}</p>
          </CardContent>
        </Card>
      )}

      {user?.must_change_password && (
        <Card className="border-accent-warning/30">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-accent-warning flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-accent-warning">Action requise</p>
              <p className="text-sm text-foreground-secondary">
                Pour des raisons de sécurité, tu dois changer le mot de passe admin avant de continuer.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Card>
          <CardContent className="p-6 text-center text-foreground-secondary">
            Chargement du profil…
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Admin Profile Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-accent-primary" />
                Profil Administrateur
              </CardTitle>
              <CardDescription>Informations et gestion du compte.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground-primary">Adresse e-mail</label>
                <Input value={profile?.email || '—'} readOnly />
                <p className="text-xs text-foreground-secondary">Non modifiable</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground-primary">Nom</label>
                {editingName ? (
                  <div className="flex gap-2">
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Entrez votre nom"
                      disabled={savingName}
                    />
                    <Button
                      size="sm"
                      onClick={handleSaveName}
                      isLoading={savingName}
                      disabled={savingName}
                    >
                      Valider
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingName(false)
                        setNewName(profile?.name || '')
                      }}
                      disabled={savingName}
                    >
                      Annuler
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <Input value={profile?.name || '—'} readOnly />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingName(true)}
                    >
                      Modifier
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground-primary">Rôle</label>
                <div className="flex items-center gap-2">
                  <Badge variant="primary" className="flex items-center gap-1">
                    <Shield className="h-4 w-4" />
                    {profile?.role || '—'}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-foreground-secondary">Créé le</p>
                  <p className="font-mono text-foreground-primary">
                    {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('fr-FR') : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-foreground-secondary">Dernière connexion</p>
                  <p className="font-mono text-foreground-primary">
                    {profile?.last_login ? new Date(profile.last_login).toLocaleDateString('fr-FR') : '—'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Backend & Session Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5 text-accent-secondary" />
                Système Backend
              </CardTitle>
              <CardDescription>Configuration et statut du serveur.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground-primary">URL Backend</label>
                <Input value={backendUrl} readOnly />
                <p className="text-xs text-foreground-secondary">
                  Configuré via <code>VITE_BACKEND_URL</code>
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground-primary">Santé du serveur</label>
                <div className="flex items-center gap-2">
                  {healthStatus === 'ok' && (
                    <Badge variant="primary">Connecté</Badge>
                  )}
                  {healthStatus === 'error' && (
                    <Badge variant="secondary">Erreur de connexion</Badge>
                  )}
                  {healthStatus === 'idle' && (
                    <Badge variant="outline">Non testé</Badge>
                  )}
                  {healthStatus === 'loading' && (
                    <Badge variant="outline">Test en cours…</Badge>
                  )}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<RefreshCw className="h-4 w-4" />}
                  onClick={handleHealthCheck}
                  disabled={healthStatus === 'loading'}
                  isLoading={healthStatus === 'loading'}
                >
                  Tester connexion
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<RefreshCw className="h-4 w-4" />}
                  onClick={() => window.location.reload()}
                >
                  Recharger
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Password Change Card */}
      {!loading && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-accent-warning" />
              Changer le mot de passe
            </CardTitle>
            <CardDescription>Sécurisez votre compte en mettant à jour votre mot de passe.</CardDescription>
          </CardHeader>
          <CardContent>
            {changingPassword ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground-primary">
                    Mot de passe actuel
                  </label>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Entrez votre mot de passe actuel"
                    disabled={changingPasswordLoading}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground-primary">
                    Nouveau mot de passe
                  </label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Entrez un nouveau mot de passe (minimum 8 caractères)"
                    disabled={changingPasswordLoading}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground-primary">
                    Confirmer le nouveau mot de passe
                  </label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirmez le nouveau mot de passe"
                    disabled={changingPasswordLoading}
                  />
                </div>

                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setChangingPassword(false)
                      setCurrentPassword('')
                      setNewPassword('')
                      setConfirmPassword('')
                    }}
                    disabled={changingPasswordLoading}
                  >
                    Annuler
                  </Button>
                  <Button
                    onClick={handleChangePassword}
                    isLoading={changingPasswordLoading}
                    disabled={changingPasswordLoading}
                  >
                    Changer le mot de passe
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setChangingPassword(true)}>
                Modifier le mot de passe
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
