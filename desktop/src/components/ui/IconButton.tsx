import { forwardRef, ButtonHTMLAttributes } from 'react';
import { LucideIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const iconButtonVariants = cva(
  'inline-flex items-center justify-center rounded-lg transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary disabled:opacity-50 disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        ghost: 'hover:bg-surface-highlighted text-text-secondary hover:text-text-primary active:bg-surface-highlighted/80',
        primary: 'bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 active:scale-95 focus-visible:ring-accent-primary',
        secondary: 'bg-accent-secondary/10 text-accent-secondary hover:bg-accent-secondary/20 active:scale-95 focus-visible:ring-accent-secondary',
        danger: 'bg-accent-error/10 text-accent-error hover:bg-accent-error/20 active:scale-95 focus-visible:ring-accent-error',
        minimal: 'text-text-secondary hover:text-text-primary hover:bg-surface-highlighted/50 active:bg-surface-highlighted',
      },
      size: {
        xs: 'h-6 w-6',
        sm: 'h-8 w-8',
        md: 'h-10 w-10',
        lg: 'h-12 w-12',
        xl: 'h-14 w-14',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md',
    },
  }
);

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  /**
   * Lucide icon component to display
   */
  icon: LucideIcon;
  /**
   * Icon size (width and height in pixels)
   */
  iconSize?: number;
  /**
   * Tooltip text
   */
  tooltip?: string;
  /**
   * Loading state
   */
  isLoading?: boolean;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      className,
      variant,
      size,
      icon: Icon,
      iconSize = 20,
      tooltip,
      isLoading = false,
      disabled,
      ...props
    },
    ref
  ) => {
    const ariaLabel = tooltip || props['aria-label'];

    return (
      <button
        ref={ref}
        className={cn(iconButtonVariants({ variant, size }), className)}
        disabled={disabled || isLoading}
        aria-label={ariaLabel}
        title={tooltip}
        {...props}
      >
        {isLoading ? (
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <Icon size={iconSize} />
        )}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';

export { IconButton, iconButtonVariants };
