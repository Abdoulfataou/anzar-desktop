/**
 * ANZAR - Point d'entrée principal
 * Assistant IA de Vibecoding pour l'Afrique
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import * as Sentry from '@sentry/react';
import App from './App';
import './index.css';

// ─────────────────────────────────────────────────────────────────────────────
// Sentry (crash reporting) — activé uniquement si VITE_SENTRY_DSN est défini
// ─────────────────────────────────────────────────────────────────────────────
try {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (dsn && dsn.trim()) {
    const tracesSampleRate = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? '0.1');
    Sentry.init({
      dsn,
      release: typeof __SENTRY_RELEASE__ === 'string' ? __SENTRY_RELEASE__ : `anzar-desktop@${__APP_VERSION__}`,
      environment: import.meta.env.MODE,
      tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.1,
      integrations: [Sentry.browserTracingIntegration()],
    });
  }
} catch (e) {
  // Sentry must never block the app.
  console.warn('Sentry init failed:', e);
}

// Error Boundary pour capturer et afficher les erreurs React
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ANZAR Error Boundary caught:', error, errorInfo);
    try {
      Sentry.captureException(error, {
        contexts: {
          react: { componentStack: errorInfo.componentStack },
        },
      });
    } catch {
      // ignore
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: '#0A0A0F',
          color: '#F8FAFC',
          fontFamily: 'Inter, system-ui, sans-serif',
          padding: '2rem',
          textAlign: 'center',
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #EF4444, #DC2626)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1.5rem',
            fontSize: '24px',
          }}>
            !
          </div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Erreur ANZAR
          </h1>
          <p style={{ color: '#94A3B8', fontSize: '0.875rem', maxWidth: '400px', marginBottom: '1rem' }}>
            Une erreur est survenue lors du chargement de l'application.
          </p>
          <pre style={{
            background: '#14141B',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '8px',
            padding: '1rem',
            fontSize: '0.75rem',
            color: '#EF4444',
            maxWidth: '600px',
            overflow: 'auto',
            textAlign: 'left',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1.5rem',
              padding: '0.5rem 1.5rem',
              borderRadius: '8px',
              background: '#6366F1',
              color: 'white',
              border: 'none',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Recharger
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Initialiser le thème depuis localStorage avant le rendu
// Le themeStore persiste sous la clé 'anzar-theme-store'
try {
  const savedThemeStore = localStorage.getItem('anzar-theme-store');
  const savedThemeDirect = localStorage.getItem('theme');
  if (savedThemeStore) {
    const parsed = JSON.parse(savedThemeStore);
    const theme = parsed.state?.theme;
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.className = theme;
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.className = prefersDark ? 'dark' : 'light';
    }
  } else if (savedThemeDirect === 'dark' || savedThemeDirect === 'light') {
    document.documentElement.className = savedThemeDirect;
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.className = prefersDark ? 'dark' : 'light';
  }
} catch (e) {
  console.error('Theme init error:', e);
  document.documentElement.className = 'dark';
}

// Monter React
const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <App />
          <Toaster
            position="bottom-right"
            toastOptions={{
              duration: 3000,
              style: {
                background: 'var(--color-surface-elevated)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: '10px',
                fontSize: '14px',
                fontFamily: 'Inter, system-ui, sans-serif',
              },
            }}
          />
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>
  );
} else {
  // Si #root n'existe pas, afficher une erreur visible
  document.body.innerHTML = '<div style="color:white;padding:2rem;font-family:sans-serif;">Erreur: Element #root introuvable</div>';
}
