import type { ReactNode } from 'react';

interface SkipLinkProps {
  href?: string;
  children?: ReactNode;
}

export function SkipLink({ href = '#main-content', children = 'メインコンテンツへスキップ' }: SkipLinkProps) {
  return (
    <a
      href={href}
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary-600 focus:text-white focus:rounded-lg focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
    >
      {children}
    </a>
  );
}

// Utility for adding accessible focus styles
export const focusRingStyles = 
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-surface-900';

// Screen reader only text
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

// Announce content to screen readers
export function LiveRegion({ 
  children, 
  politeness = 'polite' 
}: { 
  children: ReactNode; 
  politeness?: 'polite' | 'assertive' 
}) {
  return (
    <div
      role="status"
      aria-live={politeness}
      aria-atomic="true"
      className="sr-only"
    >
      {children}
    </div>
  );
}
