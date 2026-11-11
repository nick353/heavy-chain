import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Check, ChevronDown, X, ZoomIn, ZoomOut } from 'lucide-react';
import { studioCenterOn, studioMinimapArrow, studioMinimapBounds, studioViewportRect, studioZoomPercent, STUDIO_ZOOM_PRESETS, fromLightZoom,
  type StudioRect, type StudioView } from '../../lib/studioCanvas';

const isTextTarget = (target: EventTarget | null) => target instanceof HTMLElement
  && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable || Boolean(target.closest('[role="dialog"], [role="menu"], [role="listbox"]')));

/**
 * Light's minimap (data-testid "canvas-navigation", 2026-11-12): a 240px card with every node as a filled rectangle and
 * the visible area outlined. Clicking centres that spot, dragging the outline moves the view, and the arrow keys move
 * the view by 10% of the canvas while the minimap is open.
 */
export function StudioMinimap({ nodes, view, size, onView, canvasRef, navigationRef }: {
  nodes: readonly StudioRect[];
  view: StudioView;
  size: { width: number; height: number };
  onView: (view: StudioView) => void;
  canvasRef: RefObject<HTMLElement | null>;
  navigationRef: RefObject<HTMLElement | null>;
}) {
  const viewport = studioViewportRect(view, size.width, size.height);
  const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; view: StudioView; worldPerPixel: number; method: 'drag' | 'click' } | null>(null);
  const [frozen, setFrozen] = useState<ReturnType<typeof studioMinimapBounds> | null>(null);
  const [dragging, setDragging] = useState(false);
  const bounds = frozen ?? studioMinimapBounds(nodes, viewport);
  const radius = (2 * bounds.width) / 232;
  const latest = useRef({ view, size, onView });
  latest.current = { view, size, onView };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const step = studioMinimapArrow(event.key);
      if (!step || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isTextTarget(event.target)) return;
      const target = event.target as Node | null;
      if (!(target === document.body || canvasRef.current?.contains(target) || navigationRef.current?.contains(target))) return;
      event.preventDefault(); event.stopPropagation();
      const { view: current, size: canvas, onView: apply } = latest.current;
      apply({ ...current, panX: current.panX + step[0] * canvas.width * 0.1, panY: current.panY + step[1] * canvas.height * 0.1 });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [canvasRef, navigationRef]);
  const finish = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null; setDragging(false); setFrozen(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div className="fashion-studio-minimap" data-testid="fashion-studio-minimap">
      <svg role="application" aria-label="ミニマップ。矢印キーで表示範囲を動かせます" tabIndex={0}
        viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} preserveAspectRatio="xMidYMid meet"
        style={{ cursor: dragging ? 'grabbing' : 'crosshair' }}
        onPointerDown={event => {
          if (event.button !== 0 || dragRef.current) return;
          const matrix = event.currentTarget.getScreenCTM();
          if (!matrix) return;
          event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
          const inside = point.x >= viewport.x && point.x <= viewport.x + viewport.width && point.y >= viewport.y && point.y <= viewport.y + viewport.height;
          dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, view, worldPerPixel: 1 / matrix.a, method: inside ? 'drag' : 'click' };
          setDragging(inside); setFrozen(bounds);
          if (!inside) onView(studioCenterOn(view, point, size.width, size.height));
        }}
        onPointerMove={event => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId || drag.method !== 'drag') return;
          const scale = drag.view.zoom / 0.3;
          onView({ ...drag.view, panX: drag.view.panX - (event.clientX - drag.clientX) * drag.worldPerPixel * scale,
            panY: drag.view.panY - (event.clientY - drag.clientY) * drag.worldPerPixel * scale });
        }}
        onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
        {nodes.map(node => <rect key={node.id} data-node-id={node.id} x={node.x} y={node.y} width={node.width} height={node.height} rx={radius} className="fashion-studio-minimap-node" />)}
        <rect data-testid="minimap-viewport" x={viewport.x} y={viewport.y} width={viewport.width} height={viewport.height} rx={radius}
          className="fashion-studio-minimap-viewport" vectorEffect="non-scaling-stroke" style={{ cursor: dragging ? 'grabbing' : 'grab' }} />
      </svg>
    </div>
  );
}

/** Light's zoom pill: 縮小 / the level with its preset menu (200%…3%, 画面に合わせる) / 拡大. */
export function StudioZoomControl({ zoom, onStep, onZoom, onFit }: { zoom: number; onStep: (direction: -1 | 1) => void; onZoom: (zoom: number) => void; onFit: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close, true); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', escape); };
  }, [open]);
  const percent = studioZoomPercent(zoom);
  return (
    <div ref={rootRef} className="fashion-studio-zoom-inner">
      <button type="button" aria-label="キャンバスを縮小" title="キャンバスを縮小" disabled={percent <= 3} onClick={() => onStep(-1)}><ZoomOut className="h-5 w-5" /></button>
      <button type="button" className="fashion-studio-zoom-level" aria-label="キャンバスの拡大率" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {percent}%<ChevronDown aria-hidden="true" className="h-4 w-4" />
      </button>
      <button type="button" aria-label="キャンバスを拡大" title="キャンバスを拡大" disabled={percent >= 400} onClick={() => onStep(1)}><ZoomIn className="h-5 w-5" /></button>
      {open && <div role="menu" aria-label="キャンバスの拡大率" className="fashion-studio-zoom-menu">
        {STUDIO_ZOOM_PRESETS.map(value => {
          const checked = percent === Math.round(value * 100);
          return <button key={value} type="button" role="menuitemradio" aria-checked={checked} className={checked ? 'is-checked' : ''}
            onClick={() => { setOpen(false); onZoom(fromLightZoom(value)); }}>{Math.round(value * 100)}%{checked && <Check aria-hidden="true" className="h-4 w-4" />}</button>;
        })}
        <button type="button" role="menuitem" onClick={() => { setOpen(false); onFit(); }}>画面に合わせる</button>
      </div>}
    </div>
  );
}

/**
 * Light's ショートカット panel (2026-11-12), in its own words. Only the keys Heavy's studio answers are listed:
 * copy / paste / duplicate / delete / multi-select and the mask-brush keys are not implemented here, so they are left out.
 */
export const STUDIO_SHORTCUT_GROUPS: readonly { label: string; items: readonly { label: string; shortcut: string }[] }[] = [
  { label: 'キャンバス', items: [
    { label: 'ドラッグ', shortcut: 'スペースキーを押しながらドラッグ / マウスの中ボタンを押しながらドラッグ' },
    { label: 'キャンバスを拡大', shortcut: 'Ctrl + マウスホイール' },
    { label: 'キャンバスを縮小', shortcut: 'Ctrl + マウスホイール' },
  ] },
  { label: '要素', items: [
    { label: 'グループの移動する', shortcut: '↑→↓←' },
    { label: '取り消し', shortcut: 'Ctrl + Z' },
    { label: 'やり直し', shortcut: 'Ctrl + Shift + Z' },
    { label: 'キャンセル', shortcut: 'ESC' },
  ] },
  { label: 'タスクノード', items: [{ label: 'AI生成', shortcut: 'Ctrl+Enter' }] },
];

export function StudioShortcutsPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [onClose]);
  return (
    <div className="fashion-studio-shortcuts-backdrop" data-studio-chrome onClick={onClose}>
      <section role="dialog" aria-label="ショートカット" className="fashion-studio-shortcuts" data-testid="fashion-studio-shortcuts" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between pb-2"><h3 className="text-base font-medium">ショートカット</h3>
          <button type="button" aria-label="ショートカットを閉じる" onClick={onClose} className="fashion-studio-shortcuts-close"><X className="h-4 w-4" /></button></div>
        {STUDIO_SHORTCUT_GROUPS.map(group => (
          <div key={group.label} className="pt-3">
            <div className="pb-1 text-sm font-medium">{group.label}</div>
            {group.items.map(item => (
              <div key={item.label} className="flex items-center justify-between gap-4 py-1.5">
                <div className="flex-1 text-sm fashion-studio-shortcuts-label">{item.label}</div>
                <div className="fashion-studio-shortcuts-key">{item.shortcut}</div>
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}

/** Light's ヘルプ: the studio's guide (its handbook text for ファッションスタジオ, for the functions Heavy has). */
const STUDIO_HELP_ITEMS: readonly { label: string; desc: string }[] = [
  { label: 'テキストで生成', desc: '参考画像をアップロードして指示を入力すると、AIが複数の画像を融合し、デザイン案をすばやく生成します。' },
  { label: '範囲指定で生成', desc: '範囲を塗ると、AIはその範囲だけを融合し、ほかの部分はそのまま保ちます。' },
  { label: '下着のフィッティング', desc: 'インナーフィッティング専用ツール。衣服の画像とモデル図から、着用イメージを生成します。' },
  { label: '3D画像に変換', desc: 'モデル画像の服を選ぶと、ワンクリックでEC向けの平置き画像を作ります。' },
];
export function StudioHelpDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-6" data-studio-chrome onClick={onClose}>
      <section role="dialog" aria-label="ヘルプ" className="fashion-studio-help" data-testid="fashion-studio-help" onClick={event => event.stopPropagation()}>
        <h3 className="text-lg font-medium">ファッションスタジオ</h3>
        <p className="mt-2 text-sm fashion-studio-help-muted">モデル画像が1枚あれば、機能を選んでコーディネートのデザインを始められます。生成した画像はキャンバスに並び、ドラッグで自由に配置できます。</p>
        <ul className="mt-4 flex flex-col gap-3">
          {STUDIO_HELP_ITEMS.map(item => <li key={item.label}><div className="text-sm font-medium">{item.label}</div><p className="mt-1 text-sm fashion-studio-help-muted">{item.desc}</p></li>)}
        </ul>
        <div className="mt-5 flex justify-end"><button type="button" onClick={onClose} className="h-9 rounded-lg bg-[#20d0c4] px-5 text-sm font-medium text-[#111817]">わかりました</button></div>
      </section>
    </div>
  );
}
