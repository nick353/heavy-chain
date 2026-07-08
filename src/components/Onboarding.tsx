import { useState, useEffect } from 'react';
import { 
  X, 
  ChevronRight, 
  ChevronLeft, 
  Wand2, 
  Layers, 
  Clock3,
  FolderOpen, 
  Sparkles,
  Check
} from 'lucide-react';
import { Button } from './ui';

const ONBOARDING_COMPLETED_KEY = 'heavy_chain_onboarding_completed';
const LEGACY_ONBOARDING_COMPLETED_KEY = 'onboarding_completed';

const getOnboardingStorageKey = (userId?: string | null) => (
  userId ? `${ONBOARDING_COMPLETED_KEY}:${userId}` : ONBOARDING_COMPLETED_KEY
);

const hasCompletedOnboarding = (userId?: string | null) => {
  try {
    return localStorage.getItem(getOnboardingStorageKey(userId)) === 'true';
  } catch {
    return false;
  }
};

const hasLegacyCompletedOnboarding = () => {
  try {
    return localStorage.getItem(LEGACY_ONBOARDING_COMPLETED_KEY) === 'true';
  } catch {
    return false;
  }
};

const setCompletedOnboarding = (userId?: string | null) => {
  try {
    localStorage.setItem(getOnboardingStorageKey(userId), 'true');
    localStorage.removeItem(LEGACY_ONBOARDING_COMPLETED_KEY);
  } catch {
    // If storage is unavailable, keep the current session dismissed.
  }
};

const clearCompletedOnboarding = (userId?: string | null) => {
  try {
    localStorage.removeItem(getOnboardingStorageKey(userId));
    localStorage.removeItem(LEGACY_ONBOARDING_COMPLETED_KEY);
  } catch {
    // Ignore storage failures; the caller still controls visible state.
  }
};

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  tips: string[];
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Lightchainへようこそ',
    description: '服や商品画像を置いて、生成、確認、Canvas再編集まで進めるアパレル制作ワークスペースです。',
    icon: Sparkles,
    tips: [
      'まず商品・服・ロゴなどの素材画像を置きます',
      '素材の切り抜き、レイヤー、配置を画面上で決められます',
      '文章だけでなく、視覚的な作業台から制作を始めます',
    ],
  },
  {
    id: 'material-workbench',
    title: '素材ワークベンチ',
    description: '衣服参考、商品素材、背景、ロゴを読み込み、どのレイヤーに使うかを先に決めます。',
    icon: Wand2,
    tips: [
      '衣服参考ライブラリ、販促素材、モデル参照を画像から始めます',
      '自動カット、背景維持、手動マスクの方針を選べます',
      '配置とサイズを決めるとCanvas保存時の構造にも残ります',
      '生成時は参照画像として安全にhandoffされます',
    ],
  },
  {
    id: 'queue',
    title: '生成キューと復帰',
    description: '生成する作業は保存され、進行中、完了、止まった作業を後から見直せます。',
    icon: Clock3,
    tips: [
      '生成後に画面を閉じてもJobsから状態を確認できます',
      '失敗した作業は要確認にまとまり、原因と次の操作が出ます',
      '完了した成果物はGalleryとHistoryから再利用できます',
    ],
  },
  {
    id: 'canvas',
    title: 'Canvasで仕上げる',
    description: '生成画像やGallery素材をCanvasに追加し、広告・商品ページ・SNS用に再編集できます。',
    icon: Layers,
    tips: [
      'Galleryから追加して、生成済み素材を再配置できます',
      'テキスト、画像、レイヤーを使って完成物へ整えます',
      'PNG書き出しで、そのまま確認や共有に使えます',
    ],
  },
  {
    id: 'organize',
    title: '成果物を管理する',
    description: 'GalleryとHistoryで、採用候補、生成元、再編集先を追いながら制作を続けられます。',
    icon: FolderOpen,
    tips: [
      'Galleryで詳細を開き、ダウンロードや共有に進めます',
      'Historyで過去の生成とプロンプトを確認できます',
      'Canvas、Jobs、Galleryを行き来して同じ素材を使い回せます',
      '困ったらDashboardの「使い方を見る」から再表示できます',
    ],
  },
];

interface OnboardingProps {
  onComplete: () => void;
  userId?: string | null;
}

export function Onboarding({ onComplete, userId }: OnboardingProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  const step = ONBOARDING_STEPS[currentStep];
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;
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
    setCompletedOnboarding(userId);
    setTimeout(onComplete, 300);
  };

  const handleSkip = () => {
    handleComplete();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="min-h-full flex items-start justify-center p-2 sm:p-4 pt-8 sm:pt-12 md:pt-16">
        <div className="w-full max-w-2xl bg-white rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden animate-scale-in flex flex-col my-4 max-h-[calc(100dvh-4rem)] sm:max-h-[calc(100dvh-6rem)] md:max-h-[calc(100dvh-8rem)]">
        {/* Header - Responsive height */}
        <div className="relative h-24 sm:h-32 md:h-40 bg-gradient-to-br from-primary-500 via-primary-600 to-accent-600 flex items-center justify-center shrink-0">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4xIj48cGF0aCBkPSJNMzYgMzRjMC0yLjIgMS44LTQgNC00czQgMS44IDQgNC0xLjggNC00IDQtNC0xLjgtNC00eiIvPjwvZz48L2c+PC9zdmc+')] opacity-30" />
          
          <button
            onClick={handleSkip}
            className="absolute top-2 right-2 sm:top-4 sm:right-4 p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          <div className="relative z-10 text-center">
            <div className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 bg-white/20 rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-2 sm:mb-3 backdrop-blur-sm">
              <step.icon className="w-7 h-7 sm:w-8 sm:h-8 md:w-10 md:h-10 text-white" />
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="flex gap-1 px-4 sm:px-6 -mt-1 sm:-mt-2 relative z-10 shrink-0">
          {ONBOARDING_STEPS.map((s, i) => (
            <div
              key={s.id}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= currentStep ? 'bg-primary-500' : 'bg-neutral-200'
              }`}
            />
          ))}
        </div>

        {/* Content - Scrollable */}
        <div className="p-4 sm:p-6 md:p-8 overflow-y-auto flex-1 min-h-0">
          <h2 className="text-lg sm:text-xl md:text-2xl font-display font-bold text-neutral-900 mb-2 sm:mb-3">
            {step.title}
          </h2>
          <p className="text-sm sm:text-base text-neutral-600 mb-4 sm:mb-6">
            {step.description}
          </p>

          <div className="space-y-2 sm:space-y-3 mb-2 sm:mb-4">
            {step.tips.map((tip, i) => (
              <div key={i} className="flex items-start gap-2 sm:gap-3">
                <div className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-primary-600" />
                </div>
                <p className="text-xs sm:text-sm text-neutral-700">{tip}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer - Fixed */}
        <div className="p-3 sm:p-4 md:p-6 pt-2 sm:pt-3 bg-white border-t border-neutral-100 shrink-0">
          {/* Navigation */}
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <button
              onClick={handleSkip}
              className="text-xs sm:text-sm text-neutral-500 hover:text-neutral-700 transition-colors"
            >
              スキップ
            </button>

            <div className="flex items-center gap-2 sm:gap-3">
              {!isFirstStep && (
                <Button variant="secondary" size="sm" onClick={handlePrev} className="px-2 sm:px-3">
                  <ChevronLeft className="w-3 h-3 sm:w-4 sm:h-4 mr-0.5 sm:mr-1" />
                  <span className="hidden sm:inline">戻る</span>
                </Button>
              )}
              <Button onClick={handleNext} size="sm" className="px-3 sm:px-4">
                {isLastStep ? (
                  <>
                    <span className="text-sm">始める</span>
                    <Sparkles className="w-3 h-3 sm:w-4 sm:h-4 ml-1" />
                  </>
                ) : (
                  <>
                    <span className="text-sm">次へ</span>
                    <ChevronRight className="w-3 h-3 sm:w-4 sm:h-4 ml-0.5 sm:ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Step indicator */}
          <div className="text-center">
            <span className="text-[10px] sm:text-xs text-neutral-400">
              {currentStep + 1} / {ONBOARDING_STEPS.length}
            </span>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

// Hook to check if onboarding should be shown
export function useOnboarding(userId?: string | null) {
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (!userId) {
      setShowOnboarding(false);
      return;
    }

    if (!hasCompletedOnboarding(userId) && hasLegacyCompletedOnboarding()) {
      setCompletedOnboarding(userId);
      setShowOnboarding(false);
      return;
    }

    setShowOnboarding(!hasCompletedOnboarding(userId));
  }, [userId]);

  const completeOnboarding = () => {
    setShowOnboarding(false);
  };

  const resetOnboarding = () => {
    clearCompletedOnboarding(userId);
    setShowOnboarding(true);
  };

  return { showOnboarding, completeOnboarding, resetOnboarding };
}
