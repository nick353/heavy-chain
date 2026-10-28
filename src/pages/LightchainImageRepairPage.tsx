import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import toast from 'react-hot-toast';
import { ImagePlus, ImageUp, PenTool, Sparkles } from 'lucide-react';
import { useCanonicalImageWorkspace } from '../hooks/useCanonicalImageWorkspace';
import { useHeavyWorkspaceBrandGate } from '../hooks/useHeavyWorkspaceBrandGate';
import { withSignedImageUrls } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';
import { LIGHTCHAIN_IMAGE_REPAIR_TABS, LightchainDesignToolFrame } from '../components/lightchain/LightchainDesignToolFrame';
import { MaskPaintDialog } from '../components/lightchain/MaskPaintDialog';

/**
 * Light `/tools/reactor` = "画像修正", measured at 1440×900 on 2026-10-07: single 画像修正 tab, no deprecation notice,
 * フィッティングツール rail highlight, 564×280 source box, 修復内容を選択します + 手足の変形を修正 tab, the
 * 「マスクツール」 hint and the 288×40 run button. Light shows 権限がありません on this account; Heavy runs the repair.
 * Re-measured 2026-10-28 after an upload: the source box gets 再アップロード (top right) and a round マスク button
 * (bottom right) that opens Light's mask window; the painted mask is sent as a second reference image (red = area to repair).
 */
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
  const [maskOpen, setMaskOpen] = useState(false);
  const [maskData, setMaskData] = useState<ImageData | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
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

  /** Bakes the mask in red onto the source and stores it as the second reference ("修正箇所"). */
  const commitMask = async (mask: ImageData | null) => {
    setMaskOpen(false);
    setMaskData(mask);
    if (!mask) { if (maskReference) workspace.clearSource('secondary'); return; }
    if (!source) return;
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const loaded = new Image();
        loaded.crossOrigin = 'anonymous';
        loaded.onload = () => resolve(loaded);
        loaded.onerror = reject;
        loaded.src = source.imageUrl;
      });
      const tint = document.createElement('canvas');
      tint.width = mask.width; tint.height = mask.height;
      const tintContext = tint.getContext('2d');
      const composite = document.createElement('canvas');
      composite.width = mask.width; composite.height = mask.height;
      const context = composite.getContext('2d');
      if (!tintContext || !context) return;
      tintContext.putImageData(mask, 0, 0);
      tintContext.globalCompositeOperation = 'source-in';
      tintContext.fillStyle = MASK_COLOR;
      tintContext.fillRect(0, 0, tint.width, tint.height);
      context.drawImage(image, 0, 0, mask.width, mask.height);
      context.drawImage(tint, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => composite.toBlob(resolve, 'image/png'));
      if (blob) await workspace.upload('secondary', new File([blob], '修正箇所マスク.png', { type: 'image/png' }));
    } catch {
      // A restored remote source can taint the canvas; the repair still runs from the brief alone.
    }
  };

  const clearMask = () => {
    setMaskData(null);
    if (maskReference) workspace.clearSource('secondary');
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    clearMask();
    void workspace.upload('primary', file);
  };

  const generate = () => {
    if (locked || !source) return;
    void workspace.generate({ brief: imageRepairBrief(Boolean(maskReference)) });
  };

  const controls = (
    <div className="flex flex-1 flex-col">
      <div data-testid="image-repair-source" className="relative flex h-[280px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#33393b] text-center">
        <input ref={fileRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={locked} onChange={handleFile} aria-label="参考画像をアップロードしてください" />
        {source ? <>
          <img src={(maskReference?.imageUrl) ?? source.imageUrl} alt="参考画像" data-source-slot="primary" className="block max-h-[280px] max-w-full object-contain" />
          <span className="sr-only" data-testid="image-repair-file-name">{source.name}</span>
          <button type="button" aria-label="再アップロード" title="再アップロード" data-testid="image-repair-reupload" disabled={locked} onClick={() => fileRef.current?.click()} className="absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/25 disabled:opacity-40"><ImageUp aria-hidden="true" className="h-4 w-4" /></button>
          <button type="button" aria-label="マスクツール" title="マスクツール" data-testid="image-repair-mask" disabled={locked} onClick={() => setMaskOpen(true)} className="absolute bottom-4 right-4 inline-flex size-8 items-center justify-center rounded-full bg-[#20d0c4] text-slate-950 hover:brightness-105 disabled:opacity-40"><PenTool aria-hidden="true" className="h-4 w-4" /></button>
        </> : (
          <button type="button" disabled={locked} onClick={() => fileRef.current?.click()} className="absolute inset-0 flex flex-col items-center justify-center">
            <ImagePlus aria-hidden="true" className="h-6 w-6 text-neutral-200" />
            <span className="mt-2 text-base text-neutral-200">参考画像をアップロードしてください</span>
            <span className="mt-1 text-xs text-neutral-400">20MB以下の画像アップロードしてください</span>
          </button>
        )}
      </div>

      <h6 className="mt-[18px] h-5 text-base font-normal leading-5 text-white/90">修復内容を選択します</h6>
      <div role="tablist" aria-label="修復内容" className="mt-[18px] flex h-[27px] items-start">
        <span role="tab" aria-selected="true" className="border-b-2 border-[#20d0c4] pb-1 text-sm text-[#20d0c4]">手足の変形を修正</span>
      </div>
      <div role="tabpanel" className="flex min-h-[96px] flex-col items-center justify-end gap-3 pb-1">
        {maskReference && <span className="text-xs text-[#20d0c4]" data-testid="image-repair-mask-ready">マスク選択済み</span>}
        <p className="inline-flex h-10 items-center gap-2 rounded-full bg-[#2a2740] px-5 text-sm text-[#b9b3ff]">
          <Sparkles aria-hidden="true" className="h-4 w-4" />「マスクツール」を使用して手足の部分をマスクで選択してください
        </p>
      </div>

      {heavyBrand.failed && <p role="alert" className="mt-3 text-sm text-rose-200">ワークスペースを準備できません。ページを再読み込みしてください。</p>}
      {workspace.error && <p role="alert" className="mt-3 text-sm text-rose-200">{workspace.error}</p>}
      {workspace.pendingId && workspace.status !== 'running' && <button type="button" onClick={() => void workspace.reconcile()} className="mt-3 self-start rounded-lg border border-white/15 px-3 py-2 text-sm text-white/85">同じ依頼を照合</button>}
      <div className="mt-auto flex justify-end pt-4">
        <button type="button" data-testid="image-repair-generate" disabled={locked} onClick={() => { if (!source) { toast.error('画像をアップロードしてください'); return; } void generate(); }} className="inline-flex h-10 w-[288px] items-center justify-center gap-1 rounded-lg bg-[#5fd0c8] text-sm font-medium text-slate-950 transition hover:brightness-105 disabled:opacity-60">
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
      {maskOpen && source && <MaskPaintDialog imageUrl={source.imageUrl} hint="手足の変形を修正" paneTitle="変更したい手足の部分をマスクで選択してください" initialMask={maskData} onCancel={() => setMaskOpen(false)} onConfirm={(mask) => void commitMask(mask)} />}
      <LightchainDesignToolFrame active="image-repair" historyToolIds={['image-repair']} tabs={LIGHTCHAIN_IMAGE_REPAIR_TABS} railGroup={1} showNotice={false} testId="image-repair-page" navigationLocked={locked}>{controls}{result}</LightchainDesignToolFrame>
    </div>
  );
}
