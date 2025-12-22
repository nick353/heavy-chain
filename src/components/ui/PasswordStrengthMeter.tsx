import { useMemo } from 'react';
import { Check, X } from 'lucide-react';
import clsx from 'clsx';

interface PasswordStrengthMeterProps {
  password: string;
  className?: string;
}

interface PasswordRequirement {
  label: string;
  test: (password: string) => boolean;
}

const requirements: PasswordRequirement[] = [
  { label: '8文字以上', test: (p) => p.length >= 8 },
  { label: '大文字を含む', test: (p) => /[A-Z]/.test(p) },
  { label: '小文字を含む', test: (p) => /[a-z]/.test(p) },
  { label: '数字を含む', test: (p) => /[0-9]/.test(p) },
  { label: '記号を含む(!@#$%など)', test: (p) => /[!@#$%^&*(),.?":{}|<>]/.test(p) },
];

export function PasswordStrengthMeter({ password, className }: PasswordStrengthMeterProps) {
  const analysis = useMemo(() => {
    const passed = requirements.filter((r) => r.test(password));
    const strength = passed.length / requirements.length;
    
    let level: 'weak' | 'fair' | 'good' | 'strong' = 'weak';
    let label = '弱い';
    let color = 'bg-red-500';
    
    if (strength >= 0.8) {
      level = 'strong';
      label = '強い';
      color = 'bg-green-500';
    } else if (strength >= 0.6) {
      level = 'good';
      label = '良い';
      color = 'bg-blue-500';
    } else if (strength >= 0.4) {
      level = 'fair';
      label = '普通';
      color = 'bg-yellow-500';
    }

    return { passed, strength, level, label, color };
  }, [password]);

  if (!password) return null;

  return (
    <div className={clsx('space-y-3', className)}>
      {/* Strength bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            パスワード強度
          </span>
          <span
            className={clsx(
              'text-xs font-medium',
              analysis.level === 'strong' && 'text-green-600 dark:text-green-400',
              analysis.level === 'good' && 'text-blue-600 dark:text-blue-400',
              analysis.level === 'fair' && 'text-yellow-600 dark:text-yellow-400',
              analysis.level === 'weak' && 'text-red-600 dark:text-red-400'
            )}
          >
            {analysis.label}
          </span>
        </div>
        <div className="h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
          <div
            className={clsx('h-full transition-all duration-300 rounded-full', analysis.color)}
            style={{ width: `${analysis.strength * 100}%` }}
          />
        </div>
      </div>

      {/* Requirements checklist */}
      <div className="grid grid-cols-2 gap-1.5">
        {requirements.map((req, i) => {
          const passed = req.test(password);
          return (
            <div
              key={i}
              className={clsx(
                'flex items-center gap-1.5 text-xs transition-colors',
                passed
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-neutral-400 dark:text-neutral-500'
              )}
            >
              {passed ? (
                <Check className="w-3 h-3 flex-shrink-0" />
              ) : (
                <X className="w-3 h-3 flex-shrink-0" />
              )}
              <span>{req.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

