import { create } from 'zustand';
import { useSettingsStore } from '@/stores/settingsStore';

type Theme = 'dark' | 'light' | 'system';

interface ThemeStore {
  theme: Theme;
  effectiveTheme: 'dark' | 'light';
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  initializeTheme: () => void;
}

const getSystemTheme = (): 'dark' | 'light' => {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const applyTheme = (theme: 'dark' | 'light') => {
  if (typeof document === 'undefined') return;

  const html = document.documentElement;

  // Remove both classes
  html.classList.remove('dark', 'light');

  // Add the appropriate class
  html.classList.add(theme);

  // Trigger transition
  html.style.colorScheme = theme;
};


let systemListenerInstalled = false;

/** Listener système installé une seule fois ; il n'agit qu'en mode « system ». */
function ensureSystemListener(): void {
  if (systemListenerInstalled || typeof window === 'undefined') return;
  systemListenerInstalled = true;
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', (e) => {
    if (useThemeStore.getState().theme !== 'system') return;
    const next = e.matches ? 'dark' : 'light';
    useThemeStore.setState({ effectiveTheme: next });
    applyTheme(next);
  });
}

export const useThemeStore = create<ThemeStore>()(
  (set, get) => ({
    theme: 'system',
    effectiveTheme: 'dark',

    initializeTheme: () => {
      // Source-of-truth: settingsStore (persisté). Le themeStore applique au DOM.
      const theme = useSettingsStore.getState().settings.theme || 'system';

      const effectiveTheme: 'dark' | 'light' =
        theme === 'system' ? getSystemTheme() : theme;

      set({ theme, effectiveTheme });
      applyTheme(effectiveTheme);
      ensureSystemListener();
    },

    toggleTheme: () => {
      const current = get().effectiveTheme;
      const next = current === 'dark' ? 'light' : 'dark';
      get().setTheme(next);
    },

    setTheme: (theme: Theme) => {
      const effectiveTheme: 'dark' | 'light' =
        theme === 'system' ? getSystemTheme() : theme;

      set({ theme, effectiveTheme });
      applyTheme(effectiveTheme);
      ensureSystemListener();

      // Sync to settings store so SettingsPage + persistence stay consistent.
      try {
        useSettingsStore.getState().updateSettings({ theme });
      } catch {
        // ignore
      }
    },
  })
);

// Initialize theme on load
if (typeof window !== 'undefined') {
  useThemeStore.getState().initializeTheme();
}
