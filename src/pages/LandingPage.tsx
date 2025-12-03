import { Link } from 'react-router-dom';
import { 
  Layers, 
  Sparkles, 
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
  Camera,
  ShoppingBag,
  ChevronRight
} from 'lucide-react';
import { Button } from '../components/ui';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';

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

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: "easeOut",
    },
  },
};

export function LandingPage() {
  const targetRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: targetRef,
    offset: ["start start", "end start"],
  });

  const y = useTransform(scrollYProgress, [0, 1], ["0%", "50%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-900 overflow-hidden">
      {/* Hero */}
      <section ref={targetRef} className="relative min-h-screen flex items-center justify-center overflow-hidden">
        {/* Parallax Background */}
        <motion.div style={{ y, opacity }} className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-br from-neutral-50 via-primary-50/40 to-accent-50/30 dark:from-neutral-900 dark:via-primary-900/20 dark:to-accent-900/10" />
          <div className="absolute top-20 right-20 w-72 h-72 bg-primary-200 dark:bg-primary-800 rounded-full blur-[100px] animate-float opacity-60" />
          <div className="absolute bottom-20 left-20 w-96 h-96 bg-accent-200 dark:bg-accent-800 rounded-full blur-[120px] animate-pulse-slow opacity-60" />
        </motion.div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-32 z-10">
          <div className="text-center max-w-4xl mx-auto">
            {/* Badge */}
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white/50 backdrop-blur-md dark:bg-neutral-800/50 rounded-full shadow-glass mb-8 border border-white/50 dark:border-white/10"
            >
              <Sparkles className="w-4 h-4 text-accent-500 animate-pulse" />
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300 tracking-wide">
                アパレル専用AI画像生成プラットフォーム
              </span>
            </motion.div>

            {/* Headline */}
            <motion.h1 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="text-5xl sm:text-6xl lg:text-8xl font-display font-semibold text-neutral-900 dark:text-white leading-tight mb-8 tracking-tight"
            >
              アパレル画像を
              <span className="block text-gradient-gold drop-shadow-sm">
                AIで自動生成
              </span>
            </motion.h1>

            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="text-xl text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto mb-12 leading-relaxed"
            >
              商品画像、カラバリ、バナー、背景編集まで。
              <br className="hidden sm:block" />
              <strong>12種類のAI機能</strong>でアパレルビジネスを加速。
            </motion.p>

            {/* CTA */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-16"
            >
              <Link to="/signup">
                <Button size="lg" rightIcon={<ArrowRight className="w-5 h-5" />} className="shadow-glow-lg hover:scale-105 transition-transform duration-300">
                  無料で始める
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="secondary" size="lg" className="bg-white/50 backdrop-blur-sm hover:bg-white/80 border-primary-200">
                  ログイン
                </Button>
              </Link>
            </motion.div>

            {/* Trust signals */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 0.8 }}
              className="flex flex-wrap items-center justify-center gap-8 text-sm text-neutral-500 dark:text-neutral-400"
            >
              {[
                'クレジットカード不要',
                '即座に利用開始',
                '全機能無料開放中'
              ].map((text, i) => (
                <div key={i} className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/30 backdrop-blur-sm border border-white/20">
                  <Check className="w-4 h-4 text-green-500" />
                  {text}
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <motion.div 
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="relative z-20 -mt-20 mx-4 sm:mx-8 lg:mx-auto max-w-7xl"
      >
        <div className="glass-panel rounded-2xl p-8 md:p-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, index) => (
              <div key={index} className="text-center group">
                <div className="flex items-center justify-center gap-2 mb-2 transform group-hover:scale-110 transition-transform duration-300">
                  <stat.icon className="w-6 h-6 text-primary-500" />
                  <span className="text-3xl sm:text-4xl font-bold text-neutral-800 dark:text-white font-display">
                    {stat.value}
                  </span>
                </div>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 tracking-wider uppercase">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* How it works */}
      <section className="py-32 bg-neutral-50/50 dark:bg-neutral-900/50 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-20"
          >
            <h2 className="text-3xl sm:text-5xl font-display font-semibold text-neutral-900 dark:text-white mb-6">
              4ステップで簡単生成
            </h2>
            <p className="text-lg text-neutral-600 dark:text-neutral-400">
              日本語で指示するだけ。専門知識は不要です。
            </p>
          </motion.div>

          <motion.div 
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid md:grid-cols-4 gap-8"
          >
            {workflowSteps.map((item, index) => (
              <motion.div key={index} variants={itemVariants} className="relative group">
                {index < workflowSteps.length - 1 && (
                  <div className="hidden md:block absolute top-10 left-full w-full h-[2px] bg-gradient-to-r from-primary-200/50 to-transparent -translate-x-8 z-0" />
                )}
                <div className="relative z-10 bg-white dark:bg-neutral-800 rounded-2xl p-8 shadow-soft hover:shadow-elegant transition-all duration-500 hover:-translate-y-2 border border-neutral-100 dark:border-neutral-700">
                  <div className="w-14 h-14 bg-gradient-to-br from-primary-100 to-primary-50 dark:from-primary-900/50 dark:to-primary-800/30 rounded-xl flex items-center justify-center mb-6 shadow-inner group-hover:scale-110 transition-transform duration-500">
                    <span className="text-xl font-bold text-primary-600 dark:text-primary-400 font-display">{item.step}</span>
                  </div>
                  <h3 className="text-xl font-semibold text-neutral-800 dark:text-white mb-3">
                    {item.title}
                  </h3>
                  <p className="text-neutral-600 dark:text-neutral-400 text-sm leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-32 bg-white dark:bg-neutral-900 relative overflow-hidden">
        {/* Decorative background */}
        <div className="absolute top-0 right-0 w-1/2 h-full bg-primary-50/30 dark:bg-primary-900/10 skew-x-12 pointer-events-none" />
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-20"
          >
            <h2 className="text-3xl sm:text-5xl font-display font-semibold text-neutral-900 dark:text-white mb-6">
              12種類のAI機能
            </h2>
            <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto">
              アパレルビジネスに必要な画像生成・編集機能をワンストップで提供。
            </p>
          </motion.div>

          <motion.div 
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {features.map((feature, index) => (
              <motion.div
                key={index}
                variants={itemVariants}
                className="glass-card p-8 group cursor-pointer"
              >
                {feature.badge && (
                  <div className="absolute top-4 right-4 px-3 py-1 bg-primary-100/80 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 text-xs font-bold rounded-full tracking-wide backdrop-blur-sm">
                    {feature.badge}
                  </div>
                )}
                <div className="w-14 h-14 bg-gradient-to-br from-primary-100 to-accent-50 dark:from-primary-900/50 dark:to-accent-900/30 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 shadow-sm">
                  <feature.icon className="w-7 h-7 text-primary-700 dark:text-primary-400" />
                </div>
                <h3 className="text-lg font-semibold text-neutral-800 dark:text-white mb-3 group-hover:text-primary-600 transition-colors">
                  {feature.title}
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </motion.div>

          <motion.div 
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center mt-16"
          >
            <Link to="/signup">
              <Button size="lg" variant="secondary" rightIcon={<ChevronRight className="w-5 h-5" />} className="px-12">
                すべての機能を見る
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="py-32 bg-surface-50 dark:bg-surface-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-20"
          >
            <h2 className="text-3xl sm:text-5xl font-display font-semibold text-neutral-900 dark:text-white mb-6">
              あらゆるシーンで活躍
            </h2>
            <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto">
              ECサイト、SNS、商品企画まで。アパレル業界のあらゆる場面で活用できます。
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-10">
            {useCases.map((useCase, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="bg-white dark:bg-neutral-800 rounded-3xl overflow-hidden shadow-soft hover:shadow-floating transition-all duration-500 group"
              >
                <div className={`h-56 bg-gradient-to-br ${useCase.color} flex items-center justify-center relative overflow-hidden`}>
                  <useCase.icon className="w-24 h-24 text-white/20 transform group-hover:scale-125 transition-transform duration-700 rotate-12" />
                  <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors duration-500" />
                  <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-black/20 to-transparent opacity-50" />
                </div>
                <div className="p-8">
                  <h3 className="text-2xl font-semibold text-neutral-800 dark:text-white mb-3 font-display">
                    {useCase.title}
                  </h3>
                  <p className="text-neutral-600 dark:text-neutral-400 mb-6 leading-relaxed">
                    {useCase.description}
                  </p>
                  <div className="space-y-3">
                    {useCase.metrics.map((metric, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm text-neutral-600 dark:text-neutral-300 bg-neutral-50 dark:bg-neutral-700/50 px-3 py-2 rounded-lg">
                        <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                        {metric}
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-32 bg-white dark:bg-neutral-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-20"
          >
            <h2 className="text-3xl sm:text-5xl font-display font-semibold text-neutral-900 dark:text-white mb-6">
              ユーザーの声
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="bg-neutral-50 dark:bg-neutral-800/50 rounded-2xl p-8 relative border border-neutral-100 dark:border-neutral-700"
              >
                <div className="absolute top-6 right-8 text-6xl text-primary-200 dark:text-primary-900 font-serif opacity-50">"</div>
                <div className="flex gap-1 mb-6">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 text-yellow-500 fill-current drop-shadow-sm" />
                  ))}
                </div>
                <p className="text-lg text-neutral-700 dark:text-neutral-300 mb-8 relative z-10 italic font-serif">
                  {testimonial.quote}
                </p>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-accent-400 rounded-full flex items-center justify-center text-white font-bold">
                    {testimonial.author[0]}
                  </div>
                  <div>
                    <p className="font-bold text-neutral-900 dark:text-white">
                      {testimonial.author}
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      {testimonial.role}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 bg-neutral-900 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1490481651871-ab68de25d43d?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center opacity-20 blur-sm mix-blend-overlay" />
        <div className="absolute inset-0 bg-gradient-to-b from-neutral-900/80 to-neutral-900" />
        
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl sm:text-6xl font-display font-semibold text-white mb-8 leading-tight"
          >
            あなたのブランドを
            <br />
            <span className="text-gradient-gold">次のレベルへ</span>
          </motion.h2>
          
          <motion.p 
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="text-xl text-neutral-300 mb-12 max-w-2xl mx-auto"
          >
            全機能無料で利用可能。クレジットカード不要。
            <br />
            30秒で最初の画像を生成できます。
          </motion.p>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-6"
          >
            <Link to="/signup">
              <Button
                size="lg"
                className="px-10 py-6 text-lg bg-white text-neutral-900 hover:bg-neutral-100 border-none shadow-glow hover:scale-105 transition-all duration-300"
                rightIcon={<ArrowRight className="w-5 h-5" />}
              >
                無料アカウントを作成
              </Button>
            </Link>
            <Link to="/login">
              <Button
                size="lg"
                variant="ghost"
                className="px-10 py-6 text-lg text-white border-white/30 hover:bg-white/10"
              >
                ログイン
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 bg-neutral-950 border-t border-neutral-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-accent-600 rounded-xl flex items-center justify-center shadow-glow">
                <Layers className="w-5 h-5 text-white" />
              </div>
              <span className="font-display text-xl font-semibold text-white tracking-wide">
                Heavy Chain
              </span>
            </div>
            <div className="flex flex-wrap justify-center gap-8 text-sm text-neutral-400">
              <a href="#" className="hover:text-primary-400 transition-colors duration-300">利用規約</a>
              <a href="#" className="hover:text-primary-400 transition-colors duration-300">プライバシーポリシー</a>
              <a href="#" className="hover:text-primary-400 transition-colors duration-300">お問い合わせ</a>
              <a href="#" className="hover:text-primary-400 transition-colors duration-300">特定商取引法に基づく表記</a>
            </div>
            <p className="text-xs text-neutral-600">
              © 2024 Heavy Chain. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
