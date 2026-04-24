import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  persist(
    (set, get) => ({
      theme: 'system',
      effectiveTheme: 'dark',

      initializeTheme: () => {
        const stored = localStorage.getItem('theme') as Theme | null;
        const theme = stored || 'system';

        let effectiveTheme: 'dark' | 'light';

        if (theme === 'system') {
          effectiveTheme = getSystemTheme();
        } else {
          effectiveTheme = theme;
        }

        set({
          theme,
          effectiveTheme,
        });

        applyTheme(effectiveTheme);

        // Listen for system theme changes
        if (theme === 'system') {
          const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
          const handleChange = (e: MediaQueryListEvent) => {
            const newTheme = e.matches ? 'dark' : 'light';
            set({ effectiveTheme: newTheme });
            applyTheme(newTheme);
          };

          mediaQuery.addEventListener('change', handleChange);

          return () => mediaQuery.removeEventListener('change', handleChange);
        }
      },

      toggleTheme: () => {
        const current = get().effectiveTheme;
        const newTheme = current === 'dark' ? 'light' : 'dark';
        get().setTheme(newTheme);
      },

      setTheme: (theme: Theme) => {
        let effectiveTheme: 'dark' | 'light';

        if (theme === 'system') {
          effectiveTheme = getSystemTheme();
        } else {
          effectiveTheme = theme;
        }

        set({
          theme,
          effectiveTheme,
        });

        applyTheme(effectiveTheme);
        localStorage.setItem('theme', theme);
      },
    }),
    {
      name: 'anzar-theme-store',
      partialize: (state) => ({ theme: state.theme }),
    }
  )
);

// Initialize theme on load
if (typeof window !== 'undefined') {
  useThemeStore.getState().initializeTheme();
}
