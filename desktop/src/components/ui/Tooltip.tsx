import { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface TooltipProps {
  /**
   * Content to show in the tooltip
   */
  content: ReactNode;
  /**
   * Element that triggers the tooltip
   */
  children: ReactNode;
  /**
   * Position of the tooltip
   */
  position?: 'top' | 'right' | 'bottom' | 'left';
  /**
   * Delay before showing tooltip (ms)
   */
  delayMs?: number;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * Simple CSS-based tooltip component using data attributes and pseudo-elements.
 * Minimal implementation - no complex positioning, uses natural DOM placement.
 */
export function Tooltip({
  content,
  children,
  position = 'top',
  delayMs = 200,
  className,
}: TooltipProps) {
  const positionClasses = {
    top: 'bottom-full mb-2 left-1/2 -translate-x-1/2 after:bottom-[-4px] after:left-1/2 after:-translate-x-1/2 after:border-8 after:border-t-bg-tertiary',
    bottom: 'top-full mt-2 left-1/2 -translate-x-1/2 after:top-[-4px] after:left-1/2 after:-translate-x-1/2 after:border-8 after:border-b-bg-tertiary',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2 after:right-[-4px] after:top-1/2 after:-translate-y-1/2 after:border-8 after:border-l-bg-tertiary',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2 after:left-[-4px] after:top-1/2 after:-translate-y-1/2 after:border-8 after:border-r-bg-tertiary',
  };

  return (
    <div
      className="group relative inline-block"
      style={{ '--tooltip-delay': `${delayMs}ms` } as React.CSSProperties}
    >
      {children}

      {/* Tooltip content */}
      <div
        className={cn(
          'pointer-events-none absolute z-50 whitespace-nowrap rounded-lg bg-bg-tertiary px-3 py-1.5 text-xs font-medium text-text-primary opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100',
          'after:absolute after:border-transparent after:content-[""]',
          positionClasses[position],
          className
        )}
      >
        {content}
      </div>
    </div>
  );
}

/**
 * Enhanced tooltip wrapper for elements that need title/aria-label support
 */
export function TooltipWithLabel({
  content,
  children,
  className,
  ...props
}: TooltipProps & { 'aria-label'?: string }) {
  return (
    <Tooltip content={content} {...props} className={className}>
      <div aria-label={typeof content === 'string' ? content : undefined}>
        {children}
      </div>
    </Tooltip>
  );
}
