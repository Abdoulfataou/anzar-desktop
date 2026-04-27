/**
 * StatusBar - Barre d'état en bas de l'application
 * Affiche le modèle actif, statut réseau, raccourcis clavier
 */
import { Wifi, WifiOff, Zap, Brain, Keyboard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';
import { useOffline } from '@/hooks/useOffline';

export default function StatusBar() {
  const model = useSettingsStore((s) => s.settings.model);
  const { isOnline } = useOffline();

  return (
    <div className="h-7 flex items-center justify-between px-3 border-t border-border-subtle bg-bg-secondary/50 backdrop-blur-sm text-[11px] select-none">
      {/* Left side */}
      <div className="flex items-center gap-3">
        {/* Connection status */}
        <div className={cn(
          'flex items-center gap-1.5',
          isOnline ? 'text-accent-success' : 'text-accent-error'
        )}>
          {isOnline ? <Wifi size={11} /> : <WifiOff size={11} />}
          <span>{isOnline ? 'En ligne' : 'Hors ligne'}</span>
        </div>

        {/* Separator */}
        <div className="w-px h-3 bg-border-subtle" />

        {/* Model */}
        <div className="flex items-center gap-1.5 text-text-tertiary">
          {model === 'fast' ? <Zap size={11} /> : <Brain size={11} />}
          <span>{model === 'fast' ? 'Rapide' : 'Réflexion'}</span>
        </div>
      </div>

      {/* Right side - shortcuts */}
      <div className="flex items-center gap-3 text-text-muted">
        <div className="flex items-center gap-1.5">
          <Keyboard size={11} />
          <span className="kbd">⌘K</span>
          <span>Commandes</span>
        </div>
      </div>
    </div>
  );
}
