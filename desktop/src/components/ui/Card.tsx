import { forwardRef, HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  glass?: boolean;
  hover?: boolean;
  border?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      glass = false,
      hover = false,
      border = true,
      padding = 'md',
      rounded = 'lg',
      children,
      ...props
    },
    ref
  ) => {
    const paddingStyles = {
      none: '',
      sm: 'p-3',
      md: 'p-6',
      lg: 'p-8',
    };

    const roundedStyles = {
      none: 'rounded-none',
      sm: 'rounded-sm',
      md: 'rounded-md',
      lg: 'rounded-lg',
      xl: 'rounded-xl',
      full: 'rounded-full',
    };

    const baseStyles = 'transition-all duration-micro';
    const glassStyles = glass ? 'backdrop-blur-lg bg-glass-bg border border-glass-border' : 'bg-bg-tertiary';
    const borderStyles = border ? 'border border-border-subtle' : '';
    const hoverStyles = hover ? 'hover:scale-[1.02] hover:shadow-elevation-3 hover:border-accent-primary/30' : '';

    return (
      <div
        ref={ref}
        className={cn(
          baseStyles,
          glassStyles,
          borderStyles,
          paddingStyles[padding],
          roundedStyles[rounded],
          hoverStyles,
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

export { Card };

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export function CardHeader({ className, title, description, action, children, ...props }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between mb-4', className)} {...props}>
      <div className="flex-1">
        {title && <h3 className="text-lg font-semibold text-text-primary">{title}</h3>}
        {description && <p className="text-sm text-text-secondary mt-1">{description}</p>}
        {children}
      </div>
      {action && <div className="ml-4">{action}</div>}
    </div>
  );
}

export interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  noPadding?: boolean;
}

export function CardContent({ className, noPadding = false, children, ...props }: CardContentProps) {
  return (
    <div className={cn(noPadding ? '' : 'pt-2', className)} {...props}>
      {children}
    </div>
  );
}

export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  align?: 'left' | 'center' | 'right';
}

export function CardFooter({ className, align = 'left', children, ...props }: CardFooterProps) {
  const alignStyles = {
    left: 'justify-start',
    center: 'justify-center',
    right: 'justify-end',
  };

  return (
    <div className={cn('flex items-center mt-6', alignStyles[align], className)} {...props}>
      {children}
    </div>
  );
}