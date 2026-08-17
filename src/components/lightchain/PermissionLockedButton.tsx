import type { ButtonHTMLAttributes } from 'react';

const lockedPermissionButton = 'w-full rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-neutral-500';

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
      aria-disabled="true"
      aria-label="権限がありません"
      data-testid={testId}
      title={title}
      className={`${marginClass} ${lockedPermissionButton} ${className}`.trim()}
    >
      権限がありません
    </button>
  );
}
