import { forwardRef, type InputHTMLAttributes, useState } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className = '', onFocus, onBlur, ...props }, ref) => {
    const [isFocused, setIsFocused] = useState(false);

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      onFocus?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      onBlur?.(e);
    };

    return (
      <div className="w-full group">
        {/* Static label above input */}
        {label && (
          <label className={`
            block text-sm font-medium mb-1.5
            ${error ? 'text-red-500' : 'text-neutral-700 dark:text-neutral-300'}
          `}>
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            onFocus={handleFocus}
            onBlur={handleBlur}
            className={`
              input-field-glass py-3
              ${error
                ? 'border-red-300 focus:ring-red-500/30 focus:border-red-500'
                : 'group-hover:border-primary-300/50'
              }
              ${className}
            `}
            {...props}
          />
          {/* Bottom Border Indicator */}
          <div className={`
            absolute bottom-0 left-0 h-[2px] rounded-b-xl pointer-events-none
            transition-all duration-300 ease-out
            ${isFocused ? 'w-full' : 'w-0'}
            ${error ? 'bg-red-500' : 'bg-gradient-to-r from-primary-400 to-gold-DEFAULT'}
          `} />
        </div>
        
        {error && (
          <p className="mt-1.5 text-sm text-red-600 font-medium flex items-center gap-1 animate-in fade-in slide-in-from-top-1 duration-200">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">{helperText}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
