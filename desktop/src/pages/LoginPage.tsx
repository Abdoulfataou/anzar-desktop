/**
 * LoginPage — Connexion / Inscription utilisateur
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, UserPlus, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { authService } from '@/services/auth';

type AuthMode = 'login' | 'register';

export default function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Email et mot de passe requis');
      return;
    }

    if (mode === 'register' && password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'register') {
        await authService.register(email.trim(), password);
      } else {
        await authService.login(email.trim(), password);
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-bg-primary">
      <div className="w-full max-w-md px-8 py-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold gradient-text mb-2">ANZAR</h1>
          <p className="text-sm text-text-muted">
            {mode === 'login' ? 'Connecte-toi pour continuer' : 'Crée ton compte'}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 mb-6 rounded-lg bg-accent-error/10 border border-accent-error/20">
            <AlertCircle size={16} className="text-accent-error flex-shrink-0" />
            <p className="text-sm text-accent-error">{error}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ton@email.com"
              className={cn(
                'w-full px-4 py-3 rounded-lg border transition-colors',
                'bg-bg-secondary border-border-subtle',
                'text-text-primary placeholder-text-muted',
                'focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30',
              )}
              autoFocus
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Mot de passe
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'Min. 8 caractères' : '••••••••'}
                className={cn(
                  'w-full px-4 py-3 pr-12 rounded-lg border transition-colors',
                  'bg-bg-secondary border-border-subtle',
                  'text-text-primary placeholder-text-muted',
                  'focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30',
                )}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={cn(
              'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg',
              'font-medium text-white transition-all',
              'gradient-bg hover:opacity-90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {loading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : mode === 'login' ? (
              <LogIn size={18} />
            ) : (
              <UserPlus size={18} />
            )}
            {loading
              ? 'Chargement...'
              : mode === 'login'
              ? 'Se connecter'
              : 'Créer un compte'}
          </button>
        </form>

        {/* Toggle mode */}
        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
            className="text-sm text-accent-primary hover:underline"
          >
            {mode === 'login'
              ? "Pas encore de compte ? S'inscrire"
              : 'Déjà un compte ? Se connecter'}
          </button>
        </div>

        {/* Footer — Contact & Copyright */}
        <div className="mt-10 pt-6 border-t border-border-subtle/30 text-center space-y-3">
          <div className="flex items-center justify-center gap-4 text-xs text-text-muted">
            <a href="mailto:abdul@issalanhub.com" className="hover:text-accent-primary transition-colors">
              abdul@issalanhub.com
            </a>
            <span className="text-border-subtle">|</span>
            <a href="https://wa.me/17172161490" target="_blank" rel="noopener noreferrer" className="hover:text-green-500 transition-colors">
              WhatsApp
            </a>
            <span className="text-border-subtle">|</span>
            <a href="https://t.me/+17172161490" target="_blank" rel="noopener noreferrer" className="hover:text-blue-500 transition-colors">
              Telegram
            </a>
          </div>
          <p className="text-[10px] text-text-muted/60">
            &copy; {new Date().getFullYear()} IssalanHub &middot; USA &middot; Niger &middot; Tous droits réservés
          </p>
        </div>
      </div>
    </div>
  );
}
