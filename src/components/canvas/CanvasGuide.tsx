import { useState, useEffect } from 'react';
import {
  Upload,
  Wand2,
  MousePointer2,
  ZoomIn,
  MessageSquare,
  Layers,
  ChevronRight,
  ChevronLeft,
  Sparkles
} from 'lucide-react';
import { Button } from '../ui';

const CANVAS_GUIDE_COMPLETED_KEY = 'heavy_chain_canvas_guide_completed';
const LEGACY_CANVAS_GUIDE_COMPLETED_KEY = 'canvas_guide_completed';

const getCanvasGuideStorageKey = (userId?: string | null) => (
  userId ? `${CANVAS_GUIDE_COMPLETED_KEY}:${userId}` : CANVAS_GUIDE_COMPLETED_KEY
);

const hasCompletedCanvasGuide = (userId?: string | null) => {
  try {
    return localStorage.getItem(getCanvasGuideStorageKey(userId)) === 'true';
  } catch {
    return false;
  }
};

const hasLegacyCompletedCanvasGuide = () => {
  try {
    return localStorage.getItem(LEGACY_CANVAS_GUIDE_COMPLETED_KEY) === 'true';
  } catch {
    return false;
  }
};

const setCompletedCanvasGuide = (userId?: string | null) => {
  try {
    localStorage.setItem(getCanvasGuideStorageKey(userId), 'true');
    localStorage.removeItem(LEGACY_CANVAS_GUIDE_COMPLETED_KEY);
  } catch {
    // If storage is unavailable, keep the current session dismissed.
  }
};

const clearCompletedCanvasGuide = (userId?: string | null) => {
  try {
    localStorage.removeItem(getCanvasGuideStorageKey(userId));
    localStorage.removeItem(LEGACY_CANVAS_GUIDE_COMPLETED_KEY);
  } catch {
    // Ignore storage failures; the caller still controls visible state.
  }
};

interface GuideStep {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  position?: 'center' | 'left' | 'right' | 'top' | 'bottom';
  highlight?: string;
}

const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'welcome',
    title: 'キャンバスエディターへようこそ！',
    description: '無限キャンバスで自由に画像を配置・編集できます。基本操作を覚えましょう。',
    icon: Layers,
  },
  {
    id: 'upload',
    title: '画像をアップロード',
    description: '左サイドバーのアップロードボタンから画像を追加できます。ドラッグ&ドロップも対応しています。',
    icon: Upload,
    highlight: 'upload',
  },
  {
    id: 'generate',
    title: 'AI画像生成',
    description: '魔法の杖アイコンをクリックすると、テキストから画像を生成できます。複数の生成モードから選べます。',
    icon: Wand2,
    highlight: 'generate',
  },
  {
    id: 'select',
    title: '画像を選択して編集',
    description: '画像をクリックすると選択され、フローティングツールバーが表示されます。背景削除、カラバリ生成などが可能です。',
    icon: MousePointer2,
  },
  {
    id: 'navigate',
    title: 'キャンバスの操作',
    description: 'マウスホイールでズーム、ドラッグで視点移動。右下のミニマップで全体を把握できます。',
    icon: ZoomIn,
  },
  {
    id: 'chat',
    title: 'チャットで編集',
    description: '左サイドバーの吹き出しアイコンでチャットエディターを開き、「もっと明るく」など対話形式で編集できます。',
    icon: MessageSquare,
    highlight: 'chat',
  },
];

interface CanvasGuideProps {
  onComplete: () => void;
  userId?: string | null;
}

export function CanvasGuide({ onComplete, userId }: CanvasGuideProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  const step = GUIDE_STEPS[currentStep];
  const isLastStep = currentStep === GUIDE_STEPS.length - 1;
  const isFirstStep = currentStep === 0;

  const handleNext = () => {
    if (isLastStep) {
      handleComplete();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirstStep) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleComplete = () => {
    setIsVisible(false);
    setCompletedCanvasGuide(userId);
    onComplete();
  };

  const handleSkip = () => {
    handleComplete();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white dark:bg-neutral-800 rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
        {/* Progress bar */}
        <div className="h-1 bg-neutral-100 dark:bg-neutral-700">
          <div
            className="h-full bg-cyan-300 transition-all duration-300"
            style={{ width: `${((currentStep + 1) / GUIDE_STEPS.length) * 100}%` }}
          />
        </div>

        {/* Content */}
        <div className="p-8">
          {/* Icon */}
          <div className="w-16 h-16 bg-gradient-to-br from-primary-100 to-accent-100 dark:from-primary-900/50 dark:to-accent-900/50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <step.icon className="w-8 h-8 text-cyan-300" />
          </div>

          {/* Title & Description */}
          <h2 className="text-xl font-display font-bold text-neutral-800 dark:text-white text-center mb-3">
            {step.title}
          </h2>
          <p className="text-neutral-600 dark:text-neutral-300 text-center mb-8">
            {step.description}
          </p>

          {/* Visual hint */}
          {step.highlight && (
            <div className="bg-neutral-50 dark:bg-neutral-700 rounded-xl p-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary-100 dark:bg-primary-800 rounded-lg flex items-center justify-center animate-pulse">
                  <step.icon className="w-5 h-5 text-cyan-300" />
                </div>
                <div className="text-sm text-neutral-600 dark:text-neutral-300">
                  {step.highlight === 'upload' && '← 左サイドバーのこのボタン'}
                  {step.highlight === 'generate' && '← AI生成はこのボタンから'}
                  {step.highlight === 'chat' && '← チャットエディターを開く'}
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleSkip}
              className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
            >
              スキップ
            </button>

            <div className="flex items-center gap-3">
              {!isFirstStep && (
                <Button variant="secondary" size="sm" onClick={handlePrev}>
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  戻る
                </Button>
              )}
              <Button size="sm" onClick={handleNext}>
                {isLastStep ? (
                  <>
                    始める
                    <Sparkles className="w-4 h-4 ml-1" />
                  </>
                ) : (
                  <>
                    次へ
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Step indicator */}
          <div className="flex justify-center gap-1.5 mt-6">
            {GUIDE_STEPS.map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === currentStep
                    ? 'bg-cyan-300'
                    : i < currentStep
                      ? 'bg-primary-200 dark:bg-primary-700'
                      : 'bg-neutral-200 dark:bg-neutral-600'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Hook to check if canvas guide should be shown
export function useCanvasGuide(userId?: string | null) {
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (!userId) {
      setShowGuide(false);
      return;
    }

    if (!hasCompletedCanvasGuide(userId) && hasLegacyCompletedCanvasGuide()) {
      setCompletedCanvasGuide(userId);
      setShowGuide(false);
      return;
    }

    if (hasCompletedCanvasGuide(userId)) {
      setShowGuide(false);
      return;
    }

    const shouldOpenGuide = typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('guide') === '1';
    if (!shouldOpenGuide) {
      setShowGuide(false);
      return;
    }

    const timer = setTimeout(() => {
      setShowGuide(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [userId]);

  const completeGuide = () => {
    setShowGuide(false);
  };

  const resetGuide = () => {
    clearCompletedCanvasGuide(userId);
    setShowGuide(true);
  };

  return { showGuide, completeGuide, resetGuide };
}



