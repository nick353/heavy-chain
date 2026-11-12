import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  ArrowUp, Brush, BrushCleaning, Check, ChevronDown, ChevronRight, Crop, Eraser, Lasso, Minus, PenLine, Plus, Redo2, Scaling, ScanSearch,
  SquareDashedMousePointer, Undo2, WandSparkles, X, Zap, ZoomIn, ZoomOut,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { upscaleImage } from '../../lib/clientImageOps';
import { refreshSignedImageUrl } from '../../lib/storage';
import { BRAND_LIKENESS_BLOCK_COPY, validateLegalSafetyInput } from '../../lib/legalSafetyGuard';
import {
  CROP_CUSTOM, CROP_PRESET_GROUPS, EXPAND_ERRORS, EXPAND_ORIGINAL, EXPAND_PRESET_GROUPS, EXPAND_SCALES, PARTIAL_EDIT_COLORS, STUDIO_EDIT_MENU, STUDIO_ERASE_PROMPT,
  STUDIO_EXPAND_PROMPT, STUDIO_REPAIR_PROMPT, STUDIO_UPSCALE_TOO_LARGE, presetRatio, studioAspectRatioLabel, studioCenteredCrop, studioDataUrlToFile, studioEditFileName,
  studioExpandOffset, studioExpandScaleEnabled, studioExpandSize, studioPartialEditPrompt, studioResizeCrop, studioUpscaleOptions,
  type StudioClientEditTool, type StudioCropHandle, type StudioEditToolId, type StudioExpandScale, type StudioRect, type StudioServerEditTool, type StudioUpscaleTarget,
} from '../../lib/studioImageEdit';
import { STUDIO_MASK_CANDIDATES, StudioMaskSurface, studioImageUrlToFile, type StudioMaskSurfaceHandle, type StudioMaskTool } from './StudioMaskSurface';

/**
 * 本家の「画像編集」のメニュー（画像を選ぶと出る道具の帯の「画像編集」）と、道具ごとの窓。
 * 並び・言葉は本家と同じ: 画像修復(NEW)／部分編集／高画質化›(2K・4K)／ワンクリックで背景削除／クリッピング／AIトリミング／AI拡張／AI削除。
 * - 手元で仕上がる道具（高画質化・背景削除・クリッピング・AIトリミング）は onClientResult(tool, file)
 * - 生成の窓口に頼む道具（画像修復・部分編集・AI拡張・AI削除）は onServerEdit(tool, { mainFile, guideFile?, prompt, editOptions? })
 * 本家ではどちらも結果を元の画像から線でつないだ新しい画像として置く（呼び出し側が置く）。
 */
export type StudioServerEditRequest = {
  mainFile: File;
  guideFile?: File;
  prompt: string;
  editOptions?: { aspectRatio?: string; resolution?: '1k' | '4k' };
};
export type { StudioClientEditTool, StudioServerEditTool } from '../../lib/studioImageEdit';

type Size = { width: number; height: number };
type StudioEditIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
const iconSvg = (className: string | undefined, children: ReactNode) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>{children}</svg>
);
// 本家の一覧の印（2026-11-12 本家の本番で開いて拡大して見た）: 画像修復は斜めに重ねた2本の帯、部分編集は点線の丸と筆、
// 高画質化は角の丸い四角と対角の矢印、背景削除は上半分が市松の画像、クリッピングは右下が市松の四角。AIトリミング・AI削除は lucide と同じ形。
const StudioRepairIcon: StudioEditIcon = ({ className }) => iconSvg(className, <>
  <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(45 12 12)" />
  <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)" />
</>);
const StudioPartialEditIcon: StudioEditIcon = ({ className }) => iconSvg(className, <>
  <path d="M15.5 4.6A8 8 0 1 0 18 16" strokeDasharray="2.6 2.6" />
  <path d="m21 5-7.4 8.6" />
  <path d="M13.6 13.6c-1.3-.2-2.5.7-2.8 2l-.6 2.6 2.6-.6c1.3-.3 2.2-1.5 2-2.8" />
</>);
const StudioUpscaleIcon: StudioEditIcon = ({ className }) => iconSvg(className, <>
  <path d="M21 11V7a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h4" />
  <path d="M14 7h3v3" /><path d="m17 7-4 4" /><path d="M10 17H7v-3" /><path d="m7 17 4-4" />
  <path d="M18 14.5v5M15.5 17h5" strokeWidth={1.6} />
</>);
const StudioRemoveBackgroundIcon: StudioEditIcon = ({ className }) => iconSvg(className, <>
  <rect x="3" y="3" width="18" height="18" rx="4" />
  <path d="M3 16c2.6-2.4 4.6-2.4 7 0s4.6 2.4 7 0l4-3" />
  <g fill="currentColor" stroke="none"><rect x="6" y="6" width="2.4" height="2.4" /><rect x="10.8" y="6" width="2.4" height="2.4" /><rect x="15.6" y="6" width="2.4" height="2.4" /><rect x="8.4" y="8.4" width="2.4" height="2.4" /><rect x="13.2" y="8.4" width="2.4" height="2.4" /><rect x="6" y="10.8" width="2.4" height="2.4" /><rect x="10.8" y="10.8" width="2.4" height="2.4" /><rect x="15.6" y="10.8" width="2.4" height="2.4" /></g>
</>);
const StudioClippingIcon: StudioEditIcon = ({ className }) => iconSvg(className, <>
  <path d="M21 11V7a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h4" />
  <g fill="currentColor" stroke="none"><rect x="15" y="12" width="3" height="3" /><rect x="12" y="15" width="3" height="3" /><rect x="18" y="15" width="3" height="3" /><rect x="15" y="18" width="3" height="3" /></g>
</>);
const TOOL_ICON: Record<StudioEditToolId, StudioEditIcon> = {
  repair: StudioRepairIcon, partial: StudioPartialEditIcon, upscale: StudioUpscaleIcon, 'remove-background': StudioRemoveBackgroundIcon, clipping: StudioClippingIcon, crop: Crop, expand: Scaling, erase: Eraser,
};
// A node's signed URL may have expired while the page was open: sign it again before reading (refreshSignedImageUrl).
const loadImage = async (url: string) => {
  const source = await refreshSignedImageUrl(url);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('studio_edit_image_load_failed'));
    image.src = source;
  });
};
const toPng = async (canvas: HTMLCanvasElement, name: string) => {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('studio_edit_encode_failed');
  return new File([blob], name, { type: 'image/png' });
};
const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message && !/^[a-z0-9_]+$/.test(error.message) ? error.message : fallback);
/** 生成の窓口に渡す前の法的な守り（ブランドの模倣・人物の似せは送らない）。 */
const legalBlocked = (...values: string[]) => {
  if (!validateLegalSafetyInput(values).blocked) return false;
  toast.error(BRAND_LIKENESS_BLOCK_COPY);
  return true;
};

// ---- メニュー ------------------------------------------------------------------------------------------------
export function StudioImageEditMenu({
  imageUrl, fileBaseName, disabled = false, disabledTools = [], repairCost, onClientResult, onServerEdit, onClose, label = '画像編集', triggerClassName, triggerIcon, align = 'start',
}: {
  imageUrl: string;
  /** 結果のファイル名の元（拡張子はあってもよい）。 */
  fileBaseName?: string;
  disabled?: boolean;
  /** 押せない道具（権限・残高など）。 */
  disabledTools?: readonly StudioEditToolId[];
  /** 画像修復の横に出すポイントの表示（本家は 4K の料金を出す）。 */
  repairCost?: ReactNode;
  onClientResult: (tool: StudioClientEditTool, file: File) => void | Promise<void>;
  onServerEdit: (tool: StudioServerEditTool, request: StudioServerEditRequest) => void | Promise<void>;
  /** メニューか窓が閉じたとき。 */
  onClose?: () => void;
  label?: string;
  triggerClassName?: string;
  /** ボタンの印（スタジオの帯は本家の帯の印を渡す）。 */
  triggerIcon?: ReactNode;
  align?: 'start' | 'end';
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [upscaleOpen, setUpscaleOpen] = useState(false);
  const [dialog, setDialog] = useState<Exclude<StudioEditToolId, 'repair' | 'upscale' | 'remove-background'> | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSize(null);
    void loadImage(imageUrl).then(image => { if (!cancelled) setSize({ width: image.naturalWidth, height: image.naturalHeight }); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [imageUrl]);

  const closeMenu = useCallback((notify: boolean) => {
    setMenuOpen(false); setUpscaleOpen(false);
    if (notify) onClose?.();
  }, [onClose]);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) closeMenu(true); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeMenu(true); };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [menuOpen, closeMenu]);

  const upscale = size ? studioUpscaleOptions(size.width, size.height) : null;
  const name = (tool: StudioEditToolId, extra?: string) => studioEditFileName(fileBaseName, tool, extra);
  const aspect = size ? studioAspectRatioLabel(size.width, size.height) : undefined;

  const runImmediate = async (title: string, task: () => Promise<void>) => {
    closeMenu(false);
    setRunning(title);
    const id = toast.loading(`${title}を実行中…`);
    try { await task(); toast.dismiss(id); } catch (error) { toast.error(errorText(error, `${title}に失敗しました。もう一度お試しください`), { id }); }
    finally { setRunning(null); onClose?.(); }
  };
  const choose = (tool: StudioEditToolId) => {
    if (tool === 'upscale') { setUpscaleOpen(open => !open); return; }
    if (tool === 'repair') {
      void runImmediate('画像修復', async () => {
        if (legalBlocked(STUDIO_REPAIR_PROMPT)) return;
        await onServerEdit('repair', { mainFile: await studioImageUrlToFile(imageUrl, name('repair')), prompt: STUDIO_REPAIR_PROMPT, editOptions: { resolution: '4k', aspectRatio: aspect } });
      });
      return;
    }
    if (tool === 'remove-background') {
      void runImmediate('背景削除', async () => {
        const { buildHighPrecisionMaterialCutoutDataUrl } = await import('../../lib/workspaceMaterialReferences');
        const cutout = await buildHighPrecisionMaterialCutoutDataUrl({ imageUrl, modelName: 'isnet-general-use', preserveSourceFrame: true, maxDataUrlBytes: 12 * 1024 * 1024 });
        await onClientResult('remove-background', studioDataUrlToFile(cutout.dataUrl, name('remove-background')));
      });
      return;
    }
    closeMenu(false);
    setDialog(tool);
  };
  const runUpscale = (target: StudioUpscaleTarget) => {
    if (!upscale?.[target].enabled) { toast.error(STUDIO_UPSCALE_TOO_LARGE); return; }
    void runImmediate('高画質化', async () => {
      const dataUrl = await upscaleImage(imageUrl, { scale: upscale[target].scale, sharpness: 40, denoiseLevel: 0 });
      await onClientResult('upscale', studioDataUrlToFile(dataUrl, name('upscale', target)));
    });
  };
  const closeDialog = () => { setDialog(null); onClose?.(); };

  // 本家の一覧は幅190・地 #303538・1行37px・文字12px（2026-11-12 本家の本番で開いて画素で測った）。いちばん長い
  // 「ワンクリックで背景削除」（12px×11字）が切れずに1行に入るよう、幅は194・右の余白は12px（本番で190だと末尾が「…」になった）。
  const itemClass = 'flex h-[37px] w-full items-center gap-2 rounded-lg pl-3.5 pr-3 text-left text-xs text-white/95 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div ref={rootRef} className="relative inline-flex" data-testid="studio-image-edit-menu">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={disabled || running !== null}
        onClick={() => (menuOpen ? closeMenu(true) : setMenuOpen(true))}
        className={triggerClassName ?? 'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-white/90 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40'}
      >
        {/* 本家の帯の「画像編集」は印と文字だけ（下向きの矢印は無い。2026-11-12 本家の本番で並べた）。 */}
        {triggerIcon ?? <WandSparkles aria-hidden="true" className="h-4 w-4" />}{label}
      </button>
      {menuOpen && (
        <div role="menu" aria-label={label} className={`absolute top-full z-40 mt-1.5 w-[194px] rounded-xl border border-white/10 bg-[#303538] p-1 shadow-2xl ${align === 'end' ? 'right-0' : 'left-0'}`}>
          {STUDIO_EDIT_MENU.map(item => {
            const Icon = TOOL_ICON[item.id];
            const off = disabledTools.includes(item.id);
            return (
              <div key={item.id} className="relative">
                <button type="button" role="menuitem" aria-haspopup={item.submenu ? 'menu' : undefined} aria-expanded={item.submenu ? upscaleOpen : undefined} disabled={off} onClick={() => choose(item.id)} className={itemClass}>
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.badge && <span className="rounded-full px-2 py-0.5 text-xs font-medium leading-4 text-[#0b2a33]" style={{ backgroundImage: 'linear-gradient(24.94deg, #7ef2e2 0%, #c9a7ff 100%)' }}>{item.badge}</span>}
                  {item.id === 'repair' && repairCost && <span className="text-xs text-white/50">{repairCost}</span>}
                  {item.submenu && <ChevronRight aria-hidden="true" className="h-4 w-4 text-white/60" />}
                </button>
                {item.submenu && upscaleOpen && (
                  <div role="menu" aria-label={item.label} className="absolute left-full top-0 z-50 ml-2 w-[140px] rounded-xl border border-white/10 bg-[#303538] p-1 shadow-2xl">
                    {(['2k', '4k'] as const).map(target => (
                      <button key={target} type="button" role="menuitem" disabled={!upscale?.[target].enabled} title={upscale && !upscale[target].enabled ? STUDIO_UPSCALE_TOO_LARGE : undefined} onClick={() => runUpscale(target)} className={itemClass}>
                        {target.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* The windows open over the whole page (the menu may sit in a moved toolbar, which would carry a fixed window along). */}
      {dialog && typeof document !== 'undefined' && createPortal(<div data-studio-chrome="">
        {dialog === 'partial' && <BrushEditDialog kind="partial" imageUrl={imageUrl} aspect={aspect} name={name} onClose={closeDialog} onClientResult={onClientResult} onServerEdit={onServerEdit} />}
        {dialog === 'clipping' && <BrushEditDialog kind="clipping" imageUrl={imageUrl} aspect={aspect} name={name} onClose={closeDialog} onClientResult={onClientResult} onServerEdit={onServerEdit} />}
        {dialog === 'erase' && <BrushEditDialog kind="erase" imageUrl={imageUrl} aspect={aspect} name={name} onClose={closeDialog} onClientResult={onClientResult} onServerEdit={onServerEdit} />}
        {dialog === 'crop' && <CropDialog imageUrl={imageUrl} name={name} onClose={closeDialog} onClientResult={onClientResult} />}
        {dialog === 'expand' && <ExpandDialog imageUrl={imageUrl} name={name} onClose={closeDialog} onServerEdit={onServerEdit} />}
      </div>, document.body)}
    </div>
  );
}

// ---- 窓の枠（本家: 全面の暗い窓、左上に道具の名前、右上に 縮小・倍率・拡大 と ✕） -------------------------------------
function EditDialogFrame({ icon: Icon, title, zoom, onClose, sidebar, children, testId, busy }: {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  title: string;
  zoom?: { percent: number; zoomIn: () => void; zoomOut: () => void };
  onClose: () => void;
  sidebar?: ReactNode;
  children: ReactNode;
  testId: string;
  busy?: string | null;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#060a0b] text-white" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <header className="flex h-[88px] shrink-0 items-center justify-between px-6">
        <h2 className="flex items-center gap-2 text-[17px] font-medium"><Icon aria-hidden="true" className="h-5 w-5" />{title}</h2>
        <div className="flex items-center gap-4">
          {zoom && (
            <div className="flex h-10 items-center gap-1 rounded-lg bg-[#1d2224] px-1.5">
              <button type="button" aria-label="縮小" onClick={zoom.zoomOut} className="inline-flex h-8 w-8 items-center justify-center rounded text-white/80 hover:bg-white/[0.08]"><ZoomOut aria-hidden="true" className="h-4 w-4" /></button>
              <span className="w-20 rounded-md bg-black/40 py-1 text-center text-sm text-white/90" aria-live="polite">{zoom.percent}%</span>
              <button type="button" aria-label="拡大" onClick={zoom.zoomIn} className="inline-flex h-8 w-8 items-center justify-center rounded text-white/80 hover:bg-white/[0.08]"><ZoomIn aria-hidden="true" className="h-4 w-4" /></button>
            </div>
          )}
          <button type="button" aria-label="閉じる" onClick={onClose} disabled={Boolean(busy)} className="inline-flex h-8 w-8 items-center justify-center rounded text-white/80 hover:bg-white/[0.08] disabled:opacity-40"><X aria-hidden="true" className="h-5 w-5" /></button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {sidebar && <aside className="flex w-[320px] shrink-0 flex-col bg-[#1d2224]">{sidebar}</aside>}
        <div className="relative min-h-0 flex-1">
          {children}
          {busy && <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 text-sm" role="status">{busy}</div>}
        </div>
      </div>
    </div>
  );
}

/** 右側の面に、中身（w×h の画素）を合わせて置く倍率。縮小・拡大のボタンは 1.2 倍ずつ。 */
function useFitScale(width: number, height: number, reserve = 64) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Size>({ width: 0, height: 0 });
  const [factor, setFactor] = useState(1);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => { const rect = element.getBoundingClientRect(); setBox({ width: rect.width, height: rect.height }); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fit = width > 0 && height > 0 && box.width > 0 ? Math.min(1, (box.width - reserve * 2) / width, (box.height - reserve * 2) / height) : 0;
  const scale = Math.max(0.02, fit * factor);
  return { ref, scale, percent: Math.round(scale * 100), zoomIn: () => setFactor(value => Math.min(8, value * 1.2)), zoomOut: () => setFactor(value => Math.max(0.2, value / 1.2)) };
}

// ---- 部分編集・クリッピング・AI削除（下に道具の帯） ----------------------------------------------------------------
type BrushKind = 'partial' | 'clipping' | 'erase';
const BRUSH_TEXT: Record<BrushKind, { title: string; icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>; testId: string }> = {
  // 窓の左上の印は一覧と同じ（本家の窓で見た）。
  partial: { title: '部分編集', icon: StudioPartialEditIcon, testId: 'studio-edit-partial' },
  clipping: { title: 'クリッピング', icon: StudioClippingIcon, testId: 'studio-edit-clipping' },
  erase: { title: 'AI削除', icon: Eraser, testId: 'studio-edit-erase' },
};
export const PARTIAL_EDIT_PLACEHOLDER = '編集内容を入力（例：赤枠内のネクタイをスカーフに変更）';
type BrushTool = 'brush' | 'eraser' | 'lasso' | 'rect' | 'marker';

function BrushEditDialog({ kind, imageUrl, aspect, name, onClose, onClientResult, onServerEdit }: {
  kind: BrushKind;
  imageUrl: string;
  aspect?: string;
  name: (tool: StudioEditToolId, extra?: string) => string;
  onClose: () => void;
  onClientResult: (tool: StudioClientEditTool, file: File) => void | Promise<void>;
  onServerEdit: (tool: StudioServerEditTool, request: StudioServerEditRequest) => void | Promise<void>;
}) {
  const text = BRUSH_TEXT[kind];
  const [tool, setTool] = useState<BrushTool>(kind === 'partial' ? 'marker' : 'brush');
  const [color, setColor] = useState<string>(PARTIAL_EDIT_COLORS[0].hex);
  const [brushSize, setBrushSize] = useState(kind === 'partial' ? 12 : 40);
  const [percent, setPercent] = useState(100);
  const [busy, setBusy] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [, setRevision] = useState(0);
  const surface = useRef<StudioMaskSurfaceHandle | null>(null);

  const surfaceTool: StudioMaskTool = tool === 'marker' ? 'brush' : tool;
  const markerColor = kind === 'partial' ? color : null;
  const handleError = (error: unknown) => { toast.error(errorText(error, '処理に失敗しました。もう一度お試しください')); };

  const generate = async () => {
    const current = surface.current;
    if (!current || busy) return;
    setBusy('処理中…');
    try {
      if (kind === 'clipping') {
        const file = await current.getCutout(name('clipping'));
        if (!file) { toast.error('調整したい部分を選択してください'); return; }
        await onClientResult('clipping', file);
        onClose();
        return;
      }
      if (kind === 'erase') {
        const guideFile = await current.getGuide(name('erase', 'guide'));
        if (!guideFile) { toast.error('調整したい部分を選択してください'); return; }
        if (legalBlocked(STUDIO_ERASE_PROMPT)) return;
        await onServerEdit('erase', { mainFile: await studioImageUrlToFile(imageUrl, name('erase', 'source')), guideFile, prompt: STUDIO_ERASE_PROMPT, editOptions: { aspectRatio: aspect } });
        onClose();
        return;
      }
      const prompt = studioPartialEditPrompt(instruction, current.usedColors());
      if (!prompt) { toast.error('編集内容を入力してください'); return; }
      if (legalBlocked(instruction, prompt)) return;
      const guideFile = current.isEmpty() ? null : await current.getGuide(name('partial', 'guide'));
      await onServerEdit('partial', { mainFile: await studioImageUrlToFile(imageUrl, name('partial', 'source')), ...(guideFile ? { guideFile } : {}), prompt, editOptions: { aspectRatio: aspect } });
      onClose();
    } catch (error) { handleError(error); } finally { setBusy(null); }
  };

  const bar = 'flex h-12 items-center gap-1 rounded-xl border border-white/10 bg-[#1d2224] px-1.5 shadow-xl';
  const toolButton = (active: boolean) => `inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg px-2 text-white/85 transition ${active ? 'bg-white/[0.12] text-white' : 'hover:bg-white/[0.08]'} disabled:cursor-not-allowed disabled:opacity-30`;
  const divider = <span className="mx-1 h-5 w-px bg-white/10" aria-hidden="true" />;
  const canUndo = surface.current?.canUndo() ?? false, canRedo = surface.current?.canRedo() ?? false;
  const slider = (
    <div className="flex items-center gap-1 px-1 text-white/60">
      <button type="button" aria-label="ブラシを細く" onClick={() => setBrushSize(value => Math.max(4, value - 4))} className="inline-flex h-7 w-5 items-center justify-center"><Minus aria-hidden="true" className="h-3 w-3" /></button>
      <input type="range" aria-label="ブラシの太さ" min={4} max={150} value={brushSize} onChange={event => setBrushSize(Number(event.target.value))} className="w-[84px] accent-[#14c4bb]" />
      <button type="button" aria-label="ブラシを太く" onClick={() => setBrushSize(value => Math.min(150, value + 4))} className="inline-flex h-7 w-5 items-center justify-center"><Plus aria-hidden="true" className="h-3 w-3" /></button>
    </div>
  );

  return (
    <EditDialogFrame icon={text.icon} title={text.title} testId={text.testId} onClose={onClose} busy={busy}
      zoom={{ percent, zoomIn: () => surface.current?.zoomIn(), zoomOut: () => surface.current?.zoomOut() }}>
      <div className="absolute inset-x-0 bottom-[112px] top-0">
        <StudioMaskSurface
          ref={surface}
          imageUrl={imageUrl}
          tool={surfaceTool}
          brushSize={brushSize}
          markerColor={markerColor}
          recognizeRect={kind === 'clipping'}
          onChange={() => setRevision(value => value + 1)}
          onZoomChange={setPercent}
          onBusyChange={setBusy}
          testId={`${text.testId}-surface`}
        />
      </div>
      <div className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-6">
        {kind === 'partial' && (
          <form className="flex h-[72px] w-[400px] max-w-[calc(100vw-32px)] items-center gap-3 rounded-2xl border border-white/15 bg-[#1d2224] px-4 shadow-xl" onSubmit={event => { event.preventDefault(); void generate(); }}>
            <input aria-label="編集内容" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={PARTIAL_EDIT_PLACEHOLDER} className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none" />
            <button type="submit" aria-label="送信" disabled={!instruction.trim() || Boolean(busy)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#14c4bb] text-slate-950 disabled:bg-[#0f5753] disabled:text-white/50"><ArrowUp aria-hidden="true" className="h-5 w-5" /></button>
          </form>
        )}
        <div className={bar} role="toolbar" aria-label={`${text.title}の道具`}>
          {kind === 'partial' && (
            <>
              <button type="button" aria-label="マーカー" title="マーカー" aria-pressed={tool === 'marker'} onClick={() => setTool('marker')} className={toolButton(tool === 'marker')}><PenLine aria-hidden="true" className="h-5 w-5" /></button>
              {PARTIAL_EDIT_COLORS.map(item => (
                <button key={item.hex} type="button" aria-label={`${item.label}のマーカー`} aria-pressed={tool === 'marker' && color === item.hex} onClick={() => { setColor(item.hex); setTool('marker'); }}
                  className={`mx-0.5 h-6 w-6 rounded-full border-2 ${tool === 'marker' && color === item.hex ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: item.hex }} />
              ))}
              {divider}
            </>
          )}
          {kind === 'clipping' && (
            <div className="relative">
              <button type="button" aria-label="AIマスク認識" title="AIマスク認識" aria-expanded={aiOpen} onClick={() => setAiOpen(open => !open)} className={toolButton(aiOpen)}><ScanSearch aria-hidden="true" className="h-5 w-5" /></button>
              {aiOpen && (
                <div role="menu" className="absolute bottom-12 left-0 z-20 w-36 rounded-lg bg-black p-1.5 shadow-xl">
                  {STUDIO_MASK_CANDIDATES.map(candidate => (
                    <button key={candidate} type="button" role="menuitem" className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-white/10"
                      onClick={() => { setAiOpen(false); void surface.current?.recognize(candidate).catch(() => toast.error('服装を認識できません。他のツールを選択してください')); }}>
                      <span className="inline-block h-4 w-4 rounded-full border border-white/40" />{candidate}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {kind !== 'partial' && (
            <>
              {kind === 'clipping' && divider}
              <button type="button" aria-label="投げ縄ツール" title="投げ縄ツール" aria-pressed={tool === 'lasso'} onClick={() => setTool('lasso')} className={toolButton(tool === 'lasso')}><Lasso aria-hidden="true" className="h-5 w-5" /></button>
              {kind === 'clipping' && <>{divider}<button type="button" aria-label="矩形選択" title="矩形選択" aria-pressed={tool === 'rect'} onClick={() => setTool('rect')} className={toolButton(tool === 'rect')}><SquareDashedMousePointer aria-hidden="true" className="h-5 w-5" /></button></>}
              {divider}
              <button type="button" aria-label="ブラシ" title="ブラシ" aria-pressed={tool === 'brush'} onClick={() => setTool('brush')} className={toolButton(tool === 'brush')}><Brush aria-hidden="true" className="h-5 w-5" /></button>
              {slider}
              {divider}
            </>
          )}
          <button type="button" aria-label="消しゴム" title="消しゴム" aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')} className={toolButton(tool === 'eraser')}><Eraser aria-hidden="true" className="h-5 w-5" /></button>
          {divider}
          <button type="button" aria-label="取り消し" title="取り消し" disabled={!canUndo} onClick={() => surface.current?.undo()} className={toolButton(false)}><Undo2 aria-hidden="true" className="h-5 w-5" /></button>
          <button type="button" aria-label="やり直し" title="やり直し" disabled={!canRedo} onClick={() => surface.current?.redo()} className={toolButton(false)}><Redo2 aria-hidden="true" className="h-5 w-5" /></button>
          {divider}
          <button type="button" aria-label="削除" title="削除" onClick={() => surface.current?.clear()} className={toolButton(false)}><BrushCleaning aria-hidden="true" className="h-5 w-5" /></button>
          {kind !== 'partial' && (
            <button type="button" data-testid={`${text.testId}-generate`} disabled={Boolean(busy)} onClick={() => void generate()} className="ml-1.5 h-9 rounded-lg bg-[#14c4bb] px-6 text-sm font-medium text-slate-950 disabled:opacity-50">生成</button>
          )}
        </div>
      </div>
    </EditDialogFrame>
  );
}

// ---- 左の比率のプリセット（AIトリミング・AI拡張で同じ形） -----------------------------------------------------------
function PresetList({ groups, value, onChange }: { groups: ReadonlyArray<{ label: string; presets: readonly string[] }>; value: string; onChange: (label: string) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ [groups[0].label]: true });
  const shape = (label: string) => {
    const ratio = presetRatio(label);
    const w = ratio >= 1 ? 14 : Math.max(6, 14 * (ratio || 0.75)), h = ratio >= 1 ? Math.max(6, 14 / ratio) : 14;
    return <span aria-hidden="true" className="inline-flex h-4 w-4 items-center justify-center"><span className="rounded-[3px] border border-current" style={{ width: w * 0.9, height: h * 0.9 }} /></span>;
  };
  return (
    <div className="flex flex-col gap-1">
      {groups.map(group => (
        <div key={group.label} className={open[group.label] ? 'rounded-xl bg-white/[0.06] p-2' : 'px-2'}>
          <button type="button" aria-expanded={Boolean(open[group.label])} onClick={() => setOpen(current => ({ ...current, [group.label]: !current[group.label] }))} className="flex h-9 w-full items-center gap-3 px-2 text-left text-[13px] text-white/90">
            {open[group.label] ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}{group.label}
          </button>
          {open[group.label] && group.presets.map(label => (
            <button key={`${group.label}-${label}`} type="button" aria-pressed={value === label} onClick={() => onChange(label)}
              className={`flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] ${value === label ? 'bg-white/[0.12] text-white' : 'text-white/80 hover:bg-white/[0.06]'}`}>
              {shape(label)}<span className="flex-1">{label}</span>{value === label && <Check aria-hidden="true" className="h-4 w-4" />}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

const CORNER = 'pointer-events-auto absolute h-4 w-4 border-white';
function FrameHandles({ onHandleDown }: { onHandleDown?: (handle: StudioCropHandle, event: ReactPointerEvent) => void }) {
  const corner = (handle: StudioCropHandle, position: string, border: string, cursor: string) => (
    <span key={handle} aria-hidden="true" onPointerDown={event => onHandleDown?.(handle, event)} className={`${CORNER} ${position} ${border} ${onHandleDown ? cursor : 'pointer-events-none'}`} />
  );
  const edge = (handle: StudioCropHandle, position: string, cursor: string) => (
    <span key={handle} aria-hidden="true" onPointerDown={event => onHandleDown?.(handle, event)} className={`pointer-events-auto absolute bg-white ${position} ${onHandleDown ? cursor : 'pointer-events-none'}`} />
  );
  return (
    <>
      {corner('nw', '-left-[3px] -top-[3px]', 'border-l-[3px] border-t-[3px]', 'cursor-nwse-resize')}
      {corner('ne', '-right-[3px] -top-[3px]', 'border-r-[3px] border-t-[3px]', 'cursor-nesw-resize')}
      {corner('sw', '-bottom-[3px] -left-[3px]', 'border-b-[3px] border-l-[3px]', 'cursor-nesw-resize')}
      {corner('se', '-bottom-[3px] -right-[3px]', 'border-b-[3px] border-r-[3px]', 'cursor-nwse-resize')}
      {edge('n', '-top-[3px] left-1/2 h-[3px] w-8 -translate-x-1/2', 'cursor-ns-resize')}
      {edge('s', '-bottom-[3px] left-1/2 h-[3px] w-8 -translate-x-1/2', 'cursor-ns-resize')}
      {edge('w', '-left-[3px] top-1/2 h-8 w-[3px] -translate-y-1/2', 'cursor-ew-resize')}
      {edge('e', '-right-[3px] top-1/2 h-8 w-[3px] -translate-y-1/2', 'cursor-ew-resize')}
    </>
  );
}

// ---- AIトリミング ------------------------------------------------------------------------------------------
function CropDialog({ imageUrl, name, onClose, onClientResult }: {
  imageUrl: string;
  name: (tool: StudioEditToolId, extra?: string) => string;
  onClose: () => void;
  onClientResult: (tool: StudioClientEditTool, file: File) => void | Promise<void>;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [preset, setPreset] = useState<string>(CROP_CUSTOM);
  const [rect, setRect] = useState<StudioRect | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const drag = useRef<{ handle: StudioCropHandle; x: number; y: number; rect: StudioRect } | null>(null);
  const width = image?.naturalWidth ?? 0, height = image?.naturalHeight ?? 0;
  const view = useFitScale(width, height);

  useEffect(() => {
    let cancelled = false;
    void loadImage(imageUrl).then(loaded => { if (!cancelled) { setImage(loaded); setRect(studioCenteredCrop(loaded.naturalWidth, loaded.naturalHeight, 0)); } }).catch(() => toast.error('画像を読み込めませんでした'));
    return () => { cancelled = true; };
  }, [imageUrl]);
  const choosePreset = (label: string) => { setPreset(label); if (image) setRect(studioCenteredCrop(image.naturalWidth, image.naturalHeight, presetRatio(label))); };
  const onHandleDown = (handle: StudioCropHandle, event: ReactPointerEvent) => {
    if (!rect) return;
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    drag.current = { handle, x: event.clientX, y: event.clientY, rect };
  };
  const onMove = (event: ReactPointerEvent) => {
    const current = drag.current;
    if (!current || !image) return;
    const dx = (event.clientX - current.x) / view.scale, dy = (event.clientY - current.y) / view.scale;
    setRect(studioResizeCrop(current.rect, current.handle, dx, dy, { width: image.naturalWidth, height: image.naturalHeight }, presetRatio(preset)));
  };
  const generate = async () => {
    if (!image || !rect || busy) return;
    setBusy('処理中…');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = rect.width; canvas.height = rect.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas_unavailable');
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      await onClientResult('crop', await toPng(canvas, name('crop')));
      onClose();
    } catch (error) { toast.error(errorText(error, 'トリミングに失敗しました。もう一度お試しください')); } finally { setBusy(null); }
  };

  return (
    <EditDialogFrame icon={Crop} title="AIトリミング" testId="studio-edit-crop" onClose={onClose} busy={busy} zoom={view}
      sidebar={(
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-2"><PresetList groups={CROP_PRESET_GROUPS} value={preset} onChange={choosePreset} /></div>
          <div className="p-2"><button type="button" data-testid="studio-edit-crop-generate" disabled={!rect || Boolean(busy)} onClick={() => void generate()} className="h-10 w-full rounded-lg bg-[#14c4bb] text-sm font-medium text-slate-950 disabled:opacity-50">生成</button></div>
        </>
      )}>
      <div ref={view.ref} className="absolute inset-0 flex items-center justify-center overflow-hidden" onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}>
        {image && rect && (
          <div className="relative shrink-0" style={{ width: width * view.scale, height: height * view.scale }}>
            <img src={image ? image.src : imageUrl} alt="トリミングする画像" className="absolute inset-0 size-full select-none" draggable={false} />
            <div className="absolute inset-0 overflow-hidden">
              <div
                className="absolute cursor-move border border-[#14c4bb]"
                style={{ left: rect.x * view.scale, top: rect.y * view.scale, width: rect.width * view.scale, height: rect.height * view.scale, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
                onPointerDown={event => onHandleDown('move', event)}
                data-testid="studio-edit-crop-frame"
              >
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/25" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/25" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/25" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/25" />
              </div>
            </div>
            <div className="pointer-events-none absolute" style={{ left: rect.x * view.scale, top: rect.y * view.scale, width: rect.width * view.scale, height: rect.height * view.scale }}>
              <FrameHandles onHandleDown={onHandleDown} />
              <span className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-xs text-white/90">{rect.width} x {rect.height}</span>
            </div>
          </div>
        )}
      </div>
    </EditDialogFrame>
  );
}

// ---- AI拡張 ------------------------------------------------------------------------------------------------
export const EXPAND_QUALITIES = [{ value: '1k', label: '1K' }, { value: '4k', label: '4K' }] as const;
function ExpandDialog({ imageUrl, name, onClose, onServerEdit }: {
  imageUrl: string;
  name: (tool: StudioEditToolId, extra?: string) => string;
  onClose: () => void;
  onServerEdit: (tool: StudioServerEditTool, request: StudioServerEditRequest) => void | Promise<void>;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState<StudioExpandScale>(1);
  const [preset, setPreset] = useState<string>(EXPAND_ORIGINAL);
  const [quality, setQuality] = useState<'1k' | '4k'>('1k');
  const [busy, setBusy] = useState<string | null>(null);
  const width = image?.naturalWidth ?? 0, height = image?.naturalHeight ?? 0;
  const ratio = presetRatio(preset);
  const target = studioExpandSize(width, height, scale, ratio);
  const offset = studioExpandOffset(width, height, target);
  const view = useFitScale(target.width, target.height);
  const unchanged = target.width === width && target.height === height;

  useEffect(() => {
    let cancelled = false;
    void loadImage(imageUrl).then(loaded => { if (!cancelled) setImage(loaded); }).catch(() => toast.error('画像を読み込めませんでした'));
    return () => { cancelled = true; };
  }, [imageUrl]);
  const choosePreset = (label: string) => {
    const next = studioExpandSize(width, height, scale, presetRatio(label));
    if (next.error) { toast.error(EXPAND_ERRORS[next.error]); return; }
    setPreset(label);
  };
  const generate = async () => {
    if (!image || busy || target.error || unchanged) return;
    setBusy('処理中…');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = target.width; canvas.height = target.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas_unavailable');
      context.drawImage(image, offset.x, offset.y, width, height);
      if (legalBlocked(STUDIO_EXPAND_PROMPT)) return;
      await onServerEdit('expand', {
        mainFile: await toPng(canvas, name('expand', 'canvas')),
        prompt: STUDIO_EXPAND_PROMPT,
        editOptions: { aspectRatio: studioAspectRatioLabel(target.width, target.height), resolution: quality },
      });
      onClose();
    } catch (error) { toast.error(errorText(error, 'AI拡張に失敗しました。もう一度お試しください')); } finally { setBusy(null); }
  };

  return (
    <EditDialogFrame icon={Scaling} title="AI拡張" testId="studio-edit-expand" onClose={onClose} busy={busy} zoom={view}
      sidebar={(
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="border-b border-white/[0.08] px-6 py-5">
              <label className="block text-xs text-white/60" htmlFor="studio-expand-scale">拡張倍率</label>
              <select id="studio-expand-scale" value={scale} onChange={event => setScale(Number(event.target.value) as StudioExpandScale)} className="mt-3 h-9 w-full rounded-md bg-transparent text-sm text-white focus:outline-none">
                {EXPAND_SCALES.map(value => <option key={value} value={value} disabled={width > 0 && !studioExpandScaleEnabled(width, height, value, ratio)} className="bg-[#1d2224]">{value}x</option>)}
              </select>
            </div>
            <p className="px-6 pb-2 pt-5 text-xs text-white/60">プリセット</p>
            <div className="px-2"><PresetList groups={EXPAND_PRESET_GROUPS} value={preset} onChange={choosePreset} /></div>
            {target.error && <p className="px-6 py-2 text-xs text-[#ff8a8a]" role="alert">{EXPAND_ERRORS[target.error]}</p>}
          </div>
          <div className="flex gap-2 p-2">
            <label className="relative flex h-10 w-[124px] items-center rounded-lg border border-white/10 pl-8 text-sm">
              <Zap aria-hidden="true" className="pointer-events-none absolute left-2.5 h-4 w-4 text-white/80" />
              <span className="sr-only">画質</span>
              <select value={quality} onChange={event => setQuality(event.target.value as '1k' | '4k')} className="h-full w-full bg-transparent text-white focus:outline-none">
                {EXPAND_QUALITIES.map(item => <option key={item.value} value={item.value} className="bg-[#1d2224]">{item.label}</option>)}
              </select>
            </label>
            <button type="button" data-testid="studio-edit-expand-generate" disabled={!image || Boolean(busy) || Boolean(target.error) || unchanged} title={unchanged ? '拡張倍率かプリセットを選ぶと生成できます' : undefined} onClick={() => void generate()} className="h-10 flex-1 rounded-lg bg-[#14c4bb] text-sm font-medium text-slate-950 disabled:opacity-50">生成</button>
          </div>
        </>
      )}>
      <div ref={view.ref} className="absolute inset-0 flex items-center justify-center overflow-hidden">
        {image && (
          <div className="relative shrink-0" style={{ width: target.width * view.scale, height: target.height * view.scale }} data-testid="studio-edit-expand-frame">
            <div aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: 'repeating-conic-gradient(#2a2f31 0% 25%, #1d2224 0% 50%)', backgroundSize: '16px 16px' }} />
            <img src={image ? image.src : imageUrl} alt="拡張する画像" className="absolute select-none" draggable={false} style={{ left: offset.x * view.scale, top: offset.y * view.scale, width: width * view.scale, height: height * view.scale }} />
            <div className="pointer-events-none absolute inset-0 border border-dashed border-[#14c4bb]"><FrameHandles /></div>
            <span className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-xs text-white/90">{target.width} x {target.height}</span>
          </div>
        )}
      </div>
    </EditDialogFrame>
  );
}
