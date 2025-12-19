import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Wand2, Image, Check, Loader2 } from 'lucide-react';
import clsx from 'clsx';

export type GenerationStep = 'analyzing' | 'generating' | 'processing' | 'complete' | 'error';

interface GenerationProgressProps {
  currentStep: GenerationStep;
  progress?: number;
  estimatedTime?: number; // in seconds
  className?: string;
}

const stepConfig = {
  analyzing: {
    icon: Wand2,
    label: 'プロンプト解析中',
    description: '入力内容を解析しています...',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
  },
  generating: {
    icon: Sparkles,
    label: '画像生成中',
    description: 'AIが画像を生成しています...',
    color: 'text-primary-500',
    bgColor: 'bg-primary-50 dark:bg-primary-900/20',
  },
  processing: {
    icon: Image,
    label: '後処理中',
    description: '画像を最適化しています...',
    color: 'text-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
  },
  complete: {
    icon: Check,
    label: '完了',
    description: '画像の生成が完了しました！',
    color: 'text-green-500',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
  },
  error: {
    icon: Loader2,
    label: 'エラー',
    description: '問題が発生しました',
    color: 'text-red-500',
    bgColor: 'bg-red-50 dark:bg-red-900/20',
  },
};

const steps: GenerationStep[] = ['analyzing', 'generating', 'processing', 'complete'];

export function GenerationProgress({
  currentStep,
  progress,
  estimatedTime,
  className,
}: GenerationProgressProps) {
  const [elapsedTime, setElapsedTime] = useState(0);
  const config = stepConfig[currentStep];
  const Icon = config.icon;

  const currentStepIndex = steps.indexOf(currentStep);

  // Timer
  useEffect(() => {
    if (currentStep === 'complete' || currentStep === 'error') return;

    const interval = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [currentStep]);

  // Reset timer on step change
  useEffect(() => {
    if (currentStep === 'analyzing') {
      setElapsedTime(0);
    }
  }, [currentStep]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
  };

  return (
    <div className={clsx('text-center', className)}>
      {/* Main Icon */}
      <div className="relative mb-6">
        <div
          className={clsx(
            'w-20 h-20 rounded-2xl flex items-center justify-center mx-auto relative overflow-hidden',
            config.bgColor
          )}
        >
          <Icon
            className={clsx(
              'w-10 h-10 relative z-10',
              config.color,
              currentStep !== 'complete' && currentStep !== 'error' && 'animate-pulse'
            )}
          />
          {currentStep !== 'complete' && currentStep !== 'error' && (
            <div className="absolute inset-0 bg-gradient-to-t from-white/20 to-transparent animate-pulse" />
          )}
        </div>
      </div>

      {/* Title */}
      <h3 className="text-xl font-semibold text-neutral-900 dark:text-white mb-2">
        {config.label}
      </h3>
      <p className="text-neutral-500 dark:text-neutral-400 mb-6">
        {config.description}
      </p>

      {/* Progress Steps */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {steps.slice(0, -1).map((step, i) => {
          const isCompleted = i < currentStepIndex;
          const isCurrent = i === currentStepIndex;

          return (
            <div key={step} className="flex items-center">
              <div
                className={clsx(
                  'w-3 h-3 rounded-full transition-all duration-300',
                  isCompleted && 'bg-green-500',
                  isCurrent && 'bg-primary-500 animate-pulse',
                  !isCompleted && !isCurrent && 'bg-neutral-200 dark:bg-neutral-700'
                )}
              />
              {i < steps.length - 2 && (
                <div
                  className={clsx(
                    'w-8 h-0.5 transition-all duration-300',
                    isCompleted ? 'bg-green-500' : 'bg-neutral-200 dark:bg-neutral-700'
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Progress Bar */}
      {progress !== undefined && currentStep !== 'complete' && (
        <div className="w-64 mx-auto mb-4">
          <div className="h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-primary-400 to-primary-600 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <p className="text-xs text-neutral-400 mt-1">{Math.round(progress)}%</p>
        </div>
      )}

      {/* Indeterminate Progress */}
      {progress === undefined && currentStep !== 'complete' && currentStep !== 'error' && (
        <div className="w-64 mx-auto mb-4">
          <div className="h-1.5 bg-neutral-100 dark:bg-neutral-700 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-primary-400 to-primary-600 rounded-full w-1/3"
              animate={{ x: ['-100%', '300%'] }}
              transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
            />
          </div>
        </div>
      )}

      {/* Timer */}
      {currentStep !== 'complete' && currentStep !== 'error' && (
        <div className="text-sm text-neutral-500 dark:text-neutral-400">
          <span>経過時間: {formatTime(elapsedTime)}</span>
          {estimatedTime && elapsedTime < estimatedTime && (
            <span className="ml-2">
              (残り約 {formatTime(estimatedTime - elapsedTime)})
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Hook for managing generation progress
export function useGenerationProgress() {
  const [step, setStep] = useState<GenerationStep>('analyzing');
  const [progress, setProgress] = useState(0);

  const startGeneration = () => {
    setStep('analyzing');
    setProgress(0);

    // Simulate progress
    setTimeout(() => setStep('generating'), 1500);
    setTimeout(() => setStep('processing'), 8000);
  };

  const completeGeneration = () => {
    setStep('complete');
    setProgress(100);
  };

  const errorGeneration = () => {
    setStep('error');
  };

  const reset = () => {
    setStep('analyzing');
    setProgress(0);
  };

  return {
    step,
    progress,
    startGeneration,
    completeGeneration,
    errorGeneration,
    reset,
    setStep,
    setProgress,
  };
}
