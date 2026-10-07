import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import { Brush, ImagePlus, Sparkles, Trash2 } from 'lucide-react';
import { useCanonicalImageWorkspace } from '../hooks/useCanonicalImageWorkspace';
import { useHeavyWorkspaceBrandGate } from '../hooks/useHeavyWorkspaceBrandGate';
import { withSignedImageUrls } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';
import { LIGHTCHAIN_IMAGE_REPAIR_TABS, LightchainDesignToolFrame } from '../components/lightchain/LightchainDesignToolFrame';

/**
 * Light `/tools/reactor` = "画像修正", measured at 1440×900 on 2026-10-07: single 画像修正 tab, no deprecation notice,
 * フィッティングツール rail highlight, 564×280 source box, 修復内容を選択します + 手足の変形を修正 tab, the
 * 「マスクツール」 hint and the 288×40 run button. Light shows 権限がありません on this account; Heavy runs the repair.
 * The mask is painted over the source and sent as a second reference image (red = area to repair).
 */
const BRUSH = 28;
const MASK_COLOR = 'rgba(255, 40, 60, 0.55)';

export function imageRepairBrief(hasMask: boolean): string {
  return [
    '画像修正（手足の変形を修正）: 1枚目の画像に写っている人物の手・指・腕・脚・足の変形や奇形を、自然で正しい人体構造に修正してください。',
    hasMask ? '2枚目の画像で赤く塗られた範囲が修正箇所です。赤い範囲の中だけを直し、赤い色は結果に残さないでください。' : '',
    '服・顔・髪・ポーズ・背景・色味・構図・画角は元の画像のまま変えないでください。',
  ].filter(Boolean).join('\n');
}

export function LightchainImageRepairPage() {
  const { user, currentBrand } = useAuthStore();
  return <LightchainImageRepairWorkspace key={JSON.stringify([currentBrand?.id, user?.id])} />;
}

function LightchainImageRepairWorkspace() {
  const workspace = useCanonicalImageWorkspace('image-repair', { requiredSources: 1, title: '画像修正', initialInputState: { sourceType: '手足の変形を修正' } });
  const heavyBrand = useHeavyWorkspaceBrandGate();
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [maskMode, setMaskMode] = useState(false);
  const [maskDirty, setMaskDirty] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const locked = heavyBrand.pending || workspace.status === 'running' || workspace.status === 'loading' || Boolean(workspace.pendingId);
  const source = workspace.slots.primary;
  const maskReference = workspace.slots.secondary;

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

  const sizeCanvas = () => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas || !image.naturalWidth) return;
    if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      setMaskDirty(false);
    }
  };

  const paint = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    context.fillStyle = MASK_COLOR;
    context.beginPath();
    context.arc((event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale, (BRUSH / 2) * scale, 0, Math.PI * 2);
    context.fill();
    setMaskDirty(true);
  };

  /** Bakes the painted strokes onto the source and stores it as the second reference ("修正箇所"). */
  const commitMask = async () => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas || !maskDirty) return;
    try {
      const composite = document.createElement('canvas');
      composite.width = canvas.width;
      composite.height = canvas.height;
      const context = composite.getContext('2d');
      if (!context) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      context.drawImage(canvas, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => composite.toBlob(resolve, 'image/png'));
      if (blob) await workspace.upload('secondary', new File([blob], '修正箇所マスク.png', { type: 'image/png' }));
    } catch {
      // A restored remote source can taint the canvas; the repair still runs from the brief alone.
    }
  };

  const clearMask = () => {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setMaskDirty(false);
    if (maskReference) workspace.clearSource('secondary');
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    clearMask();
    setMaskMode(false);
    void workspace.upload('primary', file);
  };

  const generate = () => {
    if (locked || !source) return;
    void workspace.generate({ brief: imageRepairBrief(Boolean(maskReference)) });
  };

  const controls = (
    <div className="flex flex-1 flex-col">
      <div data-testid="image-repair-source" className="relative flex h-[280px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#33393b] text-center">
        {source ? (
          <div className="relative inline-block max-h-full max-w-full">
            <img ref={imageRef} src={source.imageUrl} alt="参考画像" data-source-slot="primary" onLoad={sizeCanvas} className="block max-h-[280px] max-w-full object-contain" />
            <canvas
              ref={canvasRef}
              data-testid="image-repair-mask-canvas"
              aria-label="マスク"
              className={`absolute inset-0 h-full w-full ${maskMode ? 'cursor-crosshair' : 'pointer-events-none'}`}
              onPointerDown={(event) => { if (!maskMode || locked) return; drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); paint(event); }}
              onPointerMove={(event) => { if (drawing.current) paint(event); }}
              onPointerUp={() => { if (!drawing.current) return; drawing.current = false; void commitMask(); }}
            />
            <span className="sr-only" data-testid="image-repair-file-name">{source.name}</span>
          </div>
        ) : null}
        <label className={`absolute inset-0 flex cursor-pointer flex-col items-center justify-center ${source ? (maskMode ? 'pointer-events-none opacity-0' : 'opacity-0 hover:opacity-100 hover:bg-black/40') : ''} transition`}>
          <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={locked} onChange={handleFile} aria-label="参考画像をアップロードしてください" />
          <ImagePlus aria-hidden="true" className="h-6 w-6 text-neutral-200" />
          <span className="mt-2 text-base text-neutral-200">参考画像をアップロードしてください</span>
          <span className="mt-1 text-xs text-neutral-400">20MB以下の画像アップロードしてください</span>
        </label>
      </div>

      <h6 className="mt-[18px] h-5 text-base font-normal leading-5 text-white/90">修復内容を選択します</h6>
      <div role="tablist" aria-label="修復内容" className="mt-[18px] flex h-[27px] items-start">
        <span role="tab" aria-selected="true" className="border-b-2 border-[#20d0c4] pb-1 text-sm text-[#20d0c4]">手足の変形を修正</span>
      </div>
      <div role="tabpanel" className="flex min-h-[96px] flex-col items-center justify-end gap-3 pb-1">
        {source && (
          <div className="flex items-center gap-2">
            <button type="button" aria-pressed={maskMode} disabled={locked} onClick={() => setMaskMode((value) => !value)} className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm ${maskMode ? 'border-[#20d0c4] bg-[#20d0c4]/15 text-[#20d0c4]' : 'border-white/15 text-white/80'}`}>
              <Brush aria-hidden="true" className="h-4 w-4" />マスクツール
            </button>
            <button type="button" disabled={locked || (!maskDirty && !maskReference)} onClick={clearMask} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-sm text-white/70 disabled:opacity-40">
              <Trash2 aria-hidden="true" className="h-4 w-4" />マスクをクリア
            </button>
            {maskReference && <span className="text-xs text-[#20d0c4]" data-testid="image-repair-mask-ready">マスク選択済み</span>}
          </div>
        )}
        <p className="inline-flex h-10 items-center gap-2 rounded-full bg-[#2a2740] px-5 text-sm text-[#b9b3ff]">
          <Sparkles aria-hidden="true" className="h-4 w-4" />「マスクツール」を使用して手足の部分をマスクで選択してください
        </p>
      </div>

      {heavyBrand.failed && <p role="alert" className="mt-3 text-sm text-rose-200">ワークスペースを準備できません。ページを再読み込みしてください。</p>}
      {workspace.error && <p role="alert" className="mt-3 text-sm text-rose-200">{workspace.error}</p>}
      {workspace.pendingId && workspace.status !== 'running' && <button type="button" onClick={() => void workspace.reconcile()} className="mt-3 self-start rounded-lg border border-white/15 px-3 py-2 text-sm text-white/85">同じ依頼を照合</button>}
      <div className="mt-auto flex justify-end pt-4">
        <button type="button" data-testid="image-repair-generate" disabled={locked || !source} onClick={generate} className="inline-flex h-10 w-[288px] items-center justify-center gap-1 rounded-lg bg-[#5fd0c8] text-sm font-medium text-slate-950 transition hover:brightness-105 disabled:opacity-60">
          {workspace.status === 'running' ? '生成中…' : 'AI生成'}<Sparkles aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const result = resultUrl ? (
    <div data-testid="image-repair-result" className="flex h-full flex-col items-center justify-center px-10 pb-6 pt-16">
      <img src={resultUrl} alt="画像修正 AI生成" className="max-h-full max-w-full rounded-lg object-contain" />
    </div>
  ) : workspace.status === 'running' ? (
    <div className="flex h-full items-center justify-center text-sm text-white/70" role="status">生成中…</div>
  ) : (
    <div className="flex h-full w-full flex-col items-center justify-center px-14 text-center">
      <h5 className="text-[20px] font-bold leading-[25.2px] text-white">画像修正</h5>
      <p className="mt-2 text-sm leading-[21px] text-neutral-400">手足や顔の奇形をAIが修復します</p>
    </div>
  );

  return (
    <div className="contents" data-workspace-feature={workspace.toolId} data-resume-job={workspace.jobId ?? ''} data-resume-state={workspace.status}>
      <LightchainDesignToolFrame active="image-repair" tabs={LIGHTCHAIN_IMAGE_REPAIR_TABS} railGroup={1} showNotice={false} testId="image-repair-page" navigationLocked={locked}>{controls}{result}</LightchainDesignToolFrame>
    </div>
  );
}
