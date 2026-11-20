import { forwardRef, HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  src?: string
  alt?: string
  fallback?: string
  variant?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error'
}

const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, size = 'md', src, alt, fallback, variant = 'default', ...props }, ref) => {
    const sizeStyles = cn({
      'h-8 w-8 text-xs': size === 'sm',
      'h-10 w-10 text-sm': size === 'md',
      'h-12 w-12 text-base': size === 'lg',
      'h-16 w-16 text-lg': size === 'xl',
    })

    const variantStyles = cn({
      'bg-background-tertiary text-foreground-primary': variant === 'default',
      'bg-accent-primary/10 text-accent-primary': variant === 'primary',
      'bg-accent-secondary/10 text-accent-secondary': variant === 'secondary',
      'bg-accent-success/10 text-accent-success': variant === 'success',
      'bg-accent-warning/10 text-accent-warning': variant === 'warning',
      'bg-accent-error/10 text-accent-error': variant === 'error',
    })

    const getInitials = (name: string) => {
      return name
        .split(' ')
        .map(part => part[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    }

    return (
      <div
        ref={ref}
        className={cn(
          'relative inline-flex items-center justify-center rounded-full',
          'border border-border-subtle overflow-hidden',
          'transition-all duration-200 hover:scale-105',
          sizeStyles,
          variantStyles,
          className
        )}
        {...props}
      >
        {src ? (
          <img
            src={src}
            alt={alt || 'Avatar'}
            className="h-full w-full object-cover"
          />
        ) : fallback ? (
          <span className="font-medium">{getInitials(fallback)}</span>
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-accent-primary to-accent-secondary opacity-50" />
        )}
        
        {/* Subtle glow effect */}
        <div className="absolute inset-0 rounded-full border border-transparent hover:border-accent-primary/20 transition-colors duration-200" />
      </div>
    )
  }
)

Avatar.displayName = 'Avatar'

export { Avatar }