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
      <main className="dark min-h-screen bg-[#101010] text-white" data-testid="lightchain-fashion-studio-project-detail" data-lightchain-parity-shell="fashion-studio-project-detail">
        <header className="flex h-14 items-center justify-between border-b border-white/10 bg-[#171a1b] px-5">
          <div className="flex items-center gap-4">
            <Link to="/flow/integration" aria-label="ファッションスタジオへ戻る" className="text-neutral-400 hover:text-white"><ChevronLeft className="h-5 w-5" /></Link>
            <span className="text-sm text-neutral-400">ファッションスタジオ</span>
            <span className="text-sm text-neutral-200">Untitled</span>
          </div>
          <button type="button" className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-neutral-300">アセット</button>
        </header>
        <div className="flex min-h-[calc(100vh-56px)]">
          <aside className="hidden w-16 shrink-0 flex-col items-center gap-3 border-r border-white/10 bg-[#171a1b] py-5 lg:flex" aria-label="プロジェクトツール">
            {[Layers, ImageIcon, Search, Upload].map((Icon, index) => <button key={index} type="button" aria-label={`ツール${index + 1}`} className="flex h-9 w-9 items-center justify-center rounded-md text-neutral-500 hover:bg-white/10 hover:text-white"><Icon className="h-4 w-4" /></button>)}
          </aside>
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-12 items-center justify-between border-b border-white/10 px-5 text-xs text-neutral-400"><span>タスク <strong className="ml-2 text-neutral-200">0</strong></span><div className="flex items-center gap-4"><span>進行中</span><span className="rounded-md border border-white/10 px-2 py-1">30%</span><span>✦ 375791</span></div></div>
            <div className="flex flex-1 items-start justify-center px-5 py-8">
              <div className="w-full max-w-[860px] rounded-2xl border border-white/10 bg-[#1b1f20] p-6 shadow-2xl">
                <div className="flex items-center gap-3"><Search className="h-5 w-5 text-cyan-200" /><h3 className="text-lg font-semibold">画像検索</h3></div>
                <p className="mt-2 text-sm text-neutral-400">指令と参考画像を使ってワンクリック生成</p>
                <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr_1.1fr]">
                  <div className="rounded-xl border border-white/10 bg-[#252a2b] p-4"><p className="text-xs font-semibold text-neutral-400">メイン画像</p><div className="mt-3 flex h-52 items-center justify-center rounded-lg border border-dashed border-white/15 text-neutral-500"><ImageIcon className="h-8 w-8" /></div></div>
                  <div className="rounded-xl border border-white/10 bg-[#252a2b] p-4"><p className="text-xs font-semibold text-neutral-400">参考画像</p><div className="mt-3 flex h-52 items-center justify-center rounded-lg border border-dashed border-white/15 text-neutral-500"><Upload className="h-8 w-8" /></div></div>
                  <div className="rounded-xl border border-white/10 bg-[#252a2b] p-4">
                    <div className="flex gap-2"><button type="button" onClick={() => setActiveInput('text')} className={`rounded-md px-3 py-1.5 text-xs ${activeInput === 'text' ? 'bg-cyan-300 text-neutral-950' : 'bg-white/5 text-neutral-400'}`}>テキストで生成</button><button type="button" onClick={() => setActiveInput('reference')} className={`rounded-md px-3 py-1.5 text-xs ${activeInput === 'reference' ? 'bg-cyan-300 text-neutral-950' : 'bg-white/5 text-neutral-400'}`}>参考画像</button></div>
                    <label className="mt-4 block text-xs font-semibold text-neutral-400" htmlFor="fashion-studio-detail-prompt">指示テキスト *</label>
                    <textarea id="fashion-studio-detail-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} className="mt-2 min-h-28 w-full resize-y rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white outline-none focus:border-cyan-300/60" aria-label="指令を入力してください。" />
                    <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500"><span>文字数：{prompt.length}/2000</span><button type="button" onClick={() => setPrompt('')} className="rounded-md px-2 py-1 text-neutral-400 hover:bg-white/10 hover:text-white">全削除</button></div>
                    <div className="mt-3 flex gap-2"><label className="sr-only" htmlFor="fashion-studio-generation-mode">生成設定</label><select id="fashion-studio-generation-mode" aria-label="生成設定" className="flex-1 rounded-md border border-white/10 bg-[#15191a] px-2 py-2 text-xs text-neutral-300"><option>自動</option></select><label className="sr-only" htmlFor="fashion-studio-generation-quality">画像品質</label><select id="fashion-studio-generation-quality" aria-label="画像品質" className="flex-1 rounded-md border border-white/10 bg-[#15191a] px-2 py-2 text-xs text-neutral-300"><option>1K</option></select></div>
                    <button type="button" onClick={() => setNotice('入力内容を保持しました。外部生成は権利確認後に実行できます。')} className="mt-4 w-full rounded-lg bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-neutral-950">AI生成 <span className="ml-1 text-xs">80</span></button>
                    {notice && <p className="mt-3 text-xs text-cyan-200" role="status">{notice}</p>}
                  </div>
                </div>
                <div className="mt-6 flex h-32 items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/10 text-sm text-neutral-500">生成結果</div>
              </div>
            </div>
          </section>
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
