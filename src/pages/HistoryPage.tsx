import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Clipboard, ExternalLink, Image, Sparkles } from 'lucide-react';

const historyItems = [
  {
    id: 'h-301',
    day: '今日',
    title: 'AIフィッティング / Linen shirt',
    prompt: 'Natural light, Japanese EC model, linen shirt, clean studio background',
    outputs: 4,
    route: '/fitting',
  },
  {
    id: 'h-299',
    day: '昨日',
    title: 'EC メイン画像 / 白背景',
    prompt: 'White background product photography, centered apparel, premium catalog layout',
    outputs: 8,
    route: '/marketing',
  },
  {
    id: 'h-292',
    day: '5日前',
    title: 'SNS プロモーション素材',
    prompt: 'Instagram campaign image, quiet luxury, warm daylight, minimal typography',
    outputs: 6,
    route: '/canvas/new',
  },
  {
    id: 'h-281',
    day: '13日前',
    title: 'モデルセット写真 / 3ポーズ',
    prompt: 'Three model poses, consistent garment, editorial but ecommerce ready',
    outputs: 3,
    route: '/gallery',
  },
];

export function HistoryPage() {
  const [expandedId, setExpandedId] = useState(historyItems[0].id);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (id: string, prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1400);
    } catch {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1400);
    }
  };

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold text-neutral-950 dark:text-white">
              生成履歴
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              過去14日の生成、プロンプト、派生先をタイムラインで確認します。ここではローカルのデモ履歴のみを表示します。
            </p>
          </div>
          <Link to="/gallery" className="btn-secondary inline-flex items-center justify-center gap-2 text-sm">
            ギャラリーへ
            <ExternalLink className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[0.25fr_1fr]">
          <aside className="rounded-2xl bg-white/50 p-4 dark:bg-surface-900/45">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary-600 dark:text-primary-300">Range</p>
            <p className="mt-2 text-2xl font-semibold text-neutral-950 dark:text-white">過去14日</p>
            <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
              フィッティング、マーケティング、キャンバス編集への展開元をまとめて追跡します。
            </p>
          </aside>

          <div className="space-y-3">
            {historyItems.map((item, index) => {
              const expanded = expandedId === item.id;
              return (
                <article key={item.id} className="relative rounded-2xl border border-white/60 bg-white/55 p-4 dark:border-white/10 dark:bg-surface-900/45">
                  <div className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-300">
                        {index === 0 ? <Sparkles className="h-5 w-5" /> : <Image className="h-5 w-5" />}
                      </div>
                      {index < historyItems.length - 1 && <div className="mt-3 h-full min-h-12 w-px bg-neutral-200 dark:bg-surface-700" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? '' : item.id)}
                        className="flex w-full items-start justify-between gap-3 text-left"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-primary-700 dark:text-primary-300">{item.day}</p>
                          <h2 className="mt-1 truncate text-base font-semibold text-neutral-950 dark:text-white">{item.title}</h2>
                          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{item.outputs} outputs</p>
                        </div>
                        <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-neutral-400 transition ${expanded ? 'rotate-180' : ''}`} />
                      </button>

                      {expanded && (
                        <div className="mt-4 rounded-2xl bg-surface-50 p-4 dark:bg-surface-950/65">
                          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">Prompt</p>
                          <p className="mt-2 text-sm leading-6 text-neutral-700 dark:text-neutral-200">{item.prompt}</p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void handleCopy(item.id, item.prompt)}
                              className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:text-primary-700 dark:bg-surface-900 dark:text-neutral-200"
                            >
                              <Clipboard className="h-3.5 w-3.5" />
                              {copiedId === item.id ? 'コピー済み' : 'プロンプトコピー'}
                            </button>
                            <Link to={item.route} className="inline-flex items-center gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-700 dark:bg-white dark:text-neutral-950">
                              展開
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                            <Link to="/gallery" className="inline-flex items-center gap-2 rounded-lg bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-700 transition hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-200">
                              ギャラリーリンク
                            </Link>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
