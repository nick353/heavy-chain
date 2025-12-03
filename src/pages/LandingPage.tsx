import { Link } from 'react-router-dom';
import { 
  Layers, 
  Sparkles, 
  Image, 
  Palette, 
  Zap, 
  ArrowRight,
  Check,
  Clock,
  DollarSign,
  Users,
  Star,
  Scissors,
  RefreshCw,
  Globe,
  Layout,
  Camera,
  ShoppingBag,
  ChevronRight,
  Play
} from 'lucide-react';
import { Button } from '../components/ui';

const stats = [
  { value: '30秒', label: '平均生成時間', icon: Clock },
  { value: '90%', label: 'コスト削減', icon: DollarSign },
  { value: '12種', label: 'AI機能', icon: Sparkles },
  { value: '24/7', label: '利用可能', icon: Zap },
];

const features = [
  {
    icon: Sparkles,
    title: 'AI画像生成',
    description: '日本語プロンプトを入力するだけで、高品質なアパレル画像を30秒で生成。',
    badge: '人気No.1',
  },
  {
    icon: Palette,
    title: 'カラバリ生成',
    description: '1枚の画像から12色以上のカラーバリエーションを一括生成。パターン/柄にも対応。',
    badge: null,
  },
  {
    icon: Scissors,
    title: '背景削除・差し替え',
    description: 'ワンクリックで背景を削除。白背景、スタジオ、屋外など7種類のプリセット。',
    badge: null,
  },
  {
    icon: RefreshCw,
    title: 'バリエーション生成',
    description: '類似度を調整しながら、元画像から複数のバリエーションを生成。',
    badge: null,
  },
  {
    icon: Camera,
    title: 'シーン別コーディネート',
    description: '同じ商品をカフェ、ストリート、オフィスなど複数シーンに自動配置。',
    badge: '新機能',
  },
  {
    icon: ShoppingBag,
    title: '商品カット自動生成',
    description: '正面・側面・背面・ディテールの4カットを自動生成。ECサイトに最適。',
    badge: null,
  },
  {
    icon: Users,
    title: 'モデルマトリクス',
    description: '体型・年齢違いの着用イメージをマトリクス生成。サイズ感の訴求に。',
    badge: null,
  },
  {
    icon: Globe,
    title: '多言語バナー',
    description: '日本語・英語・中国語・韓国語の多言語ECバナーを一括生成。',
    badge: null,
  },
];

const useCases = [
  {
    title: 'ECサイト運営',
    description: '商品ページ用の標準カット、ライフスタイルカットを大量生成。撮影コストを90%削減。',
    metrics: ['撮影コスト90%削減', '商品登録時間1/3に', '画像品質均一化'],
    icon: ShoppingBag,
    color: 'from-blue-500 to-cyan-500',
  },
  {
    title: 'SNSマーケティング',
    description: 'Instagram、X、TikTok向けのバナー・投稿画像を数秒で作成。A/Bテストも簡単。',
    metrics: ['投稿頻度3倍', 'エンゲージメント向上', 'クリエイティブ制作時間削減'],
    icon: Camera,
    color: 'from-purple-500 to-pink-500',
  },
  {
    title: '商品企画・デザイン',
    description: '新作デザインのモックアップ、カラバリ検討をAIでスピーディに。意思決定を加速。',
    metrics: ['企画サイクル短縮', 'カラバリ検討効率化', 'プレゼン資料作成迅速化'],
    icon: Palette,
    color: 'from-orange-500 to-red-500',
  },
];

const testimonials = [
  {
    quote: '撮影にかかっていた時間とコストが劇的に削減されました。ECサイトの商品登録が3倍速くなった。',
    author: '田中様',
    role: 'アパレルECサイト運営',
    rating: 5,
  },
  {
    quote: 'カラバリ検討がこんなに楽になるとは。デザインチームの生産性が大幅に向上しました。',
    author: '佐藤様',
    role: 'ファッションブランド デザイナー',
    rating: 5,
  },
  {
    quote: 'SNS投稿の画像作成に毎日使っています。日本語で指示できるのが本当に便利。',
    author: '山田様',
    role: 'フリーランスデザイナー',
    rating: 5,
  },
];

const workflowSteps = [
  {
    step: '01',
    title: '機能を選択',
    description: '12種類のAI機能から目的に合ったものを選択',
  },
  {
    step: '02',
    title: '日本語で指示',
    description: 'プロンプトを日本語で入力。AIが自動で最適化',
  },
  {
    step: '03',
    title: '画像を生成',
    description: '約30秒で高品質な画像が生成完了',
  },
  {
    step: '04',
    title: 'ダウンロード',
    description: 'PNG/JPEG/WebP形式で即座にダウンロード',
  },
];

export function LandingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-900">
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-50 via-primary-50/40 to-accent-50/30 dark:from-neutral-900 dark:via-primary-900/20 dark:to-accent-900/10" />
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-20 right-20 w-72 h-72 bg-primary-200 dark:bg-primary-800 rounded-full blur-3xl" />
          <div className="absolute bottom-20 left-20 w-96 h-96 bg-accent-200 dark:bg-accent-800 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-32">
          <div className="text-center max-w-4xl mx-auto">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-neutral-800 rounded-full shadow-soft mb-8">
              <Sparkles className="w-4 h-4 text-accent-500" />
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                アパレル専用AI画像生成プラットフォーム
              </span>
            </div>

            {/* Headline */}
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-display font-semibold text-neutral-900 dark:text-white leading-tight mb-6">
              アパレル画像を
              <span className="block text-gradient">
                AIで自動生成
              </span>
            </h1>

            <p className="text-xl text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto mb-10">
              商品画像、カラバリ、バナー、背景編集まで。
              <br className="hidden sm:block" />
              <strong>12種類のAI機能</strong>でアパレルビジネスを加速。
            </p>

            {/* CTA */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
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
            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-neutral-500 dark:text-neutral-400">
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

        {/* Stats bar */}
        <div className="relative bg-white dark:bg-neutral-800 border-y border-neutral-200 dark:border-neutral-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {stats.map((stat, index) => (
                <div key={index} className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <stat.icon className="w-5 h-5 text-primary-500" />
                    <span className="text-3xl font-bold text-neutral-800 dark:text-white">
                      {stat.value}
                    </span>
                  </div>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 bg-neutral-50 dark:bg-neutral-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-display font-semibold text-neutral-900 dark:text-white mb-4">
              4ステップで簡単生成
            </h2>
            <p className="text-lg text-neutral-600 dark:text-neutral-400">
              日本語で指示するだけ。専門知識は不要です。
            </p>
          </div>

          <div className="grid md:grid-cols-4 gap-8">
            {workflowSteps.map((item, index) => (
              <div key={index} className="relative">
                {index < workflowSteps.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-full w-full h-0.5 bg-gradient-to-r from-primary-300 to-transparent dark:from-primary-600" />
                )}
                <div className="bg-white dark:bg-neutral-800 rounded-2xl p-6 shadow-soft">
                  <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900/50 rounded-xl flex items-center justify-center mb-4">
                    <span className="text-lg font-bold text-primary-600 dark:text-primary-400">{item.step}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-neutral-800 dark:text-white mb-2">
                    {item.title}
                  </h3>
                  <p className="text-neutral-600 dark:text-neutral-400 text-sm">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24 bg-white dark:bg-neutral-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-display font-semibold text-neutral-900 dark:text-white mb-4">
              12種類のAI機能
            </h2>
            <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto">
              アパレルビジネスに必要な画像生成・編集機能をワンストップで提供。
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => (
              <div
                key={index}
                className="group relative p-6 bg-neutral-50 dark:bg-neutral-800 rounded-2xl hover:bg-white dark:hover:bg-neutral-700 hover:shadow-elegant transition-all duration-300"
              >
                {feature.badge && (
                  <div className="absolute top-4 right-4 px-2 py-1 bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 text-xs font-medium rounded-full">
                    {feature.badge}
                  </div>
                )}
                <div className="w-12 h-12 bg-gradient-to-br from-primary-100 to-accent-100 dark:from-primary-900/50 dark:to-accent-900/50 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <feature.icon className="w-6 h-6 text-primary-700 dark:text-primary-400" />
                </div>
                <h3 className="text-lg font-semibold text-neutral-800 dark:text-white mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <Link to="/signup">
              <Button size="lg" variant="secondary" rightIcon={<ChevronRight className="w-5 h-5" />}>
                すべての機能を見る
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="py-24 bg-gradient-to-b from-neutral-50 to-white dark:from-neutral-800 dark:to-neutral-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-display font-semibold text-neutral-900 dark:text-white mb-4">
              あらゆるシーンで活躍
            </h2>
            <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto">
              ECサイト、SNS、商品企画まで。アパレル業界のあらゆる場面で活用できます。
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {useCases.map((useCase, index) => (
              <div
                key={index}
                className="bg-white dark:bg-neutral-800 rounded-2xl overflow-hidden shadow-soft hover:shadow-elegant transition-shadow"
              >
                <div className={`h-48 bg-gradient-to-br ${useCase.color} flex items-center justify-center relative overflow-hidden`}>
                  <useCase.icon className="w-20 h-20 text-white/30" />
                  <div className="absolute inset-0 bg-black/10" />
                </div>
                <div className="p-6">
                  <h3 className="text-xl font-semibold text-neutral-800 dark:text-white mb-2">
                    {useCase.title}
                  </h3>
                  <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                    {useCase.description}
                  </p>
                  <div className="space-y-2">
                    {useCase.metrics.map((metric, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                        <Check className="w-4 h-4 text-green-500" />
                        {metric}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 bg-white dark:bg-neutral-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-display font-semibold text-neutral-900 dark:text-white mb-4">
              ユーザーの声
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <div
                key={index}
                className="bg-neutral-50 dark:bg-neutral-800 rounded-2xl p-6"
              >
                <div className="flex gap-1 mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 text-yellow-500 fill-current" />
                  ))}
                </div>
                <p className="text-neutral-700 dark:text-neutral-300 mb-4">
                  "{testimonial.quote}"
                </p>
                <div>
                  <p className="font-medium text-neutral-800 dark:text-white">
                    {testimonial.author}
                  </p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {testimonial.role}
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
            全機能無料で利用可能。クレジットカード不要。
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/signup">
              <Button
                size="lg"
                className="bg-white text-primary-800 hover:bg-primary-50"
                rightIcon={<ArrowRight className="w-5 h-5" />}
              >
                無料アカウントを作成
              </Button>
            </Link>
            <Link to="/login">
              <Button
                size="lg"
                variant="ghost"
                className="text-white border-white/30 hover:bg-white/10"
              >
                ログイン
              </Button>
            </Link>
          </div>
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
