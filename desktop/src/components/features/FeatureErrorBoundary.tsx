/**
 * FeatureErrorBoundary — Isolates each autonomous feature from crashing the entire ChatView.
 *
 * Unlike the global ErrorBoundary (full-screen), this renders an inline error card
 * and offers to close the feature, returning the user to the main chat.
 */
import React from 'react';
import { AlertTriangle, ArrowLeft, RotateCcw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  featureName: string;
  onClose: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class FeatureErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[FeatureErrorBoundary:${this.props.featureName}]`, error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center bg-bg-primary p-6">
          <div className="max-w-sm w-full p-5 rounded-2xl border border-accent-error/20 bg-surface-default text-center">
            <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-accent-error/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-accent-error" />
            </div>
            <h3 className="text-sm font-semibold text-text-primary mb-1">
              {this.props.featureName} a rencontré une erreur
            </h3>
            <p className="text-xs text-text-muted mb-4">
              Cette fonctionnalité a crashé mais le reste de l'app fonctionne normalement.
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={this.props.onClose}
                className="px-3 py-1.5 text-xs rounded-lg border border-border-subtle text-text-secondary hover:bg-surface-hover transition-all flex items-center gap-1.5"
              >
                <ArrowLeft size={12} />
                Retour
              </button>
              <button
                onClick={this.handleRetry}
                className="px-3 py-1.5 text-xs rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-all flex items-center gap-1.5"
              >
                <RotateCcw size={12} />
                Réessayer
              </button>
            </div>
            {this.state.error && (
              <details className="mt-3 text-left">
                <summary className="text-[10px] text-text-muted cursor-pointer">Détails</summary>
                <pre className="mt-1 p-2 rounded-lg bg-bg-tertiary text-[10px] text-text-secondary overflow-auto max-h-[80px] font-mono">
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
