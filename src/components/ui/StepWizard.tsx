import { useState, createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronRight, ChevronLeft } from 'lucide-react';
import clsx from 'clsx';
import { Button } from './Button';

interface Step {
  id: string;
  title: string;
  description?: string;
  isOptional?: boolean;
}

interface StepWizardContextType {
  currentStep: number;
  steps: Step[];
  goToStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  isFirstStep: boolean;
  isLastStep: boolean;
  canGoNext: boolean;
  setCanGoNext: (value: boolean) => void;
}

const StepWizardContext = createContext<StepWizardContextType | null>(null);

export function useStepWizard() {
  const context = useContext(StepWizardContext);
  if (!context) {
    throw new Error('useStepWizard must be used within a StepWizardProvider');
  }
  return context;
}

interface StepWizardProps {
  steps: Step[];
  children: ReactNode;
  onComplete?: () => void;
  showProgressBar?: boolean;
  allowSkip?: boolean;
  className?: string;
}

export function StepWizard({
  steps,
  children,
  onComplete,
  showProgressBar = true,
  allowSkip = false,
  className,
}: StepWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [canGoNext, setCanGoNext] = useState(true);

  const goToStep = (step: number) => {
    if (step >= 0 && step < steps.length) {
      setCurrentStep(step);
    }
  };

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else if (onComplete) {
      onComplete();
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const value: StepWizardContextType = {
    currentStep,
    steps,
    goToStep,
    nextStep,
    prevStep,
    isFirstStep: currentStep === 0,
    isLastStep: currentStep === steps.length - 1,
    canGoNext,
    setCanGoNext,
  };

  const progress = ((currentStep + 1) / steps.length) * 100;

  return (
    <StepWizardContext.Provider value={value}>
      <div className={clsx('flex flex-col', className)}>
        {/* Step indicators */}
        <div className="mb-6 sm:mb-8">
          {/* Mobile: Simple progress bar */}
          {showProgressBar && (
            <div className="sm:hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-neutral-900 dark:text-white">
                  {steps[currentStep].title}
                </span>
                <span className="text-sm text-neutral-500">
                  {currentStep + 1} / {steps.length}
                </span>
              </div>
              <div className="h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-primary-500 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          )}

          {/* Desktop: Full step indicators */}
          <div className="hidden sm:flex items-center justify-between">
            {steps.map((step, index) => {
              const isCompleted = index < currentStep;
              const isCurrent = index === currentStep;
              const isClickable = index <= currentStep || allowSkip;

              return (
                <div key={step.id} className="flex items-center flex-1 last:flex-none">
                  <button
                    onClick={() => isClickable && goToStep(index)}
                    disabled={!isClickable}
                    className={clsx(
                      'flex items-center gap-3 transition-all',
                      isClickable && 'cursor-pointer group'
                    )}
                  >
                    {/* Step number/check */}
                    <div
                      className={clsx(
                        'w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all',
                        isCompleted &&
                          'bg-green-500 text-white',
                        isCurrent &&
                          'bg-primary-500 text-white ring-4 ring-primary-500/20',
                        !isCompleted &&
                          !isCurrent &&
                          'bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400'
                      )}
                    >
                      {isCompleted ? <Check className="w-5 h-5" /> : index + 1}
                    </div>

                    {/* Step info */}
                    <div className="text-left">
                      <p
                        className={clsx(
                          'text-sm font-medium transition-colors',
                          isCurrent
                            ? 'text-neutral-900 dark:text-white'
                            : 'text-neutral-500 dark:text-neutral-400',
                          isClickable && 'group-hover:text-primary-600 dark:group-hover:text-primary-400'
                        )}
                      >
                        {step.title}
                      </p>
                      {step.description && (
                        <p className="text-xs text-neutral-400 dark:text-neutral-500">
                          {step.description}
                        </p>
                      )}
                    </div>
                  </button>

                  {/* Connector line */}
                  {index < steps.length - 1 && (
                    <div
                      className={clsx(
                        'flex-1 h-0.5 mx-4 transition-colors',
                        index < currentStep
                          ? 'bg-green-500'
                          : 'bg-neutral-200 dark:bg-neutral-700'
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="flex-1"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </StepWizardContext.Provider>
  );
}

// Step navigation buttons
export function StepNavigation({
  nextLabel = '次へ',
  prevLabel = '戻る',
  completeLabel = '完了',
  onComplete,
  className,
}: {
  nextLabel?: string;
  prevLabel?: string;
  completeLabel?: string;
  onComplete?: () => void;
  className?: string;
}) {
  const { nextStep, prevStep, isFirstStep, isLastStep, canGoNext } = useStepWizard();

  return (
    <div className={clsx('flex items-center justify-between pt-6', className)}>
      <Button
        variant="ghost"
        onClick={prevStep}
        disabled={isFirstStep}
        leftIcon={<ChevronLeft className="w-4 h-4" />}
        className={clsx(isFirstStep && 'invisible')}
      >
        {prevLabel}
      </Button>

      <Button
        onClick={() => {
          if (isLastStep && onComplete) {
            onComplete();
          } else {
            nextStep();
          }
        }}
        disabled={!canGoNext}
        rightIcon={!isLastStep ? <ChevronRight className="w-4 h-4" /> : undefined}
      >
        {isLastStep ? completeLabel : nextLabel}
      </Button>
    </div>
  );
}

// Individual step component
export function StepContent({
  stepIndex,
  children,
}: {
  stepIndex: number;
  children: ReactNode;
}) {
  const { currentStep } = useStepWizard();

  if (currentStep !== stepIndex) return null;

  return <>{children}</>;
}
