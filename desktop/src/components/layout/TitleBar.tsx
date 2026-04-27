/**
 * Custom Tauri window title bar — macOS traffic-light style
 */
import { useState, useEffect, useCallback } from 'react';
import { cn, isTauri } from '@/lib/utils';
import { appWindow } from '@tauri-apps/api/window';

interface TitleBarProps {
  className?: string;
}

export default function TitleBar({ className }: TitleBarProps) {
  const [tauriReady, setTauriReady] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    appWindow.isMaximized()
      .then((m) => {
        setIsMaximized(m);
        setTauriReady(true);
      })
      .catch(() => {
        setTauriReady(true);
      });
  }, []);

  const handleMinimize = useCallback(() => {
    appWindow.minimize().catch(console.error);
  }, []);

  const handleMaximize = useCallback(() => {
    appWindow.toggleMaximize()
      .then(() => appWindow.isMaximized())
      .then(setIsMaximized)
      .catch(console.error);
  }, []);

  const handleClose = useCallback(() => {
    appWindow.close().catch(console.error);
  }, []);

  const TrafficButton = ({ color, onClick, label }: {
    color: string;
    onClick: () => void;
    label: string;
  }) => (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{
        width: 12,
        height: 12,
        borderRadius: '50%',
        backgroundColor: color,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.18)',
      }}
      className="flex items-center justify-center cursor-pointer transition-all duration-150 hover:brightness-110 active:brightness-90"
    >
      {/* Style macOS: pas d’icônes, uniquement les pastilles */}
    </div>
  );

  return (
    <div
      className={cn(
        'h-11 bg-bg-primary/80 backdrop-blur-md border-b border-border-subtle/50',
        'flex items-center px-4 gap-4',
        'select-none flex-shrink-0',
        className
      )}
    >
      {/* Window controls */}
      {tauriReady && (
        <div className="flex items-center gap-2 relative z-50">
          <TrafficButton
            color="#FF5F57"
            label="Fermer"
            onClick={handleClose}
          />
          <TrafficButton
            color="#FEBC2E"
            label="Reduire"
            onClick={handleMinimize}
          />
          <TrafficButton
            color="#28C840"
            label={isMaximized ? 'Restaurer' : 'Agrandir'}
            onClick={handleMaximize}
          />
        </div>
      )}

      {/* Center: draggable area */}
      <div
        data-tauri-drag-region
        className="flex-1 flex items-center justify-center h-full"
      >
        <span className="text-[11px] font-medium text-text-muted tracking-wider pointer-events-none">
          ANZAR
        </span>
      </div>

      {/* Right spacer */}
      {tauriReady && (
        <div data-tauri-drag-region className="w-[60px] h-full" />
      )}
    </div>
  );
}
