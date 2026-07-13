import { Link } from 'react-router-dom';
import { ArrowRight, ImagePlus, Palette, Shirt, Sparkles, WandSparkles } from 'lucide-react';
import { lightchainCategories, lightchainFeatureCatalog } from '../lib/lightchainParityCatalog';

const heroCards = [
  {
    title: 'マーケティングワークスペース',
    description: '商品画像から販促までまとめて作成。',
    image: 'https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&w=640&q=80',
  },
  {
    title: 'AIフィッティング',
    description: '服、モデル、背景を選んで着用画像を作成。',
    image: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=640&q=80',
  },
  {
    title: 'グラフィックツール',
    description: '柄、ロゴ、配置、編集までまとめる。',
    image: 'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?auto=format&fit=crop&w=640&q=80',
  },
];

const icons = [Sparkles, WandSparkles, Shirt, Palette];

export function LandingPage() {
  return (
    <main className="min-h-screen bg-[#05090b] text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#05090b]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[70px] max-w-[1800px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="text-sm font-semibold tracking-[0.32em] text-white">
            HEAVYCHAIN
          </Link>
          <nav className="hidden items-center gap-2 md:flex">
            {lightchainCategories.map((category) => (
              <a key={category.id} href={`#${category.id}`} className="rounded-full px-3 py-2 text-sm text-neutral-300 transition hover:bg-white/10 hover:text-white">
                {category.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login" className="rounded-full px-4 py-2 text-sm font-semibold text-neutral-300 transition hover:bg-white/10 hover:text-white">
              ログイン
            </Link>
            <Link to="/signup" className="rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-200">
              開始
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-70px)] max-w-[1800px] items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)] lg:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">APPAREL AI DESIGN WORKSPACE</p>
          <h1 className="mt-5 max-w-5xl text-5xl font-semibold leading-none tracking-normal sm:text-7xl lg:text-8xl">
            HEAVY CHAIN AI
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-neutral-400">
            生成、着用、柄、編集をまとめるアパレル向けワークスペース。
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/lightchain"
              className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-full bg-cyan-300 px-7 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-200"
            >
              生成を始める
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/login"
              className="inline-flex min-h-[54px] items-center justify-center rounded-full border border-white/15 px-7 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              ログイン
            </Link>
          </div>
        </div>

        <div className="rounded-[32px] border border-white/10 bg-[#0f1416] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.45)]">
          <div className="rounded-[24px] border border-white/10 bg-black/60 p-5">
            <div className="flex items-center gap-3 rounded-full border border-cyan-300/60 px-4 py-3">
              <Sparkles className="h-5 w-5 text-cyan-300" />
              <span className="text-sm text-neutral-300">指示を入力してください... 例: 黒のチェーン柄フーディー</span>
            </div>
            <div className="mt-6 flex gap-2 overflow-x-auto rounded-xl border border-white/10 bg-white/5 p-1">
              {lightchainCategories.map((category, index) => {
                const Icon = icons[index] ?? Sparkles;
                return (
                  <span key={category.id} className={`flex shrink-0 items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold ${index === 0 ? 'bg-cyan-300 text-neutral-950' : 'text-neutral-300'}`}>
                    <Icon className="h-4 w-4" />
                    {category.label}
                  </span>
                );
              })}
            </div>
            <div className="mt-6 grid gap-3 lg:grid-cols-3">
              {heroCards.map((card) => (
                <article key={card.title} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                  <img src={card.image} alt="" className="h-36 w-full object-cover" />
                  <div className="p-4">
                    <h2 className="text-sm font-semibold">{card.title}</h2>
                    <p className="mt-2 text-xs leading-5 text-neutral-400">{card.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1800px] px-4 pb-16 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-4">
          {lightchainCategories.map((category, index) => {
            const Icon = icons[index] ?? ImagePlus;
            const count = lightchainFeatureCatalog.filter((feature) => feature.category === category.id).length;
            return (
              <section id={category.id} key={category.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <Icon className="h-6 w-6 text-cyan-300" />
                <h2 className="mt-4 text-lg font-semibold">{category.label}</h2>
                <p className="mt-2 min-h-[72px] text-sm leading-6 text-neutral-400">{category.description}</p>
                <p className="mt-4 text-xs font-semibold text-neutral-500">{count} tools</p>
              </section>
            );
          })}
        </div>
      </section>

      <footer className="border-t border-white/10 px-4 py-8 text-center text-sm text-neutral-500">
        Heavy Chain AI
      </footer>
    </main>
  );
}
