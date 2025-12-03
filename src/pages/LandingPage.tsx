import { Link } from 'react-router-dom';
import { 
  Layers, 
  Sparkles, 
  Image, 
  Palette, 
  Zap, 
  ArrowRight,
  Check
} from 'lucide-react';
import { Button } from '../components/ui';

const features = [
  {
    icon: Sparkles,
    title: 'AI画像生成',
    description: 'プロンプトを入力するだけで、高品質なアパレル画像を瞬時に生成。'
  },
  {
    icon: Palette,
    title: 'カラーバリエーション',
    description: '同じデザインの色違い・柄違いを簡単に量産。'
  },
  {
    icon: Image,
    title: '背景編集',
    description: '背景削除・差し替えで、どんなシーンにも対応した商品画像を。'
  },
  {
    icon: Zap,
    title: '高速処理',
    description: '最新のAI技術で、数秒で高品質な画像を生成。'
  }
];

const useCases = [
  {
    title: 'ECサイト',
    description: '商品ページ用の標準カット、ライフスタイルカットを大量生成',
    image: '/images/usecase-ec.jpg'
  },
  {
    title: 'SNSマーケティング',
    description: 'Instagram、X、TikTok向けのバナー・投稿画像を作成',
    image: '/images/usecase-sns.jpg'
  },
  {
    title: '商品企画',
    description: '新作デザインのモックアップ、カラバリ検討に活用',
    image: '/images/usecase-design.jpg'
  }
];

export function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-50 via-primary-50/40 to-accent-50/30" />
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-20 right-20 w-72 h-72 bg-primary-200 rounded-full blur-3xl" />
          <div className="absolute bottom-20 left-20 w-96 h-96 bg-accent-200 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-32">
          <div className="text-center max-w-4xl mx-auto">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-soft mb-8">
              <Sparkles className="w-4 h-4 text-accent-500" />
              <span className="text-sm font-medium text-neutral-700">
                AI駆動のアパレル画像生成プラットフォーム
              </span>
            </div>

            {/* Headline */}
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-display font-semibold text-neutral-900 leading-tight mb-6">
              アパレル画像を
              <span className="block text-gradient">
                AIで自動生成
              </span>
            </h1>

            <p className="text-xl text-neutral-600 max-w-2xl mx-auto mb-10">
              商品画像、バナー、カラバリ、背景編集まで。
              <br className="hidden sm:block" />
              アパレルビジネスに必要な画像をワンストップで生成。
            </p>

            {/* CTA */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/signup">
                <Button size="lg" rightIcon={<ArrowRight className="w-5 h-5" />}>
                  無料で始める
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="secondary" size="lg">
                  ログイン
                </Button>
              </Link>
            </div>

            {/* Trust signals */}
            <div className="flex items-center justify-center gap-8 mt-12 text-sm text-neutral-500">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-500" />
                クレジットカード不要
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-500" />
                即座に利用開始
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-500" />
                全機能無料開放中
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-display font-semibold text-neutral-900 mb-4">
              すべてがAIで完結
            </h2>
            <p className="text-lg text-neutral-600 max-w-2xl mx-auto">
              デザイナーがいなくても、プロ品質の画像を生成。
              アパレルビジネスを加速させる機能が揃っています。
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature, index) => (
              <div
                key={index}
                className="group p-6 bg-neutral-50 rounded-2xl hover:bg-white hover:shadow-elegant transition-all duration-300"
              >
                <div className="w-12 h-12 bg-gradient-to-br from-primary-100 to-accent-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <feature.icon className="w-6 h-6 text-primary-700" />
                </div>
                <h3 className="text-lg font-semibold text-neutral-800 mb-2">
                  {feature.title}
                </h3>
                <p className="text-neutral-600">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="py-24 bg-gradient-to-b from-neutral-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-display font-semibold text-neutral-900 mb-4">
              あらゆるシーンで活躍
            </h2>
            <p className="text-lg text-neutral-600 max-w-2xl mx-auto">
              ECサイト、SNS、商品企画まで。
              アパレル業界のあらゆる場面で活用できます。
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {useCases.map((useCase, index) => (
              <div
                key={index}
                className="bg-white rounded-2xl overflow-hidden shadow-soft hover:shadow-elegant transition-shadow"
              >
                <div className="h-48 bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
                  <Layers className="w-16 h-16 text-primary-300" />
                </div>
                <div className="p-6">
                  <h3 className="text-xl font-semibold text-neutral-800 mb-2">
                    {useCase.title}
                  </h3>
                  <p className="text-neutral-600">
                    {useCase.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 bg-gradient-to-br from-primary-800 via-primary-900 to-neutral-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-display font-semibold text-white mb-4">
            今すぐ始めましょう
          </h2>
          <p className="text-xl text-primary-100 mb-8">
            無料で全機能をお試しいただけます。
          </p>
          <Link to="/signup">
            <Button
              size="lg"
              className="bg-white text-primary-800 hover:bg-primary-50"
              rightIcon={<ArrowRight className="w-5 h-5" />}
            >
              無料アカウントを作成
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-neutral-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-gradient-to-br from-primary-600 to-accent-500 rounded-lg flex items-center justify-center">
                <Layers className="w-4 h-4 text-white" />
              </div>
              <span className="font-display text-lg font-semibold text-white">
                Heavy Chain
              </span>
            </div>
            <div className="flex items-center gap-6 text-sm text-neutral-400">
              <a href="#" className="hover:text-white transition-colors">利用規約</a>
              <a href="#" className="hover:text-white transition-colors">プライバシーポリシー</a>
              <a href="#" className="hover:text-white transition-colors">お問い合わせ</a>
            </div>
            <p className="text-sm text-neutral-500">
              © 2024 Heavy Chain. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

