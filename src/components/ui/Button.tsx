import { forwardRef, type ButtonHTMLAttributes, type ComponentProps } from 'react';
import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onDragStart' | 'onDragEnd' | 'onDrag' | 'ref'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

// Merge Framer Motion props with our custom props
type MotionButtonProps = ButtonProps & Omit<ComponentProps<typeof motion.button>, keyof ButtonProps>;

export const Button = forwardRef<HTMLButtonElement, MotionButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      children,
      className = '',
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles = `
      relative inline-flex items-center justify-center font-medium
      transition-colors duration-300 ease-out
      focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500/50
      disabled:opacity-50 disabled:cursor-not-allowed
      overflow-hidden
    `;

    const variants = {
      primary: 'btn-primary rounded-lg text-white shadow-lg shadow-primary-500/20',
      secondary: 'btn-secondary rounded-lg bg-white/50 dark:bg-white/5 backdrop-blur-sm',
      ghost: 'btn-ghost rounded-lg hover:bg-neutral-100/50 dark:hover:bg-white/10',
      danger: `
        bg-red-600 text-white rounded-lg
        hover:bg-red-700 active:bg-red-800
        shadow-soft hover:shadow-elegant
        focus:ring-red-500
      `,
    };

    const sizes = {
      sm: 'px-3 py-1.5 text-sm gap-1.5',
      md: 'px-5 py-2.5 text-sm gap-2',
      lg: 'px-8 py-3.5 text-base gap-2.5',
    };

    return (
      <motion.button
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        disabled={disabled || isLoading}
        whileHover={{ scale: disabled ? 1 : 1.02 }}
        whileTap={{ scale: disabled ? 1 : 0.97 }}
        initial={false}
        {...props}
      >
        {/* Loading Spinner with AnimatePresence-like fade */}
        {isLoading && (
          <span className="absolute inset-0 flex items-center justify-center bg-inherit rounded-lg">
            <Loader2 className="w-5 h-5 animate-spin" />
          </span>
        )}

        <span className={`flex items-center gap-2 ${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-200`}>
          {leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
          {children}
          {rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
        </span>
        
        {/* Shimmer effect for primary button */}
        {variant === 'primary' && !disabled && (
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-shimmer" />
        )}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';
