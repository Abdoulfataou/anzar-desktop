/**
 * AppLayout - Shell principal ANZAR
 * TitleBar + Sidebar + Content + CommandPalette
 * Interface unifiée sans onglets séparés
 */
import { Outlet } from 'react-router-dom';
import TitleBar from './TitleBar';
import Sidebar from './Sidebar';
import CommandPalette from '@/components/ui/CommandPalette';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
  className?: string;
}

export default function AppLayout({ className }: AppLayoutProps) {
  return (
    <div
      className={cn(
        'h-screen w-screen flex flex-col bg-bg-primary text-text-primary',
        className
      )}
    >
      {/* Command Palette (global) */}
      <CommandPalette />

      {/* Title bar */}
      <TitleBar />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <div className="flex-1 flex flex-col overflow-hidden">
          <main className="flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
