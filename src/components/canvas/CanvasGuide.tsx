import { useState, useEffect } from 'react';
import { 
  X, 
  Upload, 
  Wand2, 
  MousePointer2, 
  Move, 
  ZoomIn,
  MessageSquare,
  Layers,
  ChevronRight,
  ChevronLeft,
  Sparkles
} from 'lucide-react';
import { Button } from '../ui';

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
}

export function CanvasGuide({ onComplete }: CanvasGuideProps) {
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
    localStorage.setItem('canvas_guide_completed', 'true');
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
            className="h-full bg-primary-500 transition-all duration-300"
            style={{ width: `${((currentStep + 1) / GUIDE_STEPS.length) * 100}%` }}
          />
        </div>

        {/* Content */}
        <div className="p-8">
          {/* Icon */}
          <div className="w-16 h-16 bg-gradient-to-br from-primary-100 to-accent-100 dark:from-primary-900/50 dark:to-accent-900/50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <step.icon className="w-8 h-8 text-primary-600 dark:text-primary-400" />
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
                  <step.icon className="w-5 h-5 text-primary-600 dark:text-primary-300" />
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
                    ? 'bg-primary-500' 
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
export function useCanvasGuide() {
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    const completed = localStorage.getItem('canvas_guide_completed');
    if (!completed) {
      // Show guide after a short delay
      const timer = setTimeout(() => {
        setShowGuide(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const completeGuide = () => {
    setShowGuide(false);
  };

  const resetGuide = () => {
    localStorage.removeItem('canvas_guide_completed');
    setShowGuide(true);
  };

  return { showGuide, completeGuide, resetGuide };
}


