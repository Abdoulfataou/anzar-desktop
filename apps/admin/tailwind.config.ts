import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        // Design System Cyber Minimal
        border: {
          subtle: 'rgba(255,255,255,0.08)',
          DEFAULT: 'rgba(255,255,255,0.12)',
          strong: 'rgba(255,255,255,0.16)',
        },
        // Legacy naming used throughout the Admin UI
        background: {
          primary: '#0A0A0F',
          secondary: '#14141B',
          tertiary: '#1E1E2E',
          glass: 'rgba(20,20,30,0.7)',
        },
        foreground: {
          primary: '#FFFFFF',
          secondary: '#94A3B8',
          muted: '#64748B',
        },

        // Shorthand aliases (optional)
        bg: {
          primary: '#0A0A0F',
          secondary: '#14141B',
          tertiary: '#1E1E2E',
          glass: 'rgba(20,20,30,0.7)',
        },
        text: {
          primary: '#FFFFFF',
          secondary: '#94A3B8',
          muted: '#64748B',
        },
        accent: {
          primary: '#00D9FF',
          'primary-hover': '#00B8D9',
          secondary: '#B829DD',
          'secondary-hover': '#9B22B8',
          success: '#00C853',
          warning: '#FFAB00',
          error: '#FF3D71',
        },
        ring: {
          DEFAULT: '#00D9FF',
          success: '#00C853',
          warning: '#FFAB00',
          error: '#FF3D71',
        },
      },
      fontFamily: {
        sans: ['Sora', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      fontSize: {
        xs: ['12px', { lineHeight: '16px', letterSpacing: '0.01em' }],
        sm: ['14px', { lineHeight: '20px', letterSpacing: '0.01em' }],
        base: ['16px', { lineHeight: '24px', letterSpacing: '0' }],
        lg: ['18px', { lineHeight: '28px', letterSpacing: '0' }],
        xl: ['20px', { lineHeight: '28px', letterSpacing: '-0.01em' }],
        '2xl': ['24px', { lineHeight: '32px', letterSpacing: '-0.01em' }],
        '3xl': ['30px', { lineHeight: '36px', letterSpacing: '-0.02em' }],
        '4xl': ['36px', { lineHeight: '40px', letterSpacing: '-0.02em' }],
        '5xl': ['48px', { lineHeight: '48px', letterSpacing: '-0.03em' }],
      },
      borderRadius: {
        lg: '12px',
        md: '8px',
        sm: '4px',
        full: '9999px',
      },
      backdropBlur: {
        xs: '2px',
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '24px',
      },
      boxShadow: {
        'glass': '0 8px 32px rgba(0, 0, 0, 0.36)',
        'neon': '0 0 20px rgba(0, 217, 255, 0.3)',
        'neon-secondary': '0 0 20px rgba(184, 41, 221, 0.3)',
        'elevation-1': '0 1px 2px rgba(0, 0, 0, 0.24)',
        'elevation-2': '0 4px 12px rgba(0, 0, 0, 0.32)',
        'elevation-3': '0 12px 32px rgba(0, 0, 0, 0.40)',
      },
      animation: {
        'fade-in': 'fadeIn 150ms cubic-bezier(0.4, 0, 0.2, 1)',
        'fade-out': 'fadeOut 150ms cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-in-from-bottom': 'slideInFromBottom 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-out-to-bottom': 'slideOutToBottom 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-in-from-top': 'slideInFromTop 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-out-to-top': 'slideOutToTop 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        'pulse-subtle': 'pulseSubtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideInFromBottom: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideOutToBottom: {
          '0%': { transform: 'translateY(0)', opacity: '1' },
          '100%': { transform: 'translateY(8px)', opacity: '0' },
        },
        slideInFromTop: {
          '0%': { transform: 'translateY(-8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideOutToTop: {
          '0%': { transform: 'translateY(0)', opacity: '1' },
          '100%': { transform: 'translateY(-8px)', opacity: '0' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        glow: {
          '0%': { boxShadow: '0 0 10px rgba(0, 217, 255, 0.3)' },
          '100%': { boxShadow: '0 0 20px rgba(0, 217, 255, 0.6)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'bounce': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      },
    },
  },
  plugins: [],
}

export default config
