/**
 * ConfirmModal — Modale de confirmation ANZAR
 *
 * Remplace tous les window.confirm() par une modale native au design system.
 * Usage: const { confirm, ConfirmDialog } = useConfirmModal();
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ──

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

// ── Hook ──

export function useConfirmModal() {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ ...options, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state?.resolve(true);
    setState(null);
  }, [state]);

  const handleCancel = useCallback(() => {
    state?.resolve(false);
    setState(null);
  }, [state]);

  const ConfirmDialog = state ? (
    <ConfirmModal
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      variant={state.variant}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return { confirm, ConfirmDialog };
}

// ── Component ──

interface ConfirmModalProps {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Focus trap + Escape key
  useEffect(() => {
    // Auto-focus the cancel or confirm button on mount
    confirmBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      // Trap Tab inside the dialog
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const variantStyles = {
    danger: {
      icon: 'text-accent-error bg-accent-error/10',
      button: 'bg-accent-error hover:bg-accent-error/90 text-white',
    },
    warning: {
      icon: 'text-accent-warning bg-accent-warning/10',
      button: 'bg-accent-warning hover:bg-accent-warning/90 text-white',
    },
    info: {
      icon: 'text-accent-primary bg-accent-primary/10',
      button: 'gradient-bg hover:opacity-90 text-white',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === overlayRef.current) onCancel(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className={cn(
          'bg-bg-primary border border-border-subtle rounded-2xl shadow-2xl',
          'w-full max-w-sm mx-4 p-5',
          'animate-in zoom-in-95 duration-200',
        )}
      >
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div className={cn('p-2 rounded-xl', styles.icon)}>
            <AlertTriangle size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 id="confirm-modal-title" className="text-sm font-semibold text-text-primary">
              {title || 'Confirmation'}
            </h3>
            <p className="text-xs text-text-secondary mt-1 leading-relaxed">
              {message}
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Fermer"
            className="p-1 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className={cn(
              'px-4 py-2 rounded-xl text-xs font-medium',
              'bg-surface-default border border-border-subtle',
              'text-text-secondary hover:text-text-primary hover:bg-surface-hover',
              'transition-all duration-150',
            )}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            onClick={onConfirm}
            className={cn(
              'px-4 py-2 rounded-xl text-xs font-medium',
              'transition-all duration-150',
              styles.button,
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
