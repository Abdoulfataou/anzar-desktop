/**
 * AppLayout - Shell principal ANZAR
 * TitleBar + Sidebar + Content + CommandPalette
 * Interface unifiée sans onglets séparés
 */
import { Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import TitleBar from './TitleBar';
import Sidebar from './Sidebar';
import CommandPalette from '@/components/ui/CommandPalette';
import OnboardingWelcome from '@/components/ui/OnboardingWelcome';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';
import { useAccountStore } from '@/stores/accountStore';
import { useOffline } from '@/hooks/useOffline';

interface AppLayoutProps {
  className?: string;
}

export default function AppLayout({ className }: AppLayoutProps) {
  const settingsTheme = useSettingsStore((s) => s.settings.theme);
  const currentTheme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const { isOnline, isSlowConnection } = useOffline();
  const hasCompletedOnboarding = useAccountStore((s) => s.hasCompletedOnboarding);

  useEffect(() => {
    // Applique le thème persistant dès que settingsStore est hydraté.
    if (settingsTheme && settingsTheme !== currentTheme) {
      setTheme(settingsTheme);
    }
  }, [settingsTheme, currentTheme, setTheme]);

  return (
    <div
      className={cn(
        'h-screen w-screen flex flex-col bg-bg-primary text-text-primary min-h-0',
        className
      )}
    >
      {/* Onboarding overlay for new users */}
      {!hasCompletedOnboarding && <OnboardingWelcome />}

      {/* Command Palette (global) */}
      <CommandPalette />

      {/* Title bar */}
      <TitleBar />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        <Sidebar />

        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Offline / slow connection banner */}
          {!isOnline && (
            <div className="flex items-center gap-2 px-4 py-2 bg-accent-error/10 border-b border-accent-error/20 flex-shrink-0">
              <WifiOff size={14} className="text-accent-error flex-shrink-0" />
              <p className="text-xs font-medium text-accent-error">
                Hors ligne — les fonctionnalites reseau sont desactivees
              </p>
            </div>
          )}
          {isOnline && isSlowConnection && (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-accent-warning/10 border-b border-accent-warning/20 flex-shrink-0">
              <WifiOff size={12} className="text-accent-warning flex-shrink-0" />
              <p className="text-[11px] font-medium text-accent-warning">
                Connexion lente — les reponses peuvent prendre plus de temps
              </p>
            </div>
          )}
          <main className="flex-1 overflow-hidden min-h-0">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
