import { Link } from 'react-router-dom';
import { Button } from '../components/ui';
import { motion, useScroll, useTransform, useSpring } from 'framer-motion';
import { useRef, useEffect } from 'react';
import {
  IconSparkles,
  IconPalette,
  IconZap,
  IconArrowRight,
  IconCheck,
  IconClock,
  IconDollar,
  IconUsers,
  IconStar,
  IconScissors,
  IconRefresh,
  IconGlobe,
  IconCamera,
  IconShoppingBag,
  IconChevronRight,
  HeavyChainLogo
} from '../components/icons';

const stats = [
  { value: '30秒', label: '平均生成時間', icon: IconClock },
  { value: '90%', label: 'コスト削減', icon: IconDollar },
  { value: '12種', label: 'AI機能', icon: IconSparkles },
  { value: '24/7', label: '利用可能', icon: IconZap },
];

const features = [
  {
    icon: IconSparkles,
    title: 'AI画像生成',
    description: '日本語プロンプトを入力するだけで、高品質なアパレル画像を30秒で生成。',
    badge: '人気No.1',
  },
  {
    icon: IconPalette,
    title: 'カラバリ生成',
    description: '1枚の画像から12色以上のカラーバリエーションを一括生成。パターン/柄にも対応。',
    badge: null,
  },
  {
    icon: IconScissors,
    title: '背景削除・差し替え',
    description: 'ワンクリックで背景を削除。白背景、スタジオ、屋外など7種類のプリセット。',
    badge: null,
  },
  {
    icon: IconRefresh,
    title: 'バリエーション生成',
    description: '類似度を調整しながら、元画像から複数のバリエーションを生成。',
    badge: null,
  },
  {
    icon: IconCamera,
    title: 'シーン別コーディネート',
    description: '同じ商品をカフェ、ストリート、オフィスなど複数シーンに自動配置。',
    badge: '新機能',
  },
  {
    icon: IconShoppingBag,
    title: '商品カット自動生成',
    description: '正面・側面・背面・ディテールの4カットを自動生成。ECサイトに最適。',
    badge: null,
  },
  {
    icon: IconUsers,
    title: 'モデルマトリクス',
    description: '体型・年齢違いの着用イメージをマトリクス生成。サイズ感の訴求に。',
    badge: null,
  },
  {
    icon: IconGlobe,
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
    icon: IconShoppingBag,
    color: 'from-blue-500 to-cyan-500',
  },
  {
    title: 'SNSマーケティング',
    description: 'Instagram、X、TikTok向けのバナー・投稿画像を数秒で作成。A/Bテストも簡単。',
    metrics: ['投稿頻度3倍', 'エンゲージメント向上', 'クリエイティブ制作時間削減'],
    icon: IconCamera,
    color: 'from-purple-500 to-pink-500',
  },
  {
    title: '商品企画・デザイン',
    description: '新作デザインのモックアップ、カラバリ検討をAIでスピーディに。意思決定を加速。',
    metrics: ['企画サイクル短縮', 'カラバリ検討効率化', 'プレゼン資料作成迅速化'],
    icon: IconPalette,
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
    description: 'プロンプトを日本語で入力',
  },
  {
    step: '03',
    title: '画像を生成',
    description: '約30秒で高品質な画像が完成',
  },
  {
    step: '04',
    title: 'ダウンロード',
    description: 'PNG/JPEG/WebPで即座に保存',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.8,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
    },
  },
};

function MouseParallax() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll();
  const mouseX = useSpring(0, { stiffness: 50, damping: 20 });
  const mouseY = useSpring(0, { stiffness: 50, damping: 20 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const { clientX, clientY } = e;
      const { innerWidth, innerHeight } = window;
      mouseX.set(clientX / innerWidth - 0.5);
      mouseY.set(clientY / innerHeight - 0.5);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mouseX, mouseY]);

  const x1 = useTransform(mouseX, (val) => val * 40);
  const y1 = useTransform(mouseY, (val) => val * 40);
  const x2 = useTransform(mouseX, (val) => val * -30);
  const y2 = useTransform(mouseY, (val) => val * -30);

  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  return (
    <motion.div ref={ref} style={{ opacity }} className="absolute inset-0 pointer-events-none overflow-hidden">
      <motion.div 
        style={{ x: x1, y: y1 }}
        className="absolute top-[10%] right-[10%] w-[500px] h-[500px] bg-primary-100/30 dark:bg-primary-900/15 rounded-full blur-[150px]" 
      />
      <motion.div 
        style={{ x: x2, y: y2 }}
        className="absolute bottom-[10%] left-[10%] w-[400px] h-[400px] bg-neutral-200/30 dark:bg-neutral-800/20 rounded-full blur-[120px]" 
      />
    </motion.div>
  );
}

export function LandingPage() {
  const targetRef = useRef(null);
  const { scrollYProgress: _scrollYProgress } = useScroll({
    target: targetRef,
    offset: ["start start", "end start"],
  });

  // Reserved for future parallax effects
  // const y = useTransform(_scrollYProgress, [0, 1], ["0%", "50%"]);
  // const opacity = useTransform(_scrollYProgress, [0, 0.5], [1, 0]);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 overflow-hidden selection:bg-primary-200 selection:text-primary-900">
      {/* Hero */}
      <section ref={targetRef} className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <MouseParallax />
        
        {/* Noise Texture */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-repeat" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-32 z-10">
          <div className="text-center max-w-5xl mx-auto">
            {/* Badge */}
            <motion.div 
              initial={{ opacity: 0, y: 20, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-white/60 backdrop-blur-md dark:bg-white/5 rounded-full shadow-sm mb-10 border border-neutral-200/50 dark:border-white/10 cursor-default"
            >
              <IconSparkles className="w-4 h-4 text-primary-600 dark:text-primary-400" size={16} />
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200 tracking-wide">
                アパレル専用AI画像生成プラットフォーム
              </span>
            </motion.div>

            {/* Headline */}
<motion.h1
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
              className="text-4xl sm:text-6xl lg:text-8xl xl:text-9xl font-display font-bold text-neutral-900 dark:text-white leading-[1] sm:leading-[0.95] mb-6 sm:mb-10 tracking-tight"
            >
              <span className="whitespace-nowrap">アパレル画像を</span>
              <br />
              <span className="relative inline-block mt-1 sm:mt-2">
                <span className="relative bg-clip-text text-transparent bg-gradient-to-r from-primary-700 to-primary-500 dark:from-primary-400 dark:to-primary-300 whitespace-nowrap">
                  AIで自動生成
                </span>
              </span>
            </motion.h1>

            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
              className="text-base sm:text-xl lg:text-2xl text-neutral-600 dark:text-neutral-300 max-w-2xl mx-auto mb-8 sm:mb-14 leading-relaxed font-light px-4"
            >
              商品画像、カラバリ、バナー、背景編集まで。
              <strong className="text-neutral-900 dark:text-white font-semibold">12種類のAI機能</strong>でアパレルビジネスを加速。
            </motion.p>

            {/* CTA */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6, ease: "easeOut" }}
              className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 mb-12 sm:mb-20 px-4"
            >
              <Link to="/signup">
                <Button 
                  size="lg" 
                  className="text-sm sm:text-lg px-6 sm:px-10 py-3 sm:py-4 rounded-full shadow-glow-lg hover:scale-105 hover:shadow-glow-xl transition-all duration-500 bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 border-0"
                  rightIcon={<IconArrowRight className="w-4 h-4 sm:w-5 sm:h-5" size={20} />}
                >
                  無料で始める
                </Button>
              </Link>
              <Link to="/login">
                <Button 
                  variant="ghost" 
                  size="lg" 
                  className="text-sm sm:text-lg px-6 sm:px-10 py-3 sm:py-4 rounded-full bg-white/30 backdrop-blur-md hover:bg-white/50 border border-white/40 dark:border-white/10 dark:text-white dark:hover:bg-white/10"
                >
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
                <div key={i} className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/40 backdrop-blur-sm border border-white/30 shadow-sm dark:bg-white/5 dark:border-white/10">
                  <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <IconCheck className="w-3 h-3 text-green-600 dark:text-green-400" size={12} />
                  </div>
                  {text}
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <motion.div 
        initial={{ opacity: 0, y: 100 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-20 -mt-32 mx-4 sm:mx-8 lg:mx-auto max-w-7xl"
      >
        <div className="glass-panel rounded-3xl p-10 md:p-14 shadow-floating border border-white/60 dark:border-white/10 bg-white/80 dark:bg-surface-900/80 backdrop-blur-2xl">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 md:gap-8 divide-x-0 md:divide-x divide-neutral-200 dark:divide-neutral-800/50">
            {stats.map((stat, index) => (
              <div key={index} className="text-center group px-2">
                <div className="flex flex-col items-center justify-center gap-3 transform group-hover:-translate-y-1 transition-transform duration-500">
                  <div className="p-3 rounded-2xl bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 mb-2">
                    <stat.icon className="w-6 h-6" size={24} />
                  </div>
                  <span className="text-4xl sm:text-5xl font-bold text-neutral-900 dark:text-white font-display tracking-tight">
                    {stat.value}
                  </span>
                </div>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 tracking-widest uppercase mt-2">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* How it works */}
      <section className="py-40 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
<motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-10 sm:mb-16 lg:mb-24"
          >
            <h2 className="text-2xl sm:text-4xl lg:text-6xl font-display font-semibold text-neutral-900 dark:text-white mb-3 sm:mb-6 tracking-tight">
              4ステップで簡単生成
            </h2>
            <p className="text-sm sm:text-lg lg:text-xl text-neutral-600 dark:text-neutral-400 font-light px-4">
              日本語で指示するだけ。専門知識は不要です。
            </p>
          </motion.div>

<motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 lg:gap-8"
          >
            {workflowSteps.map((item, index) => (
              <motion.div key={index} variants={itemVariants} className="relative group">
                {index < workflowSteps.length - 1 && (
                  <div className="hidden md:block absolute top-12 left-2/3 w-full h-[2px] bg-gradient-to-r from-neutral-200 to-transparent dark:from-neutral-800 -z-10" />
                )}
                <div className="relative z-10 h-full bg-white dark:bg-surface-900/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 shadow-sm hover:shadow-elegant transition-all duration-500 hover:-translate-y-2 border border-neutral-100 dark:border-white/5">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 bg-gradient-to-br from-neutral-100 to-white dark:from-neutral-800 dark:to-neutral-900 rounded-xl sm:rounded-2xl flex items-center justify-center mb-4 sm:mb-6 lg:mb-8 shadow-inner group-hover:scale-110 transition-transform duration-500 border border-white/50 dark:border-white/5">
                    <span className="text-lg sm:text-xl lg:text-2xl font-bold text-neutral-900 dark:text-white font-display">{item.step}</span>
                  </div>
                  <h3 className="text-base sm:text-lg lg:text-xl font-semibold text-neutral-900 dark:text-white mb-2 sm:mb-4">
                    {item.title}
                  </h3>
                  <p className="text-xs sm:text-sm lg:text-base text-neutral-600 dark:text-neutral-400 leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-40 bg-surface-100/50 dark:bg-black/20 relative overflow-hidden">
        {/* Decorative background */}
        <div className="absolute top-0 right-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute top-[-20%] right-[-10%] w-[800px] h-[800px] rounded-full bg-primary-100/30 dark:bg-primary-900/10 blur-[120px]" />
          <div className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-accent-100/30 dark:bg-accent-900/10 blur-[100px]" />
        </div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-10 sm:mb-16 lg:mb-24"
          >
            <h2 className="text-2xl sm:text-4xl lg:text-6xl font-display font-semibold text-neutral-900 dark:text-white mb-3 sm:mb-6 tracking-tight">
              12種類のAI機能
            </h2>
            <p className="text-sm sm:text-lg lg:text-xl text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto font-light px-4">
              アパレルビジネスに必要な画像生成・編集機能をワンストップで提供。
            </p>
          </motion.div>

          <motion.div 
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {features.map((feature, index) => (
              <motion.div
                key={index}
                variants={itemVariants}
                className="glass-card p-8 group cursor-pointer flex flex-col h-full bg-white/60 dark:bg-surface-800/40"
              >
                {feature.badge && (
                  <div className="absolute top-4 right-4 px-3 py-1 bg-gradient-to-r from-primary-500 to-gold-DEFAULT text-white text-[10px] font-bold rounded-full tracking-widest uppercase shadow-glow">
                    {feature.badge}
                  </div>
                )}
                <div className="w-16 h-16 bg-surface-50 dark:bg-surface-900 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 shadow-sm border border-white/50 dark:border-white/5">
                  <feature.icon className="w-8 h-8 text-neutral-700 dark:text-neutral-300 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors" size={32} />
                </div>
                <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                  {feature.title}
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed flex-grow">
                  {feature.description}
                </p>
                <div className="mt-6 flex items-center text-primary-600 dark:text-primary-400 text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform translate-y-2 group-hover:translate-y-0">
                  詳しく見る <IconArrowRight className="w-4 h-4 ml-1" size={16} />
                </div>
              </motion.div>
            ))}
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mt-20"
          >
            <Link to="/signup">
              <Button size="lg" variant="secondary" rightIcon={<IconChevronRight className="w-5 h-5" size={20} />} className="px-12 rounded-full border-neutral-300 dark:border-neutral-700 hover:border-primary-500 dark:hover:border-primary-500">
                すべての機能を見る
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="py-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-24"
          >
            <h2 className="text-4xl sm:text-6xl font-display font-semibold text-neutral-900 dark:text-white mb-6 tracking-tight">
              あらゆるシーンで活躍
            </h2>
            <p className="text-xl text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto font-light">
              ECサイト、SNS、商品企画まで。アパレル業界のあらゆる場面で活用できます。
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {useCases.map((useCase, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1, duration: 0.8, ease: "easeOut" }}
                className="bg-white dark:bg-surface-900 rounded-[2rem] overflow-hidden shadow-soft hover:shadow-floating transition-all duration-500 group border border-neutral-100 dark:border-white/5"
              >
                <div className={`h-64 bg-gradient-to-br ${useCase.color} flex items-center justify-center relative overflow-hidden`}>
                  <useCase.icon className="w-32 h-32 text-white/10 transform group-hover:scale-125 transition-transform duration-1000 rotate-12 absolute -right-4 -bottom-4" size={128} />
                  <div className="relative z-10 p-8 w-full h-full flex flex-col justify-end">
                    <div className="w-14 h-14 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center mb-4 border border-white/20">
                      <useCase.icon className="w-7 h-7 text-white" size={28} />
                    </div>
                    <h3 className="text-2xl font-semibold text-white font-display">
                      {useCase.title}
                    </h3>
                  </div>
                </div>
                <div className="p-8">
                  <p className="text-neutral-600 dark:text-neutral-400 mb-8 leading-relaxed">
                    {useCase.description}
                  </p>
                  <div className="space-y-4">
                    {useCase.metrics.map((metric, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm text-neutral-700 dark:text-neutral-300 bg-surface-50 dark:bg-surface-800 px-4 py-3 rounded-xl border border-neutral-100 dark:border-neutral-700">
                        <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                          <IconCheck className="w-3 h-3 text-green-600 dark:text-green-400" size={12} />
                        </div>
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
      <section className="py-40 bg-neutral-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-20 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-repeat" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full max-w-7xl pointer-events-none">
           <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary-900/30 rounded-full blur-[100px]" />
           <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent-900/30 rounded-full blur-[100px]" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-24"
          >
            <h2 className="text-4xl sm:text-6xl font-display font-semibold mb-6 tracking-tight">
              ユーザーの声
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1, duration: 0.8 }}
                className="bg-white/5 backdrop-blur-lg rounded-3xl p-10 relative border border-white/10 hover:bg-white/10 transition-colors duration-300"
              >
                <div className="absolute top-6 right-8 text-6xl text-primary-500/20 font-serif">"</div>
                <div className="flex gap-1 mb-8">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <IconStar key={i} className="w-4 h-4 text-gold-DEFAULT fill-current" size={16} />
                  ))}
                </div>
                <p className="text-lg text-neutral-300 mb-10 relative z-10 italic font-serif leading-relaxed">
                  {testimonial.quote}
                </p>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-primary-500 to-accent-500 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-lg">
                    {testimonial.author[0]}
                  </div>
                  <div>
                    <p className="font-bold text-white text-lg">
                      {testimonial.author}
                    </p>
                    <p className="text-xs text-neutral-400 uppercase tracking-wider mt-1">
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
      <section className="py-32 relative overflow-hidden bg-surface-50 dark:bg-surface-950">
        
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="bg-white dark:bg-neutral-900 rounded-[3rem] p-12 md:p-20 shadow-floating border border-neutral-100 dark:border-neutral-800 relative overflow-hidden"
          >
             <div className="absolute inset-0 bg-gradient-to-br from-primary-50/50 to-transparent dark:from-primary-900/20 pointer-events-none" />
             
            <motion.h2 
              className="text-4xl sm:text-7xl font-display font-semibold text-neutral-900 dark:text-white mb-10 leading-tight tracking-tight relative z-10"
            >
              あなたのブランドを
              <br />
              <span className="text-gradient-gold">次のレベルへ</span>
            </motion.h2>
            
            <motion.p 
              className="text-xl text-neutral-600 dark:text-neutral-300 mb-12 max-w-2xl mx-auto font-light relative z-10"
            >
              全機能無料で利用可能。クレジットカード不要。
              <br />
              30秒で最初の画像を生成できます。
            </motion.p>

            <motion.div 
              className="flex flex-col sm:flex-row items-center justify-center gap-6 relative z-10"
            >
              <Link to="/signup">
                <Button
                  size="lg"
                  className="px-12 py-5 text-lg bg-primary-600 hover:bg-primary-700 text-white rounded-full shadow-glow hover:shadow-glow-lg hover:scale-105 transition-all duration-300"
                  rightIcon={<IconArrowRight className="w-5 h-5" size={20} />}
                >
                  無料アカウントを作成
                </Button>
              </Link>
            </motion.div>
            
            <p className="mt-8 text-sm text-neutral-400 relative z-10">
              登録から1分で生成開始できます
            </p>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-20 bg-surface-50 dark:bg-surface-950 border-t border-neutral-200 dark:border-neutral-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-10">
            <div className="flex items-center">
              <HeavyChainLogo height={48} showText={true} />
            </div>
            <div className="flex flex-wrap justify-center gap-10 text-sm text-neutral-500 dark:text-neutral-400 font-medium">
              <a href="#" className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors duration-300">利用規約</a>
              <a href="#" className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors duration-300">プライバシーポリシー</a>
              <a href="#" className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors duration-300">お問い合わせ</a>
              <a href="#" className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors duration-300">特商法表記</a>
            </div>
            <p className="text-xs text-neutral-400">
              © 2024 Heavy Chain. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
