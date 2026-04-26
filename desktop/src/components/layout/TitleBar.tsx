/**
 * Custom Tauri window title bar component
 * Draggable area with window controls (macOS-style traffic lights)
 * Falls back gracefully to browser mode when Tauri is not available
 */
import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
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

  // Listen for maximize state changes
  useEffect(() => {
    if (!isTauriAvailable) return;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const { appWindow } = await import('@tauri-apps/api/window');
        const maximized = await appWindow.isMaximized();
        setIsMaximized(maximized);
      } catch {}
    })();

    return () => {
      unlisten?.();
    };
  }, [isTauriAvailable]);

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
        'h-11 bg-bg-primary/80 backdrop-blur-md border-b border-border-subtle/50',
        'flex items-center justify-between px-4 gap-4',
        'select-none flex-shrink-0',
        className
      )}
    >
      {/* Left side: Window controls (macOS style) */}
      {isTauriAvailable && (
        <div className="flex items-center gap-2">
          {/* Close */}
          <button
            onClick={handleClose}
            className={cn(
              'w-3 h-3 rounded-full transition-all duration-150',
              'bg-[#FF5F57] hover:bg-[#FF5F57]/80',
              'flex items-center justify-center group',
              'hover:shadow-[0_0_6px_rgba(255,95,87,0.4)]'
            )}
            aria-label="Fermer"
            title="Fermer"
          >
            <X size={8} className="text-[#4D0000] opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          {/* Minimize */}
          <button
            onClick={handleMinimize}
            className={cn(
              'w-3 h-3 rounded-full transition-all duration-150',
              'bg-[#FEBC2E] hover:bg-[#FEBC2E]/80',
              'flex items-center justify-center group',
              'hover:shadow-[0_0_6px_rgba(254,188,46,0.4)]'
            )}
            aria-label="Reduire"
            title="Reduire"
          >
            <Minus size={8} className="text-[#995700] opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          {/* Maximize */}
          <button
            onClick={handleMaximize}
            className={cn(
              'w-3 h-3 rounded-full transition-all duration-150',
              'bg-[#28C840] hover:bg-[#28C840]/80',
              'flex items-center justify-center group',
              'hover:shadow-[0_0_6px_rgba(40,200,64,0.4)]'
            )}
            aria-label={isMaximized ? 'Restaurer' : 'Agrandir'}
            title={isMaximized ? 'Restaurer' : 'Agrandir'}
          >
            {isMaximized ? (
              <Copy size={7} className="text-[#006500] opacity-0 group-hover:opacity-100 transition-opacity" />
            ) : (
              <Square size={7} className="text-[#006500] opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </button>
        </div>
      )}

      {/* Center: App name */}
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[11px] font-medium text-text-muted tracking-wider">ANZAR</span>
      </div>

      {/* Right side: spacer to balance layout */}
      {isTauriAvailable && <div className="w-[56px]" />}
    </div>
  );
}
