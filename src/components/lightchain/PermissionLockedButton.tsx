import type { ButtonHTMLAttributes } from 'react';

const lockedPermissionButton = 'inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-brand-primary px-5 py-2.5 text-base font-medium text-text-on-brand-black opacity-40 shadow-xs transition-all disabled:pointer-events-none disabled:bg-control-fill-disabled disabled:text-text-disabled disabled:cursor-not-allowed';

type PermissionLockedButtonProps = {
  testId: string;
  marginClass?: string;
  className?: string;
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'title'>;

/** Lightchain's plan-locked affordance, preserved as a visual parity surface. */
export function PermissionLockedButton({
  testId,
  marginClass = 'mt-3',
  className = '',
  title,
}: PermissionLockedButtonProps) {
  return (
    <button
      type="button"
      disabled
      aria-label="権限がありません"
      data-testid={testId}
      title={title}
      className={`${marginClass} ${lockedPermissionButton} ${className}`.trim()}
    >
      権限がありません
    </button>
  );
}
