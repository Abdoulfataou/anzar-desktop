/**
 * LoginPage — Connexion / Inscription par OTP (passwordless)
 *
 * Flow:
 * 1. L'utilisateur entre son email → on envoie un code 6 chiffres
 * 2. L'utilisateur saisit le code → vérification + session créée
 * 3. Si l'email est nouveau, le compte est créé automatiquement
 */
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, ArrowRight, Loader2, AlertCircle, ArrowLeft, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { authService } from '@/services/auth';
import TitleBar from '@/components/layout/TitleBar';

type Step = 'email' | 'otp';

export default function LoginPage() {
  const navigate = useNavigate();

  // Flow state
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [expiresIn, setExpiresIn] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Refs for OTP inputs
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // ── Step 1: Send OTP code ──
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError('Entre ton adresse email');
      return;
    }

    setLoading(true);
    try {
      const result = await authService.sendCode(trimmedEmail);
      setIsNewUser(result.is_new_user);
      setExpiresIn(result.expires_in_minutes);
      setStep('otp');
      setResendCooldown(60);
      setSuccessMessage(`Code envoye a ${trimmedEmail}`);

      // Focus first OTP input after transition
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'envoyer le code");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Verify OTP code ──
  const handleVerifyCode = async () => {
    setError(null);
    const code = otpDigits.join('');

    if (code.length !== 6) {
      setError('Entre le code complet (6 chiffres)');
      return;
    }

    setLoading(true);
    try {
      await authService.verifyCode(email.trim().toLowerCase(), code);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code invalide ou expire');
      // Clear OTP on error
      setOtpDigits(['', '', '', '', '', '']);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } finally {
      setLoading(false);
    }
  };

  // ── OTP input handlers ──
  const handleOtpChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, '').slice(-1);
    const newDigits = [...otpDigits];
    newDigits[index] = digit;
    setOtpDigits(newDigits);

    // Auto-advance to next input
    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered
    if (digit && index === 5) {
      const fullCode = newDigits.join('');
      if (fullCode.length === 6) {
        // Small delay to let state update
        setTimeout(() => handleVerifyCode(), 50);
      }
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') {
      handleVerifyCode();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    const newDigits = [...otpDigits];
    for (let i = 0; i < pasted.length; i++) {
      newDigits[i] = pasted[i];
    }
    setOtpDigits(newDigits);

    // Focus last filled or next empty
    const focusIndex = Math.min(pasted.length, 5);
    otpRefs.current[focusIndex]?.focus();

    // Auto-submit if 6 digits pasted
    if (pasted.length === 6) {
      setTimeout(() => handleVerifyCode(), 50);
    }
  };

  // ── Resend code ──
  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      await authService.sendCode(email.trim().toLowerCase());
      setResendCooldown(60);
      setSuccessMessage('Nouveau code envoye !');
      setOtpDigits(['', '', '', '', '', '']);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du renvoi');
    } finally {
      setLoading(false);
    }
  };

  // ── Go back to email step ──
  const handleBack = () => {
    setStep('email');
    setError(null);
    setSuccessMessage(null);
    setOtpDigits(['', '', '', '', '', '']);
  };

  return (
    <div className="h-screen flex flex-col bg-bg-primary overflow-hidden">
      <TitleBar />
      <div className="flex-1 flex items-center justify-center overflow-y-auto">
        <div className="w-full max-w-md px-8 py-10">
          {/* Logo */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold gradient-text mb-2">ANZAR</h1>
            <p className="text-sm text-text-muted">
              {step === 'email'
                ? 'Entre ton email pour continuer'
                : isNewUser
                ? 'Bienvenue ! Verifie ton email'
                : 'Entre le code recu par email'}
            </p>
          </div>

          {/* Success message */}
          {successMessage && (
            <div className="flex items-center gap-2 px-4 py-3 mb-6 rounded-lg bg-accent-success/10 border border-accent-success/20">
              <CheckCircle size={16} className="text-accent-success flex-shrink-0" />
              <p className="text-sm text-accent-success">{successMessage}</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 mb-6 rounded-lg bg-accent-error/10 border border-accent-error/20">
              <AlertCircle size={16} className="text-accent-error flex-shrink-0" />
              <p className="text-sm text-accent-error">{error}</p>
            </div>
          )}

          {/* ── Step 1: Email ── */}
          {step === 'email' && (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Adresse email
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
                ) : (
                  <>
                    <Mail size={18} />
                    Recevoir un code de connexion
                    <ArrowRight size={16} />
                  </>
                )}
              </button>

              <p className="text-xs text-text-muted text-center mt-3">
                Un code a 6 chiffres sera envoye a ton email.
                {' '}Si tu n'as pas de compte, il sera cree automatiquement.
              </p>
            </form>
          )}

          {/* ── Step 2: OTP Code ── */}
          {step === 'otp' && (
            <div className="space-y-6">
              {/* Back button + email display */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleBack}
                  className="p-2 rounded-lg hover:bg-bg-secondary transition-colors text-text-muted hover:text-text-primary"
                >
                  <ArrowLeft size={18} />
                </button>
                <div className="flex-1">
                  <p className="text-sm text-text-secondary">
                    Code envoye a <span className="font-medium text-text-primary">{email}</span>
                  </p>
                  {expiresIn > 0 && (
                    <p className="text-xs text-text-muted">
                      Expire dans {expiresIn} minutes
                    </p>
                  )}
                </div>
              </div>

              {/* OTP Input Grid */}
              <div className="flex justify-center gap-3">
                {otpDigits.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    onPaste={i === 0 ? handleOtpPaste : undefined}
                    className={cn(
                      'w-12 h-14 text-center text-xl font-bold rounded-lg border transition-all',
                      'bg-bg-secondary border-border-subtle',
                      'text-text-primary',
                      'focus:outline-none focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/30',
                      digit && 'border-accent-primary/50',
                    )}
                    autoFocus={i === 0}
                  />
                ))}
              </div>

              {/* Verify button */}
              <button
                onClick={handleVerifyCode}
                disabled={loading || otpDigits.join('').length < 6}
                className={cn(
                  'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg',
                  'font-medium text-white transition-all',
                  'gradient-bg hover:opacity-90',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    <CheckCircle size={18} />
                    Verifier le code
                  </>
                )}
              </button>

              {/* Resend */}
              <div className="text-center">
                {resendCooldown > 0 ? (
                  <p className="text-xs text-text-muted">
                    Renvoyer dans {resendCooldown}s
                  </p>
                ) : (
                  <button
                    onClick={handleResend}
                    disabled={loading}
                    className="text-sm text-accent-primary hover:underline disabled:opacity-50"
                  >
                    Renvoyer le code
                  </button>
                )}
              </div>
            </div>
          )}

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
              {"© "}{new Date().getFullYear()} IssalanHub · USA · Niger · Tous droits reserves
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
