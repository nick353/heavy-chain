import { useState, useEffect } from 'react';
import { Loader2, Sparkles, Check } from 'lucide-react';

interface LoadingProgressProps {
  isLoading: boolean;
  steps?: string[];
  estimatedTime?: number; // in seconds
  title?: string;
  onComplete?: () => void;
}

export function LoadingProgress({
  isLoading,
  steps = ['準備中...', '画像を生成中...', '最適化中...'],
  estimatedTime = 30,
  title = '生成しています...',
  onComplete,
}: LoadingProgressProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      setCurrentStep(0);
      setProgress(0);
      setElapsedTime(0);
      return;
    }

    // Progress animation
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        const increment = Math.random() * 3 + 1;
        const newProgress = Math.min(prev + increment, 95);
        return newProgress;
      });
    }, 500);

    // Step progression
    const stepInterval = setInterval(() => {
      setCurrentStep(prev => {
        if (prev < steps.length - 1) {
          return prev + 1;
        }
        return prev;
      });
    }, estimatedTime * 1000 / steps.length);

    // Elapsed time counter
    const timeInterval = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);

    return () => {
      clearInterval(progressInterval);
      clearInterval(stepInterval);
      clearInterval(timeInterval);
    };
  }, [isLoading, steps.length, estimatedTime]);

  if (!isLoading) return null;

  const remainingTime = Math.max(0, estimatedTime - elapsedTime);

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-2xl p-8 shadow-xl text-center max-w-md mx-auto">
      {/* Animated Icon */}
      <div className="relative w-20 h-20 mx-auto mb-6">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-100 to-accent-100 dark:from-primary-900/50 dark:to-accent-900/50 rounded-2xl animate-pulse" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Sparkles className="w-10 h-10 text-primary-600 dark:text-primary-400 animate-bounce" />
        </div>
      </div>

      {/* Title */}
      <h3 className="text-xl font-semibold text-neutral-800 dark:text-white mb-2">
        {title}
      </h3>

      {/* Progress Bar */}
      <div className="w-full h-3 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Progress percentage */}
      <p className="text-2xl font-bold text-neutral-800 dark:text-white mb-4">
        {Math.round(progress)}%
      </p>

      {/* Steps */}
      <div className="space-y-2 mb-6">
        {steps.map((step, index) => (
          <div
            key={index}
            className={`flex items-center gap-2 text-sm transition-all duration-300 ${
              index < currentStep
                ? 'text-green-600 dark:text-green-400'
                : index === currentStep
                ? 'text-primary-600 dark:text-primary-400 font-medium'
                : 'text-neutral-400 dark:text-neutral-500'
            }`}
          >
            {index < currentStep ? (
              <Check className="w-4 h-4" />
            ) : index === currentStep ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <div className="w-4 h-4 rounded-full border border-neutral-300 dark:border-neutral-600" />
            )}
            <span>{step}</span>
          </div>
        ))}
      </div>

      {/* Remaining time */}
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        {remainingTime > 0 ? (
          <>推定残り時間: <span className="font-medium">約{remainingTime}秒</span></>
        ) : (
          '間もなく完了します...'
        )}
      </p>

      {/* Tips */}
      <div className="mt-6 pt-6 border-t border-neutral-200 dark:border-neutral-700">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          💡 生成中は他の作業をしていても大丈夫です
        </p>
      </div>
    </div>
  );
}

// Simple inline loading spinner
export function LoadingSpinner({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  };

  return (
    <Loader2 className={`${sizeClasses[size]} animate-spin ${className}`} />
  );
}

// Loading overlay
export function LoadingOverlay({ message = '処理中...' }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-white dark:bg-neutral-800 rounded-2xl p-8 text-center shadow-2xl">
        <LoadingSpinner size="lg" className="text-primary-500 mx-auto mb-4" />
        <p className="text-neutral-700 dark:text-neutral-200 font-medium">{message}</p>
      </div>
    </div>
  );
}


