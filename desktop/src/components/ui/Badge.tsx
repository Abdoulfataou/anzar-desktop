/**
 * Badge component for status indicators and labels.
 * Cyber-minimal design with glassmorphism and neon accents.
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-bg-primary',
  {
    variants: {
      variant: {
        default:
          'border-border-subtle bg-bg-tertiary text-text-primary hover:bg-bg-secondary hover:border-border-subtle/50',
        primary:
          'border-accent-primary/30 bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 hover:border-accent-primary/50 hover:shadow-glow-primary',
        secondary:
          'border-accent-secondary/30 bg-accent-secondary/10 text-accent-secondary hover:bg-accent-secondary/20 hover:border-accent-secondary/50 hover:shadow-glow-secondary',
        success:
          'border-accent-success/30 bg-accent-success/10 text-accent-success hover:bg-accent-success/20 hover:border-accent-success/50',
        warning:
          'border-accent-warning/30 bg-accent-warning/10 text-accent-warning hover:bg-accent-warning/20 hover:border-accent-warning/50',
        error:
          'border-accent-error/30 bg-accent-error/10 text-accent-error hover:bg-accent-error/20 hover:border-accent-error/50 hover:shadow-[0_0_12px rgba(239,68,68,0.4)]',
        ghost:
          'border-border-subtle/20 bg-glass-bg text-text-secondary hover:text-text-primary hover:bg-glass-bg/80 hover:border-glass-border',
        outline:
          'border-border-subtle text-text-primary bg-transparent hover:bg-bg-tertiary',
      },
      size: {
        sm: 'px-2 py-0.5 text-xs',
        md: 'px-2.5 py-0.5 text-xs',
        lg: 'px-3 py-1 text-sm',
      },
      glass: {
        true: 'backdrop-blur-sm border-glass-border bg-glass-bg',
        false: '',
      },
      pulse: {
        true: 'animate-pulse',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
      glass: false,
      pulse: false,
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /**
   * Icon to display before the badge label
   */
  icon?: React.ReactNode;
  /**
   * Whether the badge is clickable
   */
  interactive?: boolean;
  /**
   * Whether to show a close button
   */
  dismissible?: boolean;
  /**
   * Callback when close button is clicked
   */
  onDismiss?: () => void;
}

/**
 * Badge component for status indicators, labels, and tags.
 * Supports multiple variants, sizes, glassmorphism, and interactive states.
 */
const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  (
    {
      className,
      variant,
      size,
      glass,
      pulse,
      icon,
      interactive = false,
      dismissible = false,
      onDismiss,
      children,
      ...props
    },
    ref
  ) => {
    const [dismissed, setDismissed] = React.useState(false);

    const handleDismiss = (e: React.MouseEvent) => {
      e.stopPropagation();
      setDismissed(true);
      onDismiss?.();
    };

    if (dismissed) {
      return null;
    }

    return (
      <div
        ref={ref}
        className={cn(
          badgeVariants({ variant, size, glass, pulse }),
          interactive && 'cursor-pointer hover:scale-105 active:scale-95',
          className
        )}
        role={interactive ? 'button' : 'status'}
        tabIndex={interactive ? 0 : undefined}
        {...props}
      >
        {icon && <span className="mr-1.5 flex h-3 w-3 items-center justify-center">{icon}</span>}
        {children}
        {dismissible && (
          <button
            type="button"
            onClick={handleDismiss}
            className="ml-1.5 h-3 w-3 rounded-full bg-transparent p-0 text-current hover:bg-current/20 focus:outline-none focus:ring-1 focus:ring-current"
            aria-label="Dismiss badge"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-2.5 w-2.5"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  }
);
Badge.displayName = 'Badge';

export { Badge, badgeVariants };