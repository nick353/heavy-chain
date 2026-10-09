import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Crop, Download, Expand, Hand, ImagePlus, Info, MousePointer2, Redo2, SlidersHorizontal, Sparkles, Undo2 } from 'lucide-react';
import { useCanonicalImageWorkspace } from '../hooks/useCanonicalImageWorkspace';
import { useHeavyWorkspaceBrandGate } from '../hooks/useHeavyWorkspaceBrandGate';
import { withSignedImageUrls } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';
import { useBoardDraftProject } from '../features/boardDraftProjects';
import { ZoomControl } from './PatternDesignDetailPage';
import { watermarkImageBlobIfOn } from '../lib/imageDownload';

/**
 * Light `/editor/patternDesign/detail` = "プリントデザイン", measured at 1440×900 on 2026-10-07: empty project →
 * project card + drop zone; with a print → 320px panel: プリント柄 (current image, ⓘ), タイル表示とズーム 1.0 ›,
 * プリント合成 / デザイン作成 tabs (143px each). プリント合成 asks for a スタイルマップ (画像をアップロード /
 * キャンバスから選択); デザイン作成 has a required 1000-char prompt (「プリントをシャツに乗せる」) and 生成設定
 * (ratio 自動 + resolution 1K). Run button 286×40. Canvas toolbar 選択 / ドラッグ / 前にステップ / 次のステップ and a
 * per-image toolbar with 色調整 / 画像調整 / シームレス / download. Light shows 権限がありません; Heavy runs it.
 */
export const PRINT_DESIGN_RATIOS = ['自動', '1:1', '4:3', '3:4', '16:9', '9:16'] as const;
export const PRINT_DESIGN_RESOLUTIONS = ['1K', '2K', '4K'] as const;
type PrintMode = 'compose' | 'create' | 'seamless';
const PROMPT_LIMIT = 1000;
const ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

export function printDesignBrief({ mode, prompt, ratio, resolution, tile }: { mode: PrintMode; prompt: string; ratio: string; resolution: string; tile: number }): string {
  const lines: string[] = [];
  if (mode === 'compose') {
    lines.push(
      'プリント合成: 1枚目の画像はプリント柄（テキスタイルの柄）です。2枚目の画像（スタイルマップ＝衣服・商品の写真）の生地部分に、このプリント柄を自然なリピート柄として乗せてください。',
      `柄の大きさは元の柄の ${tile.toFixed(1)} 倍のスケールで繰り返してください。`,
      '衣服の形・しわ・陰影・縫い目・付属品・背景・モデルは2枚目の画像のまま変えず、生地の柄だけを置き換えてください。',
    );
  } else if (mode === 'seamless') {
    lines.push('シームレス化: 1枚目のプリント柄を、上下左右に並べても継ぎ目が見えないシームレスなリピート柄に変換してください。モチーフ・配色・タッチは元の柄のまま保ってください。');
  } else {
    lines.push(`デザイン作成: 1枚目の画像のプリント柄を使って、次の指示どおりにデザインを作成してください: ${prompt.trim()}`, '柄のモチーフ・配色・タッチは1枚目の画像に合わせてください。');
  }
  if (mode !== 'seamless' && ratio !== '自動') lines.push(`出力の縦横比は ${ratio} にしてください。`);
  if (mode === 'create') lines.push(`出力解像度の目安: ${resolution}。`);
  return lines.join('\n');
}

export function PrintDesignDetailPage() {
  const { user, currentBrand } = useAuthStore();
  return <PrintDesignWorkspace key={JSON.stringify([currentBrand?.id, user?.id])} />;
}

type Adjust = { brightness: number; contrast: number; saturate: number; rotate: number; flip: boolean };
const NO_ADJUST: Adjust = { brightness: 100, contrast: 100, saturate: 100, rotate: 0, flip: false };
const filterOf = (adjust: Adjust) => `brightness(${adjust.brightness}%) contrast(${adjust.contrast}%) saturate(${adjust.saturate}%)`;
const transformOf = (adjust: Adjust) => `rotate(${adjust.rotate}deg) scaleX(${adjust.flip ? -1 : 1})`;
/** 色調整 / 画像調整 are kept as `brightness,contrast,saturate,rotate,flip` so they survive a reload. */
export const encodeAdjust = (adjust: Adjust) => [adjust.brightness, adjust.contrast, adjust.saturate, adjust.rotate, adjust.flip ? 1 : 0].join(',');
export const decodeAdjust = (value: unknown): Adjust => {
  if (typeof value !== 'string') return NO_ADJUST;
  const [brightness, contrast, saturate, rotate, flip] = value.split(',').map(Number);
  const pct = (n: number) => Number.isFinite(n) ? Math.min(150, Math.max(50, n)) : 100;
  return { brightness: pct(brightness), contrast: pct(contrast), saturate: pct(saturate),
    rotate: [0, 90, 180, 270].includes(rotate) ? rotate : 0, flip: flip === 1 };
};
const adjustStorageKey = (userId: string, brandId: string, jobId: string) => `heavy:print-adjust:v1:${userId}:${brandId}:${jobId}`;

function PrintDesignWorkspace() {
  const navigate = useNavigate();
  const workspace = useCanonicalImageWorkspace('pattern-print-design', { requiredSources: 1, title: 'プリントデザイン', initialInputState: { printMode: 'compose', printRatio: '自動', printResolution: '1K', printTile: '1.0', printPrompt: '' } });
  useBoardDraftProject('pattern-print-design', workspace);
  const { user, currentBrand } = useAuthStore();
  const heavyBrand = useHeavyWorkspaceBrandGate();
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | 'drag'>('select');
  const [selected, setSelected] = useState<'source' | 'result' | null>('source');
  const [showResult, setShowResult] = useState(true);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [tileOpen, setTileOpen] = useState(false);
  const [panel, setPanel] = useState<'color' | 'image' | null>(null);
  const [adjust, setAdjustState] = useState<Record<'source' | 'result', Adjust>>({ source: NO_ADJUST, result: NO_ADJUST });
  // Restore: a saved project keeps later adjustments per job; an unsaved one keeps them in its draft input.
  const adjustKey = workspace.jobId && user?.id && currentBrand?.id ? adjustStorageKey(user.id, currentBrand.id, workspace.jobId) : null;
  const restoredAdjust = useRef<string | null>(null);
  useEffect(() => {
    if (workspace.status === 'loading') return;
    const token = `${adjustKey ?? 'draft'}:${workspace.status}`;
    if (restoredAdjust.current === token) return;
    restoredAdjust.current = token;
    let stored: Record<string, unknown> | null = null;
    try { stored = adjustKey ? JSON.parse(localStorage.getItem(adjustKey) ?? 'null') : null; } catch { stored = null; }
    setAdjustState({ source: decodeAdjust(stored?.source ?? workspace.inputState.printAdjustSource), result: decodeAdjust(stored?.result ?? workspace.inputState.printAdjustResult) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustKey, workspace.status]);
  const setAdjust = (next: (value: Record<'source' | 'result', Adjust>) => Record<'source' | 'result', Adjust>) => {
    const updated = next(adjust);
    setAdjustState(updated);
    const encoded = { source: encodeAdjust(updated.source), result: encodeAdjust(updated.result) };
    if (adjustKey) { try { localStorage.setItem(adjustKey, JSON.stringify(encoded)); } catch { /* storage unavailable */ } }
    else workspace.setInputState({ ...workspace.inputState, printAdjustSource: encoded.source, printAdjustResult: encoded.result });
  };
  const locked = heavyBrand.pending || workspace.status === 'running' || workspace.status === 'loading' || Boolean(workspace.pendingId);
  const source = workspace.slots.primary;
  const styleMap = workspace.slots.secondary;
  const input = workspace.inputState;
  const mode: 'compose' | 'create' = input.printMode === 'create' ? 'create' : 'compose';
  const ratio = typeof input.printRatio === 'string' && (PRINT_DESIGN_RATIOS as readonly string[]).includes(input.printRatio) ? input.printRatio : '自動';
  const resolution = typeof input.printResolution === 'string' && (PRINT_DESIGN_RESOLUTIONS as readonly string[]).includes(input.printResolution) ? input.printResolution : '1K';
  const tile = Math.min(3, Math.max(0.5, Number(input.printTile) || 1));
  const prompt = typeof input.printPrompt === 'string' ? input.printPrompt : '';
  const canGenerate = Boolean(source) && !locked && (mode === 'compose' ? Boolean(styleMap) : prompt.trim().length > 0);

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

  const update = (patch: Record<string, string>) => workspace.setInputState({ ...workspace.inputState, printMode: mode, printRatio: ratio, printResolution: resolution, printTile: tile.toFixed(1), printPrompt: prompt, ...patch });
  const pick = (slot: 'primary' | 'secondary') => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || file.size > 20 * 1024 * 1024) return;
    void workspace.upload(slot, file);
  };
  const run = (runMode: PrintMode) => {
    if (!source || locked) return;
    if (runMode === 'compose' && !styleMap) return;
    if (runMode === 'create' && !prompt.trim()) return;
    void workspace.generate({ brief: printDesignBrief({ mode: runMode, prompt, ratio, resolution, tile }) });
  };
  /** キャンバスから選択: use the current result (or the print itself) as the スタイルマップ. */
  const styleMapFromCanvas = async () => {
    const url = resultUrl ?? source?.imageUrl;
    if (!url || locked) return;
    try {
      const blob = await (await fetch(url)).blob();
      await workspace.upload('secondary', new File([blob], 'キャンバス画像.png', { type: blob.type || 'image/png' }));
    } catch { /* the canvas image could not be read; the upload button still works */ }
  };

  const download = async (url: string | null | undefined, kind: 'source' | 'result') => {
    if (!url) return;
    try {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const value = adjust[kind];
      const quarter = value.rotate % 180 !== 0;
      const canvas = document.createElement('canvas');
      canvas.width = quarter ? bitmap.height : bitmap.width;
      canvas.height = quarter ? bitmap.width : bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas');
      context.filter = filterOf(value);
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((value.rotate * Math.PI) / 180);
      context.scale(value.flip ? -1 : 1, 1);
      context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
      const rendered = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!rendered) throw new Error('blob');
      const href = URL.createObjectURL(await watermarkImageBlobIfOn(rendered));
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = kind === 'result' ? 'プリントデザイン.png' : source?.name ?? 'プリント柄.png';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch { window.open(url, '_blank', 'noopener'); }
  };

  const projectCard = (
    <div className="absolute left-4 top-6 z-20 w-[265px] rounded-xl border border-white/10 bg-[#262a2b] px-4 py-2" data-testid="print-design-project-card">
      <div className="flex h-8 items-center gap-2 text-sm text-white/70"><span className="h-5 w-5 rounded bg-gradient-to-br from-rose-400 via-orange-300 to-amber-300" aria-hidden="true" />プリントデザイン</div>
      <div className="my-1 h-px bg-white/10" />
      <button type="button" disabled={locked} onClick={() => navigate('/editor/patternDesign')} className="flex h-9 w-full items-center gap-6 text-left text-base text-white/80 disabled:opacity-50">
        <ChevronLeft className="h-4 w-4" aria-label="一覧へ戻る" /><span className="truncate">Untitled</span>
      </button>
    </div>
  );

  if (!source && workspace.status !== 'loading') {
    return (
      <main className="relative h-[calc(100vh-50px)] overflow-hidden bg-[#171b1c] text-white" data-testid="lightchain-print-design-detail" data-workspace-feature={workspace.toolId} data-resume-state={workspace.status}>
        {projectCard}
        <label className="absolute bottom-4 left-[338px] right-4 top-[134px] flex cursor-pointer flex-col items-center justify-center rounded-lg bg-[#33393b] text-center" data-testid="print-design-upload-dropzone">
          <ImagePlus className="h-6 w-6 text-white/80" aria-hidden="true" />
          <span className="mt-3 text-base text-white/90">ここをクリックまたはドラッグして画像を追加</span>
          <span className="mt-2 text-sm text-white/50">jpg、jpeg、png、webp形式の画像（最大20M）に対応</span>
          <input type="file" accept={ACCEPT} className="sr-only" disabled={locked} onChange={pick('primary')} aria-label="ここをクリックまたはドラッグして画像を追加" />
        </label>
        {heavyBrand.failed && <p role="alert" className="absolute bottom-6 left-4 text-sm text-rose-200">ワークスペースを準備できません。ページを再読み込みしてください。</p>}
      </main>
    );
  }

  const visibleResult = Boolean(resultUrl) && showResult;
  const currentImage = visibleResult && selected !== 'source' ? resultUrl : source?.imageUrl ?? null;
  const tileStyle = (url: string): CSSProperties => ({ backgroundImage: `url("${url}")`, backgroundSize: `${Math.round(150 / tile)}px`, backgroundRepeat: 'repeat' });

  const imageToolbar = (kind: 'source' | 'result', url: string) => (
    <div className="absolute -top-14 left-1/2 z-10 flex h-10 -translate-x-1/2 items-center gap-4 whitespace-nowrap rounded-xl border border-white/10 bg-[#262a2b] px-3 text-sm text-white/85 shadow-lg" data-testid={`print-design-${kind}-toolbar`} onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" onClick={() => setPanel(panel === 'color' ? null : 'color')} className="flex items-center gap-1 hover:text-white"><SlidersHorizontal className="h-4 w-4" />色調整</button>
      <button type="button" onClick={() => setPanel(panel === 'image' ? null : 'image')} className="flex items-center gap-1 hover:text-white"><Crop className="h-4 w-4" />画像調整</button>
      <button type="button" disabled={locked} onClick={() => run('seamless')} className="flex items-center gap-1 hover:text-white disabled:opacity-40" data-testid="print-design-seamless"><Expand className="h-4 w-4" />シームレス</button>
      <button type="button" aria-label="ダウンロード" onClick={() => void download(url, kind)} className="hover:text-white"><Download className="h-4 w-4" /></button>
      {panel && (
        <div className="absolute left-0 top-12 w-64 rounded-lg border border-white/10 bg-[#262a2b] p-3 text-xs" role="dialog" aria-label={panel === 'color' ? '色調整' : '画像調整'}>
          {panel === 'color' ? (['brightness', 'contrast', 'saturate'] as const).map((key) => (
            <label key={key} className="mb-2 flex items-center gap-2">
              <span className="w-12 text-white/70">{key === 'brightness' ? '明るさ' : key === 'contrast' ? 'コントラスト' : '彩度'}</span>
              <input type="range" min={50} max={150} value={adjust[kind][key]} onChange={(event) => setAdjust((value) => ({ ...value, [kind]: { ...value[kind], [key]: Number(event.target.value) } }))} className="flex-1" />
            </label>
          )) : (
            <div className="flex gap-2">
              <button type="button" onClick={() => setAdjust((value) => ({ ...value, [kind]: { ...value[kind], rotate: (value[kind].rotate + 90) % 360 } }))} className="rounded border border-white/15 px-2 py-1">90°回転</button>
              <button type="button" onClick={() => setAdjust((value) => ({ ...value, [kind]: { ...value[kind], flip: !value[kind].flip } }))} className="rounded border border-white/15 px-2 py-1">左右反転</button>
            </div>
          )}
          <button type="button" onClick={() => setAdjust((value) => ({ ...value, [kind]: NO_ADJUST }))} className="mt-1 text-white/60 hover:text-white">リセット</button>
        </div>
      )}
    </div>
  );

  const onCanvasPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (tool !== 'drag') { if (event.target === event.currentTarget) { setSelected(null); setPanel(null); } return; }
    setDragOrigin({ x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return (
    <main className="relative h-[calc(100vh-50px)] overflow-hidden bg-[#171b1c] text-white" data-testid="lightchain-print-design-detail" data-workspace-feature={workspace.toolId} data-resume-job={workspace.jobId ?? ''} data-resume-state={workspace.status}>
      <div className={`absolute inset-0 ${tool === 'drag' ? 'cursor-grab' : ''}`} data-testid="print-design-canvas" onPointerDown={onCanvasPointerDown} onPointerMove={(event) => { if (dragOrigin) setPan({ x: dragOrigin.panX + event.clientX - dragOrigin.x, y: dragOrigin.panY + event.clientY - dragOrigin.y }); }} onPointerUp={() => setDragOrigin(null)}>
        <div className="absolute left-1/2 top-1/2 flex items-center gap-16 md:left-[calc(50%+168px)]" style={{ transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y + 28}px)) scale(${zoom})` }}>
          {source && (
            <div className={`relative ${selected === 'source' ? 'ring-2 ring-[#5aa9ff]' : ''}`} onPointerDown={(event) => { if (tool === 'select') { event.stopPropagation(); setSelected('source'); } }}>
              {selected === 'source' && imageToolbar('source', source.imageUrl)}
              {tile !== 1
                ? <div className="h-[150px] w-[150px]" style={{ ...tileStyle(source.imageUrl), filter: filterOf(adjust.source), transform: transformOf(adjust.source) }} data-testid="print-design-tile-preview" role="img" aria-label="プリント柄（タイル表示）" />
                : <img src={source.imageUrl} alt="プリント柄" data-source-slot="primary" className="block max-h-[150px] max-w-[150px] select-none object-contain" style={{ filter: filterOf(adjust.source), transform: transformOf(adjust.source) }} draggable={false} />}
            </div>
          )}
          {visibleResult && resultUrl && (
            <div data-testid="print-design-result" className={`relative ${selected === 'result' ? 'ring-2 ring-[#5aa9ff]' : ''}`} onPointerDown={(event) => { if (tool === 'select') { event.stopPropagation(); setSelected('result'); } }}>
              {selected === 'result' && imageToolbar('result', resultUrl)}
              <img src={resultUrl} alt="プリントデザイン AI生成" className="block max-h-[min(420px,calc(100vh-290px))] max-w-[460px] select-none object-contain" style={{ filter: filterOf(adjust.result), transform: transformOf(adjust.result) }} draggable={false} />
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

      <section className="absolute left-4 top-[121px] z-20 flex max-h-[calc(100%-137px)] w-[320px] flex-col overflow-y-auto rounded-xl border border-white/10 bg-[#262a2b] px-4 pb-4 pt-4 scrollbar-hide" data-testid="print-design-panel">
        <div className="flex items-center gap-3 pl-3">
          <div className="h-10 w-10 shrink-0 overflow-hidden bg-white/5">{currentImage && <img src={currentImage} alt="" className="h-full w-full object-cover" />}</div>
          <span className="text-sm text-white/90">プリント柄</span>
          <span title="キャンバスで選択中の画像がプリント柄として使われます" className="text-white/50"><Info className="h-3.5 w-3.5" aria-label="プリント柄の説明" /></span>
          {source && <span className="sr-only" data-testid="print-design-file-name">{source.name}</span>}
        </div>
        <div className="relative mt-4">
          <button type="button" aria-expanded={tileOpen} onClick={() => setTileOpen((value) => !value)} className="flex h-6 w-full items-center gap-1.5 px-1 text-sm text-white/80">
            <Expand className="h-3.5 w-3.5 text-white/60" aria-hidden="true" />タイル表示とズーム<span className="ml-auto">{tile.toFixed(1)}</span><ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
          {tileOpen && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70">
              <span>0.5</span>
              <input type="range" aria-label="タイル表示とズーム" min={0.5} max={3} step={0.1} value={tile} disabled={locked} onChange={(event) => update({ printTile: Number(event.target.value).toFixed(1) })} className="flex-1" />
              <span>3.0</span>
            </div>
          )}
        </div>

        <div role="tablist" aria-label="プリントデザイン" className="mt-4 grid h-8 grid-cols-2">
          {([['compose', 'プリント合成'], ['create', 'デザイン作成']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} disabled={locked} onClick={() => update({ printMode: id })} className={`h-[31px] rounded-lg text-[15px] ${mode === id ? 'bg-[#3c4245] text-white' : 'text-white/70'}`}>{label}</button>
          ))}
        </div>

        <div role="tabpanel" className="flex flex-col">
          {mode === 'compose' ? (
            <div className="group relative mt-3 flex h-[178px] flex-col items-center justify-center overflow-hidden rounded-lg text-sm text-white/80" data-testid="print-design-style-map">
              {styleMap ? (
                <>
                  <img src={styleMap.imageUrl} alt="スタイルマップ" className="h-full w-full object-contain" />
                  <span className="sr-only" data-testid="print-design-style-map-name">{styleMap.name}</span>
                  <button type="button" disabled={locked} onClick={() => workspace.clearSource('secondary')} className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs">削除</button>
                </>
              ) : (
                <>
                  {/* Light reveals these on hover; they stay reachable by keyboard focus and are always shown on touch screens. */}
                  <span className="group-hover:hidden group-focus-within:hidden [@media(hover:none)]:hidden">スタイルマップをアップロードします。</span>
                  <div className="absolute inset-0 flex w-full flex-col justify-center gap-2 px-6 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                    <label className="flex h-9 cursor-pointer items-center justify-center rounded-lg bg-white/10">画像をアップロード<input type="file" accept={ACCEPT} className="sr-only" disabled={locked} onChange={pick('secondary')} aria-label="スタイルマップの画像をアップロード" /></label>
                    <button type="button" disabled={locked} onClick={() => void styleMapFromCanvas()} className="h-9 rounded-lg bg-white/10">キャンバスから選択</button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <p className="mt-3 text-sm text-white/70">プロンプト<span className="text-rose-400">*</span></p>
              <div className="mt-2 rounded-lg border border-white/15 px-3 pb-2 pt-2">
                <textarea value={prompt} maxLength={PROMPT_LIMIT} disabled={locked} onChange={(event) => update({ printPrompt: event.target.value.slice(0, PROMPT_LIMIT) })} placeholder="プリントをシャツに乗せる" aria-label="プロンプト" className="h-[82px] w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-white/35" />
                <div className="flex items-center justify-end gap-3 text-xs">
                  <span className="text-white/60"><span className="text-[#5fd0c8]">{prompt.length}</span>/{PROMPT_LIMIT}</span>
                  <button type="button" disabled={locked || !prompt} onClick={() => update({ printPrompt: '' })} className="rounded-full bg-white/10 px-3 py-1 text-white/70 disabled:opacity-40">全削除</button>
                </div>
              </div>
              <p className="mt-4 text-sm text-white/70">生成設定</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <select aria-label="生成比率" value={ratio} disabled={locked} onChange={(event) => update({ printRatio: event.target.value })} className="h-10 rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white">
                  {PRINT_DESIGN_RATIOS.map((value) => <option key={value} value={value} className="bg-[#262a2b]">{value}</option>)}
                </select>
                <select aria-label="解像度" value={resolution} disabled={locked} onChange={(event) => update({ printResolution: event.target.value })} className="h-10 rounded-lg border border-white/10 bg-transparent px-3 text-sm text-white">
                  {PRINT_DESIGN_RESOLUTIONS.map((value) => <option key={value} value={value} className="bg-[#262a2b]">{value}</option>)}
                </select>
              </div>
            </>
          )}

          {heavyBrand.failed && <p role="alert" className="mt-3 text-sm text-rose-200">ワークスペースを準備できません。ページを再読み込みしてください。</p>}
          {workspace.error && <p role="alert" className="mt-3 text-sm text-rose-200">{workspace.error}</p>}
          {workspace.pendingId && workspace.status !== 'running' && <button type="button" onClick={() => void workspace.reconcile()} className="mt-3 self-start rounded-lg border border-white/15 px-3 py-2 text-sm text-white/85">同じ依頼を照合</button>}
          <button type="button" data-testid="print-design-generate" disabled={!canGenerate} onClick={() => run(mode)} className="mt-4 inline-flex h-10 w-[286px] items-center justify-center gap-1 rounded-lg bg-[#5fd0c8] text-sm font-medium text-slate-950 transition hover:brightness-105 disabled:opacity-50">
            {workspace.status === 'running' ? '生成中…' : 'AI生成'}<Sparkles aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </section>

      <ZoomControl zoom={zoom} onChange={setZoom} onReset={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} />
    </main>
  );
}
