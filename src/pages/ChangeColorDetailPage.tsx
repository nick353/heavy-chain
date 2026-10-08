import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ChevronLeft, Download, Hand, ImagePlus, Info, MousePointer2, Pipette, Redo2, RotateCcw, SlidersHorizontal, Sparkles, Undo2 } from 'lucide-react';
import { useCanonicalImageWorkspace } from '../hooks/useCanonicalImageWorkspace';
import { useHeavyWorkspaceBrandGate } from '../hooks/useHeavyWorkspaceBrandGate';
import { withSignedImageUrls } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';
import { ZoomControl } from './PatternDesignDetailPage';
import { watermarkImageBlobIfOn } from '../lib/imageDownload';

/**
 * Light `/editor/changeColor/detail` = "色変更", measured at 1440×900 on 2026-10-07: first visit shows the
 * ガイドを見る / ガイドを表示しない chooser; empty project → project card + drop zone; with an image → 320px panel:
 * 現在の操作画像, 色の置き換え* ⓘ + リセット, colour row (swatch, 170×32 「未設定」 input, eyedropper), 色変更エリア*
 * (「色を変更する領域を入力してください（例：ネックライン）」), 生成画像の比率 (自動), 288×40 run button; canvas toolbar
 * and a per-image 色調整 / save / download toolbar. Light shows 権限がありません; Heavy runs the recolour.
 */
export const CHANGE_COLOR_RATIOS = ['自動', '1:1', '4:3', '3:4', '16:9', '9:16'] as const;
const GUIDE_KEY = 'heavy.changeColor.guideChoice';
const ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
const HEX = /^#[0-9a-f]{6}$/i;

export function changeColorBrief({ color, area, ratio }: { color: string; area: string; ratio: string }): string {
  return [
    `色変更: 画像の「${area.trim()}」の部分だけを、色 ${color.trim()} に変更してください。`,
    '素材感・柄・陰影・しわ・ハイライトは元のまま保ち、色相だけを自然に置き換えてください。指定した部分以外の色・形・背景・構図は一切変えないでください。',
    ratio !== '自動' ? `出力の縦横比は ${ratio} にしてください。` : '',
  ].filter(Boolean).join('\n');
}

export function ChangeColorDetailPage() {
  const { user, currentBrand } = useAuthStore();
  return <ChangeColorWorkspace key={JSON.stringify([currentBrand?.id, user?.id])} />;
}

function readGuideChoice(): 'shown' | 'hidden' | null {
  try { const value = window.localStorage.getItem(GUIDE_KEY); return value === 'shown' || value === 'hidden' ? value : null; } catch { return null; }
}

function ChangeColorWorkspace() {
  const navigate = useNavigate();
  const workspace = useCanonicalImageWorkspace('change-color', { requiredSources: 1, title: '色変更', initialInputState: { colorTarget: '', colorArea: '', colorRatio: '自動' } });
  const heavyBrand = useHeavyWorkspaceBrandGate();
  const [guide, setGuide] = useState<'shown' | 'hidden' | null>(readGuideChoice);
  const [guideStep, setGuideStep] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | 'drag'>('select');
  const [selected, setSelected] = useState<'source' | 'result' | null>('source');
  const [showResult, setShowResult] = useState(true);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const [tone, setTone] = useState({ brightness: 100, contrast: 100, saturate: 100 });
  const [toneOpen, setToneOpen] = useState(false);
  const sourceRef = useRef<HTMLImageElement | null>(null);
  const locked = heavyBrand.pending || workspace.status === 'running' || workspace.status === 'loading' || Boolean(workspace.pendingId);
  const source = workspace.slots.primary;
  const input = workspace.inputState;
  const color = typeof input.colorTarget === 'string' ? input.colorTarget : '';
  const area = typeof input.colorArea === 'string' ? input.colorArea : '';
  const ratio = typeof input.colorRatio === 'string' && (CHANGE_COLOR_RATIOS as readonly string[]).includes(input.colorRatio) ? input.colorRatio : '自動';
  const canGenerate = Boolean(source) && !locked && color.trim().length > 0 && area.trim().length > 0;

  useEffect(() => {
    const result = workspace.result;
    let cancelled = false;
    if (!result) { setResultUrl(null); return; }
    if (result.imageUrl) { setResultUrl(result.imageUrl); return; }
    if (!result.storagePath) { setResultUrl(null); return; }
    void withSignedImageUrls([{ storage_path: result.storagePath, image_url: '' }])
      .then(([signed]) => { if (!cancelled) setResultUrl(signed?.image_url || null); })
      .catch(() => { if (!cancelled) setResultUrl(null); });
    return () => { cancelled = true; };
  }, [workspace.result]);
  useEffect(() => { if (resultUrl) { setShowResult(true); setSelected('result'); } }, [resultUrl]);

  const update = (patch: Record<string, string>) => workspace.setInputState({ colorTarget: color, colorArea: area, colorRatio: ratio, ...patch });
  const chooseGuide = (choice: 'shown' | 'hidden') => {
    try { window.localStorage.setItem(GUIDE_KEY, choice); } catch { /* the choice still applies to this visit */ }
    setGuide(choice);
    setGuideStep(choice === 'shown' ? 1 : 0);
  };
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || file.size > 20 * 1024 * 1024) return;
    void workspace.upload('primary', file);
  };
  /** スポイト: the browser EyeDropper when available, otherwise sample the clicked pixel of the source image. */
  const startEyedropper = async () => {
    const Dropper = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (Dropper) {
      try { const { sRGBHex } = await new Dropper().open(); update({ colorTarget: sRGBHex }); } catch { /* cancelled */ }
      return;
    }
    setPicking(true);
  };
  const samplePixel = (event: PointerEvent<HTMLImageElement>) => {
    const image = sourceRef.current;
    if (!picking || !image) return;
    event.stopPropagation();
    setPicking(false);
    try {
      const rect = image.getBoundingClientRect();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(image, 0, 0);
      const x = Math.floor(((event.clientX - rect.left) / rect.width) * image.naturalWidth);
      const y = Math.floor(((event.clientY - rect.top) / rect.height) * image.naturalHeight);
      const [r, g, b] = context.getImageData(x, y, 1, 1).data;
      update({ colorTarget: `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}` });
    } catch { /* cross-origin source: type the colour instead */ }
  };
  const generate = () => { if (canGenerate) void workspace.generate({ brief: changeColorBrief({ color, area, ratio }) }); };
  const download = async (url: string | null | undefined, name: string) => {
    if (!url) return;
    try {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas');
      context.filter = `brightness(${tone.brightness}%) contrast(${tone.contrast}%) saturate(${tone.saturate}%)`;
      context.drawImage(bitmap, 0, 0);
      const rendered = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!rendered) throw new Error('blob');
      const href = URL.createObjectURL(await watermarkImageBlobIfOn(rendered));
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch { window.open(url, '_blank', 'noopener'); }
  };

  const projectCard = (
    <div className="absolute left-4 top-6 z-20 w-[265px] rounded-xl border border-white/10 bg-[#262a2b] px-4 py-2" data-testid="change-color-project-card">
      <div className="flex h-8 items-center gap-2 text-sm text-white/70"><span className="h-5 w-5 rounded bg-gradient-to-br from-slate-400 to-slate-600" aria-hidden="true" />色変更</div>
      <div className="my-1 h-px bg-white/10" />
      <button type="button" disabled={locked} onClick={() => navigate('/editor/changeColor')} className="flex h-9 w-full items-center gap-6 text-left text-base text-white/80 disabled:opacity-50">
        <ChevronLeft className="h-4 w-4" aria-label="一覧へ戻る" /><span className="truncate">Untitled</span>
      </button>
    </div>
  );

  const guideChooser = guide === null && (
    <div className="absolute bottom-4 left-[338px] right-4 top-[134px] z-30 grid grid-cols-2 gap-4 rounded-lg bg-[#33393b] p-1" data-testid="change-color-guide-chooser">
      {([['shown', 'ガイドを見る', 'ガイドを表示する', BookOpen], ['hidden', 'ガイドを表示しない', 'ガイド無しで開始します', MousePointer2]] as const).map(([id, title, sub, Icon]) => (
        <button key={id} type="button" onClick={() => chooseGuide(id)} className="flex flex-col items-start justify-end gap-2 rounded-lg bg-gradient-to-b from-[#4a5256] to-[#2a2f31] p-8 text-left hover:ring-1 hover:ring-white/30">
          <Icon className="mb-auto mt-auto h-24 w-24 self-center text-white/40" aria-hidden="true" />
          <h3 className="text-2xl font-semibold text-white">{title}</h3>
          <span className="text-sm text-white/60">{sub}</span>
        </button>
      ))}
    </div>
  );
  const guideSteps = ['1. 画像をアップロードします', '2. 「色の置き換え」で変更後の色を指定します（スポイトで画像から拾えます）', '3. 「色変更エリア」に変更する部分（例：ネックライン）を入力して AI生成 を押します'];
  const guideBubble = guide === 'shown' && guideStep > 0 && (
    <div className="absolute bottom-20 left-1/2 z-30 w-[420px] -translate-x-1/2 rounded-xl border border-white/10 bg-[#262a2b] p-4 text-sm text-white/85 shadow-xl" role="dialog" aria-label="ガイド">
      <p>{guideSteps[guideStep - 1]}</p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={() => setGuideStep(0)} className="rounded border border-white/15 px-3 py-1 text-xs">閉じる</button>
        {guideStep < guideSteps.length && <button type="button" onClick={() => setGuideStep((value) => value + 1)} className="rounded bg-[#5fd0c8] px-3 py-1 text-xs text-slate-950">次へ</button>}
      </div>
    </div>
  );

  if (!source && workspace.status !== 'loading') {
    return (
      <main className="relative h-[calc(100vh-50px)] overflow-hidden bg-[#171b1c] text-white" data-testid="lightchain-change-color-detail" data-workspace-feature={workspace.toolId} data-resume-state={workspace.status}>
        {projectCard}
        <label className="absolute bottom-4 left-[338px] right-4 top-[134px] flex cursor-pointer flex-col items-center justify-center rounded-lg bg-[#33393b] text-center" data-testid="change-color-upload-dropzone">
          <ImagePlus className="h-6 w-6 text-white/80" aria-hidden="true" />
          <span className="mt-3 text-base text-white/90">ここをクリックまたはドラッグして画像を追加</span>
          <span className="mt-2 text-sm text-white/50">jpg、jpeg、png、webp形式の画像（最大20M）に対応</span>
          <input type="file" accept={ACCEPT} className="sr-only" disabled={locked} onChange={pick} aria-label="ここをクリックまたはドラッグして画像を追加" />
        </label>
        {guideChooser}
        {guideBubble}
      </main>
    );
  }

  const visibleResult = Boolean(resultUrl) && showResult;
  const currentImage = visibleResult && selected !== 'source' ? resultUrl : source?.imageUrl ?? null;
  const filter = `brightness(${tone.brightness}%) contrast(${tone.contrast}%) saturate(${tone.saturate}%)`;
  const imageToolbar = (kind: 'source' | 'result', url: string) => (
    <div className="absolute -top-14 left-1/2 z-10 flex h-10 -translate-x-1/2 items-center gap-4 whitespace-nowrap rounded-xl border border-white/10 bg-[#262a2b] px-3 text-sm text-white/85 shadow-lg" onPointerDown={(event) => event.stopPropagation()} data-testid={`change-color-${kind}-toolbar`}>
      <button type="button" onClick={() => setToneOpen((value) => !value)} className="flex items-center gap-1 hover:text-white"><SlidersHorizontal className="h-4 w-4" />色調整</button>
      <button type="button" aria-label="ダウンロード" onClick={() => void download(url, kind === 'result' ? '色変更.png' : source?.name ?? '元画像.png')} className="hover:text-white"><Download className="h-4 w-4" /></button>
      {toneOpen && (
        <div className="absolute left-0 top-12 w-64 rounded-lg border border-white/10 bg-[#262a2b] p-3 text-xs" role="dialog" aria-label="色調整">
          {(['brightness', 'contrast', 'saturate'] as const).map((key) => (
            <label key={key} className="mb-2 flex items-center gap-2">
              <span className="w-12 text-white/70">{key === 'brightness' ? '明るさ' : key === 'contrast' ? 'コントラスト' : '彩度'}</span>
              <input type="range" min={50} max={150} value={tone[key]} onChange={(event) => setTone((value) => ({ ...value, [key]: Number(event.target.value) }))} className="flex-1" />
            </label>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <main className="relative h-[calc(100vh-50px)] overflow-hidden bg-[#171b1c] text-white" data-testid="lightchain-change-color-detail" data-workspace-feature={workspace.toolId} data-resume-job={workspace.jobId ?? ''} data-resume-state={workspace.status}>
      <div className={`absolute inset-0 ${tool === 'drag' ? 'cursor-grab' : picking ? 'cursor-crosshair' : ''}`} data-testid="change-color-canvas"
        onPointerDown={(event) => { if (tool === 'drag') { setDragOrigin({ x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }); event.currentTarget.setPointerCapture(event.pointerId); } else if (event.target === event.currentTarget) { setSelected(null); setToneOpen(false); } }}
        onPointerMove={(event) => { if (dragOrigin) setPan({ x: dragOrigin.panX + event.clientX - dragOrigin.x, y: dragOrigin.panY + event.clientY - dragOrigin.y }); }}
        onPointerUp={() => setDragOrigin(null)}>
        <div className="absolute left-1/2 top-1/2 flex items-center gap-16" style={{ transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y + 28}px)) scale(${zoom})` }}>
          {source && (
            <div className={`relative ${selected === 'source' ? 'ring-2 ring-[#5aa9ff]' : ''}`} onPointerDown={(event) => { if (tool === 'select' && !picking) { event.stopPropagation(); setSelected('source'); } }}>
              {selected === 'source' && !picking && imageToolbar('source', source.imageUrl)}
              <img ref={sourceRef} src={source.imageUrl} alt="元画像" data-source-slot="primary" onPointerDown={samplePixel} className={`block max-h-[200px] max-w-[200px] select-none object-contain ${picking ? 'cursor-crosshair' : ''}`} style={{ filter }} draggable={false} />
            </div>
          )}
          {visibleResult && resultUrl && (
            <div data-testid="change-color-result" className={`relative ${selected === 'result' ? 'ring-2 ring-[#5aa9ff]' : ''}`} onPointerDown={(event) => { if (tool === 'select') { event.stopPropagation(); setSelected('result'); } }}>
              {selected === 'result' && imageToolbar('result', resultUrl)}
              <img src={resultUrl} alt="色変更 AI生成" className="block max-h-[420px] max-w-[460px] select-none object-contain" style={{ filter }} draggable={false} />
            </div>
          )}
          {workspace.status === 'running' && <div className="flex h-[260px] w-[260px] items-center justify-center rounded-lg bg-white/[0.04] text-sm text-white/70" role="status">生成中…</div>}
        </div>
      </div>

      {projectCard}

      <nav aria-label="キャンバスツール" className="absolute left-1/2 top-6 z-20 flex h-[58px] -translate-x-1/2 items-center gap-1 rounded-xl border border-white/10 bg-[#262a2b] px-1 text-xs text-white/80">
        {([['select', '選択', MousePointer2], ['drag', 'ドラッグ', Hand]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" aria-pressed={tool === id} onClick={() => setTool(id)} className={`flex h-[50px] w-12 flex-col items-center justify-center gap-1 rounded-lg ${tool === id ? 'bg-white/10 text-white' : 'hover:bg-white/5'}`}><Icon className="h-5 w-5" />{label}</button>
        ))}
        <span className="mx-1 h-8 w-px bg-white/10" />
        <button type="button" disabled={!visibleResult} onClick={() => { setShowResult(false); setSelected('source'); }} className="flex h-[50px] w-20 flex-col items-center justify-center gap-1 rounded-lg hover:bg-white/5 disabled:text-white/30"><Undo2 className="h-5 w-5" />前にステップ</button>
        <button type="button" disabled={!resultUrl || showResult} onClick={() => { setShowResult(true); setSelected('result'); }} className="flex h-[50px] w-20 flex-col items-center justify-center gap-1 rounded-lg hover:bg-white/5 disabled:text-white/30"><Redo2 className="h-5 w-5" />次のステップ</button>
      </nav>

      <section className="absolute left-4 top-[121px] z-20 flex max-h-[calc(100%-137px)] w-[320px] flex-col overflow-y-auto rounded-xl border border-white/10 bg-[#262a2b] px-4 pb-4 pt-4 scrollbar-hide" data-testid="change-color-panel">
        <div className="flex items-center gap-3 pl-5">
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white/5">{currentImage && <img src={currentImage} alt="" className="h-full w-full object-cover" />}</div>
          <span className="text-sm text-white/90">現在の操作画像</span>
          {source && <span className="sr-only" data-testid="change-color-file-name">{source.name}</span>}
        </div>

        <div className="mt-6 flex items-center justify-between text-sm">
          <span className="flex items-center gap-1 text-white/70">色の置き換え<span className="text-rose-400">*</span><span title="変更後の色を指定します。スポイトで画像から色を拾えます。"><Info className="h-3.5 w-3.5 text-white/50" aria-label="色の置き換えの説明" /></span></span>
          <button type="button" disabled={locked || !color} onClick={() => update({ colorTarget: '' })} className="flex items-center gap-1 text-white/70 hover:text-white disabled:opacity-40">リセット<RotateCcw className="h-3.5 w-3.5" /></button>
        </div>
        <div className="mt-2 rounded-lg bg-white/[0.06] p-4">
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-1 rounded-lg bg-black/30 p-1">
              <label className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded border border-white/20" style={{ background: HEX.test(color) ? color : 'linear-gradient(45deg, transparent 46%, #f43f5e 46%, #f43f5e 54%, transparent 54%), #fff' }} aria-label="色を選択">
                <input type="color" value={HEX.test(color) ? color : '#ffffff'} disabled={locked} onChange={(event) => update({ colorTarget: event.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
              </label>
              <input type="text" value={color} placeholder="未設定" disabled={locked} onChange={(event) => update({ colorTarget: event.target.value.slice(0, 32) })} aria-label="変更後の色" className="h-8 w-[170px] rounded border border-white/10 bg-transparent px-3 text-sm text-white outline-none placeholder:text-white/40" />
            </div>
            <button type="button" aria-pressed={picking} disabled={locked} onClick={() => void startEyedropper()} aria-label="スポイト" className={`flex h-8 w-8 items-center justify-center rounded ${picking ? 'bg-[#5fd0c8] text-slate-950' : 'text-white/70 hover:text-white'}`}><Pipette className="h-4 w-4" /></button>
          </div>
        </div>

        <p className="mt-5 text-sm text-white/70">色変更エリア<span className="text-rose-400">*</span></p>
        <input type="text" value={area} maxLength={100} disabled={locked} onChange={(event) => update({ colorArea: event.target.value })} placeholder="色を変更する領域を入力してください（例：ネックライン）" aria-label="色変更エリア" className="mt-2 h-8 w-[286px] rounded-lg border border-white/15 bg-transparent px-3 text-sm text-white outline-none placeholder:text-white/35" />

        <p className="mt-5 text-sm text-white/70">生成画像の比率</p>
        <select aria-label="生成画像の比率" value={ratio} disabled={locked} onChange={(event) => update({ colorRatio: event.target.value })} className="mt-2 h-8 w-[286px] rounded-lg border border-white/15 bg-transparent px-3 text-sm text-white">
          {CHANGE_COLOR_RATIOS.map((value) => <option key={value} value={value} className="bg-[#262a2b]">{value}</option>)}
        </select>

        {heavyBrand.failed && <p role="alert" className="mt-3 text-sm text-rose-200">ワークスペースを準備できません。ページを再読み込みしてください。</p>}
        {workspace.error && <p role="alert" className="mt-3 text-sm text-rose-200">{workspace.error}</p>}
        {workspace.pendingId && workspace.status !== 'running' && <button type="button" onClick={() => void workspace.reconcile()} className="mt-3 self-start rounded-lg border border-white/15 px-3 py-2 text-sm text-white/85">同じ依頼を照合</button>}
        <button type="button" data-testid="change-color-generate" disabled={!canGenerate} onClick={generate} className="mt-6 inline-flex h-10 w-[288px] items-center justify-center gap-1 rounded-lg bg-[#5fd0c8] text-sm font-medium text-slate-950 transition hover:brightness-105 disabled:opacity-50">
          {workspace.status === 'running' ? '生成中…' : 'AI生成'}<Sparkles aria-hidden="true" className="h-4 w-4" />
        </button>
      </section>

      {guideBubble}
      <ZoomControl zoom={zoom} onChange={setZoom} onReset={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} />
    </main>
  );
}
