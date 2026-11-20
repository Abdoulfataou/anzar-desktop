import { forwardRef, InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error = false, leftIcon, rightIcon, ...props }, ref) => {
    return (
      <div className="relative">
        {leftIcon && (
          <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-foreground-secondary">
            {leftIcon}
          </div>
        )}
        <input
          type={type}
          className={cn(
            'flex h-10 w-full rounded-md border border-border bg-background-secondary px-3 py-2',
            'text-sm text-foreground-primary placeholder:text-foreground-muted',
            'focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'transition-all duration-150',
            {
              'pl-10': leftIcon,
              'pr-10': rightIcon,
              'border-accent-error focus:ring-accent-error': error,
              'hover:border-border-strong': !error && !props.disabled,
            },
            className
          )}
          ref={ref}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-foreground-secondary">
            {rightIcon}
          </div>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'

export { Input }