/**
 * Custom Tauri window title bar — adapts to macOS (traffic lights) and Windows (rectangular buttons)
 */
import { useState, useEffect, useCallback } from ‘react’;
import { cn, isTauri } from ‘@/lib/utils’;
import { appWindow } from ‘@tauri-apps/api/window’;
import { type } from ‘@tauri-apps/api/os’;

interface TitleBarProps {
  className?: string;
}

export default function TitleBar({ className }: TitleBarProps) {
  const [tauriReady, setTauriReady] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [platform, setPlatform] = useState<’darwin’ | ‘windows’ | ‘linux’>(‘darwin’);

  useEffect(() => {
    if (!isTauri()) return;
    Promise.all([
      appWindow.isMaximized().catch(() => false),
      type().catch(() => ‘Darwin’ as string),
    ]).then(([maximized, osType]) => {
      setIsMaximized(maximized);
      const os = osType.toLowerCase();
      if (os.includes(‘windows’)) setPlatform(‘windows’);
      else if (os.includes(‘linux’)) setPlatform(‘linux’);
      else setPlatform(‘darwin’);
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

  const isMac = platform === ‘darwin’;

  // macOS-style traffic light dots
  const MacButton = ({ color, onClick, label }: {
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
      onKeyDown={(e) => { if (e.key === ‘Enter’ || e.key === ‘ ‘) { e.preventDefault(); onClick(); } }}
      style={{
        width: 12,
        height: 12,
        borderRadius: ‘50%’,
        backgroundColor: color,
        boxShadow: ‘inset 0 0 0 1px rgba(0,0,0,0.18)’,
      }}
      className="flex items-center justify-center cursor-pointer transition-all duration-150 hover:brightness-110 active:brightness-90"
    />
  );

  // Windows-style rectangular buttons
  const WinButton = ({ onClick, label, hoverClass, children }: {
    onClick: () => void;
    label: string;
    hoverClass: string;
    children: React.ReactNode;
  }) => (
    <button
      aria-label={label}
      title={label}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className={cn(
        ‘w-[46px] h-full flex items-center justify-center’,
        ‘text-text-secondary transition-colors duration-150’,
        hoverClass,
      )}
    >
      {children}
    </button>
  );

  return (
    <div
      className={cn(
        ‘h-11 bg-bg-primary/80 backdrop-blur-md border-b border-border-subtle/50’,
        ‘flex items-center select-none flex-shrink-0’,
        isMac ? ‘px-4 gap-4’ : ‘pl-4 pr-0 gap-0’,
        className
      )}
    >
      {/* macOS: controls on the left */}
      {tauriReady && isMac && (
        <div className="flex items-center gap-2 relative z-50">
          <MacButton color="#FF5F57" label="Fermer" onClick={handleClose} />
          <MacButton color="#FEBC2E" label="Reduire" onClick={handleMinimize} />
          <MacButton color="#28C840" label={isMaximized ? ‘Restaurer’ : ‘Agrandir’} onClick={handleMaximize} />
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

      {/* macOS: right spacer */}
      {tauriReady && isMac && (
        <div data-tauri-drag-region className="w-[60px] h-full" />
      )}

      {/* Windows/Linux: controls on the right */}
      {tauriReady && !isMac && (
        <div className="flex items-center h-full">
          <WinButton label="Reduire" onClick={handleMinimize} hoverClass="hover:bg-white/10">
            {/* Minimize icon — */}
            <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
              <rect width="10" height="1" />
            </svg>
          </WinButton>
          <WinButton
            label={isMaximized ? ‘Restaurer’ : ‘Agrandir’}
            onClick={handleMaximize}
            hoverClass="hover:bg-white/10"
          >
            {isMaximized ? (
              /* Restore icon */
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="2" y="3" width="7" height="7" rx="0.5" />
                <path d="M3 3V1.5C3 1.22 3.22 1 3.5 1H8.5C8.78 1 9 1.22 9 1.5V6.5C9 6.78 8.78 7 8.5 7H7" />
              </svg>
            ) : (
              /* Maximize icon */
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" />
              </svg>
            )}
          </WinButton>
          <WinButton label="Fermer" onClick={handleClose} hoverClass="hover:bg-red-600 hover:text-white">
            {/* Close icon X */}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M1 1L9 9M9 1L1 9" />
            </svg>
          </WinButton>
        </div>
      )}
    </div>
  );
}
