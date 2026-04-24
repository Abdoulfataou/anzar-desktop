import React, { forwardRef, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  leftIcon?: LucideIcon | ReactNode;
  rightIcon?: LucideIcon | ReactNode;
  icon?: LucideIcon | ReactNode;
  floatingLabel?: boolean;
  floating?: boolean; // alias for floatingLabel
  fullWidth?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      label,
      error,
      leftIcon: LeftIcon,
      rightIcon: RightIcon,
      icon,
      floatingLabel = false,
      floating,
      fullWidth = false,
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
    const hasError = !!error;
    const useFloatingLabel = floatingLabel || floating;
    
    // If icon prop is provided, treat it as leftIcon
    const effectiveLeftIcon = LeftIcon || icon;

    const baseStyles = 'bg-bg-secondary text-text-primary placeholder:text-text-secondary border border-border-subtle rounded-lg transition-all duration-micro focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed';
    const errorStyles = hasError ? 'border-accent-error focus:ring-accent-error' : '';
    const iconLeftStyles = effectiveLeftIcon ? 'pl-10' : '';
    const iconRightStyles = RightIcon ? 'pr-10' : '';
    const widthStyles = fullWidth ? 'w-full' : '';

    if (useFloatingLabel) {
      return (
        <div className={cn('input-floating', fullWidth && 'w-full', className)}>
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'input-floating-input',
              baseStyles,
              errorStyles,
              iconLeftStyles,
              iconRightStyles,
              widthStyles,
              'px-4 py-3 w-full'
            )}
            placeholder=" "
            {...props}
          />
          {label && (
            <label htmlFor={inputId} className="input-floating-label">
              {label}
            </label>
          )}
          {effectiveLeftIcon && (
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-text-secondary pointer-events-none">
              {React.isValidElement(effectiveLeftIcon) ? 
                effectiveLeftIcon : 
                (typeof effectiveLeftIcon === 'function' ? 
                  React.createElement(effectiveLeftIcon as any, { className: "w-5 h-5" }) : 
                  effectiveLeftIcon)}
            </div>
          )}
          {RightIcon && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-text-secondary pointer-events-none">
              {React.isValidElement(RightIcon) ? 
                RightIcon : 
                (typeof RightIcon === 'function' ? 
                  React.createElement(RightIcon as any, { className: "w-5 h-5" }) : 
                  RightIcon)}
            </div>
          )}
          {hasError && <p className="mt-1 text-xs text-accent-error">{error}</p>}
        </div>
      );
    }

    return (
      <div className={cn(fullWidth && 'w-full', className)}>
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-text-secondary mb-2">
            {label}
          </label>
        )}
        <div className="relative">
          {effectiveLeftIcon && (
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-text-secondary pointer-events-none">
              {React.isValidElement(effectiveLeftIcon) ? 
                effectiveLeftIcon : 
                (typeof effectiveLeftIcon === 'function' ? 
                  React.createElement(effectiveLeftIcon as any, { className: "w-5 h-5" }) : 
                  effectiveLeftIcon)}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              baseStyles,
              errorStyles,
              iconLeftStyles,
              iconRightStyles,
              widthStyles,
              'px-4 py-3',
              !label && effectiveLeftIcon && 'pl-10',
              !label && RightIcon && 'pr-10'
            )}
            {...props}
          />
          {RightIcon && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-text-secondary pointer-events-none">
              {React.isValidElement(RightIcon) ? 
                RightIcon : 
                (typeof RightIcon === 'function' ? 
                  React.createElement(RightIcon as any, { className: "w-5 h-5" }) : 
                  RightIcon)}
            </div>
          )}
        </div>
        {hasError && <p className="mt-1 text-xs text-accent-error">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input };

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  floatingLabel?: boolean;
  fullWidth?: boolean;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      label,
      error,
      floatingLabel = false,
      fullWidth = false,
      resize = 'vertical',
      id,
      ...props
    },
    ref
  ) => {
    const textareaId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`;
    const hasError = !!error;

    const baseStyles = 'bg-bg-secondary text-text-primary placeholder:text-text-secondary border border-border-subtle rounded-lg transition-all duration-micro focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed';
    const errorStyles = hasError ? 'border-accent-error focus:ring-accent-error' : '';
    const widthStyles = fullWidth ? 'w-full' : '';
    const resizeStyles = {
      none: 'resize-none',
      vertical: 'resize-y',
      horizontal: 'resize-x',
      both: 'resize',
    };

    if (floatingLabel) {
      return (
        <div className={cn('input-floating', fullWidth && 'w-full', className)}>
          <textarea
            ref={ref}
            id={textareaId}
            className={cn(
              'input-floating-input',
              baseStyles,
              errorStyles,
              resizeStyles[resize],
              widthStyles,
              'px-4 py-3 w-full min-h-[100px]'
            )}
            placeholder=" "
            {...props}
          />
          {label && (
            <label htmlFor={textareaId} className="input-floating-label">
              {label}
            </label>
          )}
          {hasError && <p className="mt-1 text-xs text-accent-error">{error}</p>}
        </div>
      );
    }

    return (
      <div className={cn(fullWidth && 'w-full', className)}>
        {label && (
          <label htmlFor={textareaId} className="block text-sm font-medium text-text-secondary mb-2">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(
            baseStyles,
            errorStyles,
            resizeStyles[resize],
            widthStyles,
            'px-4 py-3',
            !label && 'mt-0'
          )}
          {...props}
        />
        {hasError && <p className="mt-1 text-xs text-accent-error">{error}</p>}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  floatingLabel?: boolean;
  fullWidth?: boolean;
  options: Array<{ value: string; label: string }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      label,
      error,
      floatingLabel = false,
      fullWidth = false,
      options,
      id,
      ...props
    },
    ref
  ) => {
    const selectId = id || `select-${Math.random().toString(36).substr(2, 9)}`;
    const hasError = !!error;

    const baseStyles = 'bg-bg-secondary text-text-primary border border-border-subtle rounded-lg transition-all duration-micro focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed appearance-none';
    const errorStyles = hasError ? 'border-accent-error focus:ring-accent-error' : '';
    const widthStyles = fullWidth ? 'w-full' : '';

    if (floatingLabel) {
      return (
        <div className={cn('input-floating', fullWidth && 'w-full', className)}>
          <select
            ref={ref}
            id={selectId}
            className={cn(
              'input-floating-input',
              baseStyles,
              errorStyles,
              widthStyles,
              'px-4 py-3 w-full'
            )}
            {...props}
          >
            <option value="" disabled hidden></option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {label && (
            <label htmlFor={selectId} className="input-floating-label">
              {label}
            </label>
          )}
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
            <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          {hasError && <p className="mt-1 text-xs text-accent-error">{error}</p>}
        </div>
      );
    }

    return (
      <div className={cn(fullWidth && 'w-full', className)}>
        {label && (
          <label htmlFor={selectId} className="block text-sm font-medium text-text-secondary mb-2">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={cn(
              baseStyles,
              errorStyles,
              widthStyles,
              'px-4 py-3 pr-10',
              !label && 'mt-0'
            )}
            {...props}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
            <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
        {hasError && <p className="mt-1 text-xs text-accent-error">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';