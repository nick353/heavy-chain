import { ChevronDown, Globe2, HelpCircle, Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';

const LIGHTCHAIN_AVATAR_URL = 'https://ql-hangzhou-oss.oss-cn-hangzhou.aliyuncs.com/AIDesign/saas-avatar-new.png?x-oss-process=image/resize,m_lfit,w_64,limit_1/format,webp';

/** The public launcher header observed on the current Lightchain home. */
export function LightchainLauncherHeader() {
  return (
    <header className="w-full border-b border-white/10 bg-[#05090b]/90 backdrop-blur-xl">
      <div className="flex h-[50px] w-full items-center justify-between px-5 sm:px-6 lg:px-6">
        <div className="flex items-center gap-5">
          <Link to="/" aria-label="Lightchain AI" className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.2em] text-white">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-neutral-950">
              <Link2 className="h-4 w-4" strokeWidth={2.5} />
            </span>
            LIGHTCHAIN
          </Link>
          <button type="button" aria-label="日本語" className="inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-xs text-neutral-300 transition hover:bg-white/10 hover:text-white">
            <Globe2 className="h-3.5 w-3.5" />
            日本語
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>

        <div className="flex items-center gap-4 text-xs text-neutral-300">
          <button type="button" aria-label="ヘルプセンター" className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 transition hover:bg-white/10 hover:text-white">
            <HelpCircle className="h-3.5 w-3.5" />
            ヘルプセンター
          </button>
          <button type="button" aria-label="avatar" className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-white/10 transition hover:bg-white/15">
            <img src={LIGHTCHAIN_AVATAR_URL} alt="avatar" className="h-full w-full object-cover" />
          </button>
        </div>
      </div>
    </header>
  );
}
