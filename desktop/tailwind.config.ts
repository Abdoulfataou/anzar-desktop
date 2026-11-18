import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Couleur pilotée par une variable CSS, compatible avec les modificateurs
 * d'opacité de Tailwind (`bg-bg-tertiary/60`, `text-text-muted/50`…).
 * Sans ce relais, Tailwind ne génère aucune règle pour ces classes : elles
 * étaient silencieusement sans effet. color-mix fonctionne quel que soit le
 * format de la variable (hex ou rgba).
 */
const withAlpha = (variable: string) =>
  `color-mix(in srgb, var(${variable}) calc(<alpha-value> * 100%), transparent)`;

const config: Config = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'],
      },
      // Échelle typographique d'interface (base 14 px, réglable via --ui-font-size)
      fontSize: {
        'ui-xl': ['calc(var(--ui-font-size) + 4px)', { lineHeight: '1.4' }],
        'ui-lg': ['calc(var(--ui-font-size) + 2px)', { lineHeight: '1.45' }],
        'ui-base': ['var(--ui-font-size)', { lineHeight: '1.5' }],
        'ui-caption': ['calc(var(--ui-font-size) - 1px)', { lineHeight: '1.5' }],
        'ui-sm': ['calc(var(--ui-font-size) - 2px)', { lineHeight: '1.45' }],
        'ui-xs': ['calc(var(--ui-font-size) - 4px)', { lineHeight: '1.4' }],
      },
      colors: {
        window: withAlpha('--color-window'),
        'user-bubble': withAlpha('--color-user-bubble'),
        selected: withAlpha('--color-selected'),
        'hover-fill': withAlpha('--color-hover-fill'),
        link: withAlpha('--color-link'),
        tag: withAlpha('--color-tag'),
        'inline-code': withAlpha('--color-inline-code'),
        input: {
          DEFAULT: withAlpha('--color-input'),
          border: withAlpha('--color-input-border'),
          'border-hover': withAlpha('--color-input-border-hover'),
        },
        diff: {
          added: withAlpha('--color-diff-added'),
          removed: withAlpha('--color-diff-removed'),
        },
        bg: {
          primary: withAlpha('--color-bg-primary'),
          secondary: withAlpha('--color-bg-secondary'),
          tertiary: withAlpha('--color-bg-tertiary'),
        },
        surface: {
          default: withAlpha('--color-surface-default'),
          elevated: withAlpha('--color-surface-elevated'),
          hover: withAlpha('--color-surface-hover'),
        },
        accent: {
          primary: withAlpha('--color-accent-primary'),
          secondary: withAlpha('--color-accent-secondary'),
          tertiary: withAlpha('--color-accent-tertiary'),
          success: withAlpha('--color-accent-success'),
          warning: withAlpha('--color-accent-warning'),
          error: withAlpha('--color-accent-error'),
          info: withAlpha('--color-accent-info'),
        },
        text: {
          primary: withAlpha('--color-text-primary'),
          secondary: withAlpha('--color-text-secondary'),
          tertiary: withAlpha('--color-text-tertiary'),
          muted: withAlpha('--color-text-muted'),
        },
        border: {
          subtle: withAlpha('--color-border-subtle'),
          medium: withAlpha('--color-border-medium'),
          strong: withAlpha('--color-border-strong'),
        },
        // Tokens Blueprint : ambre réservé aux crédits, bouton principal inversé
        credit: {
          DEFAULT: withAlpha('--color-credit'),
          soft: withAlpha('--color-credit-soft'),
        },
        'primary-btn': {
          DEFAULT: withAlpha('--color-primary'),
          fg: withAlpha('--color-primary-fg'),
        },
      },
      borderRadius: {
        DEFAULT: '8px',
        sm: '6px',
        md: '10px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
      },
      borderWidth: {
        '3': '3px',
      },
      boxShadow: {
        'sm': '0 1px 3px var(--color-shadow)',
        'md': '0 4px 12px var(--color-shadow)',
        'lg': '0 12px 32px var(--color-shadow)',
        'glow': '0 0 20px -5px var(--glow-accent)',
        'composer': 'var(--shadow-composer)',
        'glow-lg': '0 0 40px -5px var(--glow-accent-strong)',
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'pulse-dot': 'pulseDot 1.4s infinite ease-in-out both',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        pulseDot: {
          '0%, 80%, 100%': { transform: 'scale(0)' },
          '40%': { transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [animate],
};

export default config;
