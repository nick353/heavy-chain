import { ChevronLeft, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * The Light Chain "new file" destination is an empty upload canvas. Keep this
 * route separate from the richer local studio workbench so the deep link has
 * the same initial state as the production Light Chain surface.
 */
export function FashionStudioDetailPage() {
  return (
    <main
      className="dark min-h-[calc(100vh-50px)] bg-[#101010] text-white"
      data-testid="lightchain-fashion-studio-detail"
      data-lightchain-parity-shell="fashion-studio-detail"
    >
      <aside className="absolute left-4 top-[74px] z-10 w-[264px] overflow-hidden rounded-xl border border-white/10 bg-[#202426]">
        <div className="flex h-10 items-center gap-2 border-b border-white/10 px-2 text-sm text-neutral-400">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#52c9c3] text-[11px] font-bold text-neutral-950">✦</span>
          <span>ファッションスタジオ</span>
        </div>
        <Link
          to="/flow/integration"
          aria-label="ファッションスタジオへ戻る"
          className="flex h-11 items-center gap-3 px-3 text-sm text-neutral-400 transition hover:bg-white/5 hover:text-white"
        >
          <ChevronLeft className="h-5 w-5" />
          <span>Untitled</span>
        </Link>
      </aside>

      <label
        className="absolute left-1/2 top-[190.93px] flex h-[496.14px] w-[781.59px] -translate-x-1/2 cursor-pointer flex-col items-center justify-center rounded-xl bg-[#25292b] text-center transition hover:bg-[#2a2e30]"
        data-testid="fashion-studio-detail-upload"
      >
        <Upload className="h-8 w-8 text-white" />
        <span className="mt-5 text-sm text-neutral-300">ここをクリックまたはドラッグして画像を追加</span>
        <span className="mt-1 text-xs text-neutral-500">jpg、jpeg、png、webp形式の画像（最大20M）に対応</span>
        <input className="sr-only" type="file" accept=".png,.jpg,.jpeg,.avif,.webp" />
      </label>
    </main>
  );
}
