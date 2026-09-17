import { ChevronLeft, ImageIcon, Layers, Search, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

/**
 * Light Chain uses the same deep-link for a new file and an existing project,
 * but the existing-project state exposes the image-search workbench. Keep the
 * empty upload canvas for the new-file URL and render the observed project
 * shell when a board project code is present.
 */
export function FashionStudioDetailPage() {
  const [searchParams] = useSearchParams();
  const [activeInput, setActiveInput] = useState<'text' | 'reference'>('text');
  const [prompt, setPrompt] = useState('メイン画像のブルーの壁紙を参考画像の平面で見せて');
  const [notice, setNotice] = useState('');
  const hasProject = Boolean(searchParams.get('boardProjectCode'));

  if (hasProject) {
    return (
      <main className="dark relative min-h-[calc(100vh-50px)] overflow-hidden bg-[#181a1d] text-white" data-testid="lightchain-fashion-studio-project-detail" data-lightchain-parity-shell="fashion-studio-project-detail">
        <div className="pointer-events-none absolute inset-0 opacity-70" style={{ backgroundImage: 'radial-gradient(#464b50 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
        <header className="relative z-20 flex h-14 items-center justify-between border-b border-white/10 bg-[#171a1b]/95 px-4">
          <div className="flex min-w-0 items-center gap-3"><Link to="/flow/integration" aria-label="ファッションスタジオへ戻る" className="text-neutral-400 hover:text-white"><ChevronLeft className="h-5 w-5" /></Link><span className="truncate text-sm text-neutral-300">ファッションスタジオ</span><span className="text-sm text-neutral-100">Untitled</span></div>
          <div className="flex items-center gap-3 text-xs text-neutral-300"><span>✦ 375791</span><button type="button" className="rounded-md border border-white/10 px-3 py-1.5">アセット</button></div>
        </header>
        <div className="relative z-10 min-h-[calc(100vh-106px)] overflow-auto">
          <aside className="absolute left-4 top-5 z-10 w-[264px] overflow-hidden rounded-xl border border-white/10 bg-[#202426]/95 shadow-xl"><div className="flex h-10 items-center gap-2 border-b border-white/10 px-2 text-sm text-neutral-400"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#52c9c3] text-[11px] font-bold text-neutral-950">✦</span><span>ファッションスタジオ</span></div><div className="flex h-11 items-center gap-3 px-3 text-sm text-neutral-300"><span>Untitled</span><span className="ml-auto text-xs text-neutral-500">30%</span></div></aside>
          <aside className="absolute left-4 top-[180px] z-10 flex flex-col gap-2 rounded-xl border border-white/10 bg-[#202426]/95 p-2 shadow-xl" aria-label="プロジェクトツール">{[Layers, ImageIcon, Search, Upload].map((Icon, index) => <button key={index} type="button" aria-label={`ツール${index + 1}`} className="flex h-9 w-9 items-center justify-center rounded-md text-neutral-400 hover:bg-white/10 hover:text-white"><Icon className="h-4 w-4" /></button>)}</aside>
          <section className="mx-auto min-w-[760px] max-w-[1500px] px-[310px] pb-32 pt-8" data-testid="lightchain-fashion-studio-canvas">
            <div className="flex items-center justify-between text-xs text-neutral-400"><span>タスク <strong className="ml-2 text-neutral-200">0</strong></span><span>進行中</span></div>
            <div className="relative mt-5 min-h-[520px] rounded-2xl border border-white/10 bg-[#202426]/35">
              <div className="absolute left-[14%] top-[16%] w-44 overflow-hidden rounded-xl border border-white/15 bg-[#252a2b] shadow-xl"><div className="h-28 bg-gradient-to-br from-sky-300 via-blue-500 to-indigo-900" /><p className="px-3 py-2 text-xs text-neutral-300">メイン画像</p></div>
              <div className="absolute right-[16%] top-[24%] w-44 overflow-hidden rounded-xl border border-white/15 bg-[#252a2b] shadow-xl"><div className="h-28 bg-gradient-to-br from-amber-100 via-orange-300 to-rose-500" /><p className="px-3 py-2 text-xs text-neutral-300">参考画像</p></div>
              <div className="absolute left-[38%] top-[57%] w-52 overflow-hidden rounded-xl border border-cyan-200/30 bg-[#252a2b] shadow-xl"><div className="h-32 bg-gradient-to-br from-neutral-100 via-cyan-100 to-slate-400" /><p className="px-3 py-2 text-xs text-neutral-300">生成結果</p></div>
              <div className="pointer-events-none absolute left-[29%] top-[30%] h-px w-[38%] rotate-[18deg] bg-cyan-200/60" /><div className="pointer-events-none absolute left-[50%] top-[45%] h-px w-[20%] -rotate-[22deg] bg-cyan-200/60" />
            </div>
          </section>
          <section className="absolute bottom-5 left-5 z-20 w-[min(390px,calc(100vw-40px))] rounded-xl border border-white/10 bg-[#202426]/95 p-3 shadow-2xl" data-testid="lightchain-fashion-studio-generation-panel">
            <div className="flex items-center justify-between"><div className="flex gap-1"><button type="button" onClick={() => setActiveInput('text')} className={`rounded-md px-3 py-1.5 text-xs ${activeInput === 'text' ? 'bg-cyan-300 text-neutral-950' : 'bg-white/5 text-neutral-400'}`}>テキストで生成</button><button type="button" onClick={() => setActiveInput('reference')} className={`rounded-md px-3 py-1.5 text-xs ${activeInput === 'reference' ? 'bg-cyan-300 text-neutral-950' : 'bg-white/5 text-neutral-400'}`}>参考画像</button></div><span className="text-xs text-neutral-500">画像検索</span></div>
            <div className="mt-3 grid grid-cols-2 gap-2"><div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-white/15 text-xs text-neutral-500"><ImageIcon className="mr-2 h-4 w-4" />メイン画像</div><div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-white/15 text-xs text-neutral-500"><Upload className="mr-2 h-4 w-4" />参考画像</div></div>
            <label className="mt-3 block text-xs font-semibold text-neutral-400" htmlFor="fashion-studio-detail-prompt">指示テキスト *</label><textarea id="fashion-studio-detail-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} className="mt-2 min-h-20 w-full resize-y rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white outline-none focus:border-cyan-300/60" aria-label="指令を入力してください。" />
            <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500"><span>文字数：{prompt.length}/2000</span><button type="button" onClick={() => setPrompt('')} className="rounded-md px-2 py-1 text-neutral-400 hover:bg-white/10 hover:text-white">全削除</button></div><div className="mt-2 flex gap-2"><select id="fashion-studio-generation-mode" aria-label="生成設定" className="flex-1 rounded-md border border-white/10 bg-[#15191a] px-2 py-2 text-xs text-neutral-300"><option>自動</option></select><select id="fashion-studio-generation-quality" aria-label="画像品質" className="flex-1 rounded-md border border-white/10 bg-[#15191a] px-2 py-2 text-xs text-neutral-300"><option>1K</option></select><button type="button" onClick={() => setNotice('入力内容を保持しました。外部生成は権利確認後に実行できます。')} className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-neutral-950">AI生成 <span className="ml-1 text-xs">80</span></button></div>{notice && <p className="mt-2 text-xs text-cyan-200" role="status">{notice}</p>}
          </section>
          <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 gap-1 rounded-lg border border-white/10 bg-[#202426]/95 p-2" data-testid="lightchain-fashion-studio-canvas-toolbar"><button type="button" aria-label="選択" className="rounded px-3 py-1 text-xs text-neutral-300 hover:bg-white/10">選択</button><button type="button" aria-label="元に戻す" className="rounded px-3 py-1 text-xs text-neutral-300 hover:bg-white/10">戻す</button><button type="button" aria-label="やり直す" className="rounded px-3 py-1 text-xs text-neutral-300 hover:bg-white/10">進む</button></div>
          <div className="absolute bottom-6 right-5 z-20 flex items-center gap-2 rounded-lg border border-white/10 bg-[#202426]/95 p-2 text-xs text-neutral-300" data-testid="lightchain-fashion-studio-zoom-controls"><button type="button" aria-label="ズームアウト">−</button><span>100%</span><button type="button" aria-label="ズームイン">＋</button></div>
        </div>
      </main>
    );
  }

  return (
    <main className="dark min-h-[calc(100vh-50px)] bg-[#101010] text-white" data-testid="lightchain-fashion-studio-detail" data-lightchain-parity-shell="fashion-studio-detail">
      <aside className="absolute left-4 top-[74px] z-10 w-[264px] overflow-hidden rounded-xl border border-white/10 bg-[#202426]"><div className="flex h-10 items-center gap-2 border-b border-white/10 px-2 text-sm text-neutral-400"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#52c9c3] text-[11px] font-bold text-neutral-950">✦</span><span>ファッションスタジオ</span></div><Link to="/flow/integration" aria-label="ファッションスタジオへ戻る" className="flex h-11 items-center gap-3 px-3 text-sm text-neutral-400 transition hover:bg-white/5 hover:text-white"><ChevronLeft className="h-5 w-5" /><span>Untitled</span></Link></aside>
      <label className="absolute left-1/2 top-[190.93px] flex h-[496.14px] w-[781.59px] -translate-x-1/2 cursor-pointer flex-col items-center justify-center rounded-xl bg-[#25292b] text-center transition hover:bg-[#2a2e30]" data-testid="fashion-studio-detail-upload"><Upload className="h-8 w-8 text-white" /><p className="relative top-[8px] mt-5 text-sm leading-[21px] text-neutral-300">ここをクリックまたはドラッグして画像を追加</p><p className="relative top-[8px] mt-1 text-xs leading-[17.14px] text-neutral-500">jpg、jpeg、png、webp形式の画像（最大20M）に対応</p><input className="sr-only" type="file" accept=".png,.jpg,.jpeg,.avif,.webp" /></label>
    </main>
  );
}
