/**
 * Custom Tauri window title bar component
 * Draggable area with app name and window controls
 * Falls back gracefully to browser mode when Tauri is not available
 */
import { useState, useEffect } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { cn, isTauri } from '@/lib/utils';

interface TitleBarProps {
  className?: string;
}

export default function TitleBar({ className }: TitleBarProps) {
  const [isTauriAvailable, setIsTauriAvailable] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    setIsTauriAvailable(isTauri());
  }, []);

  const handleMinimize = async () => {
    if (!isTauriAvailable) return;
    try {
      const { appWindow } = await import('@tauri-apps/api/window');
      await appWindow.minimize();
    } catch (error) {
      console.error('Failed to minimize window:', error);
    }
  };

  const handleMaximize = async () => {
    if (!isTauriAvailable) return;
    try {
      const { appWindow } = await import('@tauri-apps/api/window');
      await appWindow.toggleMaximize();
      setIsMaximized(!isMaximized);
    } catch (error) {
      console.error('Failed to toggle maximize window:', error);
    }
  };

  const handleClose = async () => {
    if (!isTauriAvailable) return;
    try {
      const { appWindow } = await import('@tauri-apps/api/window');
      await appWindow.close();
    } catch (error) {
      console.error('Failed to close window:', error);
    }
  };

  return (
    <div
      data-tauri-drag-region
      className={cn(
        'h-10 bg-bg-primary border-b border-border-subtle',
        'flex items-center justify-between px-4 gap-4',
        'select-none',
        className
      )}
    >
      {/* Left side: App name */}
      <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
        <div className="w-2 h-2 rounded-full bg-accent-primary" />
        <span className="tracking-wide">ANZAR</span>
      </div>

      {/* Right side: Window controls (only show in Tauri) */}
      {isTauriAvailable && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleMinimize}
            className={cn(
              'p-1 rounded hover:bg-bg-secondary',
              'transition-colors duration-150',
              'text-text-secondary hover:text-text-primary'
            )}
            aria-label="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className={cn(
              'p-1 rounded hover:bg-bg-secondary',
              'transition-colors duration-150',
              'text-text-secondary hover:text-text-primary'
            )}
            aria-label="Maximize"
          >
            <Square size={14} />
          </button>
          <button
            onClick={handleClose}
            className={cn(
              'p-1 rounded hover:bg-red-500/20',
              'transition-colors duration-150',
              'text-text-secondary hover:text-red-500'
            )}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
