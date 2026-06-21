import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Download,
  ImagePlus,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { motion } from 'framer-motion';

const fittingTabs = ['説明生成', '参考画像', 'モデルセット写真'] as const;
type FittingTab = (typeof fittingTabs)[number];

const seedHistory = [
  { id: 'fit-1042', title: 'リネンシャツ / モデル着用', status: '完了', time: '12分前' },
  { id: 'fit-1038', title: 'ワイドパンツ / EC白背景', status: '完了', time: '昨日' },
];

export function FittingPage() {
  const [activeTab, setActiveTab] = useState<FittingTab>('説明生成');
  const [quality, setQuality] = useState<'smart' | '1k'>('smart');
  const [isGenerating, setIsGenerating] = useState(false);
  const [history, setHistory] = useState(seedHistory);

  const tabCopy = useMemo(() => {
    if (activeTab === '説明生成') return '商品説明、着用シーン、素材感をAIが整理してプロンプト化します。';
    if (activeTab === '参考画像') return 'ムード、構図、背景トーンを参照してフィッティング精度を寄せます。';
    return 'モデル、ポーズ、身長レンジをセットにして同一商品の着用差分を作ります。';
  }, [activeTab]);

  const handleGenerate = () => {
    setIsGenerating(true);
    window.setTimeout(() => {
      setIsGenerating(false);
      setHistory((items) => [
        {
          id: `fit-${Date.now()}`,
          title: quality === 'smart' ? 'スマート生成 / 新作トップス' : '1K生成 / 新作トップス',
          status: '完了',
          time: 'たった今',
        },
        ...items,
      ]);
    }, 1200);
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="glass-panel rounded-2xl p-5 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="font-display text-3xl font-semibold text-neutral-950 dark:text-white">
                AIフィッティング
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                衣服画像から、EC向けの着用イメージ、モデル差分、説明文までを同じ作業面で作る UI-only ワークスペースです。
              </p>
            </div>
            <Link to="/generate" className="btn-secondary inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm">
              <Sparkles className="h-4 w-4" />
              既存生成へ
            </Link>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <label className="group flex min-h-[360px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-primary-300/70 bg-white/55 p-6 text-center transition hover:border-primary-500 hover:bg-white/80 dark:border-primary-700/50 dark:bg-surface-900/50 dark:hover:bg-surface-900/80">
              <input type="file" accept="image/*" className="sr-only" />
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 shadow-inner dark:bg-primary-900/30 dark:text-primary-300">
                <Upload className="h-7 w-7" />
              </div>
              <p className="mt-4 text-base font-semibold text-neutral-900 dark:text-white">
                衣服画像をアップロード
              </p>
              <p className="mt-2 max-w-xs text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                平置き、トルソー、実物写真を想定。ここではファイル選択のみで外部保存は行いません。
              </p>
              <div className="mt-6 grid w-full max-w-xs grid-cols-3 gap-2">
                {['正面', '背面', 'ディテール'].map((label) => (
                  <div key={label} className="rounded-xl bg-surface-100 px-3 py-2 text-xs font-medium text-neutral-500 dark:bg-surface-800 dark:text-neutral-300">
                    {label}
                  </div>
                ))}
              </div>
            </label>

            <div className="rounded-2xl border border-white/60 bg-white/50 p-4 dark:border-white/10 dark:bg-surface-900/40">
              <div className="flex rounded-xl bg-surface-100 p-1 dark:bg-surface-950/70">
                {fittingTabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition sm:text-sm ${
                      activeTab === tab
                        ? 'bg-white text-primary-700 shadow-sm dark:bg-surface-800 dark:text-primary-300'
                        : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-2xl bg-gradient-to-br from-surface-50 to-white p-4 dark:from-surface-950 dark:to-surface-900">
                <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-300">{tabCopy}</p>
                <textarea
                  className="mt-4 min-h-32 w-full rounded-xl border border-neutral-200 bg-white/80 p-4 text-sm leading-6 text-neutral-800 outline-none transition focus:border-primary-400 dark:border-surface-700 dark:bg-surface-950/70 dark:text-neutral-100"
                  defaultValue="生成したい着用感: 春夏向け、自然光、20代女性モデル、EC商品ページのメイン画像として使える落ち着いた構図。"
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-xl bg-surface-100 p-1 dark:bg-surface-950/70">
                  {(['smart', '1k'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setQuality(mode)}
                      className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                        quality === mode
                          ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                          : 'text-neutral-500 dark:text-neutral-400'
                      }`}
                    >
                      {mode === 'smart' ? 'スマート' : '1K'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="btn-primary inline-flex items-center gap-2 text-sm"
                >
                  {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  AI生成
                </button>
              </div>
            </div>
          </div>
        </div>

        <aside className="glass-panel rounded-2xl p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">ローカル生成履歴</h2>
          <div className="mt-4 space-y-3">
            {isGenerating && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-primary-200 bg-primary-50/70 p-4 dark:border-primary-900/60 dark:bg-primary-950/30">
                <div className="flex items-center gap-3">
                  <RefreshCw className="h-5 w-5 animate-spin text-primary-600" />
                  <div>
                    <p className="text-sm font-semibold text-primary-900 dark:text-primary-100">生成中</p>
                    <p className="text-xs text-primary-700/80 dark:text-primary-200/80">モデル合成と背景整合を処理中</p>
                  </div>
                </div>
              </motion.div>
            )}
            {history.map((item) => (
              <div key={item.id} className="rounded-2xl border border-white/60 bg-white/55 p-4 dark:border-white/10 dark:bg-surface-900/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-100 text-primary-600 dark:bg-surface-800 dark:text-primary-300">
                      <ImagePlus className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">{item.title}</p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">{item.status} / {item.time}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-4 gap-2">
                  {[
                    { label: 'DL', icon: Download },
                    { label: '編集', icon: Pencil },
                    { label: '再生成', icon: RefreshCw },
                    { label: '削除', icon: Trash2 },
                  ].map((action) => (
                    <button key={action.label} type="button" className="flex items-center justify-center gap-1 rounded-lg bg-surface-100 px-2 py-2 text-xs font-medium text-neutral-600 transition hover:bg-primary-50 hover:text-primary-700 dark:bg-surface-800 dark:text-neutral-300 dark:hover:bg-primary-900/30">
                      <action.icon className="h-3.5 w-3.5" />
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
