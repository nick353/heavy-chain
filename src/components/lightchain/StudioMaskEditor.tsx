import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BrushCleaning, Brush, CircleMinus, CirclePlus, Lasso, Minus, PenTool, Plus, Redo2, ScanSearch, SquareDashedMousePointer, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { STUDIO_MASK_CANDIDATES, StudioMaskSurface, type StudioMaskCandidate, type StudioMaskMode, type StudioMaskSurfaceHandle, type StudioMaskTool } from './StudioMaskSurface';

/**
 * 本家の簡易エディター（sr-only の題「簡易エディター」）。画面全体を暗くし、上に浮いた帯
 * マスク調整｜AIマスク認識｜ブラシ｜投げ縄ツール｜矩形選択｜パスツール｜選択範囲をクリア｜↶↷｜キャンセル｜(呼び出し側のボタン)、
 * 選んだ道具の真下に小さな帯（AIマスク認識なら ○トップス ○ボトムス ○全身、ほかは 追加選択｜選択解除｜ブラシなら − 太さ ＋）、
 * その下に 520×515 の題つきの面（選んでいる面は青緑の枠と題、ほかは暗くして案内の文字）。2026-11-12 本家の本番で
 * 帯のクリッピングと範囲指定のマスク調整を開いて並べた形。
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
  /** The part last chosen under AIマスク認識 (its radio is filled, like Light's). */
  const [aiPick, setAiPick] = useState<StudioMaskCandidate | null>(null);
  /** The small bar of the chosen tool opens right under that tool's button (Light); its left edge follows the button. */
  const toolRefs = useRef<Partial<Record<StudioMaskEditorTool, HTMLButtonElement | null>>>({});
  const [subLeft, setSubLeft] = useState(0);
  useLayoutEffect(() => { setSubLeft(toolRefs.current[tool]?.offsetLeft ?? 0); }, [tool]);
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
    setAiPick(candidate);
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
  // Light's bar: a tool is a 36px button; the chosen one has a teal outline and teal text (no fill).
  const toolButton = (active: boolean) => `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[13px] transition ${active ? 'border-[#20d0c4] text-[#20d0c4]' : 'border-transparent text-white/90 hover:bg-white/[0.06]'} disabled:cursor-not-allowed disabled:opacity-40`;
  const subButton = (active: boolean) => `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] transition ${active ? 'bg-white/[0.1] text-white' : 'text-white/80 hover:bg-white/[0.06]'}`;
  const iconButton = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-white/80 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-30';
  const anyUndo = (['base', 'reference'] as const).some(pane => surfaces.current[pane]?.canUndo());
  const anyRedo = (['base', 'reference'] as const).some(pane => surfaces.current[pane]?.canRedo());
  const panes: Array<{ id: StudioMaskPaneId; pane: StudioMaskEditorPane; title: string }> = [
    { id: 'base', pane: base, title: base.title ?? STUDIO_MASK_EDITOR_TEXT.baseTitle },
    ...(reference ? [{ id: 'reference' as const, pane: reference, title: reference.title ?? STUDIO_MASK_EDITOR_TEXT.referenceTitle }] : []),
  ];
  const icon = { 'ai-mask': ScanSearch, brush: Brush, lasso: Lasso, rect: SquareDashedMousePointer, pen: PenTool } as const;
  const paneHint = (id: StudioMaskPaneId) => (id === 'reference' ? '参考にしたい領域を描画してください' : '調整したい領域を描画してください');

  // 後ろは本家と同じく画面全体を約80%暗くする（2026-11-12 本家の本番で、開く前と後の画素を比べて測った）。
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/80" role="dialog" aria-modal="true" aria-label={ariaLabel} data-testid={testId}>
      <h2 className="sr-only">{STUDIO_MASK_EDITOR_TEXT.title}</h2>
      <div className="mx-auto flex min-h-full w-max flex-col items-center px-3 pb-6 pt-[13vh] text-white">
        <div className="relative">
          <div className="flex h-[45px] items-center gap-1 rounded-lg border border-white/[0.08] bg-[#26292b] px-2 shadow-2xl" role="toolbar" aria-label={STUDIO_MASK_EDITOR_TEXT.adjust}>
            <span className="shrink-0 px-2 text-base text-white/70">{STUDIO_MASK_EDITOR_TEXT.adjust}</span>
            <span className="mx-1 h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />
            {STUDIO_MASK_EDITOR_TOOLS.filter(item => tools.includes(item.id)).map(item => {
              const Icon = icon[item.id];
              return <button key={item.id} ref={element => { toolRefs.current[item.id] = element; }} type="button" onClick={() => setTool(item.id)} disabled={busy !== null} aria-pressed={tool === item.id} className={toolButton(tool === item.id)}><Icon aria-hidden="true" className="h-4 w-4" />{item.label}</button>;
            })}
            <button type="button" onClick={clearAll} disabled={busy !== null} className={toolButton(false)}><BrushCleaning aria-hidden="true" className="h-4 w-4" />{STUDIO_MASK_EDITOR_TEXT.clear}</button>
            <span className="mx-1 h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />
            <button type="button" aria-label="元に戻す" title="元に戻す" onClick={() => step('undo')} disabled={!anyUndo || busy !== null} className={iconButton}><Undo2 aria-hidden="true" className="h-4 w-4" /></button>
            <button type="button" aria-label="やり直し" title="やり直し" onClick={() => step('redo')} disabled={!anyRedo || busy !== null} className={iconButton}><Redo2 aria-hidden="true" className="h-4 w-4" /></button>
            <span className="mx-1 h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />
            <div className="flex shrink-0 items-center gap-2 pl-1">
              <button type="button" onClick={onCancel} disabled={busy !== null} className="h-9 rounded-md bg-[#5b6164] px-4 text-sm text-white hover:bg-[#666c6f] disabled:opacity-40">{STUDIO_MASK_EDITOR_TEXT.cancel}</button>
              {actions?.(api)}
            </div>
          </div>
          {/* AIマスク認識の丸は本家と同じく低い帯（高さ34px・文字12px・丸15px）。ほかの道具は48pxの帯（2026-11-12 本家の本番で並べて測った）。 */}
          <div className={`absolute top-[calc(100%+9px)] flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#26292b] px-1.5 shadow-2xl ${tool === 'ai-mask' ? 'h-[34px]' : 'h-12'}`} style={{ left: subLeft }} role="toolbar" aria-label={`${iconLabel(tool)}の設定`}>
            {tool === 'ai-mask' ? (
              <div role="radiogroup" aria-label={iconLabel(tool)} className="flex items-center gap-1">
                {STUDIO_MASK_CANDIDATES.map(candidate => (
                  <button key={candidate} type="button" role="radio" aria-checked={aiPick === candidate} disabled={busy !== null} onClick={() => void recognize(candidate)} className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs text-white/90 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50">
                    <span aria-hidden="true" className={`inline-block h-[15px] w-[15px] rounded-full border ${aiPick === candidate ? 'border-[#20d0c4] bg-[radial-gradient(circle,#20d0c4_45%,transparent_50%)]' : 'border-white/50'}`} />{candidate}
                  </button>
                ))}
              </div>
            ) : <>
              <button type="button" onClick={() => setMode('add')} aria-pressed={mode === 'add'} className={subButton(mode === 'add')}><CirclePlus aria-hidden="true" className="h-4 w-4" />{STUDIO_MASK_EDITOR_TEXT.add}</button>
              <button type="button" onClick={() => setMode('remove')} aria-pressed={mode === 'remove'} className={subButton(mode === 'remove')}><CircleMinus aria-hidden="true" className="h-4 w-4" />{STUDIO_MASK_EDITOR_TEXT.remove}</button>
              {tool === 'brush' && (
                <div className="ml-1 flex items-center gap-1 border-l border-white/10 pl-2 text-white/70">
                  <button type="button" aria-label="ブラシを細く" onClick={() => setBrushSize(value => Math.max(BRUSH_MIN, value - BRUSH_STEP))} className={iconButton}><Minus aria-hidden="true" className="h-3.5 w-3.5" /></button>
                  <input type="range" aria-label="ブラシの太さ" min={BRUSH_MIN} max={BRUSH_MAX} step={1} value={brushSize} onChange={event => setBrushSize(Number(event.target.value))} className="w-20 accent-[#20d0c4]" />
                  <button type="button" aria-label="ブラシを太く" onClick={() => setBrushSize(value => Math.min(BRUSH_MAX, value + BRUSH_STEP))} className={iconButton}><Plus aria-hidden="true" className="h-3.5 w-3.5" /></button>
                </div>
              )}
              {tool === 'pen' && <span className="ml-2 whitespace-nowrap pr-2 text-xs text-white/50">クリックで点を置き、最初の点を押すかダブルクリック・Enter で閉じます</span>}
            </>}
          </div>
        </div>
        <div className="mt-[102px] flex gap-10">
          {panes.map(({ id, pane, title }) => (
            <section key={id} aria-label={title}
              className={`relative flex h-[min(515px,calc(87vh-180px))] min-h-[320px] w-[520px] flex-col overflow-hidden rounded-xl border-2 bg-[#25292c] ${panes.length > 1 ? 'max-w-[calc(50vw-32px)]' : 'max-w-[calc(100vw-24px)]'} ${activePane === id ? 'border-[#20d0c4]' : 'border-[#4b5053]'}`}>
              <h3 className={`h-[46px] shrink-0 border-b border-white/10 text-center text-sm leading-[44px] ${activePane === id ? 'text-[#20d0c4]' : 'text-white/90'}`}>{title}</h3>
              {/* 余白は面の中の24pxだけ（本家の窓は画像の上下左右が約24px。2026-11-12 本番で並べて測った。ここにも余白を付けると画像が一回り小さくなっていた）。 */}
              <div className="relative min-h-0 flex-1">
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
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm text-white" role="status">{busy}</div>
                )}
              </div>
              {/* 使っていない側は、本家と同じく題も含めた面の全体を約78%暗くし、真ん中に案内を出す（2026-11-12 本家の本番で画素を測った）。 */}
              {panes.length > 1 && activePane !== id && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/[0.78] text-sm text-white">{paneHint(id)}</div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
