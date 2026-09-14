import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImagePlus } from 'lucide-react';

export function PatternDesignDetailPage() {
  const navigate = useNavigate();
  const [fileName, setFileName] = useState('');

  return (
    <main className="dark min-h-[calc(100vh-50px)] bg-[#101010] px-4 py-6 text-white sm:px-8" data-testid="lightchain-pattern-detail">
      <section className="mx-auto max-w-[960px]">
        <div className="flex items-center gap-4 border-b border-white/10 pb-4">
          <ImagePlus className="h-6 w-6 text-cyan-300" />
          <span className="text-base font-semibold">デザインアレンジ</span>
          <span className="text-sm text-neutral-400">Untitled</span>
        </div>
        <label className="mt-10 flex min-h-[420px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-[#171c1f] text-center transition hover:border-cyan-300/60" data-testid="lightchain-pattern-upload-dropzone">
          <ImagePlus className="h-12 w-12 text-cyan-300/70" />
          <span className="mt-5 text-base font-semibold">ここをクリックまたはドラッグして画像を追加</span>
          <span className="mt-3 text-sm text-neutral-400">jpg、jpeg、png、webp形式の画像（最大20M）に対応</span>
          <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')} />
          {fileName && <span className="mt-5 rounded-lg bg-white/[0.08] px-4 py-2 text-sm text-cyan-200">選択中: {fileName}</span>}
        </label>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" className="rounded-lg border border-white/10 px-4 py-2 text-sm text-neutral-300" onClick={() => navigate('/editor/pattern')}>一覧へ戻る</button>
          <button type="button" disabled={!fileName} className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => navigate('/patterns/workbench')}>作業台へ進む</button>
        </div>
      </section>
    </main>
  );
}
