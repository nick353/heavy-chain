import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  Bot,
  Brush,
  ChevronRight,
  Layers,
  Megaphone,
  MonitorUp,
  Radio,
  Settings2,
  ShoppingBag,
  Store,
} from 'lucide-react';

const channels = [
  { id: 'ec', label: 'EC', icon: ShoppingBag },
  { id: 'sns', label: 'SNS', icon: Megaphone },
  { id: 'brand', label: 'ブランド', icon: Brush },
  { id: 'store', label: '店舗・オフライン', icon: Store },
  { id: 'live', label: 'ライブ配信', icon: Radio },
  { id: 'promo', label: 'プロモーション', icon: MonitorUp },
] as const;

const ecTemplates = ['メイン画像', '詳細画像', '白背景・背景削除', '店舗ポスター'];
const projects = [
  { name: '24SS Linen Launch', format: 'EC / SNS', updated: '今日 14:20' },
  { name: 'Holiday Capsule Poster', format: '店舗ポスター', updated: '昨日' },
  { name: 'Live Commerce Kit', format: 'ライブ配信', updated: '2日前' },
];

type ChannelId = (typeof channels)[number]['id'];

export function MarketingWorkspacePage() {
  const [activeChannel, setActiveChannel] = useState<ChannelId>('ec');
  const [selectedTemplate, setSelectedTemplate] = useState(ecTemplates[0]);
  const [progress, setProgress] = useState(20);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 92) return 92;
        return current + 6;
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, []);

  const activeLabel = useMemo(
    () => channels.find((channel) => channel.id === activeChannel)?.label ?? 'EC',
    [activeChannel]
  );

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold text-neutral-950 dark:text-white">
              マーケティングワークスペース
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              EC画像、SNS投稿、ブランド素材、店舗販促までをプロジェクト単位で組み立てる Lightchain 風の UI-only 作業面です。
            </p>
          </div>
          <Link to="/canvas/new" className="btn-secondary inline-flex items-center justify-center gap-2 text-sm">
            キャンバスで開く
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {channels.map((channel) => {
            const Icon = channel.icon;
            const active = channel.id === activeChannel;
            return (
              <button
                key={channel.id}
                type="button"
                onClick={() => setActiveChannel(channel.id)}
                className={`rounded-2xl border p-4 text-left transition ${
                  active
                    ? 'border-primary-300 bg-primary-50/80 text-primary-900 shadow-sm dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-100'
                    : 'border-white/60 bg-white/45 text-neutral-600 hover:bg-white/70 dark:border-white/10 dark:bg-surface-900/40 dark:text-neutral-300'
                }`}
              >
                <Icon className="h-5 w-5" />
                <p className="mt-3 text-sm font-semibold">{channel.label}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.85fr_1.25fr_0.9fr]">
        <aside className="glass-panel rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">テンプレート</h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{activeLabel} 用の制作プリセット</p>
          <div className="mt-4 space-y-2">
            {ecTemplates.map((template) => (
              <button
                key={template}
                type="button"
                onClick={() => setSelectedTemplate(template)}
                className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
                  selectedTemplate === template
                    ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                    : 'bg-white/55 text-neutral-700 hover:bg-white dark:bg-surface-900/50 dark:text-neutral-300'
                }`}
              >
                {template}
                <ChevronRight className="h-4 w-4" />
              </button>
            ))}
          </div>

          <div className="mt-6 rounded-2xl bg-surface-100 p-4 dark:bg-surface-950/70">
            <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-white">
              <BarChart3 className="h-4 w-4 text-primary-600" />
              ジョブ状態デモ
            </div>
            <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
              分析中 20% から開始し、ローカル状態で進捗が更新されます。
            </p>
            <div className="mt-4 h-2 rounded-full bg-white dark:bg-surface-800">
              <div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-gold-DEFAULT transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-xs font-semibold text-primary-700 dark:text-primary-300">分析中 {progress}%</p>
          </div>
        </aside>

        <main className="glass-panel rounded-2xl p-5">
          <div className="rounded-2xl border border-white/60 bg-white/55 p-4 dark:border-white/10 dark:bg-surface-900/45">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">
                  プロジェクト詳細エディタ
                </h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">{selectedTemplate} / 24SS Linen Launch</p>
              </div>
              <button type="button" className="btn-primary inline-flex items-center justify-center gap-2 text-sm">
                <Bot className="h-4 w-4" />
                AI提案
              </button>
            </div>

            <div className="mt-5 aspect-[4/3] rounded-2xl bg-gradient-to-br from-surface-100 via-white to-primary-50 p-5 dark:from-surface-950 dark:via-surface-900 dark:to-primary-950/30">
              <div className="grid h-full grid-cols-[0.9fr_1.1fr] gap-4">
                <div className="rounded-2xl bg-white/80 p-4 shadow-soft dark:bg-surface-900/80">
                  <p className="text-xs font-semibold uppercase tracking-widest text-primary-600 dark:text-primary-300">Main visual</p>
                  <div className="mt-4 h-36 rounded-xl bg-[linear-gradient(135deg,#f8fafc_0%,#e2e8f0_45%,#c58851_100%)] dark:bg-[linear-gradient(135deg,#18181b_0%,#27272a_55%,#8b5e34_100%)]" />
                  <p className="mt-4 text-xl font-semibold text-neutral-950 dark:text-white">Linen set for quiet summer</p>
                  <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">白背景、商品正面、余白30%。EC一覧で縮小しても素材感が残る構図。</p>
                </div>
                <div className="grid grid-rows-3 gap-3">
                  {['コピー候補', '色調整', '出力サイズ'].map((label, index) => (
                    <div key={label} className="rounded-xl border border-white/70 bg-white/65 p-3 dark:border-white/10 dark:bg-surface-900/60">
                      <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{label}</p>
                      <div className="mt-2 h-2 rounded-full bg-surface-200 dark:bg-surface-700">
                        <div className="h-full rounded-full bg-primary-500" style={{ width: `${75 - index * 16}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>

        <aside className="space-y-5">
          <section className="glass-panel rounded-2xl p-5">
            <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">マイプロジェクト</h2>
            <div className="mt-4 space-y-3">
              {projects.map((project) => (
                <button key={project.name} type="button" className="w-full rounded-2xl bg-white/55 p-4 text-left transition hover:bg-white dark:bg-surface-900/45 dark:hover:bg-surface-900/70">
                  <p className="text-sm font-semibold text-neutral-900 dark:text-white">{project.name}</p>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{project.format} / {project.updated}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="glass-panel rounded-2xl p-5">
            <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">制作アシスタント</h2>
            <div className="mt-4 space-y-3">
              {[
                { icon: Bot, label: 'AIアシスタント', text: '商品特徴から見出しとCTAを作成' },
                { icon: Layers, label: 'レイヤー設定', text: '画像、テキスト、背景、ロゴを整理' },
                { icon: Settings2, label: 'デザインアシスタント', text: '余白、色、視線誘導をチェック' },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/60 bg-white/45 p-4 dark:border-white/10 dark:bg-surface-900/45">
                  <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-white">
                    <item.icon className="h-4 w-4 text-primary-600" />
                    {item.label}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{item.text}</p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}
