import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-bg-primary">
          <div className="max-w-md w-full mx-4 p-6 rounded-2xl border border-border-subtle bg-surface-default text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-accent-error/10 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-accent-error" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary mb-2">
              Quelque chose s'est mal passe
            </h2>
            <p className="text-sm text-text-secondary mb-6">
              Une erreur inattendue est survenue. Tu peux essayer de recharger la page.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 text-sm rounded-lg border border-border-subtle text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                Reessayer
              </button>
              <button
                onClick={this.handleReload}
                className="px-4 py-2 text-sm rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Recharger
              </button>
            </div>
            {this.state.error && (
              <details className="mt-4 text-left">
                <summary className="text-xs text-text-muted cursor-pointer">Details techniques</summary>
                <pre className="mt-2 p-3 rounded-lg bg-bg-tertiary text-xs text-text-secondary overflow-auto max-h-[120px] font-mono">
                  {this.state.error.message}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
