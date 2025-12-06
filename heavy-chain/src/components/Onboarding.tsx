import { useState, useEffect } from 'react';
import { 
  X, 
  ChevronRight, 
  ChevronLeft, 
  Wand2, 
  Layers, 
  Users, 
  FolderOpen, 
  Sparkles,
  Check
} from 'lucide-react';
import { Button } from './ui';

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
    title: 'Heavy Chainへようこそ！',
    description: 'AIを活用したアパレル向け画像生成プラットフォームです。数クリックでプロ品質の画像を作成できます。',
    icon: Sparkles,
    tips: [
      '日本語でプロンプトを入力できます',
      'AIが自動で最適な英語に変換します',
      'アパレル・ファッションに特化した生成が可能です',
    ],
  },
  {
    id: 'generate',
    title: '画像生成機能',
    description: '様々な生成モードで、商品画像からSNSバナーまで幅広く対応します。',
    icon: Wand2,
    tips: [
      '基本生成: テキストから画像を生成',
      'デザインガチャ: 8スタイルから4つを一括生成',
      '商品カット: 4方向（正面/側面/背面/詳細）を自動生成',
      'モデルマトリクス: 体型×年齢の組み合わせを生成',
    ],
  },
  {
    id: 'canvas',
    title: 'キャンバスエディター',
    description: '無限キャンバスで自由にレイアウト。テキスト、シェイプ、画像を配置できます。',
    icon: Layers,
    tips: [
      'マウスホイールでズーム',
      'ドラッグで視点移動',
      '画像選択後、フローティングツールバーで編集',
      'チャットエディターで対話形式の編集も可能',
    ],
  },
  {
    id: 'team',
    title: 'チーム機能',
    description: 'ブランドを作成してチームメンバーを招待。リアルタイムで共同編集できます。',
    icon: Users,
    tips: [
      '複数ブランドの管理に対応',
      'オーナー/管理者/編集者/閲覧者の4段階権限',
      'メンバー招待はメールまたは招待コード',
    ],
  },
  {
    id: 'organize',
    title: '画像管理',
    description: '生成した画像はフォルダとタグで整理。お気に入りやZIP一括ダウンロードも。',
    icon: FolderOpen,
    tips: [
      'フォルダで階層管理',
      'タグ付けで検索性向上',
      '生成履歴は30日間保存',
      '共有リンクで外部共有',
    ],
  },
];

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
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
    localStorage.setItem('onboarding_completed', 'true');
    setTimeout(onComplete, 300);
  };

  const handleSkip = () => {
    handleComplete();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-scale-in my-auto max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="relative h-32 sm:h-40 bg-gradient-to-br from-primary-500 via-primary-600 to-accent-600 flex items-center justify-center flex-shrink-0">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4xIj48cGF0aCBkPSJNMzYgMzRjMC0yLjIgMS44LTQgNC00czQgMS44IDQgNC0xLjggNC00IDQtNC0xLjgtNC00eiIvPjwvZz48L2c+PC9zdmc+')] opacity-30" />
            
            <button
              onClick={handleSkip}
              className="absolute top-4 right-4 p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="relative z-10 text-center">
              <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3 backdrop-blur-sm">
                <step.icon className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
              </div>
            </div>
          </div>

          {/* Progress */}
          <div className="flex gap-1 px-6 -mt-2 relative z-10 flex-shrink-0">
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
          <div className="p-6 sm:p-8 overflow-y-auto flex-1">
            <h2 className="text-xl sm:text-2xl font-display font-bold text-neutral-900 mb-3">
              {step.title}
            </h2>
            <p className="text-sm sm:text-base text-neutral-600 mb-6">
              {step.description}
            </p>

            <div className="space-y-3 mb-6 sm:mb-8">
              {step.tips.map((tip, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Check className="w-3 h-3 text-primary-600" />
                  </div>
                  <p className="text-sm text-neutral-700">{tip}</p>
                </div>
              ))}
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <button
                onClick={handleSkip}
                className="text-sm text-neutral-500 hover:text-neutral-700 transition-colors"
              >
                スキップ
              </button>

              <div className="flex items-center gap-2 sm:gap-3">
                {!isFirstStep && (
                  <Button variant="secondary" onClick={handlePrev} size="sm">
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    戻る
                  </Button>
                )}
                <Button onClick={handleNext} size="sm">
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
          </div>

          {/* Step indicator */}
          <div className="px-6 sm:px-8 pb-4 sm:pb-6 text-center flex-shrink-0">
            <span className="text-xs text-neutral-400">
              {currentStep + 1} / {ONBOARDING_STEPS.length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Hook to check if onboarding should be shown
export function useOnboarding() {
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const completed = localStorage.getItem('onboarding_completed');
    if (!completed) {
      setShowOnboarding(true);
    }
  }, []);

  const completeOnboarding = () => {
    setShowOnboarding(false);
  };

  const resetOnboarding = () => {
    localStorage.removeItem('onboarding_completed');
    setShowOnboarding(true);
  };

  return { showOnboarding, completeOnboarding, resetOnboarding };
}





