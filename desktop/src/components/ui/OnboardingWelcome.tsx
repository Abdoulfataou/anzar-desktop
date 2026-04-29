/**
 * OnboardingWelcome — Ecran de bienvenue pour les nouveaux utilisateurs
 * Overlay affiche une seule fois apres la premiere connexion
 */
import { useState } from 'react';
import { MessageSquare, FolderOpen, Zap, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import AnzarLogo from '@/components/ui/AnzarLogo';
import { useAccountStore } from '@/stores/accountStore';

const steps = [
  {
    icon: MessageSquare,
    color: 'text-accent-primary',
    bg: 'bg-accent-primary/10',
    title: 'Discute avec ANZAR',
    description:
      'Pose tes questions, demande des explications ou de l\'aide sur n\'importe quel sujet technique.',
  },
  {
    icon: FolderOpen,
    color: 'text-accent-secondary',
    bg: 'bg-accent-secondary/10',
    title: 'Cree des projets complets',
    description:
      'Decris ton application et ANZAR genere le code, les fichiers et la structure du projet automatiquement.',
  },
  {
    icon: Zap,
    color: 'text-accent-warning',
    bg: 'bg-accent-warning/10',
    title: 'Modele prepaye',
    description:
      'Pas d\'abonnement. Recharge ton solde via Wave, Orange Money ou M-Pesa et consomme a ton rythme.',
  },
];

export default function OnboardingWelcome() {
  const [currentStep, setCurrentStep] = useState(0);
  const completeOnboarding = useAccountStore((s) => s.completeOnboarding);
  const user = useAccountStore((s) => s.user);

  const isLastStep = currentStep === steps.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      completeOnboarding();
    } else {
      setCurrentStep((s) => s + 1);
    }
  };

  const handleSkip = () => {
    completeOnboarding();
  };

  const step = steps[currentStep];
  const Icon = step.icon;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-bg-primary border border-border-subtle rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex flex-col items-center pt-8 pb-4 px-6">
          <AnzarLogo size={48} />
          <h1 className="mt-3 text-lg font-bold text-text-primary">
            Bienvenue{user?.name ? `, ${user.name}` : ''} !
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Decouvre ce que tu peux faire avec ANZAR
          </p>
        </div>

        {/* Step content */}
        <div className="px-8 py-6">
          <div className="flex flex-col items-center text-center">
            <div className={cn('w-14 h-14 rounded-2xl flex items-center justify-center mb-4', step.bg)}>
              <Icon size={28} className={step.color} />
            </div>
            <h2 className="text-base font-semibold text-text-primary mb-2">
              {step.title}
            </h2>
            <p className="text-sm text-text-secondary leading-relaxed">
              {step.description}
            </p>
          </div>
        </div>

        {/* Step dots */}
        <div className="flex justify-center gap-1.5 pb-4">
          {steps.map((_, i) => (
            <div
              key={i}
              className={cn(
                'w-2 h-2 rounded-full transition-all duration-300',
                i === currentStep
                  ? 'bg-accent-primary w-5'
                  : i < currentStep
                    ? 'bg-accent-primary/40'
                    : 'bg-surface-hover'
              )}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-6 pb-6">
          <button
            onClick={handleSkip}
            className="text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            Passer
          </button>
          <button
            onClick={handleNext}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
              'bg-accent-primary text-white hover:bg-accent-primary/90 active:scale-[0.97]'
            )}
          >
            {isLastStep ? 'Commencer' : 'Suivant'}
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
