import { Children, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

/**
 * Light's デザインツール frame (生地イメージ / プリントイメージ / 線画の実写化 / 平絵生成), measured at 1440×900:
 * 80px tool rail, 596px left panel with the 564px tab strip and closable deprecation notice, and the
 * result panel with the 生成履歴 button. Mirrors the verified /tools/fabric frame in LightchainMaterialWorkbenchPage.
 */
const RAIL_ROOT = {
  label: 'ツールバー',
  to: '/designProduction?category=recommended',
  iconUrl: 'https://jp.linkaigc.com/routeIcons/ic_%E5%B7%A5%E5%85%B7.svg',
} as const;

const RAIL_ITEMS: ReadonlyArray<{ label: string; to: string; iconUrl: string }> = [
  { label: 'デザインツール', to: '/tools/fabric', iconUrl: 'https://jp.linkaigc.com/routeIcons/%E6%9C%8D%E8%A3%85%E8%AE%BE%E8%AE%A1%E5%B7%A5%E5%85%B7-%E9%80%89%E4%B8%AD.svg' },
  { label: 'フィッティングツール', to: '/model', iconUrl: 'https://jp.linkaigc.com/routeIcons/%E6%A8%A1%E7%89%B9%E8%AF%95%E8%A1%A3%E5%B7%A5%E5%85%B7-%E6%9C%AA%E9%80%89.svg' },
  { label: 'グラフィックデザインツール', to: '/tools/pattern-to-vector', iconUrl: 'https://jp.linkaigc.com/routeIcons/%E5%9B%BE%E6%A1%88%E5%88%9B%E4%BD%9C%E5%B7%A5%E5%85%B7-%E6%9C%AA%E9%80%89.svg' },
  { label: '衣類生産ツール', to: '/tools/fabric', iconUrl: 'https://jp.linkaigc.com/routeIcons/%E7%94%9F%E4%BA%A7%E5%B7%A5%E5%85%B7-%E6%9C%AA%E9%80%89.svg' },
];

export const LIGHTCHAIN_DESIGN_TOOL_TABS = [
  { id: 'fabric', label: '生地イメージ', route: '/tools/fabric' },
  { id: 'printing', label: 'プリントイメージ', route: '/tools/printing' },
  { id: 'line-draft', label: '線画の実写化', route: '/tools/line-draft-to-tile' },
  { id: 'line', label: '平絵生成', route: '/tools/line' },
] as const;

export type LightchainDesignToolTabId = typeof LIGHTCHAIN_DESIGN_TOOL_TABS[number]['id'];

export const LIGHTCHAIN_VECTOR_TOOL_TABS = [
  { id: 'pattern-vector', label: 'パターンをベクター画像に変換（通常版）', route: '/tools/pattern-to-vector' },
  { id: 'pattern-vector-pro', label: 'パターンをベクター画像に変換（プロフェッショナル版）', route: '/tools/vector-special' },
] as const;

type FrameTab = { readonly id: string; readonly label: string; readonly route: string };
/** Rail entry highlighted for the current tool group: 0 = デザインツール, 2 = グラフィックデザインツール. */
export type LightchainRailGroup = 0 | 2;

export function LightchainDesignToolRail({ locked = false, activeIndex = 0 }: { locked?: boolean; activeIndex?: LightchainRailGroup }) {
  return (
    <aside aria-label="ツールバー" className="absolute inset-y-4 left-4 hidden w-20 flex-col items-center rounded-[16px] bg-[#262a2b] px-0 py-4 lg:flex">
      <Link to={RAIL_ROOT.to} aria-disabled={locked || undefined} onClick={(event) => { if (locked) event.preventDefault(); }} className="flex flex-col items-center gap-2 self-stretch text-center text-[12px] leading-[17.1429px] text-white/90">
        <img src={RAIL_ROOT.iconUrl} alt="" className="h-14 w-14 object-contain" />
        <span>{RAIL_ROOT.label}</span>
      </Link>
      <div className="mb-2 mt-4 h-px w-10 shrink-0 bg-white/10" />
      <div className="scrollbar-hide flex h-full flex-col items-center gap-4 self-stretch overflow-scroll">
        {RAIL_ITEMS.map((item, index) => {
          const isActive = index === activeIndex;
          return (
            <Link
              key={item.label}
              to={item.to}
              aria-current={isActive ? 'page' : undefined}
              aria-disabled={locked || undefined}
              onClick={(event) => { if (locked) event.preventDefault(); }}
              className={`flex h-auto min-h-18 w-[72px] flex-col items-center justify-center rounded-lg px-2 py-1 text-center text-[12px] leading-[17.1429px] transition ${isActive ? 'bg-[#202326] text-[#65d3cf]' : 'text-white/80 hover:bg-[#202326] hover:text-white'}`}
            >
              <img src={item.iconUrl} alt="" className={`h-14 w-14 object-contain ${isActive ? '' : 'opacity-60'}`} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}

export function LightchainDesignToolFrame({ active, testId, children, workspaceAttributes, navigationLocked = false, tabs = LIGHTCHAIN_DESIGN_TOOL_TABS, railGroup = 0 }: {
  active: string;
  tabs?: ReadonlyArray<FrameTab>;
  railGroup?: LightchainRailGroup;
  /** While a generation is in flight, keep the user on this tool so its pending request can be reconciled. */
  navigationLocked?: boolean;
  testId: string;
  /** Exactly two children: the left-panel content below the deprecation notice, then the result-panel content. */
  children: [ReactNode, ReactNode];
  workspaceAttributes?: Record<string, string>;
}) {
  const navigate = useNavigate();
  const [bannerVisible, setBannerVisible] = useState(true);
  const [controls, result] = Children.toArray(children);
  return (
    <div data-testid={testId} className="relative h-[calc(100vh-50px)] min-h-0 overflow-hidden bg-[#0b1113] px-4 py-4 pl-28 text-white" {...workspaceAttributes}>
      <LightchainDesignToolRail locked={navigationLocked} activeIndex={railGroup} />
      <div className="grid h-full gap-4 lg:grid-cols-[minmax(0,596px)_minmax(360px,1fr)]">
        <section className="relative flex min-w-0 flex-col overflow-y-auto scrollbar-hide rounded-lg bg-[#171d20] p-4 shadow-2xl shadow-black/20">
          <nav className="mb-4 grid gap-0 rounded-xl border border-white/10 px-[3px] py-[1.5px]" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} aria-label="素材ツール" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => navigate(tab.route)}
                disabled={navigationLocked}
                role="tab"
                aria-selected={tab.id === active}
                className={`min-h-[31px] overflow-hidden whitespace-nowrap rounded-lg px-2 py-1 text-xs font-semibold transition sm:px-3 sm:text-sm ${tab.id === active
                  ? 'bg-[#737d84] text-white shadow-lg shadow-black/20'
                  : 'text-white/45 hover:bg-white/[0.06] hover:text-white/80'}`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          {bannerVisible && (
            <div data-testid="lightchain-design-tool-deprecation-banner" className="flex rounded-lg bg-[#5b1f2a] px-4 py-2 text-sm leading-6 text-white">
              <span className="flex-1">
                この機能はまもなく終了します。より高機能な画像生成機能はデザイン制作ワークスペースでご利用ください
                <Link to="/designProduction" className="ml-7 underline text-primary hover:opacity-80" target="_blank">今すぐ体験</Link>
              </span>
              <button type="button" aria-label="閉じる" onClick={() => setBannerVisible(false)} className="ml-3 self-start px-1 text-white/70 hover:text-white">×</button>
            </div>
          )}
          {controls}
        </section>
        <aside className="relative min-w-0 overflow-hidden rounded-none bg-[#232728] shadow-2xl shadow-black/20">
          <button
            type="button"
            onClick={() => navigate('/history')}
            disabled={navigationLocked}
            className="absolute right-4 top-4 z-10 inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-white/15 bg-[#171b1c]/80 px-2.5 text-sm font-medium text-white/80 shadow-xs backdrop-blur-sm transition hover:bg-white/[0.08]"
          >
            生成履歴
          </button>
          {result}
        </aside>
      </div>
    </div>
  );
}

/** Light's centered empty state for the result panel: title, one-line description and the looping demo video. */
export function LightchainDesignToolEmptyState({ title, description, videoUrl, videoTestId }: { title: string; description: string; videoUrl: string; videoTestId?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-0 px-14 text-center">
      <h5 className="text-[20px] font-bold leading-[25.2px] text-white">{title}</h5>
      <p className="mt-2 max-w-[28rem] text-sm leading-[21px] text-neutral-400">{description}</p>
      <video data-testid={videoTestId} className="mt-4 h-[340px] w-full" src={videoUrl} autoPlay controls muted playsInline loop />
    </div>
  );
}
