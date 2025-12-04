import { forwardRef, type InputHTMLAttributes, useState } from 'react';
import { motion } from 'framer-motion';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className = '', onFocus, onBlur, ...props }, ref) => {
    const [isFocused, setIsFocused] = useState(false);
    const [hasValue, setHasValue] = useState(!!props.value);

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      onFocus?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      setHasValue(!!e.target.value);
      onBlur?.(e);
    };

    return (
      <div className="w-full group">
        <div className="relative">
          {label && (
            <motion.label
              initial={false}
              animate={{
                y: isFocused || hasValue || props.value ? -24 : 12,
                scale: isFocused || hasValue || props.value ? 0.85 : 1,
                opacity: isFocused || hasValue || props.value ? 0.8 : 0.5,
                x: isFocused || hasValue || props.value ? 0 : 12,
              }}
              className={`
                absolute left-0 top-0 pointer-events-none origin-top-left
                font-medium text-neutral-700 dark:text-neutral-300 z-10
                ${error ? 'text-red-500' : ''}
              `}
            >
              {label}
            </motion.label>
          )}
          <input
            ref={ref}
            onFocus={handleFocus}
            onBlur={handleBlur}
            className={`
              input-field-glass pt-3 pb-3
              ${label ? 'mt-1' : ''}
              ${error
                ? 'border-red-300 focus:ring-red-500/30 focus:border-red-500'
                : 'group-hover:border-primary-300/50'
              }
              ${className}
            `}
            {...props}
          />
          {/* Animated Bottom Border */}
          <div className="absolute bottom-0 left-0 w-full h-[1px] bg-neutral-200/0 overflow-hidden rounded-b-xl pointer-events-none">
            <motion.div
              initial={{ width: "0%" }}
              animate={{ width: isFocused ? "100%" : "0%" }}
              className={`h-[2px] w-full mx-auto ${error ? 'bg-red-500' : 'bg-gradient-to-r from-primary-400 to-gold-DEFAULT'}`}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          </div>
        </div>
        
        {error && (
          <motion.p 
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1.5 text-sm text-red-600 font-medium flex items-center gap-1"
          >
            {error}
          </motion.p>
        )}
        {helperText && !error && (
          <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">{helperText}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
