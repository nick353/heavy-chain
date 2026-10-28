import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Expand, Hand, ImagePlus, Info, MousePointer2, Redo2, Sparkles, Undo2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCanonicalImageWorkspace } from '../hooks/useCanonicalImageWorkspace';
import { useHeavyWorkspaceBrandGate } from '../hooks/useHeavyWorkspaceBrandGate';
import { withSignedImageUrls } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';
import { useBoardDraftProject } from '../features/boardDraftProjects';
import { CollectButton, ColorAdjustPanel, CropFrame, DownloadMenu, ImageAdjustPanel, NO_EDIT, ShortcutSheetButton, ToolbarTextButton, UpscaleMenu, decodeImageEdit, encodeImageEdit, imageEditStyle, renderEditedImage, type EditorExportFormat, type ImageEdit } from '../components/lightchain/EditorImageTools';
import { upscaleImage } from '../lib/imageApi';
import { saveWorkspaceArtifactBestEffort } from '../lib/localWorkspaceArtifacts';
import { cloudflareDataPlane } from '../lib/cloudflareApi';
import { watermarkImageBlobIfOn } from '../lib/imageDownload';
import { projectNameFromFile } from '../lib/projectNames';

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

/** 色調整 / 画像調整 (see EditorImageTools) are kept per image so they survive a reload. */
const adjustStorageKey = (userId: string, brandId: string, jobId: string) => `heavy:print-adjust:v2:${userId}:${brandId}:${jobId}`;
const EXPORT_EXTENSION: Record<EditorExportFormat, string> = { png: 'png', jpeg: 'jpg', avif: 'avif' };
const TILE_MIN = 0.1;
const TILE_MAX = 2;

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
  const [adjust, setAdjustState] = useState<Record<'source' | 'result', ImageEdit>>({ source: NO_EDIT, result: NO_EDIT });
  // While a 色調整 / 画像調整 panel is open the image shows the draft; 適用 saves it.
  const [preview, setPreview] = useState<{ kind: 'source' | 'result'; edit: ImageEdit } | null>(null);
  const [tileDraft, setTileDraft] = useState<number | null>(null);
  const [busyTool, setBusyTool] = useState(false);
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
    setAdjustState({ source: decodeImageEdit(stored?.source ?? workspace.inputState.printAdjustSource), result: decodeImageEdit(stored?.result ?? workspace.inputState.printAdjustResult) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustKey, workspace.status]);
  const setAdjust = (next: (value: Record<'source' | 'result', ImageEdit>) => Record<'source' | 'result', ImageEdit>) => {
    const updated = next(adjust);
    setAdjustState(updated);
    const encoded = { source: encodeImageEdit(updated.source), result: encodeImageEdit(updated.result) };
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
  const tile = Math.min(TILE_MAX, Math.max(TILE_MIN, Number(input.printTile) || 1));
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

  const download = async (url: string | null | undefined, kind: 'source' | 'result', format: EditorExportFormat = 'png') => {
    if (!url) return;
    try {
      const rendered = await renderEditedImage(url, adjust[kind], format);
      const href = URL.createObjectURL(await watermarkImageBlobIfOn(rendered));
      const anchor = document.createElement('a');
      anchor.href = href;
      const base = kind === 'result' ? 'プリントデザイン' : (source?.name ?? 'プリント柄').replace(/\.[^.]+$/, '');
      anchor.download = `${base}.${EXPORT_EXTENSION[format]}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('format_unsupported')) toast.error('このブラウザではこの形式で保存できません');
      else window.open(url, '_blank', 'noopener');
    }
  };
  /** Light's コレクション: the selected image goes to マイライブラリー. */
  const collect = async (url: string, kind: 'source' | 'result') => {
    if (!currentBrand?.id || !user?.id) return;
    try {
      const persistenceContext = await cloudflareDataPlane?.captureArtifactPersistenceContext();
      const storagePath = kind === 'result' ? workspace.result?.storagePath : undefined;
      const result = await saveWorkspaceArtifactBestEffort({ brandId: currentBrand.id, scopeId: user.id, featureType: 'pattern-print-design', title: 'プリントデザイン', prompt: 'プリントデザイン', imageUrl: url,
        createdAt: new Date().toISOString(), metadata: { librarySource: 'print-design-collection', libraryGroup: 'マイライブラリー', ...(storagePath ? { sourceStoragePath: storagePath } : {}) } }, { persistenceContext });
      if (!result.localPersisted || (cloudflareDataPlane && !result.remote)) throw new Error('library_save_unconfirmed');
      toast.success('アセットライブラリに保存しました');
    } catch { toast.error('ライブラリーへ保存できませんでした'); }
  };
  /** Light's 高画質化 2K / 4K: the upscaled copy becomes the canvas result. */
  const upscale = async (url: string, scale: 2 | 4) => {
    if (!currentBrand?.id || busyTool) return;
    setBusyTool(true);
    try {
      const result = await upscaleImage(url, currentBrand.id, scale, { lightchainFeatureId: 'pattern-print-design', lightchainFeatureTitle: 'プリントデザイン', lightchainTaskCodes: ['upscale'] }, { rightsConfirmed: true });
      const next = result.imageUrl ?? result.images?.[0]?.imageUrl;
      if (!result.success || !next) throw new Error('upscale_failed');
      setResultUrl(next); setShowResult(true); setSelected('result');
      setAdjust((value) => ({ ...value, result: NO_EDIT }));
    } catch { toast.error('高画質化できませんでした'); }
    finally { setBusyTool(false); }
  };
  /** タイル表示とズーム › キャンバスに保存: the tiled print is drawn once and placed on the canvas as the result. */
  const saveTileToCanvas = async (scale: number) => {
    const url = source?.imageUrl;
    if (!url) return;
    try {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 1024;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas');
      const size = Math.max(16, Math.round((1024 / 3) * scale));
      const height = Math.round(size * (bitmap.height / bitmap.width));
      for (let y = 0; y < 1024; y += height) for (let x = 0; x < 1024; x += size) context.drawImage(bitmap, x, y, size, height);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('blob');
      setResultUrl(URL.createObjectURL(blob)); setShowResult(true); setSelected('result');
    } catch { toast.error('キャンバスに保存できませんでした'); }
  };

  const projectCard = (
    <div className="absolute left-4 top-6 z-20 w-[265px] rounded-xl border border-white/10 bg-[#262a2b] px-4 py-2" data-testid="print-design-project-card">
      <div className="flex h-8 items-center gap-2 text-sm text-white/70"><span className="h-5 w-5 rounded bg-gradient-to-br from-rose-400 via-orange-300 to-amber-300" aria-hidden="true" />プリントデザイン</div>
      <div className="my-1 h-px bg-white/10" />
      <button type="button" disabled={locked} onClick={() => navigate('/editor/patternDesign')} className="flex h-9 w-full items-center gap-6 text-left text-base text-white/80 disabled:opacity-50">
        <ChevronLeft className="h-4 w-4" aria-label="一覧へ戻る" /><span className="truncate">{projectNameFromFile(source?.name)}</span>
      </button>
    </div>
  );

  if (!source && workspace.status !== 'loading') {
    return (
      <main className="relative h-[calc(100vh-50px)] overflow-hidden bg-[#171b1c] text-white" data-testid="lightchain-print-design-detail" data-workspace-feature={workspace.toolId} data-resume-state={workspace.status}>
        {projectCard}
        <label className="absolute left-1/2 top-1/2 flex h-[484px] w-[min(764px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center justify-center rounded-lg bg-[#33393b] text-center" data-testid="print-design-upload-dropzone">
          <ImagePlus className="h-6 w-6 text-white/80" aria-hidden="true" />
          <span className="mt-3 text-base text-white/90">ここをクリックまたはドラッグして画像を追加</span>
          <span className="mt-2 text-sm text-white/50">jpg、jpeg、png、webp形式の画像（最大20M）に対応</span>
          <input type="file" accept={ACCEPT} className="sr-only" disabled={locked} onChange={pick('primary')} aria-label="ここをクリックまたはドラッグして画像を追加" />
        </label>
        {heavyBrand.failed && <p role="alert" className="absolute bottom-6 left-4 text-sm text-rose-200">ワークスペースを準備できません。ページを再読み込みしてください。</p>}
        <ShortcutSheetButton />
      </main>
    );
  }

  const visibleResult = Boolean(resultUrl) && showResult;
  const currentImage = visibleResult && selected !== 'source' ? resultUrl : source?.imageUrl ?? null;
  const tileStyle = (url: string, scale = tile): CSSProperties => ({ backgroundImage: `url("${url}")`, backgroundSize: `${Math.round(50 * scale)}px`, backgroundRepeat: 'repeat' });
  const editOf = (kind: 'source' | 'result') => (preview?.kind === kind ? preview.edit : adjust[kind]);

  // Light's image toolbar: 色調整, 画像調整, シームレス, 高画質化 (2K / 4K), コレクション and ダウンロード (PNG / JPG / AVIF).
  const imageToolbar = (kind: 'source' | 'result', url: string) => (
    <div className="absolute -top-14 left-1/2 z-10 flex h-10 -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-xl border border-white/10 bg-[#262a2b] px-1.5 text-sm text-white/85 shadow-lg" data-testid={`print-design-${kind}-toolbar`} onPointerDown={(event) => event.stopPropagation()}>
      <ToolbarTextButton label="色調整" icon="color" active={panel === 'color'} onClick={() => { setPreview(null); setPanel(panel === 'color' ? null : 'color'); }} testId="print-design-color" />
      <ToolbarTextButton label="画像調整" icon="image" active={panel === 'image'} onClick={() => { setPreview(null); setPanel(panel === 'image' ? null : 'image'); }} testId="print-design-image" />
      <button type="button" disabled={locked} onClick={() => run('seamless')} className="flex h-8 items-center gap-1 rounded-lg px-1.5 hover:bg-white/10 disabled:opacity-40" data-testid="print-design-seamless"><Expand className="h-4 w-4" />シームレス</button>
      <UpscaleMenu disabled={busyTool || locked} onSelect={(scale) => void upscale(url, scale)} />
      <span className="mx-0.5 h-5 w-px bg-white/10" />
      <CollectButton onClick={() => void collect(url, kind)} />
      <DownloadMenu onSelect={(format) => void download(url, kind, format)} />
      {panel === 'color' && <ColorAdjustPanel value={adjust[kind].tone} onClose={() => { setPanel(null); setPreview(null); }}
        onPreview={(tone) => setPreview({ kind, edit: { ...adjust[kind], tone } })} onApply={(tone) => setAdjust((value) => ({ ...value, [kind]: { ...value[kind], tone } }))} />}
      {panel === 'image' && <ImageAdjustPanel value={adjust[kind]} onClose={() => { setPanel(null); setPreview(null); }}
        onPreview={(edit) => setPreview({ kind, edit })} onApply={(edit) => setAdjust((value) => ({ ...value, [kind]: edit }))} />}
    </div>
  );
  const cropFrameFor = (kind: 'source' | 'result') => panel === 'image' && preview?.kind === kind && preview.edit.crop
    ? <CropFrame crop={preview.edit.crop} onChange={(crop) => setPreview({ kind, edit: { ...preview.edit, crop } })} /> : null;

  const onCanvasPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (tool !== 'drag') { if (event.target === event.currentTarget) { setSelected(null); setPanel(null); } return; }
    setDragOrigin({ x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return (
    <main className="relative h-[calc(100vh-50px)] overflow-hidden bg-[#171b1c] text-white" data-testid="lightchain-print-design-detail" data-workspace-feature={workspace.toolId} data-resume-job={workspace.jobId ?? ''} data-resume-state={workspace.status}>
      <div className={`absolute inset-0 ${tool === 'drag' ? 'cursor-grab' : ''}`} data-testid="print-design-canvas" onPointerDown={onCanvasPointerDown} onPointerMove={(event) => { if (dragOrigin) setPan({ x: dragOrigin.panX + event.clientX - dragOrigin.x, y: dragOrigin.panY + event.clientY - dragOrigin.y }); }} onPointerUp={() => setDragOrigin(null)}
        onWheel={(event) => setZoom((value) => Math.min(4, Math.max(0.25, value * (event.deltaY < 0 ? 1.1 : 0.9))))}>
        <div className="absolute left-1/2 top-1/2 flex items-center gap-16 md:left-[calc(50%+168px)]" style={{ transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y + 28}px)) scale(${zoom})` }}>
          {source && (
            <div className={`relative ${selected === 'source' ? 'ring-2 ring-[#5aa9ff]' : ''}`} onPointerDown={(event) => { if (tool === 'select') { event.stopPropagation(); setSelected('source'); } }}>
              {selected === 'source' && imageToolbar('source', source.imageUrl)}
              {tile !== 1
                ? <div className="h-[150px] w-[150px]" style={{ ...tileStyle(source.imageUrl), ...imageEditStyle(editOf('source')) }} data-testid="print-design-tile-preview" role="img" aria-label="プリント柄（タイル表示）" />
                : <img src={source.imageUrl} alt="プリント柄" data-source-slot="primary" className="block max-h-[150px] max-w-[150px] select-none object-contain" style={imageEditStyle(editOf('source'))} draggable={false} />}
              {cropFrameFor('source')}
            </div>
          )}
          {visibleResult && resultUrl && (
            <div data-testid="print-design-result" className={`relative ${selected === 'result' ? 'ring-2 ring-[#5aa9ff]' : ''}`} onPointerDown={(event) => { if (tool === 'select') { event.stopPropagation(); setSelected('result'); } }}>
              {selected === 'result' && imageToolbar('result', resultUrl)}
              <img src={resultUrl} alt="プリントデザイン AI生成" className="block max-h-[min(420px,calc(100vh-290px))] max-w-[460px] select-none object-contain" style={imageEditStyle(editOf('result'))} draggable={false} />
              {cropFrameFor('result')}
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
          <button type="button" aria-expanded={tileOpen} onClick={() => { setTileDraft(tile); setTileOpen((value) => !value); }} className="flex h-[33px] w-full items-center gap-1.5 rounded-lg bg-white/[0.06] px-2 text-sm text-white/80" data-testid="print-design-tile-toggle">
            <Expand className="h-3.5 w-3.5 text-white/60" aria-hidden="true" />タイル表示とズーム<span className="ml-auto">{tile.toFixed(1)}</span><ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
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

      {/* Light's タイル表示とズーム opens beside the panel: preview, ズーム倍率, キャンバスに保存 and 適用. */}
      {tileOpen && source && (
        <section role="dialog" aria-label="タイル表示とズーム" data-testid="print-design-tile-panel" className="absolute left-[352px] top-[121px] z-30 w-[255px] rounded-2xl border border-white/10 bg-[#25292b] p-4 text-sm text-white shadow-2xl">
          <div className="flex items-center justify-between"><h3 className="font-medium">タイル表示とズーム</h3>
            <button type="button" aria-label="閉じる" onClick={() => setTileOpen(false)} className="text-white/60 hover:text-white"><X className="h-4 w-4" /></button></div>
          <p className="mt-1 text-xs leading-5 text-white/60">ズーム倍率が大きいほど、上半身のプリントが大きくなります</p>
          <div className="mt-3 h-[224px] w-full rounded bg-white/5" style={tileStyle(source.imageUrl, (tileDraft ?? tile) * 4.5)} role="img" aria-label="タイル表示のプレビュー" />
          <div className="mt-4 flex items-center justify-between"><span className="text-white/80">ズーム倍率</span>
            <input type="number" aria-label="ズーム倍率" step={0.1} min={TILE_MIN} max={TILE_MAX} value={(tileDraft ?? tile).toFixed(1)} onChange={(event) => setTileDraft(Math.min(TILE_MAX, Math.max(TILE_MIN, Number(event.target.value) || 1)))}
              className="h-8 w-12 rounded-lg border border-white/10 bg-transparent px-2 text-sm text-white outline-none" /></div>
          <input type="range" aria-label="ズーム倍率のスライダー" min={TILE_MIN} max={TILE_MAX} step={0.1} value={tileDraft ?? tile} disabled={locked} onChange={(event) => setTileDraft(Number(event.target.value))} className="mt-2 w-full accent-[#0bcabc]" />
          <div className="mt-4 flex items-center justify-between gap-2">
            <button type="button" disabled={locked} onClick={() => void saveTileToCanvas(tileDraft ?? tile)} className="h-8 flex-1 rounded-lg bg-white/10 px-3 text-sm hover:bg-white/15 disabled:opacity-40">キャンバスに保存</button>
            <button type="button" disabled={locked} onClick={() => { update({ printTile: (tileDraft ?? tile).toFixed(1) }); setTileOpen(false); }} className="h-8 rounded-lg bg-[#0bcabc] px-4 text-sm font-medium text-neutral-950 hover:bg-[#3dd8cc] disabled:opacity-40">適用</button>
          </div>
        </section>
      )}
      <ShortcutSheetButton />
    </main>
  );
}
