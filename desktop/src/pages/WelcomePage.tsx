/**
 * WelcomePage — Accueil public "prompt-first".
 *
 * L'utilisateur décrit son idée AVANT de s'authentifier. Le prompt est mis
 * en attente (sessionStorage) puis rejoué automatiquement après login :
 * mode 'build' → pipeline plan → studio ; mode 'chat' → conversation.
 *
 * Réutilise le WelcomeScreen du chat (hero + segmented control + suggestions)
 * sans en dupliquer le design.
 */
import { useNavigate } from 'react-router-dom';
import TitleBar from '@/components/layout/TitleBar';
import WelcomeScreen from '@/components/chat/WelcomeScreen';
import { savePendingPrompt } from '@/lib/pendingPrompt';

export default function WelcomePage() {
  const navigate = useNavigate();

  const handleIdea = (prompt: string, mode: 'build' | 'chat') => {
    savePendingPrompt({ mode, prompt });
    navigate('/login');
  };

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      <TitleBar />
      <main className="flex-1 min-h-0 flex flex-col">
        <WelcomeScreen
          onGenerate={(prompt) => handleIdea(prompt, 'build')}
          onChat={(prompt) => handleIdea(prompt, 'chat')}
          onImportFolder={() => navigate('/login')}
        />
        <p className="pb-5 text-center text-[11px] text-text-muted">
          Connexion requise après la première idée — code OTP par email, sans mot de passe.
        </p>
      </main>
    </div>
  );
}
