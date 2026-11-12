import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BrushCleaning, Brush, ChevronDown, Lasso, Minus, PenTool, Plus, Redo2, ScanSearch, SlidersHorizontal, SquareDashed, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { STUDIO_MASK_CANDIDATES, StudioMaskSurface, type StudioMaskCandidate, type StudioMaskMode, type StudioMaskSurfaceHandle, type StudioMaskTool } from './StudioMaskSurface';

/**
 * 本家の簡易エディター（sr-only の題「簡易エディター」）。上の帯に
 * マスク調整｜AIマスク認識｜ブラシ｜投げ縄ツール｜矩形選択｜パスツール｜選択範囲をクリア｜↶↷｜キャンセル｜(呼び出し側のボタン)、
 * その下に選んだ道具の帯（追加選択｜選択解除｜ブラシなら − 太さ ＋）、真ん中に題つきの面。
 * 本家の baseCanvasProps / referenceCanvasProps と同じく、元画像と参考画像の2面にもできる（範囲指定の窓）。
 * 呼び出し側は actions(api) でボタンを差し込み、api.getMask() / getCutout() などで結果を受け取る。
 */
export type StudioMaskPaneId = 'base' | 'reference';
export type StudioMaskEditorTool = 'ai-mask' | 'brush' | 'lasso' | 'rect' | 'pen';
export const STUDIO_MASK_EDITOR_TOOLS: ReadonlyArray<{ id: StudioMaskEditorTool; label: string }> = [
  { id: 'ai-mask', label: 'AIマスク認識' },
  { id: 'brush', label: 'ブラシ' },
  { id: 'lasso', label: '投げ縄ツール' },
  { id: 'rect', label: '矩形選択' },
  { id: 'pen', label: 'パスツール' },
];
export const STUDIO_MASK_EDITOR_TEXT = {
  title: '簡易エディター',
  adjust: 'マスク調整',
  clear: '選択範囲をクリア',
  cancel: 'キャンセル',
  add: '追加選択',
  remove: '選択解除',
  baseTitle: '調整したい領域を描いてください',
  referenceTitle: '参考にしたい領域を描いてください',
  empty: '調整したい部分を選択してください',
  busy: '処理中…',
  recognizeFailed: '認識に失敗しました。選択範囲ツールに切り替えて、塗りつぶしを行うことができます',
} as const;

export type StudioMaskEditorPane = {
  imageUrl: string;
  /** 面の題。省略すると本家の既定（元画像「調整したい領域を描いてください」・参考画像「参考にしたい領域を描いてください」）。 */
  title?: string;
  /** 前に塗ったマスク（作業用の大きさ。MaskPaintDialog・regionMaskImageData と同じ）。 */
  initialMask?: ImageData | null;
  /** 書き出すファイル名の元。 */
  fileBaseName?: string;
};

export type StudioMaskEditorApi = {
  /** 元の大きさのマスク PNG（塗った所が白・ほかは透明）。pane を省くと元画像の面。 */
  getMask: (pane?: StudioMaskPaneId) => Promise<File | null>;
  /** 作業用の大きさのマスク（範囲指定の窓が今 MaskPaintDialog から受け取っている形）。 */
  getMaskImageData: (pane?: StudioMaskPaneId) => ImageData | null;
  /** 元の大きさのまま選択の外を透明にした PNG（本家 getSynthesis）。 */
  getCutout: (pane?: StudioMaskPaneId) => Promise<File | null>;
  /** 選択の外接矩形で切り出した透明 PNG（本家 imageAutoClip）。 */
  getClip: (pane?: StudioMaskPaneId) => Promise<File | null>;
  isEmpty: (pane?: StudioMaskPaneId) => boolean;
  /** 「調整したい部分を選択してください」を出す。 */
  notifyEmpty: () => void;
  /** 「処理中…」を出しながら非同期の処理を走らせる。投げられたら知らせを出して false を返す。 */
  run: (task: () => Promise<void>) => Promise<boolean>;
  busy: boolean;
};

const BRUSH_MIN = 5, BRUSH_MAX = 150, BRUSH_STEP = 5;

export function StudioMaskEditor({
  base, reference = null, tools = STUDIO_MASK_EDITOR_TOOLS.map(tool => tool.id), onCancel, actions, emptyMessage = STUDIO_MASK_EDITOR_TEXT.empty,
  ariaLabel = STUDIO_MASK_EDITOR_TEXT.title, recognizeRect = true, testId = 'studio-mask-editor',
}: {
  base: StudioMaskEditorPane;
  reference?: StudioMaskEditorPane | null;
  tools?: readonly StudioMaskEditorTool[];
  onCancel: () => void;
  actions?: (api: StudioMaskEditorApi) => ReactNode;
  emptyMessage?: string;
  ariaLabel?: string;
  /** 矩形選択で中の物を認識する（認識できなければ矩形を塗る）。 */
  recognizeRect?: boolean;
  testId?: string;
}) {
  const [tool, setTool] = useState<StudioMaskEditorTool>(tools.includes('brush') ? 'brush' : tools[0] ?? 'brush');
  const [mode, setMode] = useState<StudioMaskMode>('add');
  const [brushSize, setBrushSize] = useState(40);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [activePane, setActivePane] = useState<StudioMaskPaneId>('base');
  const [busy, setBusy] = useState<string | null>(null);
  const [, setRevision] = useState(0);
  const surfaces = useRef<Record<StudioMaskPaneId, StudioMaskSurfaceHandle | null>>({ base: null, reference: null });
  /** 本家の履歴は1本。どちらの面を変えたかの順番で戻す。 */
  const order = useRef<{ undo: StudioMaskPaneId[]; redo: StudioMaskPaneId[] }>({ undo: [], redo: [] });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  const paneChanged = useCallback(() => setRevision(value => value + 1), []);

  const pushOrder = (pane: StudioMaskPaneId) => { order.current.undo.push(pane); order.current.redo = []; };
  const step = (direction: 'undo' | 'redo') => {
    const from = order.current[direction], to = order.current[direction === 'undo' ? 'redo' : 'undo'];
    const pane = from.pop() ?? activePane;
    const surface = surfaces.current[pane];
    if (!surface || !(direction === 'undo' ? surface.canUndo() : surface.canRedo())) return;
    surface[direction]();
    to.push(pane);
  };

  const pick = (pane?: StudioMaskPaneId) => surfaces.current[pane ?? 'base'];
  const api: StudioMaskEditorApi = {
    getMask: async pane => (await pick(pane)?.getMask(`${(pane === 'reference' ? reference?.fileBaseName : base.fileBaseName) ?? 'image'}-mask.png`)) ?? null,
    getMaskImageData: pane => pick(pane)?.getMaskImageData() ?? null,
    getCutout: async pane => (await pick(pane)?.getCutout(`${(pane === 'reference' ? reference?.fileBaseName : base.fileBaseName) ?? 'image'}-cutout.png`)) ?? null,
    getClip: async pane => (await pick(pane)?.getClip(`${(pane === 'reference' ? reference?.fileBaseName : base.fileBaseName) ?? 'image'}-clip.png`)) ?? null,
    isEmpty: pane => pick(pane)?.isEmpty() ?? true,
    notifyEmpty: () => { toast.error(emptyMessage); },
    run: async task => {
      setBusy(STUDIO_MASK_EDITOR_TEXT.busy);
      try { await task(); return true; } catch (error) {
        toast.error(error instanceof Error && error.message && !/^[a-z_]+$/.test(error.message) ? error.message : '処理に失敗しました。もう一度お試しください');
        return false;
      } finally { setBusy(null); }
    },
    busy: busy !== null,
  };

  const recognize = async (candidate: StudioMaskCandidate) => {
    setAiMenuOpen(false);
    const surface = surfaces.current[activePane];
    if (!surface || busy) return;
    try { await surface.recognize(candidate, mode); } catch { toast.error(STUDIO_MASK_EDITOR_TEXT.recognizeFailed); }
  };
  const clearAll = () => {
    (['base', 'reference'] as const).forEach(pane => {
      const surface = surfaces.current[pane];
      if (surface && !surface.isEmpty()) surface.clear();
    });
  };

  const surfaceTool: StudioMaskTool = tool === 'ai-mask' ? 'none' : tool;
  const iconLabel = (id: StudioMaskEditorTool) => STUDIO_MASK_EDITOR_TOOLS.find(item => item.id === id)?.label ?? id;
  const toolButton = (active: boolean) => `inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] transition ${active ? 'bg-[#5fd0c8]/20 text-[#5fd0c8]' : 'text-white/85 hover:bg-white/[0.06]'} disabled:cursor-not-allowed disabled:opacity-40`;
  const iconButton = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-white/80 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-30';
  const anyUndo = (['base', 'reference'] as const).some(pane => surfaces.current[pane]?.canUndo());
  const anyRedo = (['base', 'reference'] as const).some(pane => surfaces.current[pane]?.canRedo());
  const panes: Array<{ id: StudioMaskPaneId; pane: StudioMaskEditorPane; title: string }> = [
    { id: 'base', pane: base, title: base.title ?? STUDIO_MASK_EDITOR_TEXT.baseTitle },
    ...(reference ? [{ id: 'reference' as const, pane: reference, title: reference.title ?? STUDIO_MASK_EDITOR_TEXT.referenceTitle }] : []),
  ];
  const icon = { 'ai-mask': ScanSearch, brush: Brush, lasso: Lasso, rect: SquareDashed, pen: PenTool } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-label={ariaLabel} data-testid={testId}>
      <div className="relative flex h-[773px] max-h-[calc(100vh-24px)] w-[1296px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg bg-[#232728] text-white shadow-2xl">
        <h2 className="sr-only">{STUDIO_MASK_EDITOR_TEXT.title}</h2>
        <div className="flex h-14 items-center gap-1 overflow-x-auto border-b border-white/[0.06] bg-[#1b1f20] px-4" role="toolbar" aria-label={STUDIO_MASK_EDITOR_TEXT.adjust}>
          <span className="mr-2 inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-white"><SlidersHorizontal aria-hidden="true" className="h-4 w-4" />{STUDIO_MASK_EDITOR_TEXT.adjust}</span>
          <span className="mx-1 h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />
          {STUDIO_MASK_EDITOR_TOOLS.filter(item => tools.includes(item.id)).map(item => {
            const Icon = icon[item.id];
            if (item.id === 'ai-mask') {
              return (
                <div key={item.id} className="relative shrink-0">
                  <button type="button" onClick={() => { setTool('ai-mask'); setAiMenuOpen(open => !open); }} disabled={busy !== null} aria-expanded={aiMenuOpen} aria-pressed={tool === 'ai-mask'} className={toolButton(tool === 'ai-mask')}>
                    <Icon aria-hidden="true" className="h-4 w-4" />{item.label}<ChevronDown aria-hidden="true" className="h-3 w-3" />
                  </button>
                  {aiMenuOpen && (
                    <div role="menu" className="absolute left-0 top-11 z-20 w-40 rounded-lg bg-black p-1.5 shadow-xl">
                      {STUDIO_MASK_CANDIDATES.map(candidate => (
                        <button key={candidate} type="button" role="menuitem" onClick={() => void recognize(candidate)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-white/10">
                          <span className="inline-block h-4 w-4 rounded-full border border-white/40" />{candidate}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return <button key={item.id} type="button" onClick={() => { setTool(item.id); setAiMenuOpen(false); }} disabled={busy !== null} aria-pressed={tool === item.id} className={toolButton(tool === item.id)}><Icon aria-hidden="true" className="h-4 w-4" />{item.label}</button>;
          })}
          <button type="button" onClick={clearAll} disabled={busy !== null} className={toolButton(false)}><BrushCleaning aria-hidden="true" className="h-4 w-4" />{STUDIO_MASK_EDITOR_TEXT.clear}</button>
          <span className="mx-1 h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />
          <button type="button" aria-label="元に戻す" title="元に戻す" onClick={() => step('undo')} disabled={!anyUndo || busy !== null} className={iconButton}><Undo2 aria-hidden="true" className="h-4 w-4" /></button>
          <button type="button" aria-label="やり直し" title="やり直し" onClick={() => step('redo')} disabled={!anyRedo || busy !== null} className={iconButton}><Redo2 aria-hidden="true" className="h-4 w-4" /></button>
          <div className="ml-auto flex shrink-0 items-center gap-3 pl-4">
            <button type="button" onClick={onCancel} disabled={busy !== null} className="h-8 rounded-lg border border-white/15 px-4 text-sm text-white/85 hover:bg-white/[0.06] disabled:opacity-40">{STUDIO_MASK_EDITOR_TEXT.cancel}</button>
            {actions?.(api)}
          </div>
        </div>
        <div className="flex h-11 items-center gap-1 bg-[#1b1f20]/60 px-4" role="toolbar" aria-label={`${iconLabel(tool)}の設定`}>
          <button type="button" onClick={() => setMode('add')} aria-pressed={mode === 'add'} className={toolButton(mode === 'add')}><Plus aria-hidden="true" className="h-3.5 w-3.5" />{STUDIO_MASK_EDITOR_TEXT.add}</button>
          <button type="button" onClick={() => setMode('remove')} aria-pressed={mode === 'remove'} className={toolButton(mode === 'remove')}><Minus aria-hidden="true" className="h-3.5 w-3.5" />{STUDIO_MASK_EDITOR_TEXT.remove}</button>
          {tool === 'brush' && (
            <div className="ml-3 flex items-center gap-2 text-white/70">
              <button type="button" aria-label="ブラシを細く" onClick={() => setBrushSize(value => Math.max(BRUSH_MIN, value - BRUSH_STEP))} className={iconButton}><Minus aria-hidden="true" className="h-3.5 w-3.5" /></button>
              <input type="range" aria-label="ブラシの太さ" min={BRUSH_MIN} max={BRUSH_MAX} step={1} value={brushSize} onChange={event => setBrushSize(Number(event.target.value))} className="w-28 accent-[#5fd0c8]" />
              <button type="button" aria-label="ブラシを太く" onClick={() => setBrushSize(value => Math.min(BRUSH_MAX, value + BRUSH_STEP))} className={iconButton}><Plus aria-hidden="true" className="h-3.5 w-3.5" /></button>
            </div>
          )}
          {tool === 'pen' && <span className="ml-3 text-xs text-white/50">クリックで点を置き、最初の点を押すかダブルクリック・Enter で閉じます</span>}
        </div>
        <div className={`grid min-h-0 flex-1 gap-4 p-4 ${panes.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {panes.map(({ id, pane, title }) => (
            <section key={id} className="flex min-h-0 flex-col" aria-label={title}>
              <h3 className="mb-2 text-center text-sm text-white/90">{title}</h3>
              <div className={`relative min-h-0 flex-1 rounded-lg border bg-[#0b1113] ${activePane === id ? 'border-[#5fd0c8]' : 'border-white/10'}`}>
                <StudioMaskSurface
                  ref={handle => { surfaces.current[id] = handle; }}
                  imageUrl={pane.imageUrl}
                  initialMask={pane.initialMask}
                  tool={surfaceTool}
                  mode={mode}
                  brushSize={brushSize}
                  recognizeRect={recognizeRect}
                  active={activePane === id}
                  onPointerActivate={() => setActivePane(id)}
                  onChange={paneChanged}
                  onStroke={() => pushOrder(id)}
                  onBusyChange={setBusy}
                  testId={`${testId}-${id}`}
                />
                {busy && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 text-sm text-white" role="status">{busy}</div>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
