/**
 * AppLayout - Shell principal ANZAR
 * TitleBar + Sidebar + Content + CommandPalette
 * Interface unifiée sans onglets séparés
 */
import { Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import TitleBar from './TitleBar';
import Sidebar from './Sidebar';
import CommandPalette from '@/components/ui/CommandPalette';
import { startBackgroundQueues } from '@/services/background';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';
import { useOffline } from '@/hooks/useOffline';
import { loadMcpConfig, startServer } from '@/services/mcp/manager';
import { prefetchRemoteSkills } from '@/services/skills/remote';

interface AppLayoutProps {
  className?: string;
}

export default function AppLayout({ className }: AppLayoutProps) {
  const settingsTheme = useSettingsStore((s) => s.settings.theme);
  const currentTheme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const { isOnline, isSlowConnection } = useOffline();
  // L'espace de travail dessine ses propres panneaux ; les autres pages reçoivent un cadre unique.
  const { pathname } = useLocation();
  const framed = pathname.startsWith('/settings') || pathname.startsWith('/skills') || pathname.startsWith('/automations') || pathname.startsWith('/connectors') || pathname.startsWith('/tickets');

  useEffect(() => {
    // Connecteurs MCP activés : démarrés en arrière-plan, prêts avant le premier message
    const t = setTimeout(() => {
      void loadMcpConfig().then((servers) => servers.filter((s) => s.enabled).forEach((s) => void startServer(s.id))).catch(() => {});
      prefetchRemoteSkills(); // skills du serveur : copie locale à jour avant la première demande
    }, 2_000);
    return () => clearTimeout(t);
  }, []);

  // File du super-agent et automatisations : services hors composant, démarrés avec la session.
  useEffect(() => startBackgroundQueues(), []);

  useEffect(() => {
    // Applique le thème persistant dès que settingsStore est hydraté.
    if (settingsTheme && settingsTheme !== currentTheme) {
      setTheme(settingsTheme);
    }
  }, [settingsTheme, currentTheme, setTheme]);

  return (
    <div
      className={cn(
        'h-screen w-screen flex flex-col bg-window text-text-primary min-h-0',
        className
      )}
    >
      {/* Lien d'évitement clavier */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[200] focus:top-2 focus:left-2 focus:rounded-lg focus:border focus:border-border-medium focus:bg-surface-elevated focus:px-3 focus:py-2 focus:text-ui-base focus:text-text-primary focus:shadow-lg"
      >
        Aller au contenu
      </a>

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
                Hors ligne — les fonctionnalités réseau sont désactivées
              </p>
            </div>
          )}
          {isOnline && isSlowConnection && (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-accent-warning/10 border-b border-accent-warning/20 flex-shrink-0">
              <WifiOff size={12} className="text-accent-warning flex-shrink-0" />
              <p className="text-[11px] font-medium text-accent-warning">
                Connexion lente — les réponses peuvent prendre plus de temps
              </p>
            </div>
          )}
          <main id="main-content" tabIndex={-1} className="flex-1 overflow-hidden min-h-0 pr-1 pb-1 outline-none">
            {framed ? (
              <div className="h-full overflow-hidden rounded-xl border border-border-medium bg-bg-primary">
                <Outlet />
              </div>
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
