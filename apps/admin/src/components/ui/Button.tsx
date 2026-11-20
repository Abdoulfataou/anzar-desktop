import { forwardRef, ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'
import { Loader2 } from 'lucide-react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
  size?: 'sm' | 'md' | 'lg' | 'icon'
  isLoading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles = cn(
      'inline-flex items-center justify-center font-medium transition-all duration-150',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      'disabled:pointer-events-none disabled:opacity-50',
      'active:scale-98 hover:scale-102',
      'rounded-md'
    )

    const variantStyles = cn({
      // Primary - Electric cyan with neon glow
      'bg-accent-primary text-background-primary hover:bg-accent-primary-hover shadow-neon hover:shadow-neon':
        variant === 'primary',
      
      // Secondary - Glassmorphism with subtle border
      'bg-background-glass text-foreground-primary border border-border-subtle hover:border-border hover:bg-background-tertiary':
        variant === 'secondary',
      
      // Ghost - Minimal, transparent on hover
      'text-foreground-secondary hover:text-foreground-primary hover:bg-background-tertiary':
        variant === 'ghost',
      
      // Danger - Coral error with subtle glow
      'bg-accent-error text-background-primary hover:bg-accent-error/90 shadow-[0_0_10px_rgba(255,61,113,0.3)]':
        variant === 'danger',
      
      // Outline - Border only, transparent fill
      'border border-border text-foreground-primary hover:border-accent-primary hover:text-accent-primary':
        variant === 'outline',
    })

    const sizeStyles = cn({
      'h-8 px-3 text-xs': size === 'sm',
      'h-10 px-4 text-sm': size === 'md',
      'h-12 px-6 text-base': size === 'lg',
      'h-10 w-10': size === 'icon',
    })

    const loadingStyles = cn({
      'cursor-wait': isLoading,
    })

    return (
      <button
        ref={ref}
        className={cn(
          baseStyles,
          variantStyles,
          sizeStyles,
          loadingStyles,
          className
        )}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        )}
        {!isLoading && leftIcon && (
          <span className="mr-2">{leftIcon}</span>
        )}
        {children}
        {!isLoading && rightIcon && (
          <span className="ml-2">{rightIcon}</span>
        )}
      </button>
    )
  }
)

Button.displayName = 'Button'

export { Button }