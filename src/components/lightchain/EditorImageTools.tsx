import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Crop, Download, FlipHorizontal2, FlipVertical2, FolderHeart, Keyboard, RotateCcw, Scan, SlidersHorizontal, X } from 'lucide-react';

/**
 * Light's per-image tools on the プリントデザイン and 色変更 editors (measured 2026-10-28): the image toolbar's
 * 色調整 / 画像調整 panels, コレクション, the 2K / 4K 高画質化 menu, the ダウンロードPNG / JPG / AVIF menu, and the
 * bottom-right ショートカットキーを表示 sheet. Each editor keeps the values; these components only draw and edit them.
 */

/** 色調整: 色味 is degrees (-180…180); 彩度・明るさ・コントラスト are -100…100 around the original (0). */
export type ImageTone = { hue: number; saturation: number; brightness: number; contrast: number };
/** 画像調整: flips, 透過度 (0…100) and the 画像をトリミング frame as insets (0…0.9 of each side). */
export type ImageCrop = { top: number; right: number; bottom: number; left: number };
export type ImageEdit = { tone: ImageTone; flipX: boolean; flipY: boolean; opacity: number; crop: ImageCrop | null };

export const NO_TONE: ImageTone = { hue: 0, saturation: 0, brightness: 0, contrast: 0 };
export const NO_EDIT: ImageEdit = { tone: NO_TONE, flipX: false, flipY: false, opacity: 100, crop: null };
const FULL_CROP: ImageCrop = { top: 0, right: 0, bottom: 0, left: 0 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

export const imageEditFilter = (edit: ImageEdit) => {
  const { hue, saturation, brightness, contrast } = edit.tone;
  return `hue-rotate(${hue}deg) saturate(${100 + saturation}%) brightness(${100 + brightness}%) contrast(${100 + contrast}%)`;
};
export const imageEditStyle = (edit: ImageEdit): CSSProperties => ({
  filter: imageEditFilter(edit),
  opacity: edit.opacity / 100,
  transform: `scale(${edit.flipX ? -1 : 1}, ${edit.flipY ? -1 : 1})`,
  clipPath: edit.crop ? `inset(${edit.crop.top * 100}% ${edit.crop.right * 100}% ${edit.crop.bottom * 100}% ${edit.crop.left * 100}%)` : undefined,
});

/** Saved as one JSON string so an unsaved draft can keep it in its input state. */
export const encodeImageEdit = (edit: ImageEdit) => JSON.stringify(edit);
export const decodeImageEdit = (value: unknown): ImageEdit => {
  let raw: unknown = value;
  if (typeof value === 'string') { try { raw = JSON.parse(value); } catch { return NO_EDIT; } }
  if (!raw || typeof raw !== 'object') return NO_EDIT;
  const data = raw as Partial<ImageEdit>;
  const tone = (data.tone ?? {}) as Partial<ImageTone>;
  const crop = data.crop && typeof data.crop === 'object' ? data.crop as Partial<ImageCrop> : null;
  return {
    tone: { hue: clamp(Number(tone.hue), -180, 180), saturation: clamp(Number(tone.saturation), -100, 100), brightness: clamp(Number(tone.brightness), -100, 100), contrast: clamp(Number(tone.contrast), -100, 100) },
    flipX: data.flipX === true, flipY: data.flipY === true,
    opacity: data.opacity === undefined ? 100 : clamp(Number(data.opacity), 0, 100),
    crop: crop ? { top: clamp(Number(crop.top), 0, 0.9), right: clamp(Number(crop.right), 0, 0.9), bottom: clamp(Number(crop.bottom), 0, 0.9), left: clamp(Number(crop.left), 0, 0.9) } : null,
  };
};

export type EditorExportFormat = 'png' | 'jpeg' | 'avif';
const EXPORT_MIME: Record<EditorExportFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', avif: 'image/avif' };

/** Draws the image with its 色調整 / 画像調整 applied, cropped, in the chosen format. Rejects when the browser cannot write that format. */
export async function renderEditedImage(url: string, edit: ImageEdit, format: EditorExportFormat = 'png'): Promise<Blob> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const crop = edit.crop ?? FULL_CROP;
  const sx = Math.round(bitmap.width * crop.left);
  const sy = Math.round(bitmap.height * crop.top);
  const sw = Math.max(1, Math.round(bitmap.width * (1 - crop.left - crop.right)));
  const sh = Math.max(1, Math.round(bitmap.height * (1 - crop.top - crop.bottom)));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas_unavailable');
  if (format === 'jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, sw, sh); }
  context.filter = imageEditFilter(edit);
  context.globalAlpha = edit.opacity / 100;
  context.translate(edit.flipX ? sw : 0, edit.flipY ? sh : 0);
  context.scale(edit.flipX ? -1 : 1, edit.flipY ? -1 : 1);
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, EXPORT_MIME[format], 0.92));
  if (!blob || blob.type !== EXPORT_MIME[format]) throw new Error(`format_unsupported:${format}`);
  return blob;
}

const panelShell = 'absolute left-full top-0 z-30 ml-3 w-[255px] rounded-2xl border border-white/10 bg-[#25292b] p-4 text-sm text-white shadow-2xl';
const footerButton = 'h-8 rounded-lg bg-white/10 px-4 text-sm text-white/80 hover:bg-white/15 disabled:opacity-40';

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="flex items-center justify-between"><h3 className="text-sm font-medium">{title}</h3>
    <button type="button" aria-label="閉じる" onClick={onClose} className="text-white/60 hover:text-white"><X className="h-4 w-4" /></button></div>;
}

function NumberSlider({ label, value, min, max, onChange, track, suffix = '' }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; track?: string; suffix?: string }) {
  return <div className="mt-4">
    <div className="flex items-center justify-between"><span className="text-white/80">{label}</span>
      <input type="number" aria-label={label} value={value} min={min} max={max} onChange={(event) => onChange(clamp(Number(event.target.value), min, max))}
        className="h-8 w-12 rounded-lg border border-white/10 bg-transparent px-2 text-sm text-white outline-none [appearance:textfield]" />{suffix && <span className="sr-only">{suffix}</span>}</div>
    <input type="range" aria-label={`${label}のスライダー`} min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))}
      className="mt-2 h-1 w-full cursor-pointer appearance-none rounded-full accent-[#0bcabc]" style={{ background: track ?? 'linear-gradient(90deg,#3f4447,#d4d4d4)' }} />
  </div>;
}

/** Light's 色調整 panel: 色味・彩度・明るさ・コントラスト, リセット and 適用. The image previews each change; closing without 適用 restores it. */
export function ColorAdjustPanel({ value, onPreview, onApply, onClose }: { value: ImageTone; onPreview: (tone: ImageTone) => void; onApply: (tone: ImageTone) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value);
  const opened = useRef(value);
  const set = (patch: Partial<ImageTone>) => { const next = { ...draft, ...patch }; setDraft(next); onPreview(next); };
  const changed = JSON.stringify(draft) !== JSON.stringify(opened.current);
  const close = () => { onPreview(opened.current); onClose(); };
  return <div className={panelShell} role="dialog" aria-label="色調整" data-testid="editor-color-panel" onPointerDown={(event) => event.stopPropagation()}>
    <PanelHeader title="色調整" onClose={close} />
    <NumberSlider label="色味" value={draft.hue} min={-180} max={180} onChange={(hue) => set({ hue })} track="linear-gradient(90deg,#ef4444,#f59e0b,#eab308,#22c55e)" />
    <NumberSlider label="彩度" value={draft.saturation} min={-100} max={100} onChange={(saturation) => set({ saturation })} track="linear-gradient(90deg,#6b7280,#0bcabc)" />
    <NumberSlider label="明るさ" value={draft.brightness} min={-100} max={100} onChange={(brightness) => set({ brightness })} track="linear-gradient(90deg,#000,#fff)" />
    <NumberSlider label="コントラスト" value={draft.contrast} min={-100} max={100} onChange={(contrast) => set({ contrast })} track="linear-gradient(90deg,#000,#fff)" />
    <div className="mt-6 flex items-center justify-between">
      <button type="button" onClick={() => set(NO_TONE)} className="flex items-center gap-1 text-white/80 hover:text-white">リセット<RotateCcw className="h-3.5 w-3.5" /></button>
      <button type="button" disabled={!changed} onClick={() => { onApply(draft); onClose(); }} className={footerButton}>適用</button>
    </div>
  </div>;
}

/** Light's 画像調整 panel: 水平反転 / 垂直反転, 透過度, 画像をトリミング, リセット and 適用. */
export function ImageAdjustPanel({ value, onPreview, onApply, onClose }: {
  value: ImageEdit; onPreview: (edit: ImageEdit) => void; onApply: (edit: ImageEdit) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const opened = useRef(value);
  const set = (patch: Partial<ImageEdit>) => { const next = { ...draft, ...patch }; setDraft(next); onPreview(next); };
  const changed = JSON.stringify(draft) !== JSON.stringify(opened.current);
  const close = () => { onPreview(opened.current); onClose(); };
  return <div className={panelShell} role="dialog" aria-label="画像調整" data-testid="editor-image-panel" onPointerDown={(event) => event.stopPropagation()}>
    <PanelHeader title="画像調整" onClose={close} />
    <div className="mt-4 grid grid-cols-2 gap-2">
      <button type="button" aria-pressed={draft.flipX} onClick={() => set({ flipX: !draft.flipX })} className="flex h-8 items-center justify-center gap-1 rounded-lg bg-white/10 text-sm hover:bg-white/15"><FlipHorizontal2 className="h-4 w-4" />水平反転</button>
      <button type="button" aria-pressed={draft.flipY} onClick={() => set({ flipY: !draft.flipY })} className="flex h-8 items-center justify-center gap-1 rounded-lg bg-white/10 text-sm hover:bg-white/15"><FlipVertical2 className="h-4 w-4" />垂直反転</button>
    </div>
    <NumberSlider label="透過度" value={draft.opacity} min={0} max={100} onChange={(opacity) => set({ opacity })} suffix="%" />
    <div className="mt-4 border-t border-white/10 pt-4">
      <label className="flex items-center justify-between px-2 text-white/80">画像をトリミング
        <button type="button" role="switch" aria-checked={Boolean(draft.crop)} aria-label="画像をトリミング" onClick={() => set({ crop: draft.crop ? null : { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 } })}
          className={`relative h-5 w-10 rounded-full transition ${draft.crop ? 'bg-[#0bcabc]' : 'bg-white/20'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${draft.crop ? 'left-[22px]' : 'left-0.5'}`} /></button>
      </label>
      {draft.crop && <p className="mt-2 px-2 text-xs text-white/50">画像の上の枠の角をドラッグして範囲を決めます。</p>}
    </div>
    <div className="mt-5 flex items-center justify-between">
      <button type="button" onClick={() => set({ flipX: false, flipY: false, opacity: 100, crop: null })} className="flex items-center gap-1 text-white/80 hover:text-white">リセット<RotateCcw className="h-3.5 w-3.5" /></button>
      <button type="button" disabled={!changed} onClick={() => { onApply(draft); onClose(); }} className={footerButton}>適用</button>
    </div>
  </div>;
}

/** The 画像をトリミング frame drawn over the image; the corners move the insets. */
export function CropFrame({ crop, onChange }: { crop: ImageCrop; onChange: (crop: ImageCrop) => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const drag = (corner: 'tl' | 'tr' | 'bl' | 'br') => (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    event.preventDefault();
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const move = (moveEvent: PointerEvent) => {
      const x = clamp((moveEvent.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((moveEvent.clientY - rect.top) / rect.height, 0, 1);
      const next = { ...crop };
      if (corner.includes('l')) next.left = clamp(x, 0, 0.9 - crop.right);
      if (corner.includes('r')) next.right = clamp(1 - x, 0, 0.9 - crop.left);
      if (corner.includes('t')) next.top = clamp(y, 0, 0.9 - crop.bottom);
      if (corner.includes('b')) next.bottom = clamp(1 - y, 0, 0.9 - crop.top);
      onChange(next);
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };
  const handle = 'absolute h-3 w-3 rounded-sm border border-[#0bcabc] bg-white';
  return <div ref={box} className="pointer-events-none absolute inset-0 z-10" data-testid="editor-crop-frame">
    <div className="absolute border border-dashed border-[#0bcabc] shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" style={{ top: `${crop.top * 100}%`, right: `${crop.right * 100}%`, bottom: `${crop.bottom * 100}%`, left: `${crop.left * 100}%` }}>
      <span role="presentation" onPointerDown={drag('tl')} className={`${handle} pointer-events-auto -left-1.5 -top-1.5 cursor-nwse-resize`} />
      <span role="presentation" onPointerDown={drag('tr')} className={`${handle} pointer-events-auto -right-1.5 -top-1.5 cursor-nesw-resize`} />
      <span role="presentation" onPointerDown={drag('bl')} className={`${handle} pointer-events-auto -bottom-1.5 -left-1.5 cursor-nesw-resize`} />
      <span role="presentation" onPointerDown={drag('br')} className={`${handle} pointer-events-auto -bottom-1.5 -right-1.5 cursor-nwse-resize`} />
    </div>
  </div>;
}

function MenuButton({ label, icon, items, testId, disabled }: { label: string; icon: ReactNode; items: { label: string; onSelect: () => void }[]; testId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  return <span className="relative">
    <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} data-testid={testId} onClick={() => setOpen((value) => !value)}
      className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10 disabled:opacity-40">{icon}</button>
    {open && <>
      <span className="fixed inset-0 z-30" aria-hidden="true" onClick={() => setOpen(false)} />
      <span role="menu" aria-label={label} className="absolute left-1/2 top-full z-40 mt-2 flex w-40 -translate-x-1/2 flex-col rounded-xl border border-white/10 bg-[#25292b] p-1.5 shadow-2xl">
        {items.map((item) => <button key={item.label} type="button" role="menuitem" onClick={() => { setOpen(false); item.onSelect(); }} className="rounded-lg px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10">{item.label}</button>)}
      </span>
    </>}
  </span>;
}

/** Light's 高画質化 (2K / 4K). */
export function UpscaleMenu({ onSelect, disabled }: { onSelect: (scale: 2 | 4) => void; disabled?: boolean }) {
  return <MenuButton label="高画質化" testId="editor-upscale" disabled={disabled} icon={<Scan className="h-4 w-4" />}
    items={[{ label: '2K', onSelect: () => onSelect(2) }, { label: '4K', onSelect: () => onSelect(4) }]} />;
}

/** Light's ダウンロードPNG / ダウンロードJPG / ダウンロードAVIF. */
export function DownloadMenu({ onSelect }: { onSelect: (format: EditorExportFormat) => void }) {
  return <MenuButton label="ダウンロード" testId="editor-download" icon={<Download className="h-4 w-4" />}
    items={[{ label: 'ダウンロードPNG', onSelect: () => onSelect('png') }, { label: 'ダウンロードJPG', onSelect: () => onSelect('jpeg') }, { label: 'ダウンロードAVIF', onSelect: () => onSelect('avif') }]} />;
}

export function CollectButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return <button type="button" aria-label="コレクション" title="コレクション" disabled={disabled} data-testid="editor-collect" onClick={onClick}
    className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10 disabled:opacity-40"><FolderHeart className="h-4 w-4" /></button>;
}

export function ToolbarTextButton({ label, icon, onClick, active, disabled, testId }: { label: string; icon: 'color' | 'image'; onClick: () => void; active?: boolean; disabled?: boolean; testId?: string }) {
  return <button type="button" aria-pressed={active} disabled={disabled} data-testid={testId} onClick={onClick}
    className={`flex h-8 items-center gap-1 rounded-lg px-1.5 text-sm hover:bg-white/10 disabled:opacity-40 ${active ? 'bg-white/10' : ''}`}>
    {icon === 'color' ? <SlidersHorizontal className="h-4 w-4" /> : <Crop className="h-4 w-4" />}{label}</button>;
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Ctrl', 'C'], label: 'コピー' }, { keys: ['Ctrl', 'V'], label: '貼り付け' }, { keys: ['⌫'], label: '削除' },
  { keys: ['Space', 'マウス'], label: 'ドラッグ' }, { keys: ['Ctrl', 'Z'], label: '取り消し' },
  { keys: ['Ctrl', 'Shift', 'Z'], label: 'やり直し' }, { keys: ['ホイール'], label: 'キャンバスをズーム' },
];

/** Light's bottom-right ⌨ button and its ショートカットキーを表示 sheet along the bottom of the editor. */
export function ShortcutSheetButton({ buttonClassName }: { buttonClassName?: string } = {}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" aria-label="ショートカットキーを表示" aria-expanded={open} data-testid="editor-shortcuts" onClick={() => setOpen((value) => !value)}
      className={buttonClassName ?? 'absolute bottom-[10px] right-20 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#262a2b] text-white/80 hover:text-white'}><Keyboard className="h-4 w-4" /></button>
    {open && <section role="dialog" aria-label="ショートカットキーを表示" data-testid="editor-shortcut-sheet" className="absolute bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#25292b] px-6 pb-6 pt-5 text-white">
      <div className="flex items-center justify-between"><h3 className="text-base font-medium">ショートカットキーを表示</h3>
        <button type="button" aria-label="閉じる" onClick={() => setOpen(false)} className="text-white/60 hover:text-white"><X className="h-4 w-4" /></button></div>
      <ul className="mt-5 grid grid-cols-5 gap-x-6 gap-y-5 text-sm">
        {SHORTCUTS.map((shortcut) => <li key={shortcut.label} className="flex items-center gap-1.5">
          {shortcut.keys.map((key, index) => <span key={key} className="flex items-center gap-1.5">{index > 0 && <span className="text-white/60">+</span>}
            <kbd className="rounded border border-white/30 px-1.5 py-0.5 text-xs text-white/90">{key}</kbd></span>)}
          <span className="ml-1 text-white/90">{shortcut.label}</span></li>)}
      </ul>
    </section>}
  </>;
}
