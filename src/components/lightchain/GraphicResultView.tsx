import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Copy, Download, Eraser, FileText, Grid3x3, History, LayoutGrid, Loader2, Palette, PenTool, RotateCcw, Send, Star, X, ZoomIn } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { downloadValidatedImage } from '../../lib/imageDownload';
import { downloadImagesAsZip, upscaleImage } from '../../lib/clientImageOps';
import { extractPalette, hexToRgb, makeSeamless, recolorPixels, removeBackground, REPEAT_LAYOUTS, rgbToHex, type RepeatLayout, type Rgb } from '../../features/graphicDesign/graphicTools';
import { blobToFile, drawRepeatUnit, pixelsToBlob, pixelsToCanvas, readPixels, repeatSheetBlob, type Pixels } from '../../features/graphicDesign/graphicToolsCanvas';
import { graphicFileName } from '../../features/graphicDesign/graphicResult';
import { VECTOR_COLOR_CHOICES, VECTOR_DETAILS, type VectorDetail, type VectorTraceResult } from '../../lib/vectorTrace';
import { saveSvgFile, traceImageUrlToVector } from '../../lib/vectorTraceClient';
import {
  createGraphicDocument, GRAPHIC_SEND_TARGETS, loadRunCandidates, registerCandidate, setCandidateFavorite, type GraphicCandidate,
} from '../../features/graphicDesign/graphicResultActions';

/**
 * AIグラフィックデザインの生成後の画面（独自）。本家はこのアカウントで生成が「権限がありません」で生成後の画面を比べられないため、
 * 本家の説明動画の生成後の画面（‹ 戻る・◀・☆・デザインドキュメントの作成・緑のダウンロード・大きな案と4案のサムネイル）に
 * 合わせ、服の柄を作る人が次にしたい道具（似た案を増やす・総柄にする・配色を替える・リピートで確認・背景を消す・
 * ほかの道具へ送る・2倍の大きさ・4案まとめて・SVGにする）を足した。
 */
type Tool = 'recolor' | 'repeat' | 'cutout' | 'svg';
const PREVIEW_EDGE = 1024;
/** 2倍の大きさ: room for a 1696×2528 proposal to double (3392×5056), well inside the browser's canvas limit. */
const GRAPHIC_UPSCALE_EDGE = 6144;
const TITLE = 'AIグラフィックデザイン';

const barButton = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-full text-xs text-white transition hover:bg-white/15 disabled:opacity-40';
const toolButton = 'flex h-14 w-[76px] flex-col items-center justify-center gap-1 rounded-lg text-[11px] leading-tight text-neutral-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40';
const panelButton = 'flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-xs transition disabled:opacity-40';
const checker = 'bg-[length:16px_16px] bg-[linear-gradient(45deg,#3a3f41_25%,transparent_25%,transparent_75%,#3a3f41_75%),linear-gradient(45deg,#3a3f41_25%,transparent_25%,transparent_75%,#3a3f41_75%)] bg-[position:0_0,8px_8px] bg-[#2c3133]';

export function GraphicResultView({ brandId, userId, jobId, fallbackUrl, locked, onBack, onOpenHistory, onFollowUp, onUseAsReference }: {
  brandId: string | undefined; userId: string | undefined; jobId: string | null; fallbackUrl: string | null; locked: boolean;
  onBack: () => void; onOpenHistory: () => void;
  /** 似た案を増やす / 総柄にする: the page redraws the chosen proposal with its references (a new run of 4). */
  onFollowUp: (kind: 'variations' | 'repeat', candidate: GraphicCandidate) => void;
  onUseAsReference: (file: File) => void;
}) {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<GraphicCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [menu, setMenu] = useState<'send' | 'download' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCandidates([]); setSelectedId(null); setTool(null);
    if (!brandId || !jobId) return;
    void loadRunCandidates(brandId, jobId).then((rows) => {
      if (cancelled) return;
      setCandidates(rows); setSelectedId(rows[0]?.id ?? null);
    }).catch(() => { if (!cancelled) toast.error('この生成の案を読み込めませんでした'); });
    return () => { cancelled = true; };
  }, [brandId, jobId]);

  const selectedIndex = Math.max(0, candidates.findIndex((item) => item.id === selectedId));
  const selected = candidates[selectedIndex] ?? null;
  const shownUrl = selected?.image_url ?? fallbackUrl;
  const close = () => setMenu(null);
  const run = async (key: string, task: () => Promise<void>, failure: string) => {
    if (busy) return;
    setBusy(key); close();
    try { await task(); } catch { toast.error(failure); } finally { setBusy(null); }
  };

  const toggleFavorite = () => selected && void run('favorite', async () => {
    const favorite = await setCandidateFavorite(selected.id, !selected.is_favorite);
    setCandidates((rows) => rows.map((row) => (row.id === selected.id ? { ...row, is_favorite: favorite } : row)));
    toast.success(favorite ? 'お気に入りに追加しました' : 'お気に入りから外しました');
  }, 'お気に入りを保存できませんでした');

  const sendTo = (target: typeof GRAPHIC_SEND_TARGETS[number]) => selected && brandId && void run('send', async () => {
    const artifactId = await registerCandidate(brandId, userId, selected, TITLE);
    navigate(target.href(artifactId));
  }, 'ほかのツールに送れませんでした');

  const createDocument = () => brandId && candidates.length > 0 && void run('document', async () => {
    const images = candidates.map((row) => ({ storagePath: row.storage_path, ...(sizes[row.id] ?? { width: 1024, height: 1024 }) }));
    const id = await createGraphicDocument(brandId, `${TITLE} ${new Date().toLocaleDateString('ja-JP')}`, images);
    navigate(`/board/edit?id=${encodeURIComponent(id)}`);
  }, 'デザインドキュメントを作成できませんでした');

  const downloadSelected = (scale: 1 | 2) => selected && void run(`download-${scale}`, async () => {
    const url = scale === 1 ? selected.image_url : await upscaleImage(selected.image_url, { scale: 2, sharpness: 40, denoiseLevel: 0, maxEdge: GRAPHIC_UPSCALE_EDGE });
    await downloadValidatedImage(url, graphicFileName(selectedIndex, scale === 2 ? '2倍' : ''), 'graphic_result_download');
  }, 'ダウンロードに失敗しました');

  const downloadAll = () => candidates.length > 0 && void run('download-all', async () => {
    const result = await downloadImagesAsZip(candidates.map((row, index) => ({ url: row.image_url, name: graphicFileName(index, '', 'png').replace(/\.png$/, '') })), `${TITLE}.zip`);
    if (result.failed) toast.error(`${result.failed}件はZIPに入れられませんでした`);
  }, 'まとめてダウンロードできませんでした');

  return (
    <div className="flex size-full min-h-0 flex-col" data-testid="graphic-result-view">
      <div className="flex h-10 shrink-0 items-center gap-2">
        <button type="button" onClick={onBack} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-sm text-white hover:bg-white/10"><ChevronLeft aria-hidden="true" className="h-4 w-4" />戻る</button>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button type="button" aria-label="ほかのツールに送る" aria-expanded={menu === 'send'} disabled={!selected || locked || Boolean(busy)} onClick={() => setMenu(menu === 'send' ? null : 'send')} className={`${barButton} w-8 bg-white/10`}><Send aria-hidden="true" className="h-4 w-4" /></button>
            {menu === 'send' && (
              <div role="menu" className="absolute right-0 top-10 z-30 w-52 rounded-lg border border-white/10 bg-[#171b1c] p-1 shadow-xl">
                {GRAPHIC_SEND_TARGETS.map((target) => (
                  <button key={target.id} type="button" role="menuitem" onClick={() => sendTo(target)} className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10">{target.label}</button>
                ))}
              </div>
            )}
          </div>
          <button type="button" aria-label={selected?.is_favorite ? 'お気に入りから外す' : 'お気に入りに追加'} aria-pressed={Boolean(selected?.is_favorite)} disabled={!selected || Boolean(busy)} onClick={toggleFavorite} className={`${barButton} w-8 bg-white/10`}>
            <Star aria-hidden="true" className={`h-4 w-4 ${selected?.is_favorite ? 'fill-[#20d0c4] text-[#20d0c4]' : ''}`} />
          </button>
          <button type="button" disabled={candidates.length === 0 || locked || Boolean(busy)} onClick={createDocument} className={`${barButton} bg-white/10 px-3`}>
            {busy === 'document' ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <FileText aria-hidden="true" className="h-4 w-4" />}デザインドキュメントの作成
          </button>
          <div className="relative">
            <button type="button" aria-label="ダウンロード" aria-expanded={menu === 'download'} disabled={!selected || Boolean(busy)} onClick={() => setMenu(menu === 'download' ? null : 'download')} className={`${barButton} w-8 bg-[#20d0c4] text-neutral-950 hover:bg-[#3fe0d5]`}>
              {busy?.startsWith('download') ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Download aria-hidden="true" className="h-4 w-4" />}
            </button>
            {menu === 'download' && (
              <div role="menu" className="absolute right-0 top-10 z-30 w-48 rounded-lg border border-white/10 bg-[#171b1c] p-1 shadow-xl">
                <button type="button" role="menuitem" onClick={() => downloadSelected(1)} className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10">この案をダウンロード</button>
                <button type="button" role="menuitem" onClick={() => downloadSelected(2)} className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10">2倍の大きさでダウンロード</button>
                <button type="button" role="menuitem" onClick={downloadAll} className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10">{candidates.length}案をまとめて（ZIP）</button>
              </div>
            )}
          </div>
          <button type="button" onClick={onOpenHistory} className="flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-[#171b1c] pl-2.5 pr-3 text-xs font-medium text-white"><History aria-hidden="true" className="h-4 w-4" />生成履歴</button>
        </div>
      </div>

      <div className="relative mt-3 flex min-h-0 flex-1 gap-3">
        {tool === 'svg' && selected ? (
          <GraphicSvgStage key={`svg-${selected.id}`} candidate={selected} index={selectedIndex} onClose={() => setTool(null)} />
        ) : tool && tool !== 'svg' && selected ? (
          <GraphicToolStage key={`${tool}-${selected.id}`} tool={tool} candidate={selected} index={selectedIndex} locked={locked} onClose={() => setTool(null)} onUseAsReference={onUseAsReference} />
        ) : (
          <div className="relative flex min-w-0 flex-1 items-center justify-center">
            {/* A new img per proposal: changing src kept the previous proposal on screen for seconds while the 2MB image
                loaded (production 2026-11-12), so a click on a thumbnail looked ignored. */}
            {shownUrl && <img key={shownUrl} src={shownUrl} alt="生成結果" data-testid="graphic-design-result" onLoad={() => setLoadedUrl(shownUrl)} onError={() => setLoadedUrl(shownUrl)}
              className={`max-h-full max-w-full rounded-lg object-contain transition-opacity ${loadedUrl === shownUrl ? 'opacity-100' : 'opacity-0'}`} />}
            {shownUrl && loadedUrl !== shownUrl && <Loader2 aria-label="画像を読み込み中" className="absolute h-6 w-6 animate-spin text-neutral-400" />}
          </div>
        )}
      </div>

      <div className="mt-3 flex shrink-0 justify-center gap-2" data-testid="graphic-result-thumbnails">
        {candidates.map((row, index) => (
          <button key={row.id} type="button" aria-label={`案${index + 1}`} aria-pressed={row.id === selected?.id} onClick={() => setSelectedId(row.id)}
            className={`relative size-[52px] overflow-hidden rounded border-2 bg-[#d9d9d9]/10 ${row.id === selected?.id ? 'border-[#20d0c4]' : 'border-transparent hover:border-white/30'}`}>
            <img src={row.image_url} alt="" className="size-full object-cover" onLoad={(event) => { const image = event.currentTarget; setSizes((current) => ({ ...current, [row.id]: { width: image.naturalWidth, height: image.naturalHeight } })); }} />
            {row.is_favorite && <Star aria-hidden="true" className="absolute right-0.5 top-0.5 h-3 w-3 fill-[#20d0c4] text-[#20d0c4]" />}
          </button>
        ))}
      </div>

      <div className="mt-2 flex shrink-0 justify-center gap-1 border-t border-white/[0.06] pt-2" role="toolbar" aria-label="生成後の道具" data-testid="graphic-result-tools">
        <button type="button" disabled={!selected || locked} onClick={() => selected && onFollowUp('variations', selected)} className={toolButton}><Copy aria-hidden="true" className="h-4 w-4" />似た案を増やす</button>
        <button type="button" disabled={!selected || locked} onClick={() => selected && onFollowUp('repeat', selected)} className={toolButton}><Grid3x3 aria-hidden="true" className="h-4 w-4" />総柄にする</button>
        <button type="button" aria-pressed={tool === 'recolor'} disabled={!selected} onClick={() => setTool(tool === 'recolor' ? null : 'recolor')} className={`${toolButton} ${tool === 'recolor' ? 'bg-white/[0.08] text-[#20d0c4]' : ''}`}><Palette aria-hidden="true" className="h-4 w-4" />配色を替える</button>
        <button type="button" aria-pressed={tool === 'repeat'} disabled={!selected} onClick={() => setTool(tool === 'repeat' ? null : 'repeat')} className={`${toolButton} ${tool === 'repeat' ? 'bg-white/[0.08] text-[#20d0c4]' : ''}`}><LayoutGrid aria-hidden="true" className="h-4 w-4" />リピートで確認</button>
        <button type="button" aria-pressed={tool === 'cutout'} disabled={!selected} onClick={() => setTool(tool === 'cutout' ? null : 'cutout')} className={`${toolButton} ${tool === 'cutout' ? 'bg-white/[0.08] text-[#20d0c4]' : ''}`}><Eraser aria-hidden="true" className="h-4 w-4" />背景を消す</button>
        <button type="button" aria-pressed={tool === 'svg'} disabled={!selected} onClick={() => setTool(tool === 'svg' ? null : 'svg')} className={`${toolButton} ${tool === 'svg' ? 'bg-white/[0.08] text-[#20d0c4]' : ''}`}><PenTool aria-hidden="true" className="h-4 w-4" />SVGにする</button>
      </div>
    </div>
  );
}

/**
 * SVGにする: the proposal's outlines traced into a real vector SVG in the browser (VTracer, see lib/vectorTrace). Before
 * 2026-11-12 the only way to an SVG was 送る → ベクター化, which redrew the image with AI and traced it as 640px
 * pixel-edge polygons.
 */
function GraphicSvgStage({ candidate, index, onClose }: { candidate: GraphicCandidate; index: number; onClose: () => void }) {
  const [colors, setColors] = useState<number>(8);
  const [detail, setDetail] = useState<VectorDetail>('normal');
  const [zoomed, setZoomed] = useState(false);
  const [state, setState] = useState<{ status: 'tracing' } | { status: 'ready'; result: VectorTraceResult; url: string; ms: number } | { status: 'error' }>({ status: 'tracing' });

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setState({ status: 'tracing' });
    const started = performance.now();
    traceImageUrlToVector(candidate.image_url, { colors, detail, lineArt: false }).then((result) => {
      if (cancelled) return;
      url = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
      setState({ status: 'ready', result, url, ms: Math.round(performance.now() - started) });
    }).catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [candidate.image_url, colors, detail]);

  const ready = state.status === 'ready' ? state : null;
  return (
    <>
      <div className={`flex min-w-0 flex-1 overflow-auto rounded-lg bg-white ${zoomed ? '' : 'items-center justify-center'}`} data-testid="graphic-tool-stage-svg" data-svg-status={state.status}>
        {state.status === 'error' ? <p role="alert" className="m-auto text-sm text-rose-600">SVGに変換できませんでした</p>
          : !ready ? <span role="status" className="m-auto flex items-center gap-2 text-sm text-neutral-500"><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />線をなぞっています…</span>
          : <img src={ready.url} alt="SVGにした案" data-testid="graphic-svg-preview" className={zoomed ? 'max-w-none' : 'max-h-full max-w-full object-contain'} style={zoomed ? { width: `${ready.result.traceWidth * 4}px` } : undefined} />}
      </div>
      <aside className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg bg-[#171b1c] p-4 text-sm" aria-label="SVGにする" data-testid="graphic-tool-svg">
        <div className="flex items-center justify-between"><h3 className="text-sm font-medium text-white">SVGにする</h3><button type="button" aria-label="閉じる" onClick={onClose} className="text-neutral-400 hover:text-white"><X aria-hidden="true" className="h-4 w-4" /></button></div>
        <p className="text-xs leading-5 text-neutral-400">色ごとの形の輪郭を曲線でなぞったSVGです。拡大しても輪郭がにじまず、Illustrator・Figmaで色ごとに編集できます。</p>
        <div>
          <div className="text-xs text-neutral-400">色数</div>
          <div className="mt-2 flex rounded-lg bg-white/[0.06] p-0.5" role="radiogroup" aria-label="色数">
            {VECTOR_COLOR_CHOICES.map((count) => (
              <button key={count} type="button" role="radio" aria-checked={colors === count} disabled={state.status === 'tracing'} onClick={() => setColors(count)} className={`h-7 flex-1 rounded-md text-xs ${colors === count ? 'bg-[#20d0c4] text-neutral-950' : 'text-neutral-300'}`}>{count}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs text-neutral-400">細かさ</div>
          <div className="mt-2 flex rounded-lg bg-white/[0.06] p-0.5" role="radiogroup" aria-label="細かさ">
            {VECTOR_DETAILS.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={detail === item.id} disabled={state.status === 'tracing'} onClick={() => setDetail(item.id)} className={`h-7 flex-1 rounded-md text-xs ${detail === item.id ? 'bg-[#20d0c4] text-neutral-950' : 'text-neutral-300'}`}>{item.label}</button>
            ))}
          </div>
        </div>
        <p className="text-xs text-neutral-300" data-testid="graphic-svg-stats">{ready ? `${ready.result.colors.length}色・${ready.result.pathCount}個の形（${Math.round(ready.result.svg.length / 1024)}KB）` : state.status === 'tracing' ? '変換中…' : ''}</p>
        <button type="button" aria-pressed={zoomed} disabled={!ready} onClick={() => setZoomed(!zoomed)} className={`${panelButton} border border-white/15 text-neutral-200 hover:border-white/30`}><ZoomIn aria-hidden="true" className="h-3.5 w-3.5" />{zoomed ? '全体を見る' : '4倍に拡大して見る'}</button>
        <button type="button" disabled={!ready} onClick={() => ready && saveSvgFile(ready.result.svg, graphicFileName(index, 'ベクター', 'svg'))} className={`${panelButton} bg-[#20d0c4] font-medium text-neutral-950`}><Download aria-hidden="true" className="h-3.5 w-3.5" />SVGでダウンロード</button>
      </aside>
    </>
  );
}

/** One open tool: the preview takes the image's place and its settings sit in a panel on the right. */
function GraphicToolStage({ tool, candidate, index, locked, onClose, onUseAsReference }: {
  tool: Exclude<Tool, 'svg'>; candidate: GraphicCandidate; index: number; locked: boolean; onClose: () => void; onUseAsReference: (file: File) => void;
}) {
  const [source, setSource] = useState<Pixels | null>(null);
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const [replacements, setReplacements] = useState<Array<Rgb | null>>([]);
  const [layout, setLayout] = useState<RepeatLayout>('straight');
  const [seamless, setSeamless] = useState(true);
  const [tileSize, setTileSize] = useState(160);
  const [tolerance, setTolerance] = useState(48);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    readPixels(candidate.image_url, PREVIEW_EDGE).then((pixels) => { if (!cancelled) setSource(pixels); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; urls.current.forEach((url) => URL.revokeObjectURL(url)); urls.current = []; };
  }, [candidate.image_url]);

  const palette = useMemo(() => (source && tool === 'recolor' ? extractPalette(source.data, source.width, source.height, 6) : []), [source, tool]);
  const apply = (pixels: Pixels): Pixels => {
    if (tool === 'recolor') return { ...pixels, data: recolorPixels(pixels.data, palette.map((entry) => entry.color), replacements) };
    if (tool === 'repeat') return seamless ? { ...pixels, data: makeSeamless(pixels.data, pixels.width, pixels.height) } : pixels;
    return { ...pixels, data: removeBackground(pixels.data, pixels.width, pixels.height, tolerance).pixels };
  };
  const cutout = useMemo(() => (source && tool === 'cutout' ? removeBackground(source.data, source.width, source.height, tolerance) : null), [source, tool, tolerance]);

  // The preview: recolored / cut-out image, or the repeat unit that the stage tiles with CSS.
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const processed = tool === 'cutout' && cutout ? { ...source, data: cutout.pixels } : apply(source);
      const canvas = tool === 'repeat' ? drawRepeatUnit(pixelsToCanvas(processed), layout) : pixelsToCanvas(processed);
      canvas.toBlob((blob) => {
        if (cancelled || !blob) return;
        // Only the shown preview is kept; the one it replaces is released.
        const url = URL.createObjectURL(blob);
        urls.current.forEach((old) => URL.revokeObjectURL(old));
        urls.current = [url]; setPreviewUrl(url);
      }, 'image/png');
    }, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, tool, replacements, layout, seamless, cutout]);

  /** The full-size result of the open tool (the preview works on a 1024px copy). */
  const fullSize = async (): Promise<Pixels> => apply(await readPixels(candidate.image_url));
  const act = async (task: () => Promise<void>) => {
    if (working) return;
    setWorking(true);
    try { await task(); } catch { toast.error('画像を書き出せませんでした'); } finally { setWorking(false); }
  };
  const download = (blob: Blob, suffix: string) => {
    const url = URL.createObjectURL(blob);
    return downloadValidatedImage(url, graphicFileName(index, suffix), 'graphic_tool_download').finally(() => window.setTimeout(() => URL.revokeObjectURL(url), 5000));
  };
  const useAsReference = (suffix: string) => act(async () => { onUseAsReference(blobToFile(await pixelsToBlob(await fullSize()), graphicFileName(index, suffix))); toast.success('参考画像にしました'); });
  const changed = replacements.some(Boolean);
  const title = tool === 'recolor' ? '配色を替える' : tool === 'repeat' ? 'リピートで確認' : '背景を消す';

  return (
    <>
      <div className={`flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg ${tool === 'cutout' ? checker : ''}`} data-testid={`graphic-tool-stage-${tool}`}>
        {failed ? <p role="alert" className="text-sm text-rose-300">画像を読み込めませんでした</p>
          : !previewUrl ? <Loader2 aria-label="準備中" className="h-6 w-6 animate-spin text-neutral-400" />
          : tool === 'repeat' ? <div role="img" aria-label="リピートの見本" className="size-full" style={{ backgroundImage: `url(${previewUrl})`, backgroundSize: `${tileSize * (layout === 'straight' ? 1 : 2)}px auto`, backgroundRepeat: 'repeat' }} />
          : <img src={previewUrl} alt={title} className="max-h-full max-w-full object-contain" />}
      </div>
      <aside className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg bg-[#171b1c] p-4 text-sm" aria-label={title} data-testid={`graphic-tool-${tool}`}>
        <div className="flex items-center justify-between"><h3 className="text-sm font-medium text-white">{title}</h3><button type="button" aria-label="閉じる" onClick={onClose} className="text-neutral-400 hover:text-white"><X aria-hidden="true" className="h-4 w-4" /></button></div>
        {tool === 'recolor' && (
          <>
            <p className="text-xs leading-5 text-neutral-400">色を押して替える色を選びます。濃淡と線はそのまま残ります。</p>
            <div className="grid grid-cols-2 gap-2">
              {palette.map((entry, at) => {
                const next = replacements[at];
                return (
                  <label key={rgbToHex(entry.color)} className="flex items-center gap-2 rounded-lg bg-white/[0.04] p-1.5 text-xs text-neutral-300">
                    <span className="relative size-8 shrink-0 overflow-hidden rounded border border-white/15" style={{ background: rgbToHex(next ?? entry.color) }}>
                      <input type="color" aria-label={`色${at + 1}（${Math.round(entry.share * 100)}%）を替える`} value={rgbToHex(next ?? entry.color)} disabled={!source}
                        onChange={(event) => { const rgb = hexToRgb(event.target.value); setReplacements((current) => { const copy = [...current]; copy[at] = rgb; return copy; }); }}
                        className="absolute inset-0 size-full cursor-pointer opacity-0" />
                    </span>
                    <span className="min-w-0"><span className="block font-mono text-[11px]">{rgbToHex(next ?? entry.color)}</span><span className="text-[10px] text-neutral-500">{Math.round(entry.share * 100)}%</span></span>
                  </label>
                );
              })}
            </div>
            <button type="button" disabled={!changed} onClick={() => setReplacements([])} className={`${panelButton} border border-white/15 text-neutral-200 hover:border-white/30`}><RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />元の配色に戻す</button>
            <button type="button" disabled={!changed || working} onClick={() => act(async () => { await download(await pixelsToBlob(await fullSize()), '配色替え'); })} className={`${panelButton} bg-[#20d0c4] font-medium text-neutral-950`}>{working ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Download aria-hidden="true" className="h-3.5 w-3.5" />}この配色でダウンロード</button>
            <button type="button" disabled={!changed || working || locked} onClick={() => useAsReference('配色替え')} className={`${panelButton} border border-white/15 text-neutral-200 hover:border-[#20d0c4]`}>参考画像にして作り直す</button>
          </>
        )}
        {tool === 'repeat' && (
          <>
            <div>
              <div className="text-xs text-neutral-400">並べ方</div>
              <div className="mt-2 flex rounded-lg bg-white/[0.06] p-0.5" role="radiogroup" aria-label="並べ方">
                {REPEAT_LAYOUTS.map((item) => (
                  <button key={item.id} type="button" role="radio" aria-checked={layout === item.id} onClick={() => setLayout(item.id)} className={`h-7 flex-1 rounded-md text-xs ${layout === item.id ? 'bg-[#20d0c4] text-neutral-950' : 'text-neutral-300'}`}>{item.label}</button>
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between text-xs text-neutral-300">
              つなぎ目をなじませる
              <button type="button" role="switch" aria-checked={seamless} aria-label="つなぎ目をなじませる" onClick={() => setSeamless(!seamless)} className={`relative h-5 w-9 rounded-full transition ${seamless ? 'bg-[#20d0c4]' : 'bg-neutral-500'}`}>
                <span className={`absolute top-0.5 size-4 rounded-full bg-white transition ${seamless ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </label>
            <label className="text-xs text-neutral-400">1枚の大きさ
              <input type="range" min={64} max={400} step={8} value={tileSize} onChange={(event) => setTileSize(Number(event.target.value))} className="mt-2 w-full accent-[#20d0c4]" aria-label="1枚の大きさ" />
            </label>
            <p className="text-xs leading-5 text-neutral-500">端の4分の1を反対側の続きに替え、柄の少ない所を通る線でつなぐので、並べても継ぎ目が出ず、柄も薄く重なりません。ミラーは反転して並べるので継ぎ目が出ません。</p>
            <button type="button" disabled={working || !source} onClick={() => act(async () => { await download(await pixelsToBlob(await fullSize()), seamless ? 'リピート用' : 'タイル'); })} className={`${panelButton} bg-[#20d0c4] font-medium text-neutral-950`}>{working ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Download aria-hidden="true" className="h-3.5 w-3.5" />}1枚分をダウンロード</button>
            <button type="button" disabled={working || !source} onClick={() => act(async () => { await download(await repeatSheetBlob(pixelsToCanvas(await fullSize()), layout, 3), `${REPEAT_LAYOUTS.find((item) => item.id === layout)?.label}3x3`); })} className={`${panelButton} border border-white/15 text-neutral-200 hover:border-white/30`}>並べた画像（3×3）をダウンロード</button>
            <button type="button" disabled={working || locked || !source} onClick={() => useAsReference('リピート用')} className={`${panelButton} border border-white/15 text-neutral-200 hover:border-[#20d0c4]`}>参考画像にして作り直す</button>
          </>
        )}
        {tool === 'cutout' && (
          <>
            <p className="text-xs leading-5 text-neutral-400">まわりの無地の背景を透明にします。柄の中の白は残ります。</p>
            <label className="text-xs text-neutral-400">背景とみなす色の幅（{tolerance}）
              <input type="range" min={16} max={120} step={4} value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} className="mt-2 w-full accent-[#20d0c4]" aria-label="背景とみなす色の幅" />
            </label>
            {cutout && !cutout.ground && <p role="alert" className="text-xs text-rose-300">背景が一色ではないため、消せませんでした</p>}
            <button type="button" disabled={working || !cutout?.ground} onClick={() => act(async () => { await download(await pixelsToBlob(await fullSize()), '背景なし'); })} className={`${panelButton} bg-[#20d0c4] font-medium text-neutral-950`}>{working ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Download aria-hidden="true" className="h-3.5 w-3.5" />}透過PNGでダウンロード</button>
          </>
        )}
      </aside>
    </>
  );
}
