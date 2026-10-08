import { useId } from 'react';

interface LightchainLogoProps {
  className?: string;
}

export function LightchainLogo({ className = 'h-6 w-[124px] shrink-0 text-white' }: LightchainLogoProps) {
  // Keep the historical export name for persisted/imported compatibility; it renders the Heavy Chain logo.
  return <HeavyChainBrandLogo className={className} />;
}

/**
 * Heavy Chain mark: two interlocked chain links (teal and the current text colour). Each link has a small gap
 * where the other passes over it, so the links read as hooked together at any size.
 * Drawn in a 24×24 box; ids are per instance so several logos can share a page.
 */
export function HeavyChainMark({ size = 24, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <HeavyChainMarkPaths id={id} />
    </svg>
  );
}

function HeavyChainMarkPaths({ id }: { id: string }) {
  return (
    <>
      <defs>
        <clipPath id={`${id}-top`}><circle cx="12" cy="8.1" r="3.1" /></clipPath>
        <clipPath id={`${id}-bottom`}><circle cx="12" cy="15.9" r="3.1" /></clipPath>
        <mask id={`${id}-gap-light`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <rect x="1.8" y="7.4" width="12.4" height="9.2" rx="4.6" stroke="#000" strokeWidth="4.4" clipPath={`url(#${id}-top)`} />
        </mask>
        <mask id={`${id}-gap-teal`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <rect x="9.8" y="7.4" width="12.4" height="9.2" rx="4.6" stroke="#000" strokeWidth="4.4" clipPath={`url(#${id}-bottom)`} />
        </mask>
      </defs>
      <rect x="1.8" y="7.4" width="12.4" height="9.2" rx="4.6" stroke="#5FCFC4" strokeWidth="2.6" mask={`url(#${id}-gap-teal)`} />
      <rect x="9.8" y="7.4" width="12.4" height="9.2" rx="4.6" stroke="currentColor" strokeWidth="2.6" mask={`url(#${id}-gap-light)`} />
    </>
  );
}

/** Mark + "HEAVY CHAIN" wordmark in the same 124×24 footprint the header layout expects. */
export function HeavyChainBrandLogo({ className = 'h-6 w-[124px] shrink-0 text-white', height = 24, showText = true }: { className?: string; height?: number; showText?: boolean }) {
  const id = useId().replace(/:/g, '');
  const width = showText ? height * (124 / 24) : height;
  return (
    <svg width={width} height={height} viewBox={showText ? '0 0 124 24' : '0 0 24 24'} fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-label="Heavy Chain" role="img">
      <HeavyChainMarkPaths id={id} />
      {showText && (
        <text x="31" y="16.2" fill="currentColor" fontFamily="Inter, 'Helvetica Neue', Arial, sans-serif" fontSize="11" fontWeight="800" letterSpacing="1.4" textLength="92" lengthAdjust="spacingAndGlyphs">
          HEAVY CHAIN
        </text>
      )}
    </svg>
  );
}
