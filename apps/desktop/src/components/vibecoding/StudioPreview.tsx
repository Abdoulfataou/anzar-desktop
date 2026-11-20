/**
 * StudioPreview — Live Preview avec Browser Tools intégrés.
 *
 * Inspiré de TRAE SOLO Browser Tools / Computer Use:
 *   - Toolbar navigateur complet (URL bar, refresh, device selector)
 *   - Console panel (capture console.log/error/warn de l'iframe)
 *   - Element inspector (highlight + info au clic)
 *   - Device presets étendus (iPhone, iPad, Pixel, Desktop)
 *   - Responsive resize live
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  RefreshCw, Smartphone, Tablet, Monitor,
  Globe, Loader2, ExternalLink, Wifi, WifiOff,
  Terminal, X, ChevronDown, Search, Trash2,
  AlertTriangle, Info, Bug,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  browserTools,
  DEVICE_PRESETS,
  type ConsoleEntry,
  type DevicePreset,
} from '@/services/studio/browserTools';

// ============================================================================
// TYPES
// ============================================================================

export interface StudioPreviewProps {
  /** URL du dev server (ex: http://localhost:3000) */
  previewUrl: string | null;
  /** Callback pour ouvrir dans le navigateur externe */
  onOpenExternal?: () => void;
}

// ============================================================================
// CONSOLE PANEL
// ============================================================================

const ConsolePanel: React.FC<{
  entries: ConsoleEntry[];
  onClear: () => void;
}> = ({ entries, onClear }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  const levelColors: Record<string, string> = {
    log: 'text-text-secondary',
    info: 'text-blue-400',
    warn: 'text-amber-400',
    error: 'text-red-400',
  };

  const levelIcons: Record<string, React.ReactNode> = {
    log: <Terminal size={10} />,
    info: <Info size={10} />,
    warn: <AlertTriangle size={10} />,
    error: <Bug size={10} />,
  };

  return (
    <div className="flex flex-col border-t border-border-subtle bg-bg-primary">
      {/* Console header */}
      <div className="flex items-center justify-between px-2 py-1 bg-bg-secondary/50 border-b border-border-subtle">
        <div className="flex items-center gap-1.5">
          <Terminal size={12} className="text-text-muted" />
          <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Console</span>
          {entries.length > 0 && (
            <span className="text-[9px] text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded-full">
              {entries.length}
            </span>
          )}
          {entries.filter(e => e.level === 'error').length > 0 && (
            <span className="text-[9px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded-full">
              {entries.filter(e => e.level === 'error').length} err
            </span>
          )}
        </div>
        <button
          onClick={onClear}
          className="p-1 rounded text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-colors"
          title="Effacer la console"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Console entries */}
      <div ref={scrollRef} className="max-h-[150px] overflow-y-auto scrollbar-thin">
        {entries.length === 0 ? (
          <div className="px-3 py-3 text-center text-[10px] text-text-muted">
            Aucun message console
          </div>
        ) : (
          entries.map(entry => (
            <div
              key={entry.id}
              className={cn(
                'flex items-start gap-1.5 px-2 py-0.5 text-[11px] font-mono border-b border-border-subtle/30',
                entry.level === 'error' && 'bg-red-500/3',
                entry.level === 'warn' && 'bg-amber-500/3',
              )}
            >
              <span className={cn('flex-shrink-0 mt-0.5', levelColors[entry.level])}>
                {levelIcons[entry.level]}
              </span>
              <span className={cn('flex-1 break-all whitespace-pre-wrap', levelColors[entry.level])}>
                {entry.message}
              </span>
              <span className="text-[9px] text-text-muted flex-shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ============================================================================
// DEVICE SELECTOR DROPDOWN
// ============================================================================

const DeviceSelector: React.FC<{
  selected: string;
  onSelect: (id: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}> = ({ selected, onSelect, isOpen, onToggle }) => {
  const preset = DEVICE_PRESETS.find(p => p.id === selected);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onToggle]);

  const categories = [
    { key: 'phone' as const, label: 'Phones', icon: <Smartphone size={11} /> },
    { key: 'tablet' as const, label: 'Tablets', icon: <Tablet size={11} /> },
    { key: 'desktop' as const, label: 'Desktop', icon: <Monitor size={11} /> },
  ];

  const categoryIcon = preset?.category === 'phone'
    ? <Smartphone size={13} />
    : preset?.category === 'tablet'
      ? <Tablet size={13} />
      : <Monitor size={13} />;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-bg-tertiary/40 hover:bg-bg-tertiary text-text-secondary text-[11px] transition-colors"
      >
        {categoryIcon}
        <span className="max-w-[80px] truncate">{preset?.label || 'Device'}</span>
        <ChevronDown size={11} className={cn('transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-[200px] bg-bg-secondary border border-border-subtle rounded-xl shadow-xl z-50 py-1 overflow-hidden">
          {categories.map(cat => {
            const devices = DEVICE_PRESETS.filter(p => p.category === cat.key);
            return (
              <div key={cat.key}>
                <div className="px-3 py-1 text-[9px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-1">
                  {cat.icon} {cat.label}
                </div>
                {devices.map(d => (
                  <button
                    key={d.id}
                    onClick={() => { onSelect(d.id); onToggle(); }}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-[11px] hover:bg-surface-hover transition-colors flex items-center justify-between',
                      selected === d.id && 'text-accent-primary bg-accent-primary/5',
                    )}
                  >
                    <span>{d.label}</span>
                    <span className="text-[9px] text-text-muted">{d.width}×{d.height}</span>
                  </button>
                ))}
              </div>
            );
          })}
          {/* Responsive / full width option */}
          <div className="border-t border-border-subtle mt-1 pt-1">
            <button
              onClick={() => { onSelect('responsive'); onToggle(); }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-[11px] hover:bg-surface-hover transition-colors',
                selected === 'responsive' && 'text-accent-primary bg-accent-primary/5',
              )}
            >
              🔄 Responsive (100%)
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const StudioPreview: React.FC<StudioPreviewProps> = ({
  previewUrl,
  onOpenExternal,
}) => {
  const [selectedDevice, setSelectedDevice] = useState('responsive');
  const [isLoading, setIsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showConsole, setShowConsole] = useState(false);
  const [showDeviceDropdown, setShowDeviceDropdown] = useState(false);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [inspectorActive, setInspectorActive] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Subscribe to console updates
  useEffect(() => {
    browserTools.startListening();
    const unsub = browserTools.subscribe(entries => setConsoleEntries(entries));
    return () => {
      unsub();
      browserTools.stopListening();
    };
  }, []);

  // Inject console capture when iframe loads
  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    if (iframeRef.current) {
      browserTools.injectConsoleCapture(iframeRef.current);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshKey(k => k + 1);
    setIsLoading(true);
    browserTools.clear();
  }, []);

  useEffect(() => {
    if (previewUrl) setIsLoading(true);
  }, [previewUrl]);

  const handleToggleInspector = useCallback(() => {
    if (iframeRef.current) {
      browserTools.toggleInspector(iframeRef.current);
      setInspectorActive(a => !a);
    }
  }, []);

  const handleClearConsole = useCallback(() => {
    browserTools.clear();
  }, []);

  // Compute iframe dimensions from device preset
  const iframeStyle = useMemo(() => {
    if (selectedDevice === 'responsive') {
      return { width: '100%', maxWidth: '9999px' };
    }
    const preset = DEVICE_PRESETS.find(p => p.id === selectedDevice);
    if (!preset) return { width: '100%', maxWidth: '9999px' };
    return { width: `${preset.width}px`, maxWidth: `${preset.width}px` };
  }, [selectedDevice]);

  const errorCount = consoleEntries.filter(e => e.level === 'error').length;

  // ── No server state ──
  if (!previewUrl) {
    return (
      <div className="flex flex-col h-full bg-bg-primary">
        <div className="flex items-center px-3 py-2 border-b border-border-subtle bg-bg-secondary/50">
          <Globe size={14} className="text-text-muted mr-2" />
          <span className="text-[11px] text-text-muted font-medium">Preview</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-bg-tertiary/60 flex items-center justify-center mx-auto mb-4">
              <WifiOff size={24} className="text-text-muted/40" />
            </div>
            <p className="text-sm font-medium text-text-secondary mb-1.5">
              Aucun serveur détecté
            </p>
            <p className="text-xs text-text-muted leading-relaxed max-w-[220px] mx-auto">
              Clique sur <span className="font-semibold text-text-secondary">Run</span> pour lancer
              le serveur de développement et voir ton app en temps réel ici.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Active preview ──
  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* ── Enhanced Toolbar ── */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border-subtle bg-bg-secondary/50">
        {/* Refresh */}
        <button
          onClick={handleRefresh}
          className="p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-colors"
          title="Rafraîchir"
        >
          <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
        </button>

        {/* URL bar */}
        <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bg-tertiary/60 border border-border-subtle/50 min-w-0">
          {isLoading ? (
            <Loader2 size={11} className="animate-spin text-accent-primary flex-shrink-0" />
          ) : (
            <Wifi size={11} className="text-emerald-400 flex-shrink-0" />
          )}
          <span className="text-[11px] text-text-muted font-mono truncate">
            {previewUrl}
          </span>
        </div>

        {/* Device selector */}
        <DeviceSelector
          selected={selectedDevice}
          onSelect={setSelectedDevice}
          isOpen={showDeviceDropdown}
          onToggle={() => setShowDeviceDropdown(s => !s)}
        />

        {/* Inspector toggle */}
        <button
          onClick={handleToggleInspector}
          className={cn(
            'p-1.5 rounded-lg transition-colors',
            inspectorActive
              ? 'text-accent-primary bg-accent-primary/10'
              : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
          )}
          title={inspectorActive ? 'Désactiver l\'inspecteur' : 'Inspecteur d\'éléments'}
        >
          <Search size={13} />
        </button>

        {/* Console toggle */}
        <button
          onClick={() => setShowConsole(s => !s)}
          className={cn(
            'p-1.5 rounded-lg transition-colors relative',
            showConsole
              ? 'text-accent-primary bg-accent-primary/10'
              : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
          )}
          title="Console"
        >
          <Terminal size={13} />
          {errorCount > 0 && !showConsole && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 text-white text-[8px] rounded-full flex items-center justify-center font-bold">
              {errorCount > 9 ? '9+' : errorCount}
            </span>
          )}
        </button>

        {/* Open external */}
        {onOpenExternal && (
          <button
            onClick={onOpenExternal}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-colors"
            title="Ouvrir dans le navigateur"
          >
            <ExternalLink size={13} />
          </button>
        )}
      </div>

      {/* ── Iframe container ── */}
      <div className="flex-1 overflow-hidden flex items-start justify-center bg-bg-tertiary/50 p-0 relative">
        <div
          className="h-full bg-white transition-all duration-300 overflow-hidden"
          style={{
            ...iframeStyle,
            ...(selectedDevice !== 'responsive' && {
              borderLeft: '1px solid var(--border-subtle)',
              borderRight: '1px solid var(--border-subtle)',
            }),
          }}
        >
          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 bg-bg-primary/80 flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-2">
                <Loader2 size={24} className="animate-spin text-accent-primary" />
                <span className="text-xs text-text-muted">Chargement...</span>
              </div>
            </div>
          )}

          <iframe
            ref={iframeRef}
            key={refreshKey}
            src={previewUrl}
            className="w-full h-full border-0"
            onLoad={handleIframeLoad}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            title="Live Preview"
          />
        </div>
      </div>

      {/* ── Console panel ── */}
      {showConsole && (
        <ConsolePanel
          entries={consoleEntries}
          onClear={handleClearConsole}
        />
      )}
    </div>
  );
};

export default StudioPreview;
