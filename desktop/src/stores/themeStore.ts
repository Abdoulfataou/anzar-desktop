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

      // Listen for system theme changes (only in system mode)
      if (theme === 'system') {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e: MediaQueryListEvent) => {
          const next = e.matches ? 'dark' : 'light';
          set({ effectiveTheme: next });
          applyTheme(next);
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
      }
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
