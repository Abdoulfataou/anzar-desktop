import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { IconButton } from './IconButton';
import { Tooltip } from './Tooltip';

export interface ThemeToggleProps {
  /**
   * Size of the toggle button
   */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Show tooltip
   */
  showTooltip?: boolean;
  /**
   * Custom className
   */
  className?: string;
}

/**
 * Beautiful theme toggle button with smooth animation.
 * Shows sun icon for light theme, moon icon for dark theme.
 * Supports system theme preference.
 */
export function ThemeToggle({
  size = 'md',
  showTooltip = true,
  className,
}: ThemeToggleProps) {
  const { effectiveTheme, toggleTheme } = useThemeStore();
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className={`h-10 w-10 animate-pulse rounded-lg bg-surface-highlighted ${className}`} />
    );
  }

  const isDark = effectiveTheme === 'dark';
  const icon = isDark ? Sun : Moon;
  const tooltip = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  const button = (
    <IconButton
      icon={icon}
      onClick={toggleTheme}
      variant="minimal"
      size={size}
      className={`transition-transform duration-300 ${
        isDark ? 'rotate-0' : 'rotate-180'
      } ${className}`}
      aria-label={tooltip}
    />
  );

  return showTooltip ? (
    <Tooltip content={tooltip} position="bottom">
      {button}
    </Tooltip>
  ) : (
    button
  );
}
