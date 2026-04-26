import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/Card'
import { Lock, Mail, Eye, EyeOff } from 'lucide-react'
import AnzarLogo from '@/components/ui/AnzarLogo'
import { motion } from 'framer-motion'
import { anzarApi } from '@/api/backend'
import { useAuthStore } from '@/stores/authStore'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const setSession = useAuthStore((s) => s.setSession)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const result = await anzarApi.login(email.trim(), password)
      setSession({ token: result.token, user: result.user as any })
      if ((result.user as any)?.must_change_password) {
        navigate('/settings')
      } else {
        navigate('/dashboard')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Échec de la connexion'
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background-primary flex">
      {/* Left Panel - Visual */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-accent-primary/10 via-accent-secondary/5 to-transparent" />
        
        {/* Animated background elements */}
        <div className="absolute inset-0">
          {[...Array(20)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute rounded-full bg-accent-primary/5"
              style={{
                width: Math.random() * 100 + 50,
                height: Math.random() * 100 + 50,
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
              }}
              animate={{
                y: [0, -20, 0],
                opacity: [0.3, 0.6, 0.3],
              }}
              transition={{
                duration: 3 + Math.random() * 2,
                repeat: Infinity,
                delay: Math.random() * 2,
              }}
            />
          ))}
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center p-12">
          <div className="max-w-md">
            <div className="flex items-center gap-3 mb-8">
              <AnzarLogo size={48} />
              <div>
                <h1 className="text-3xl font-bold text-foreground-primary">ANZAR</h1>
                <p className="text-foreground-secondary">Admin • Vibecoding Console</p>
              </div>
            </div>

            <h2 className="text-4xl font-bold text-foreground-primary mb-4">Piloter le vibecoding.</h2>
            <p className="text-lg text-foreground-secondary mb-8">
              Planifier, exécuter et auditer la génération de projets (agents, crédits, usage, santé du backend).
            </p>

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-accent-success" />
                <span className="text-foreground-primary">Real-time agent monitoring</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-accent-primary" />
                <span className="text-foreground-primary">Automated workflow orchestration</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-accent-secondary" />
                <span className="text-foreground-primary">Enterprise security & compliance</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Card className="border-border bg-background-glass backdrop-blur-lg">
              <CardHeader className="text-center">
                <div className="flex justify-center mb-4">
                  <AnzarLogo size={48} />
                </div>
                <CardTitle className="text-2xl">Connexion</CardTitle>
                <CardDescription>
                  Connecte-toi au backend ANZAR
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-foreground-primary mb-2 block">
                        Email
                      </label>
                      <Input
                        type="email"
                        placeholder="admin@anzar.dev"
                        leftIcon={<Mail className="h-4 w-4" />}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-foreground-primary mb-2 block">
                        Mot de passe
                      </label>
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        leftIcon={<Lock className="h-4 w-4" />}
                        rightIcon={
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="text-foreground-secondary hover:text-foreground-primary"
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        }
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="p-3 rounded-lg bg-accent-error/10 border border-accent-error/20 text-accent-error text-sm"
                    >
                      {error}
                    </motion.div>
                  )}

                  <div className="flex items-center">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border bg-background-secondary text-accent-primary focus:ring-accent-primary"
                      />
                      <span className="text-sm text-foreground-secondary">Rester connecté</span>
                    </label>
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    isLoading={isLoading}
                    disabled={isLoading}
                  >
                    Se connecter
                  </Button>

                </form>
              </CardContent>
            </Card>

            <div className="mt-6 text-center text-xs text-foreground-muted">
              <p>{"© "}{new Date().getFullYear()} IssalanHub · Tous droits reserves</p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
