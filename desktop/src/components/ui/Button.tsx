import { forwardRef, ButtonHTMLAttributes } from 'react';
import { LucideIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary disabled:opacity-50 disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary:
          'bg-accent-primary text-white hover:bg-accent-primary/90 active:scale-[0.98] focus-visible:ring-accent-primary shadow-lg hover:shadow-xl',
        secondary:
          'bg-accent-secondary text-white hover:bg-accent-secondary/90 active:scale-[0.98] focus-visible:ring-accent-secondary shadow-lg hover:shadow-xl',
        ghost:
          'bg-transparent text-text-primary hover:bg-surface-highlighted active:bg-surface-highlighted/80 border border-border-medium hover:border-accent-primary/50',
        danger:
          'bg-accent-error text-white hover:bg-accent-error/90 active:scale-[0.98] focus-visible:ring-accent-error shadow-lg hover:shadow-xl',
        success:
          'bg-accent-success text-white hover:bg-accent-success/90 active:scale-[0.98] focus-visible:ring-accent-success shadow-lg hover:shadow-xl',
        warning:
          'bg-accent-warning text-white hover:bg-accent-warning/90 active:scale-[0.98] focus-visible:ring-accent-warning shadow-lg hover:shadow-xl',
        outline:
          'bg-transparent text-text-primary border border-border-medium hover:border-accent-primary hover:text-accent-primary active:bg-surface-highlighted',
        error:
          'bg-accent-error text-white hover:bg-accent-error/90 active:scale-[0.98] focus-visible:ring-accent-error shadow-lg hover:shadow-xl',
      },
      size: {
        xs: 'px-2 py-1 text-xs rounded-md',
        sm: 'px-3 py-1.5 text-sm rounded-md',
        md: 'px-4 py-2 text-sm rounded-lg',
        lg: 'px-6 py-3 text-base rounded-lg',
        xl: 'px-8 py-4 text-lg rounded-xl',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
      rounded: {
        true: 'rounded-full',
        false: '',
      },
      glass: {
        true: 'backdrop-blur-md bg-glass-bg border border-glass-border hover:bg-glass-bg/90 hover:border-accent-primary/30',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      fullWidth: false,
      rounded: false,
      glass: false,
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /**
   * Icon displayed before the button text
   */
  leftIcon?: LucideIcon;
  /**
   * Icon displayed after the button text
   */
  rightIcon?: LucideIcon;
  /**
   * Loading state (shows spinner, disables button)
   */
  isLoading?: boolean;
  /**
   * Alias for isLoading for backwards compatibility
   */
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      fullWidth,
      rounded,
      glass,
      isLoading = false,
      loading,
      leftIcon: LeftIcon,
      rightIcon: RightIcon,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const isButtonLoading = isLoading || loading;

    const iconSize = {
      xs: 'w-3 h-3',
      sm: 'w-3.5 h-3.5',
      md: 'w-4 h-4',
      lg: 'w-5 h-5',
      xl: 'w-6 h-6',
    }[size || 'md'];

    return (
      <button
        ref={ref}
        className={cn(
          buttonVariants({ variant, size, fullWidth, rounded, glass }),
          isButtonLoading && 'relative text-transparent hover:text-transparent',
          className
        )}
        disabled={disabled || isButtonLoading}
        {...props}
      >
        {isButtonLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {LeftIcon && <LeftIcon className={cn('mr-2', iconSize)} />}
        <span className={cn(isButtonLoading && 'invisible')}>{children}</span>
        {RightIcon && <RightIcon className={cn('ml-2', iconSize)} />}
      </button>
    );
  }
);

Button.displayName = 'Button';

export { Button, buttonVariants };