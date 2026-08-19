import { Link } from 'react-router-dom';
import { ChevronDown, Globe2, HelpCircle } from 'lucide-react';

export function Header() {
  return (
    <header className="w-full border-b border-white/10 bg-[#05090b]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[70px] max-w-[1800px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" aria-label="Lightchain AI" className="flex items-center gap-2 text-sm font-semibold tracking-[0.24em] text-white">
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/80 bg-white text-[11px] font-black tracking-normal text-neutral-950">◌</span>
          LIGHTCHAIN
        </Link>

        <div className="flex items-center gap-1 text-sm text-neutral-300 sm:gap-2">
          <button type="button" aria-label="日本語" className="hidden items-center gap-1 rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white sm:inline-flex">
            <Globe2 className="h-4 w-4" />
            日本語
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="ヘルプセンター" className="hidden items-center gap-2 rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white sm:inline-flex">
            <HelpCircle className="h-4 w-4" />
            ヘルプセンター
          </button>
          <Link to="/login" className="rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white">
            ログイン
          </Link>
          <Link to="/signup" className="rounded-full bg-cyan-300 px-3 py-2 font-semibold text-neutral-950 transition hover:bg-cyan-200 sm:px-4">
            無料で始める
          </Link>
        </div>
      </div>
    </header>
  );
}
