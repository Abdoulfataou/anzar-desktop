import { forwardRef, HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'outline'
}

const Badge = forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const variantStyles = cn({
      // Default - Subtle glass
      'bg-background-glass text-foreground-secondary border border-border-subtle':
        variant === 'default',
      
      // Primary - Electric cyan
      'bg-accent-primary/10 text-accent-primary border border-accent-primary/20':
        variant === 'primary',
      
      // Secondary - Neon purple
      'bg-accent-secondary/10 text-accent-secondary border border-accent-secondary/20':
        variant === 'secondary',
      
      // Success - Matrix green
      'bg-accent-success/10 text-accent-success border border-accent-success/20':
        variant === 'success',
      
      // Warning - Amber alert
      'bg-accent-warning/10 text-accent-warning border border-accent-warning/20':
        variant === 'warning',
      
      // Error - Coral error
      'bg-accent-error/10 text-accent-error border border-accent-error/20':
        variant === 'error',
      
      // Outline - Border only
      'text-foreground-secondary border border-border':
        variant === 'outline',
    })

    return (
      <div
        ref={ref}
        className={cn(
          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
          'transition-colors duration-150',
          variantStyles,
          className
        )}
        {...props}
      />
    )
  }
)

Badge.displayName = 'Badge'

export { Badge }