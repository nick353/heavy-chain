import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight, ChevronRight, Circle, Copy, Download, FolderHeart, ImagePlus, MoreHorizontal, PenLine, Plus, Redo2,
  Spline, Square, Trash2, Type, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Arrow, Ellipse, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useAuthStore } from '../stores/authStore';
import { cloudflareDataPlane } from '../lib/cloudflareApi';
import { withSignedImageUrls } from '../lib/storage';
import { saveWorkspaceArtifactBestEffort } from '../lib/localWorkspaceArtifacts';
import {
  BOARD_DEFAULT_TITLE, BOARD_PAGE_HEIGHT, BOARD_PAGE_WIDTH, boardSnapshot, emptyBoardDocument, fitBoardZoom, formatBoardDate,
  newBoardId, pageImagePaths, readBoardDocument, type BoardDocumentData, type BoardItem, type BoardPage, type BoardShapeType,
} from '../features/board/boardDocuments';

export { formatBoardDate } from '../features/board/boardDocuments';

type BoardListDocument = { id: string; title: string; updatedAt: string; data: BoardDocumentData };

const signPaths = async (paths: string[]) => {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return {} as Record<string, string>;
  const signed = await withSignedImageUrls(unique.map((storage_path) => ({ storage_path, image_url: '' })));
  return Object.fromEntries(unique.map((path, index) => [path, signed[index]?.image_url ?? ''])) as Record<string, string>;
};

/** A page drawn from its saved items (Light's cards show the document's first page). */
function BoardPagePreview({ page, urls, className }: { page: BoardPage | undefined; urls: Record<string, string>; className?: string }) {
  return (
    <svg viewBox={`0 0 ${BOARD_PAGE_WIDTH} ${BOARD_PAGE_HEIGHT}`} preserveAspectRatio="xMidYMid meet" className={className} aria-hidden="true">
      <rect width={BOARD_PAGE_WIDTH} height={BOARD_PAGE_HEIGHT} fill="#fff" />
      {(page?.items ?? []).map((item) => {
        const transform = `translate(${item.x} ${item.y}) rotate(${item.rotation})`;
        switch (item.type) {
          case 'image':
            return urls[item.storagePath] ? <image key={item.id} href={urls[item.storagePath]} width={item.width} height={item.height} transform={transform} preserveAspectRatio="none" /> : null;
          case 'text':
            return <text key={item.id} transform={transform} fontSize={item.fontSize} fill={item.fill} dominantBaseline="hanging">{item.text.split('\n').map((line, index) => <tspan key={index} x={0} dy={index ? item.fontSize * 1.2 : 0}>{line}</tspan>)}</text>;
          case 'path':
            return <polyline key={item.id} transform={transform} points={item.points.join(' ')} fill="none" stroke={item.stroke} strokeWidth={item.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
          case 'circle':
            return <ellipse key={item.id} transform={transform} cx={item.width / 2} cy={item.height / 2} rx={item.width / 2} ry={item.height / 2} fill="none" stroke={item.stroke} strokeWidth={item.strokeWidth} />;
          case 'rect':
            return <rect key={item.id} transform={transform} width={item.width} height={item.height} fill="none" stroke={item.stroke} strokeWidth={item.strokeWidth} />;
          case 'arrow':
            return (
              <g key={item.id} transform={transform} stroke={item.stroke} strokeWidth={item.strokeWidth} fill={item.stroke}>
                <line x1={0} y1={item.height / 2} x2={item.width - 20} y2={item.height / 2} />
                <polygon points={`${item.width},${item.height / 2} ${item.width - 24},${item.height / 2 - 12} ${item.width - 24},${item.height / 2 + 12}`} />
              </g>
            );
          default:
            return null;
        }
      })}
    </svg>
  );
}

export function LightchainBoardPage() {
  const navigate = useNavigate();
  const { currentBrand, user } = useAuthStore();
  const [documents, setDocuments] = useState<BoardListDocument[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BoardListDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const brandId = currentBrand?.id;
  const userId = user?.id;

  const load = useCallback(async () => {
    if (!brandId || !userId || !cloudflareDataPlane) { setDocuments([]); return; }
    const rows = await cloudflareDataPlane.listCanvasDocumentsPage(brandId, 100, 0);
    // マイデザインドキュメント: the signed-in user's design documents only (projects and agent tasks are other canvas documents).
    const list = rows.flatMap((row) => {
      const data = row.owner_id === userId ? readBoardDocument(row.snapshot) : null;
      return data ? [{ id: row.id, title: row.title || BOARD_DEFAULT_TITLE, updatedAt: row.updated_at, data }] : [];
    });
    setDocuments(list);
    setUrls(await signPaths(list.flatMap((document) => pageImagePaths(document.data.pages[0]))));
  }, [brandId, userId]);

  useEffect(() => {
    let active = true;
    load().catch(() => { if (active) toast.error('デザインドキュメントを読み込めませんでした'); });
    return () => { active = false; };
  }, [load]);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuFor]);

  /** Creates the document under a fixed id; a lost response is reconciled by reading that id, never by a second id. */
  const createDocument = async (title: string, data: BoardDocumentData) => {
    if (!brandId || !cloudflareDataPlane) throw new Error('board_brand_unavailable');
    const id = newBoardId();
    try {
      await cloudflareDataPlane.createCanvasDocument({ id, brand_id: brandId, title, snapshot: boardSnapshot(data) });
    } catch (error) {
      const existing = await cloudflareDataPlane.getCanvasDocument(id).catch(() => null);
      if (!existing || !readBoardDocument(existing.snapshot)) throw error;
    }
    return id;
  };

  const handleCreate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await createDocument(BOARD_DEFAULT_TITLE, emptyBoardDocument());
      navigate(`/board/edit?id=${encodeURIComponent(id)}`);
    } catch {
      toast.error('デザインドキュメントを作成できませんでした');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (document: BoardListDocument) => {
    setMenuFor(null);
    if (busy) return;
    setBusy(true);
    try {
      await createDocument(document.title, document.data);
      await load();
      toast.success('ドキュメントをコピーしました');
    } catch {
      toast.error('ドキュメントをコピーできませんでした');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (document: BoardListDocument) => {
    setConfirmDelete(null);
    if (!cloudflareDataPlane) return;
    try {
      await cloudflareDataPlane.deleteCanvasDocument(document.id);
    } catch {
      // The delete may have landed before the response was lost: the list read below shows the outcome.
    }
    await load().catch(() => undefined);
  };

  return (
    <main className="min-h-[calc(100vh-50px)] bg-[#242829] px-10 pb-10 pt-8 text-white" data-testid="lightchain-board-page">
      <div className="flex h-6 items-center gap-2">
        <span aria-hidden="true" className="flex size-5 items-center justify-center text-[18px] leading-none">🙂</span>
        <h1 className="text-base font-semibold leading-6">デザインドキュメントへようこそ</h1>
      </div>

      <button
        type="button"
        onClick={() => void handleCreate()}
        disabled={busy}
        className="mt-4 flex h-24 w-full items-center justify-center gap-4 rounded-lg border border-dashed border-white/20 bg-white/[0.03] transition hover:border-white/35 hover:bg-white/[0.06] disabled:cursor-wait"
        data-testid="lightchain-board-create"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-[#5fcfc4] text-[#10201f]">
          <Plus className="size-5" aria-hidden="true" />
        </span>
        <span className="text-left">
          <span className="block text-sm font-semibold leading-[18px]">デザインドキュメントの作成</span>
          <span className="block text-xs leading-4 text-neutral-400">デザイン提案/マップの作成</span>
        </span>
      </button>

      <section className="mt-10" aria-labelledby="lightchain-board-documents-heading">
        <h2 id="lightchain-board-documents-heading" className="text-base font-semibold leading-6">マイデザインドキュメント</h2>
        {/* Light: six 207px columns, 24px apart, 16px between rows; a 156px page preview, then title and date. */}
        <div className="mt-4 grid grid-cols-6 gap-x-6 gap-y-4">
          {documents.map((document) => (
            <article key={document.id} className="group/card min-w-0" data-testid="lightchain-board-document-card">
              <button
                type="button"
                onClick={() => navigate(`/board/edit?id=${encodeURIComponent(document.id)}`)}
                className="block h-[156px] w-full overflow-hidden"
                aria-label={`${document.title}を開く`}
              >
                <BoardPagePreview page={document.data.pages[0]} urls={urls} className="size-full transition-all group-hover/card:scale-110" />
              </button>
              <div className="relative mt-2 pr-5">
                <p className="truncate text-sm leading-[18.85px] text-neutral-200">{document.title}</p>
                <p className="text-sm leading-[18.85px] text-neutral-500">{formatBoardDate(document.updatedAt)}</p>
                <button
                  type="button"
                  className="absolute right-0 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-neutral-400 transition hover:bg-white/15 hover:text-white"
                  aria-label={`${document.title}のメニュー`}
                  aria-expanded={menuFor === document.id}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setMenuFor((current) => current === document.id ? null : document.id)}
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </button>
                {menuFor === document.id ? (
                  <div role="menu" onPointerDown={(event) => event.stopPropagation()} className="absolute right-0 top-[calc(50%+14px)] z-20 w-[120px] rounded-lg bg-[#3b4043] p-1 text-sm shadow-xl">
                    <button type="button" role="menuitem" onClick={() => void handleCopy(document)} className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-neutral-200 hover:bg-white/10">
                      <Copy className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />ドキュメントをコピーしてください
                    </button>
                    <button type="button" role="menuitem" onClick={() => { setMenuFor(null); setConfirmDelete(document); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[#ff7875] hover:bg-white/10">
                      <Trash2 className="size-3.5 shrink-0" aria-hidden="true" />削除
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="ドキュメントの削除">
          <div className="w-[400px] rounded-xl bg-[#2b2f31] p-6 text-sm text-neutral-200 shadow-2xl">
            <p className="text-base font-semibold text-white">ドキュメントを削除しますか？</p>
            <p className="mt-2 text-neutral-400">「{confirmDelete.title}」を削除すると元に戻せません。</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-lg px-4 py-2 hover:bg-white/10">キャンセル</button>
              <button type="button" onClick={() => void handleDelete(confirmDelete)} className="rounded-lg bg-[#ff4d4f] px-4 py-2 font-semibold text-white hover:bg-[#ff7875]">削除</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Editor (/board/edit?id=)

type Tool = 'select' | 'text' | 'pen';
type SaveState = 'saved' | 'saving' | 'failed';
type LibraryImage = { id: string; storagePath: string; url: string };

const PAGE_GAP = 52; // space above each page for its ページN tab
const STROKE = '#1f2328';

function useHeaderSlot(id: string) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => { setElement(document.getElementById(id)); }, [id]);
  return element;
}

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new window.Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('board_image_load_failed'));
  image.src = url;
});

const readAsDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('board_upload_read_failed'));
  reader.onerror = () => reject(reader.error ?? new Error('board_upload_read_failed'));
  reader.readAsDataURL(file);
});

const fitInside = (width: number, height: number, max = 640) => {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <div className="group/tool relative">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={`flex size-9 items-center justify-center rounded-md text-neutral-200 transition hover:bg-white/10 disabled:opacity-40 ${active ? 'bg-white/15 text-white' : ''}`}
      >
        {children}
      </button>
      <span className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-30 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-black px-2 py-1 text-sm text-white group-hover/tool:block">{label}</span>
    </div>
  );
}

export function LightchainBoardEditPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const documentId = searchParams.get('id') ?? '';
  const { currentBrand, user } = useAuthStore();
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [title, setTitle] = useState(BOARD_DEFAULT_TITLE);
  const [editingTitle, setEditingTitle] = useState(false);
  const [data, setData] = useState<BoardDocumentData>(() => emptyBoardDocument());
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [tool, setTool] = useState<Tool>('select');
  const [flyout, setFlyout] = useState<null | 'shape' | 'library'>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [pageMenu, setPageMenu] = useState<number | null>(null);
  const [zoom, setZoom] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});
  const [library, setLibrary] = useState<LibraryImage[] | null>(null);
  const [draftPath, setDraftPath] = useState<{ page: number; points: number[] } | null>(null);
  const [uploading, setUploading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dataRef = useRef(data);
  const titleRef = useRef(title);
  const revisionRef = useRef(0);
  const savedRef = useRef('');
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const past = useRef<BoardDocumentData[]>([]);
  const future = useRef<BoardDocumentData[]>([]);
  const contextSlot = useHeaderSlot('lightchain-header-context');
  const actionsSlot = useHeaderSlot('lightchain-header-actions');
  dataRef.current = data;
  titleRef.current = title;

  // Load the document.
  useEffect(() => {
    if (!documentId || !cloudflareDataPlane || !user?.id) return;
    let active = true;
    setLoadState('loading');
    cloudflareDataPlane.getCanvasDocument(documentId).then((row) => {
      if (!active) return;
      const loaded = readBoardDocument(row.snapshot);
      if (!loaded) { setLoadState('missing'); return; }
      revisionRef.current = row.revision;
      savedRef.current = JSON.stringify({ title: row.title, data: loaded });
      past.current = [];
      future.current = [];
      setTitle(row.title || BOARD_DEFAULT_TITLE);
      setData(loaded);
      setSaveState('saved');
      setLoadState('ready');
    }).catch(() => { if (active) setLoadState('missing'); });
    return () => { active = false; };
  }, [documentId, user?.id]);

  // Area size and the opening zoom (Light fits the page: 81% at 1440×900).
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) };
      setSize(next);
      setZoom((current) => current || fitBoardZoom(next.width, next.height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Sign stored images and load them for the canvas.
  useEffect(() => {
    const missing = data.pages.flatMap(pageImagePaths).filter((path) => !(path in urls));
    if (missing.length === 0) return;
    let active = true;
    void signPaths(missing).then((signed) => { if (active) setUrls((current) => ({ ...current, ...signed })); });
    return () => { active = false; };
  }, [data, urls]);
  useEffect(() => {
    for (const [path, url] of Object.entries(urls)) {
      if (!url || images[path]) continue;
      void loadImage(url).then((image) => setImages((current) => ({ ...current, [path]: image }))).catch(() => undefined);
    }
  }, [urls, images]);

  // Saving: the server copy is the document; each save names the revision it replaces.
  const save = useCallback(async () => {
    if (!cloudflareDataPlane || !documentId || savingRef.current) return;
    const payload = JSON.stringify({ title: titleRef.current, data: dataRef.current });
    if (payload === savedRef.current) { dirtyRef.current = false; setSaveState('saved'); return; }
    savingRef.current = true;
    dirtyRef.current = false;
    setSaveState('saving');
    const input = { documentId, title: titleRef.current.trim() || BOARD_DEFAULT_TITLE, snapshot: boardSnapshot(dataRef.current) };
    const attempt = async () => {
      const row = await cloudflareDataPlane!.updateCanvasDocument({ ...input, expected_revision: revisionRef.current });
      revisionRef.current = row.revision;
      savedRef.current = payload;
    };
    try {
      await attempt();
    } catch {
      // A lost response may still have saved: read the stored copy before deciding.
      const row = await cloudflareDataPlane.getCanvasDocument(documentId).catch(() => null);
      const stored = row ? JSON.stringify({ title: row.title, data: readBoardDocument(row.snapshot) }) : null;
      let saved = false;
      if (row && stored === JSON.stringify({ title: input.title, data: input.snapshot.boardDocument })) {
        revisionRef.current = row.revision;
        savedRef.current = payload;
        saved = true;
      } else if (row && row.revision !== revisionRef.current) {
        // The server moved on from the revision we named (our own earlier save whose answer was lost, or another
        // tab): replace it once under the stored revision; a second failure is reported, not retried.
        revisionRef.current = row.revision;
        saved = await attempt().then(() => true, () => false);
      }
      if (!saved) {
        savingRef.current = false;
        setSaveState('failed');
        return;
      }
    }
    savingRef.current = false;
    if (dirtyRef.current || JSON.stringify({ title: titleRef.current, data: dataRef.current }) !== savedRef.current) void save();
    else setSaveState('saved');
  }, [documentId]);

  useEffect(() => {
    if (loadState !== 'ready') return;
    if (JSON.stringify({ title, data }) === savedRef.current) return;
    dirtyRef.current = true;
    setSaveState('saving');
    const timer = window.setTimeout(() => void save(), 700);
    return () => window.clearTimeout(timer);
  }, [title, data, loadState, save]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current || savingRef.current) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // Editing with undo/redo.
  const apply = useCallback((change: (current: BoardDocumentData) => BoardDocumentData) => {
    const current = dataRef.current;
    const next = change(current);
    if (next === current) return;
    past.current = [...past.current.slice(-49), current];
    future.current = [];
    setData(next);
  }, []);
  const updateItem = useCallback((pageIndex: number, id: string, patch: Partial<BoardItem>) => apply((current) => ({
    ...current,
    pages: current.pages.map((page, index) => index !== pageIndex ? page : { ...page, items: page.items.map((item) => item.id === id ? { ...item, ...patch } as BoardItem : item) }),
  })), [apply]);
  const addItem = useCallback((pageIndex: number, item: BoardItem) => {
    apply((current) => ({ ...current, pages: current.pages.map((page, index) => index === pageIndex ? { ...page, items: [...page.items, item] } : page) }));
    setSelectedId(item.id);
  }, [apply]);
  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    apply((current) => ({ ...current, pages: current.pages.map((page) => ({ ...page, items: page.items.filter((item) => item.id !== selectedId) })) }));
    setSelectedId(null);
  }, [apply, selectedId]);
  const undo = () => {
    const previous = past.current.at(-1);
    if (!previous) return;
    past.current = past.current.slice(0, -1);
    future.current = [dataRef.current, ...future.current];
    setSelectedId(null);
    setData(previous);
  };
  const redo = () => {
    const [next, ...rest] = future.current;
    if (!next) return;
    future.current = rest;
    past.current = [...past.current, dataRef.current];
    setSelectedId(null);
    setData(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) { event.preventDefault(); removeSelected(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Geometry: pages stacked vertically, centred, each with its tab above.
  const pageWidth = BOARD_PAGE_WIDTH * zoom;
  const pageHeight = BOARD_PAGE_HEIGHT * zoom;
  const pageX = (size.width - pageWidth) / 2;
  const pageY = (index: number) => PAGE_GAP + index * (pageHeight + PAGE_GAP) - scrollY;
  const contentHeight = data.pages.length * (pageHeight + PAGE_GAP) + PAGE_GAP + 72;
  const maxScroll = Math.max(0, contentHeight - size.height);
  const visiblePage = useMemo(() => {
    const middle = scrollY + size.height / 2;
    return Math.min(data.pages.length - 1, Math.max(0, Math.floor((middle - PAGE_GAP / 2) / (pageHeight + PAGE_GAP))));
  }, [scrollY, size.height, pageHeight, data.pages.length]);

  const setZoomKeepingCentre = (next: number) => {
    const clamped = Math.min(4, Math.max(0.1, Math.round(next * 100) / 100));
    setScrollY((current) => Math.max(0, (current + size.height / 2) * (clamped / (zoom || 1)) - size.height / 2));
    setZoom(clamped);
  };

  const pagePoint = (index: number) => {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return null;
    return { x: (pointer.x - pageX) / zoom, y: (pointer.y - pageY(index)) / zoom };
  };

  const pageAtPointer = () => {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return -1;
    return data.pages.findIndex((_, index) => pointer.x >= pageX && pointer.x <= pageX + pageWidth && pointer.y >= pageY(index) && pointer.y <= pageY(index) + pageHeight);
  };

  const onStagePointerDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    setFlyout(null);
    setPageMenu(null);
    const index = pageAtPointer();
    if (tool === 'text' && index >= 0) {
      const point = pagePoint(index)!;
      const item: BoardItem = { id: newBoardId(), type: 'text', x: point.x, y: point.y, rotation: 0, text: 'テキストを入力', fontSize: 48, fill: STROKE, width: 480 };
      addItem(index, item);
      setTool('select');
      setEditingTextId(item.id);
      return;
    }
    if (tool === 'pen' && index >= 0) {
      const point = pagePoint(index)!;
      setDraftPath({ page: index, points: [point.x, point.y] });
      return;
    }
    const clickedEmpty = event.target === event.target.getStage() || event.target.name() === 'page-background';
    if (clickedEmpty) setSelectedId(null);
  };
  const onStagePointerMove = () => {
    if (!draftPath) return;
    const point = pagePoint(draftPath.page);
    if (point) setDraftPath({ ...draftPath, points: [...draftPath.points, point.x, point.y] });
  };
  const onStagePointerUp = () => {
    if (!draftPath) return;
    const { page, points } = draftPath;
    setDraftPath(null);
    if (points.length < 4) return;
    const xs = points.filter((_, index) => index % 2 === 0);
    const ys = points.filter((_, index) => index % 2 === 1);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    addItem(page, { id: newBoardId(), type: 'path', x, y, rotation: 0, points: points.map((value, index) => index % 2 === 0 ? value - x : value - y), stroke: STROKE, strokeWidth: 4 });
    setSelectedId(null);
  };
  const onWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    if (event.evt.ctrlKey || event.evt.metaKey) setZoomKeepingCentre(zoom * (event.evt.deltaY > 0 ? 0.9 : 1.1));
    else setScrollY((current) => Math.min(maxScroll, Math.max(0, current + event.evt.deltaY)));
  };

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const node = selectedId ? stageRef.current?.findOne(`#${CSS.escape(selectedId)}`) : null;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedId, data, zoom, scrollY]);

  const addShape = (type: BoardShapeType) => {
    setFlyout(null);
    const size = type === 'arrow' ? { width: 320, height: 40 } : { width: 280, height: 280 };
    addItem(visiblePage, { id: newBoardId(), type, x: (BOARD_PAGE_WIDTH - size.width) / 2, y: (BOARD_PAGE_HEIGHT - size.height) / 2, rotation: 0, ...size, stroke: STROKE, strokeWidth: 4 });
  };

  const addImageItem = async (storagePath: string, url: string) => {
    const image = await loadImage(url);
    const fitted = fitInside(image.naturalWidth || 640, image.naturalHeight || 640);
    setUrls((current) => ({ ...current, [storagePath]: url }));
    setImages((current) => ({ ...current, [storagePath]: image }));
    addItem(visiblePage, { id: newBoardId(), type: 'image', x: (BOARD_PAGE_WIDTH - fitted.width) / 2, y: (BOARD_PAGE_HEIGHT - fitted.height) / 2, rotation: 0, storagePath, ...fitted });
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file || !currentBrand?.id || !user?.id) return;
    setUploading(true);
    try {
      const imageUrl = await readAsDataUrl(file);
      // The upload is kept in the library (履歴アップロード) and the document refers to its stored copy.
      const result = await saveWorkspaceArtifactBestEffort({
        brandId: currentBrand.id, scopeId: user.id, featureType: 'lightchain-library-upload', title: file.name.replace(/\.[^.]+$/u, '') || 'Untitled',
        imageUrl, prompt: null, metadata: { librarySource: 'upload', libraryGroup: '履歴アップロード', originalFileName: file.name },
      });
      const storagePath = result.remote?.storagePath;
      if (!storagePath) throw new Error('board_upload_not_stored');
      const signed = await signPaths([storagePath]);
      await addImageItem(storagePath, signed[storagePath] || imageUrl);
    } catch {
      toast.error('画像をアップロードできませんでした');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const openLibrary = async () => {
    setFlyout((current) => current === 'library' ? null : 'library');
    if (library || !currentBrand?.id || !cloudflareDataPlane) return;
    try {
      const rows = await cloudflareDataPlane.listGeneratedImages(currentBrand.id, { order: 'newest', limit: 60 });
      const usable = rows.filter((row) => row.storage_path && !/video|動画/i.test(row.feature_type || ''));
      const signed = await signPaths(usable.map((row) => row.storage_path));
      setLibrary(usable.map((row) => ({ id: row.id, storagePath: row.storage_path, url: signed[row.storage_path] })).filter((item) => item.url));
    } catch {
      setLibrary([]);
    }
  };

  const addPage = () => {
    apply((current) => ({ ...current, pages: [...current.pages, { id: newBoardId(), items: [] }] }));
    setScrollY(Math.max(0, data.pages.length * (pageHeight + PAGE_GAP)));
  };
  const duplicatePage = (index: number) => {
    setPageMenu(null);
    apply((current) => {
      const source = current.pages[index];
      const copy = { id: newBoardId(), items: source.items.map((item) => ({ ...item, id: newBoardId() })) };
      return { ...current, pages: [...current.pages.slice(0, index + 1), copy, ...current.pages.slice(index + 1)] };
    });
  };
  const deletePage = (index: number) => {
    setPageMenu(null);
    if (data.pages.length < 2) return;
    apply((current) => ({ ...current, pages: current.pages.filter((_, pageIndex) => pageIndex !== index) }));
  };

  const handleDownload = () => {
    const stage = stageRef.current;
    if (!stage) return;
    setSelectedId(null);
    transformerRef.current?.nodes([]);
    try {
      data.pages.forEach((_, index) => {
        const url = stage.toDataURL({ x: pageX, y: pageY(index), width: pageWidth, height: pageHeight, pixelRatio: 1 / zoom });
        const anchor = document.createElement('a');
        anchor.href = url;
        const base = (title.trim() || BOARD_DEFAULT_TITLE).replace(/[\\/:*?"<>|]/g, '_');
        anchor.download = data.pages.length > 1 ? `${base}-ページ${index + 1}.png` : `${base}.png`;
        anchor.click();
      });
    } catch {
      toast.error('ダウンロードできませんでした');
    }
  };

  const editingText = useMemo(() => {
    for (const [pageIndex, page] of data.pages.entries()) {
      const item = page.items.find((entry) => entry.id === editingTextId);
      if (item?.type === 'text') return { pageIndex, item };
    }
    return null;
  }, [data, editingTextId]);

  const renderItem = (item: BoardItem, pageIndex: number) => {
    const common = {
      id: item.id, x: item.x, y: item.y, rotation: item.rotation,
      draggable: tool === 'select' && editingTextId !== item.id,
      onPointerDown: (event: Konva.KonvaEventObject<PointerEvent>) => { if (tool === 'select') { event.cancelBubble = true; setSelectedId(item.id); } },
      onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => updateItem(pageIndex, item.id, { x: event.target.x(), y: event.target.y() }),
      onTransformEnd: (event: Konva.KonvaEventObject<Event>) => {
        const node = event.target;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scale({ x: 1, y: 1 });
        const base = { x: node.x(), y: node.y(), rotation: node.rotation() };
        if (item.type === 'text') updateItem(pageIndex, item.id, { ...base, width: Math.max(40, item.width * scaleX), fontSize: Math.max(8, item.fontSize * scaleY) });
        else if (item.type === 'path') updateItem(pageIndex, item.id, { ...base, points: item.points.map((value, index) => value * (index % 2 === 0 ? scaleX : scaleY)) });
        else updateItem(pageIndex, item.id, { ...base, width: Math.max(8, item.width * scaleX), height: Math.max(8, item.height * scaleY) });
      },
    };
    switch (item.type) {
      case 'text':
        return <Text key={item.id} {...common} text={item.text} fontSize={item.fontSize} fill={item.fill} width={item.width} visible={editingTextId !== item.id} onDblClick={() => setEditingTextId(item.id)} />;
      case 'image':
        return images[item.storagePath]
          ? <KonvaImage key={item.id} {...common} image={images[item.storagePath]} width={item.width} height={item.height} />
          : <Rect key={item.id} {...common} width={item.width} height={item.height} fill="#eef0f1" />;
      case 'path':
        return <Line key={item.id} {...common} points={item.points} stroke={item.stroke} strokeWidth={item.strokeWidth} lineCap="round" lineJoin="round" tension={0.3} hitStrokeWidth={16} />;
      case 'circle':
        return <Group key={item.id} {...common}><Rect width={item.width} height={item.height} fill="transparent" /><Ellipse x={item.width / 2} y={item.height / 2} radiusX={item.width / 2} radiusY={item.height / 2} stroke={item.stroke} strokeWidth={item.strokeWidth} /></Group>;
      case 'rect':
        return <Group key={item.id} {...common}><Rect width={item.width} height={item.height} stroke={item.stroke} strokeWidth={item.strokeWidth} fill="transparent" /></Group>;
      case 'arrow':
        return <Group key={item.id} {...common}><Rect width={item.width} height={item.height} fill="transparent" /><Arrow points={[0, item.height / 2, item.width, item.height / 2]} stroke={item.stroke} fill={item.stroke} strokeWidth={item.strokeWidth} pointerLength={24} pointerWidth={24} /></Group>;
      default:
        return null;
    }
  };

  const header = contextSlot ? createPortal(
    <div className="flex items-center gap-2" data-testid="lightchain-board-edit-header">
      <ChevronRight className="size-4 text-neutral-400" aria-hidden="true" />
      {editingTitle ? (
        <input
          autoFocus
          aria-label="ドキュメント名"
          value={title}
          maxLength={160}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => { setEditingTitle(false); if (!title.trim()) setTitle(BOARD_DEFAULT_TITLE); }}
          onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
          className="h-[22px] w-[220px] rounded border border-white/20 bg-transparent px-1 text-base font-semibold text-white outline-none focus:border-[#5fcfc4]"
        />
      ) : (
        <button type="button" onClick={() => setEditingTitle(true)} className="flex items-center gap-2 text-base font-semibold text-white" aria-label={`ドキュメント名を編集: ${title}`}>
          <span className="max-w-[260px] truncate leading-[22px]">{title}</span>
          <PenLine className="size-3.5 text-neutral-300" aria-hidden="true" />
        </button>
      )}
      <span className="inline-flex h-5 items-center gap-1 rounded-full bg-white/10 px-2 text-xs text-neutral-300" aria-live="polite">
        <span className={`size-1.5 rounded-full ${saveState === 'failed' ? 'bg-[#ff4d4f]' : saveState === 'saving' ? 'bg-amber-400' : 'bg-[#52c41a]'}`} aria-hidden="true" />
        {saveState === 'failed' ? '保存に失敗しました' : saveState === 'saving' ? '保存中...' : '保存されました'}
      </span>
    </div>,
    contextSlot,
  ) : null;
  const actions = actionsSlot ? createPortal(
    <button type="button" onClick={handleDownload} disabled={loadState !== 'ready'} className="inline-flex h-8 w-[138px] items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 text-sm text-neutral-200 transition hover:bg-white/10 disabled:opacity-50">
      <Download className="size-3.5" aria-hidden="true" />ダウンロード
    </button>,
    actionsSlot,
  ) : null;

  if (!documentId || loadState === 'missing') {
    return (
      <main className="flex h-[calc(100vh-50px)] flex-col items-center justify-center gap-4 bg-[#191d1f] text-sm text-neutral-300" data-testid="lightchain-board-edit-page">
        <p>デザインドキュメントが見つかりません</p>
        <button type="button" onClick={() => navigate('/board')} className="rounded-lg bg-white/10 px-4 py-2 hover:bg-white/15">デザインドキュメントへ戻る</button>
      </main>
    );
  }

  const panelClass = 'flex w-12 flex-col items-center gap-3 rounded-lg bg-[#26292c] p-[6px] py-2 shadow-lg';
  return (
    <main className="relative h-[calc(100vh-50px)] overflow-hidden bg-[#191d1f] text-white" data-testid="lightchain-board-edit-page">
      {header}
      {actions}
      <div ref={containerRef} className={`absolute inset-0 ${tool === 'pen' ? 'cursor-crosshair' : tool === 'text' ? 'cursor-text' : ''}`}>
        {size.width > 0 && zoom > 0 ? (
          <Stage
            ref={stageRef}
            width={size.width}
            height={size.height}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onWheel={onWheel}
          >
            <Layer>
              {data.pages.map((page, index) => (
                <Group key={page.id} x={pageX} y={pageY(index)} scaleX={zoom} scaleY={zoom} clipX={0} clipY={0} clipWidth={BOARD_PAGE_WIDTH} clipHeight={BOARD_PAGE_HEIGHT}>
                  <Rect name="page-background" width={BOARD_PAGE_WIDTH} height={BOARD_PAGE_HEIGHT} fill="#fff" />
                  {page.items.map((item) => renderItem(item, index))}
                  {draftPath?.page === index ? <Line points={draftPath.points} stroke={STROKE} strokeWidth={4} lineCap="round" lineJoin="round" tension={0.3} /> : null}
                </Group>
              ))}
              <Transformer ref={transformerRef} rotateEnabled keepRatio={false} borderStroke="#5fcfc4" anchorStroke="#5fcfc4" anchorSize={8} />
            </Layer>
          </Stage>
        ) : null}
      </div>

      {/* Page tabs and menus */}
      {zoom > 0 ? data.pages.map((page, index) => {
        const top = pageY(index) - 33;
        if (top < -40 || top > size.height) return null;
        return (
          <div key={page.id} className="pointer-events-none absolute flex items-center justify-between" style={{ left: pageX, top, width: pageWidth }}>
            <span className="pointer-events-auto flex h-[29px] items-center rounded-md bg-[#26292c] px-2 text-sm text-neutral-200">ページ{index + 1}</span>
            <div className="pointer-events-auto relative">
              <button type="button" aria-label={`ページ${index + 1}のメニュー`} onClick={() => setPageMenu((current) => current === index ? null : index)} className="flex size-7 items-center justify-center rounded-md text-neutral-300 hover:bg-white/10">
                <MoreHorizontal className="size-5" aria-hidden="true" />
              </button>
              {pageMenu === index ? (
                <div role="menu" className="absolute right-0 top-8 z-30 w-36 rounded-lg bg-[#3b4043] p-1 text-sm shadow-xl">
                  <button type="button" role="menuitem" onClick={() => duplicatePage(index)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-neutral-200 hover:bg-white/10"><Copy className="size-3.5" aria-hidden="true" />ページを複製</button>
                  <button type="button" role="menuitem" disabled={data.pages.length < 2} onClick={() => deletePage(index)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[#ff7875] hover:bg-white/10 disabled:opacity-40"><Trash2 className="size-3.5" aria-hidden="true" />ページを削除</button>
                </div>
              ) : null}
            </div>
          </div>
        );
      }) : null}

      {/* Text editing */}
      {editingText ? (
        <textarea
          autoFocus
          aria-label="テキスト"
          defaultValue={editingText.item.text}
          onBlur={(event) => { const value = event.target.value; setEditingTextId(null); if (value !== editingText.item.text) updateItem(editingText.pageIndex, editingText.item.id, { text: value || ' ' }); }}
          onKeyDown={(event) => { if (event.key === 'Escape') (event.target as HTMLTextAreaElement).blur(); }}
          className="absolute z-20 resize-none overflow-hidden border border-[#5fcfc4] bg-white/90 p-0 leading-none text-[#1f2328] outline-none"
          style={{
            left: pageX + editingText.item.x * zoom, top: pageY(editingText.pageIndex) + editingText.item.y * zoom,
            width: editingText.item.width * zoom, minHeight: editingText.item.fontSize * zoom * 1.4, fontSize: editingText.item.fontSize * zoom,
          }}
        />
      ) : null}

      {/* Tools (Light: two floating 48px panels at the left, centred vertically) */}
      <div className="absolute left-2 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2">
        <div className={panelClass}>
          <ToolButton label="テキスト" active={tool === 'text'} onClick={() => { setFlyout(null); setTool((current) => current === 'text' ? 'select' : 'text'); }}><Type className="size-5" aria-hidden="true" /></ToolButton>
          <ToolButton label="画像をアップロード" disabled={uploading || loadState !== 'ready'} onClick={() => { setFlyout(null); setTool('select'); fileRef.current?.click(); }}><ImagePlus className="size-5" aria-hidden="true" /></ToolButton>
          <ToolButton label="ペン" active={tool === 'pen'} onClick={() => { setFlyout(null); setTool((current) => current === 'pen' ? 'select' : 'pen'); }}><Spline className="size-5" aria-hidden="true" /></ToolButton>
          <div className="relative">
            <ToolButton label="図形" active={flyout === 'shape'} onClick={() => { setTool('select'); setFlyout((current) => current === 'shape' ? null : 'shape'); }}><Circle className="size-5" aria-hidden="true" /></ToolButton>
            {flyout === 'shape' ? (
              <div className={`${panelClass} absolute left-[66px] top-1/2 -translate-y-1/2`}>
                <ToolButton label="円" onClick={() => addShape('circle')}><Circle className="size-5" aria-hidden="true" /></ToolButton>
                <ToolButton label="四角形" onClick={() => addShape('rect')}><Square className="size-5" aria-hidden="true" /></ToolButton>
                <ToolButton label="矢印" onClick={() => addShape('arrow')}><ArrowRight className="size-5" aria-hidden="true" /></ToolButton>
              </div>
            ) : null}
          </div>
          <div className="relative">
            <ToolButton label="ライブラリー" active={flyout === 'library'} onClick={() => { setTool('select'); void openLibrary(); }}><FolderHeart className="size-5" aria-hidden="true" /></ToolButton>
            {flyout === 'library' ? (
              <div className="absolute left-[66px] top-1/2 w-[280px] -translate-y-1/2 rounded-lg bg-[#26292c] p-3 shadow-xl">
                <p className="mb-2 text-sm font-semibold text-neutral-200">ライブラリー</p>
                {library === null ? <p className="py-6 text-center text-xs text-neutral-500">読み込み中...</p> : library.length === 0 ? <p className="py-6 text-center text-xs text-neutral-500">素材がありません</p> : (
                  <div className="grid max-h-[360px] grid-cols-3 gap-2 overflow-y-auto">
                    {library.map((asset) => (
                      <button key={asset.id} type="button" aria-label="ライブラリーの画像を追加" onClick={() => { setFlyout(null); void addImageItem(asset.storagePath, asset.url).catch(() => toast.error('画像を追加できませんでした')); }} className="aspect-square overflow-hidden rounded-md bg-white/5 hover:ring-2 hover:ring-[#5fcfc4]">
                        <img src={asset.url} alt="" className="size-full object-cover" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
        <div className={panelClass}>
          <ToolButton label="元に戻す" disabled={past.current.length === 0} onClick={undo}><Undo2 className="size-5" aria-hidden="true" /></ToolButton>
          <ToolButton label="やり直し" disabled={future.current.length === 0} onClick={redo}><Redo2 className="size-5" aria-hidden="true" /></ToolButton>
          <div className="h-px w-6 bg-white/15" aria-hidden="true" />
          <ToolButton label="縮小" onClick={() => setZoomKeepingCentre(zoom - 0.1)}><ZoomOut className="size-5" aria-hidden="true" /></ToolButton>
          <span className="text-xs leading-4 text-neutral-300" data-testid="lightchain-board-zoom">{Math.round(zoom * 100)}%</span>
          <ToolButton label="拡大" onClick={() => setZoomKeepingCentre(zoom + 0.1)}><ZoomIn className="size-5" aria-hidden="true" /></ToolButton>
        </div>
      </div>

      <button type="button" aria-label="ページを追加" onClick={addPage} disabled={loadState !== 'ready'} className="absolute bottom-[25px] left-1/2 z-20 flex h-8 w-[72px] -translate-x-1/2 items-center justify-center rounded-lg bg-[#26292c] text-neutral-200 shadow-lg hover:bg-[#30353a]">
        <Plus className="size-5" aria-hidden="true" />
      </button>

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="画像ファイル" onChange={(event) => void handleUpload(event.target.files?.[0])} />
      {loadState === 'loading' ? <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#191d1f] text-sm text-neutral-400">読み込み中...</div> : null}
    </main>
  );
}
