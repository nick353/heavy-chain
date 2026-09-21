import { useState, type ChangeEvent } from 'react';
import { ChevronLeft, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Light Chain's laboratory detail route is intentionally a minimal empty
 * canvas. Keep it separate from the richer local LabPage so the canonical
 * deep-link has the same first state as the source site.
 */
export function LightchainLabDetailPage() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageUrl(URL.createObjectURL(file));
  };

  return (
    <main
      className="dark min-h-[calc(100vh-50px)] overflow-hidden bg-[#181a1d] text-white"
      data-testid="lightchain-lab-detail"
      data-lightchain-parity-shell="lab-detail"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{ backgroundImage: 'radial-gradient(#464b50 1px, transparent 1px)', backgroundSize: '18px 18px' }}
      />
      <aside className="absolute left-4 top-[74px] z-10 w-[264px] overflow-hidden rounded-xl border border-white/10 bg-[#202426] shadow-xl">
        <div className="flex h-10 items-center gap-2 border-b border-white/10 px-2 text-sm text-neutral-400">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-violet-400 via-indigo-500 to-cyan-300 text-[11px] font-bold text-neutral-950">✦</span>
          <span>Lightchain Lab</span>
        </div>
        <Link
          to="/flow/laboratory"
          aria-label="Lightchain Labへ戻る"
          className="flex h-11 items-center gap-3 px-3 text-sm text-neutral-400 transition hover:bg-white/5 hover:text-white"
        >
          <ChevronLeft className="h-5 w-5" />
          <span>Untitled</span>
        </Link>
      </aside>
      <label
        className="absolute left-1/2 top-[190.93px] flex h-[496.14px] w-[min(781.59px,calc(100vw-40px))] -translate-x-1/2 cursor-pointer flex-col items-center justify-center rounded-xl bg-[#25292b] text-center transition hover:bg-[#2a2e30]"
        data-testid="lightchain-lab-detail-upload"
      >
        {imageUrl ? (
          <img src={imageUrl} alt="アップロードしたラボ素材" className="h-full w-full rounded-xl object-contain" />
        ) : (
          <>
            <Upload className="h-8 w-8 text-white" />
            <p className="relative top-[8px] mt-5 text-sm leading-[21px] text-neutral-300">ここをクリックまたはドラッグして画像を追加</p>
            <p className="relative top-[8px] mt-1 text-xs leading-[17.14px] text-neutral-500">jpg、jpeg、png、webp形式の画像（最大20M）に対応</p>
          </>
        )}
        <input className="sr-only" type="file" accept=".png,.jpg,.jpeg,.avif,.webp" onChange={handleFileChange} />
      </label>
    </main>
  );
}
