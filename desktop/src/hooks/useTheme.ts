/**
 * useTheme Hook
 * Custom React hook for theme management
 * Provides theme state and toggle functionality
 */

import { useCallback } from 'react';
import { useThemeStore } from '@/stores/themeStore';
import { Theme } from '@/types';

/**
 * Return type for useTheme hook
 */
export interface UseThemeReturn {
  /** Current theme setting ('dark' | 'light' | 'system') */
  theme: Theme;

  /** Effective theme being applied ('dark' | 'light') */
  effectiveTheme: 'dark' | 'light';

  /** Set a specific theme */
  setTheme: (theme: Theme) => void;

  /** Toggle between dark and light mode */
  toggleTheme: () => void;

  /** Check if current theme is dark */
  isDark: boolean;

  /** Check if current theme is light */
  isLight: boolean;
}

/**
 * useTheme Hook
 * Access and manipulate the application theme
 *
 * @example
 * ```typescript
 * const { theme, toggleTheme, isDark } = useTheme();
 *
 * return (
 *   <button onClick={toggleTheme}>
 *     {isDark ? '☀️ Light' : '🌙 Dark'}
 *   </button>
 * );
 * ```
 */
export function useTheme(): UseThemeReturn {
  const theme = useThemeStore((state) => state.theme);
  const effectiveTheme = useThemeStore((state) => state.effectiveTheme);
  const setThemeAction = useThemeStore((state) => state.setTheme);
  const toggleThemeAction = useThemeStore((state) => state.toggleTheme);

  /**
   * Set the theme
   */
  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeAction(newTheme);
    },
    [setThemeAction]
  );

  /**
   * Toggle between dark and light
   */
  const toggleTheme = useCallback(() => {
    toggleThemeAction();
  }, [toggleThemeAction]);

  return {
    theme,
    effectiveTheme,
    setTheme,
    toggleTheme,
    isDark: effectiveTheme === 'dark',
    isLight: effectiveTheme === 'light',
  };
}
