import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { modalBodyScrollLock } from './modalBodyScrollLock';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ isOpen, onClose, title, children, footer, size = 'md' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleFocusTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    if (!isOpen) return undefined;
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('keydown', handleFocusTrap);
    const releaseBodyScrollLock = modalBodyScrollLock.acquire(document.body);
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => {
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      (firstFocusable ?? dialogRef.current)?.focus();
    }, 0);
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('keydown', handleFocusTrap);
      releaseBodyScrollLock();
      previousActiveElement?.focus();
    };
  }, [isOpen, onClose]);

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] overflow-y-auto">
          {/* Backdrop */}
          <motion.div
            ref={overlayRef}
            initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            animate={{ opacity: 1, backdropFilter: 'blur(8px)' }}
            exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            className="fixed inset-0 bg-black/40 dark:bg-black/70"
            onClick={(e) => {
              if (e.target === overlayRef.current) onClose();
            }}
          />

          {/* Modal Container */}
          <div className="min-h-full flex items-start justify-center p-2 sm:p-4 md:p-6 pt-8 sm:pt-12 md:pt-16">
            {/* Modal Content */}
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? titleId : undefined}
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className={`
                relative w-full ${sizes[size]} 
                bg-white/90 dark:bg-surface-900/90 backdrop-blur-xl 
                rounded-2xl sm:rounded-3xl shadow-2xl border border-white/50 dark:border-surface-700
                overflow-hidden flex flex-col max-h-[calc(100dvh-4rem)] sm:max-h-[calc(100dvh-6rem)] md:max-h-[calc(100dvh-8rem)] my-4
              `}
            >
            {title && (
              <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 md:px-8 md:py-6 border-b border-neutral-100/50 dark:border-white/10 shrink-0">
                <h2 id={titleId} className="text-base sm:text-lg md:text-xl font-display font-semibold text-neutral-900 dark:text-white tracking-wide truncate pr-4">
                  {title}
                </h2>
                <button
                  onClick={onClose}
                  aria-label="閉じる"
                  className="p-1.5 sm:p-2 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/5 rounded-full transition-colors duration-300 shrink-0"
                >
                  <X className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </div>
            )}
            
            {/* Content Area - Scrollable if needed */}
            <div className="p-4 sm:p-5 md:p-6 lg:p-8 overflow-y-auto flex-1 min-h-0">
              {children}
            </div>

            {/* Footer - Fixed at bottom */}
            {footer && (
              <div className="px-4 py-3 sm:px-6 sm:py-4 md:px-8 md:py-6 border-t border-neutral-100/50 dark:border-white/10 shrink-0 bg-white/90 dark:bg-surface-900/90">
                {footer}
              </div>
            )}

              {/* Decorative Glow */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary-500/10 rounded-full blur-[50px] pointer-events-none" />
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-accent-500/10 rounded-full blur-[50px] pointer-events-none" />
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}
