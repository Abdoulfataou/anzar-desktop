/**
 * AppLayout - Shell principal ANZAR
 * TitleBar + Sidebar + Content + CommandPalette
 * Interface unifiée sans onglets séparés
 */
import { Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import TitleBar from './TitleBar';
import Sidebar from './Sidebar';
import CommandPalette from '@/components/ui/CommandPalette';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';

interface AppLayoutProps {
  className?: string;
}

export default function AppLayout({ className }: AppLayoutProps) {
  const settingsTheme = useSettingsStore((s) => s.settings.theme);
  const currentTheme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

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
      {/* Command Palette (global) */}
      <CommandPalette />

      {/* Title bar */}
      <TitleBar />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        <Sidebar />

        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <main className="flex-1 overflow-hidden min-h-0">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
