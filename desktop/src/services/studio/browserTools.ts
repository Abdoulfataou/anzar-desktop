/**
 * BrowserTools — Outils navigateur intégrés pour le VibeCoding Studio.
 *
 * Inspiré de TRAE SOLO Browser Tools / Computer Use:
 *  - Capture des console.log/error/warn de l'iframe preview
 *  - Device presets étendus (iPhone, Pixel, iPad, etc.)
 *  - Screenshot du preview
 *  - Injection de scripts dans l'iframe (element highlighting, etc.)
 *
 * Communication via postMessage entre le studio et l'iframe preview.
 */

// ============================================================================
// TYPES
// ============================================================================

export type ConsoleLevel = 'log' | 'warn' | 'error' | 'info';

export interface ConsoleEntry {
  id: string;
  level: ConsoleLevel;
  message: string;
  timestamp: number;
  source?: string;
}

export interface DevicePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  category: 'phone' | 'tablet' | 'desktop';
  userAgent?: string;
}

// ============================================================================
// DEVICE PRESETS
// ============================================================================

export const DEVICE_PRESETS: DevicePreset[] = [
  // Phones
  { id: 'iphone-15', label: 'iPhone 15', width: 393, height: 852, category: 'phone' },
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667, category: 'phone' },
  { id: 'pixel-7', label: 'Pixel 7', width: 412, height: 915, category: 'phone' },
  { id: 'galaxy-s23', label: 'Galaxy S23', width: 360, height: 780, category: 'phone' },

  // Tablets
  { id: 'ipad', label: 'iPad', width: 810, height: 1080, category: 'tablet' },
  { id: 'ipad-pro-11', label: 'iPad Pro 11"', width: 834, height: 1194, category: 'tablet' },
  { id: 'ipad-pro-13', label: 'iPad Pro 13"', width: 1024, height: 1366, category: 'tablet' },

  // Desktops
  { id: 'laptop', label: 'Laptop', width: 1366, height: 768, category: 'desktop' },
  { id: 'desktop-hd', label: 'Desktop HD', width: 1920, height: 1080, category: 'desktop' },
  { id: 'desktop-4k', label: 'Desktop 4K', width: 2560, height: 1440, category: 'desktop' },
];

// ============================================================================
// CONSOLE CAPTURE SCRIPT (injected into iframe)
// ============================================================================

/**
 * Script injected into the preview iframe to capture console messages
 * and forward them to the parent window via postMessage.
 */
export const CONSOLE_CAPTURE_SCRIPT = `
(function() {
  if (window.__anzarConsoleCapture) return;
  window.__anzarConsoleCapture = true;

  const levels = ['log', 'warn', 'error', 'info'];
  const originals = {};

  levels.forEach(level => {
    originals[level] = console[level];
    console[level] = function(...args) {
      originals[level].apply(console, args);
      try {
        const message = args.map(a => {
          if (typeof a === 'object') {
            try { return JSON.stringify(a, null, 2); }
            catch { return String(a); }
          }
          return String(a);
        }).join(' ');

        window.parent.postMessage({
          type: 'anzar-console',
          level: level,
          message: message,
          timestamp: Date.now(),
        }, '*');
      } catch(e) {}
    };
  });

  // Also capture unhandled errors
  window.addEventListener('error', function(e) {
    window.parent.postMessage({
      type: 'anzar-console',
      level: 'error',
      message: e.message + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : ''),
      timestamp: Date.now(),
    }, '*');
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', function(e) {
    window.parent.postMessage({
      type: 'anzar-console',
      level: 'error',
      message: 'Unhandled Promise: ' + (e.reason?.message || String(e.reason)),
      timestamp: Date.now(),
    }, '*');
  });
})();
`;

// ============================================================================
// ELEMENT INSPECTOR SCRIPT (injected into iframe)
// ============================================================================

export const ELEMENT_INSPECTOR_SCRIPT = `
(function() {
  if (window.__anzarInspector) { window.__anzarInspector.toggle(); return; }

  const overlay = document.createElement('div');
  overlay.id = '__anzar-inspector-overlay';
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:999999;border:2px solid #6366f1;background:rgba(99,102,241,0.08);transition:all 0.1s ease;display:none;';
  document.body.appendChild(overlay);

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;z-index:999999;background:#6366f1;color:white;font-size:11px;font-family:monospace;padding:2px 6px;border-radius:3px;pointer-events:none;display:none;';
  document.body.appendChild(label);

  let active = true;

  function onMove(e) {
    if (!active) return;
    const el = e.target;
    if (el === overlay || el === label) return;
    const rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    label.style.display = 'block';
    label.style.top = Math.max(0, rect.top - 22) + 'px';
    label.style.left = rect.left + 'px';
    label.textContent = el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ')[0] : '') + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height);
  }

  function onClick(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    const rect = el.getBoundingClientRect();
    const styles = window.getComputedStyle(el);
    window.parent.postMessage({
      type: 'anzar-inspect',
      tag: el.tagName.toLowerCase(),
      classes: el.className,
      id: el.id,
      dimensions: { width: Math.round(rect.width), height: Math.round(rect.height) },
      styles: {
        color: styles.color,
        background: styles.backgroundColor,
        fontSize: styles.fontSize,
        fontFamily: styles.fontFamily,
        padding: styles.padding,
        margin: styles.margin,
      },
      textContent: (el.textContent || '').slice(0, 100),
    }, '*');
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);

  window.__anzarInspector = {
    toggle: function() {
      active = !active;
      if (!active) {
        overlay.style.display = 'none';
        label.style.display = 'none';
      }
    },
    destroy: function() {
      active = false;
      overlay.remove();
      label.remove();
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      delete window.__anzarInspector;
    }
  };
})();
`;

// ============================================================================
// SERVICE
// ============================================================================

class BrowserToolsService {
  private consoleEntries: ConsoleEntry[] = [];
  private listeners: Array<(entries: ConsoleEntry[]) => void> = [];
  private messageHandler: ((e: MessageEvent) => void) | null = null;
  private maxEntries = 500;

  /**
   * Start listening for console messages from the preview iframe.
   */
  startListening(): void {
    if (this.messageHandler) return;

    this.messageHandler = (e: MessageEvent) => {
      if (e.data?.type === 'anzar-console') {
        const entry: ConsoleEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          level: e.data.level,
          message: e.data.message,
          timestamp: e.data.timestamp || Date.now(),
          source: 'preview',
        };
        this.consoleEntries.push(entry);
        if (this.consoleEntries.length > this.maxEntries) {
          this.consoleEntries = this.consoleEntries.slice(-this.maxEntries);
        }
        this.emit();
      }
    };

    window.addEventListener('message', this.messageHandler);
  }

  /**
   * Stop listening for console messages.
   */
  stopListening(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
  }

  /**
   * Inject the console capture script into the iframe.
   */
  injectConsoleCapture(iframe: HTMLIFrameElement): void {
    try {
      iframe.contentWindow?.postMessage({ type: 'anzar-exec', script: CONSOLE_CAPTURE_SCRIPT }, '*');
      // Also try direct injection (same-origin only)
      const doc = iframe.contentDocument;
      if (doc) {
        const script = doc.createElement('script');
        script.textContent = CONSOLE_CAPTURE_SCRIPT;
        doc.head?.appendChild(script);
      }
    } catch {
      // cross-origin, can't inject directly
    }
  }

  /**
   * Toggle element inspector in the iframe.
   */
  toggleInspector(iframe: HTMLIFrameElement): void {
    try {
      const doc = iframe.contentDocument;
      if (doc) {
        const script = doc.createElement('script');
        script.textContent = ELEMENT_INSPECTOR_SCRIPT;
        doc.head?.appendChild(script);
      }
    } catch {
      // cross-origin
    }
  }

  /**
   * Get all console entries.
   */
  getEntries(): ConsoleEntry[] {
    return [...this.consoleEntries];
  }

  /**
   * Get entries filtered by level.
   */
  getErrors(): ConsoleEntry[] {
    return this.consoleEntries.filter(e => e.level === 'error');
  }

  /**
   * Clear all console entries.
   */
  clear(): void {
    this.consoleEntries = [];
    this.emit();
  }

  /**
   * Subscribe to console updates.
   */
  subscribe(listener: (entries: ConsoleEntry[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit(): void {
    const entries = this.getEntries();
    for (const listener of this.listeners) {
      listener(entries);
    }
  }

  /**
   * Get a device preset by ID.
   */
  getPreset(id: string): DevicePreset | undefined {
    return DEVICE_PRESETS.find(p => p.id === id);
  }

  /**
   * Get presets by category.
   */
  getPresetsByCategory(category: 'phone' | 'tablet' | 'desktop'): DevicePreset[] {
    return DEVICE_PRESETS.filter(p => p.category === category);
  }
}

export const browserTools = new BrowserToolsService();
