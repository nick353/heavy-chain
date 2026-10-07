import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, MoreHorizontal, Plus } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { listWorkspaceArtifacts, type WorkspaceArtifact } from '../lib/localWorkspaceArtifacts';
import { readWorkspaceArtifactImage } from '../lib/workspaceArtifactImageReadback';

export type LightchainBoardDocument = {
  id: string;
  title: string;
  createdAt: string;
  imageUrl: string;
};

export const LIGHTCHAIN_BOARD_STORAGE_KEY = 'heavy-chain:lightchain-board-documents:v1';

const previewImages = [
  '/assets/lightchain-cards/design-v1.png',
  '/assets/lightchain-cards/fitting-v1.png',
  '/assets/lightchain-cards/graphics-v1.png',
  '/assets/lightchain-cards/marketing-v1.png',
];

/** Light shows document dates as `2025.11.28 18:23`. */
export const formatBoardDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const readStoredDocuments = (): LightchainBoardDocument[] => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LIGHTCHAIN_BOARD_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is LightchainBoardDocument => (
      Boolean(item)
      && typeof item.id === 'string'
      && typeof item.title === 'string'
      && typeof item.createdAt === 'string'
      && typeof item.imageUrl === 'string'
    ));
  } catch {
    return [];
  }
};

const artifactToDocument = (artifact: WorkspaceArtifact, index: number): LightchainBoardDocument => ({
  id: `artifact-${artifact.id}`,
  title: artifact.title || '名称未設定ドキュメント',
  createdAt: artifact.createdAt,
  imageUrl: /^(?:https?:|data:image\/|blob:|\/)/.test(artifact.imageUrl) ? artifact.imageUrl : previewImages[index % previewImages.length],
});

export const readLightchainBoardDocuments = (
  brandId?: string | null,
  userId?: string | null,
): LightchainBoardDocument[] => {
  const stored = readStoredDocuments();
  const artifacts = brandId
    ? listWorkspaceArtifacts(brandId, userId ?? undefined).map(artifactToDocument)
    : [];
  const merged = [...stored, ...artifacts];
  const seen = new Set<string>();
  return merged.filter((document) => {
    if (seen.has(document.id)) return false;
    seen.add(document.id);
    return true;
  });
};

export function LightchainBoardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentBrand, user } = useAuthStore();
  const [documents, setDocuments] = useState<LightchainBoardDocument[]>([]);

  useEffect(() => {
    const stored = readLightchainBoardDocuments(currentBrand?.id, user?.id);
    // Only the signed-in user's own documents (the source account's sample list is not copied).
    setDocuments(stored);
    const brandId = currentBrand?.id;
    const userId = user?.id;
    if (!brandId || !userId) return;
    let active = true;
    const artifacts = listWorkspaceArtifacts(brandId, userId);
    void Promise.allSettled(artifacts.map((artifact) => readWorkspaceArtifactImage(artifact, { brandId, userId }))).then((results) => {
      if (!active) return;
      const urls = new Map(artifacts.map((artifact, index) => [`artifact-${artifact.id}`, results[index].status === 'fulfilled' ? (results[index] as PromiseFulfilledResult<{ imageUrl: string }>).value.imageUrl : '']));
      setDocuments((current) => current.map((document) => urls.get(document.id) ? { ...document, imageUrl: urls.get(document.id)! } : document));
    });
    return () => { active = false; };
  }, [currentBrand?.id, user?.id, location.key]);

  const visibleDocuments = useMemo(() => documents.slice(0, 18), [documents]);

  return (
    <main className="min-h-[calc(100vh-50px)] bg-[#242829] px-10 py-8 text-white" data-testid="lightchain-board-page">
      <div className="mx-auto max-w-[1440px]">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span aria-hidden="true">🙂</span>
          <h1>デザインドキュメントへようこそ</h1>
        </div>

        <button
          type="button"
          onClick={() => navigate('/board/edit')}
          className="mt-5 flex min-h-24 w-full items-center justify-center gap-4 rounded-md border border-dashed border-white/25 bg-white/[0.03] text-left transition hover:border-cyan-200/70 hover:bg-white/[0.06]"
          data-testid="lightchain-board-create"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-[#63d2ca] text-[#142122]">
            <Plus className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-base font-semibold">デザインドキュメントの作成</span>
            <span className="mt-1 block text-xs text-neutral-400">デザイン提案/マップの作成</span>
          </span>
        </button>

        <section className="mt-11" aria-labelledby="lightchain-board-documents-heading">
          <h2 id="lightchain-board-documents-heading" className="text-lg font-semibold">マイデザインドキュメント</h2>
          {/* The source keeps six compact document columns at the desktop
              viewport used by the Light Chain shell. Responsive 2/3/4-column
              fallbacks make Heavy visibly different at that same width and
              push the source-shaped ellipsis/date stack below the fold. */}
          <div className="mt-5 grid grid-cols-6 gap-x-6 gap-y-6">
            {visibleDocuments.map((document) => (
              <article key={document.id} className="group min-w-0" data-testid="lightchain-board-document-card">
                <button
                  type="button"
                  onClick={() => navigate(`/board/edit?documentId=${encodeURIComponent(document.id)}`)}
                  className="block w-full overflow-hidden bg-white text-left transition hover:ring-2 hover:ring-cyan-200/80"
                  aria-label={`${document.title}を開く`}
                >
                  <div className="flex aspect-[1.35/1] items-center justify-center p-2">
                    <img src={document.imageUrl} alt="" className="max-h-full max-w-full object-contain" loading="lazy" />
                  </div>
                </button>
                <div className="mt-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs text-neutral-200">{document.title}</p>
                    <p className="mt-1 text-xs text-neutral-500">{formatBoardDate(document.createdAt)}</p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-neutral-500 transition hover:bg-white/10 hover:text-white"
                    aria-label={`${document.title}のメニュー`}
                    onClick={() => navigate(`/board/edit?documentId=${encodeURIComponent(document.id)}`)}
                  >
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

export function LightchainBoardEditPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentBrand, user } = useAuthStore();
  const documentId = new URLSearchParams(location.search).get('documentId');
  const [title, setTitle] = useState('名称未設定ドキュメント');
  const [saved, setSaved] = useState(true);
  const [zoom, setZoom] = useState(61);

  useEffect(() => {
    const document = readLightchainBoardDocuments(currentBrand?.id, user?.id).find((item) => item.id === documentId);
    if (document) setTitle(document.title);
  }, [currentBrand?.id, documentId, user?.id]);

  const handleSave = () => {
    if (typeof window === 'undefined') return;
    const existing = readStoredDocuments().filter((item) => item.id !== documentId);
    const nextDocument: LightchainBoardDocument = {
      id: documentId || `lightchain-board-${crypto.randomUUID()}`,
      title: title.trim() || '名称未設定ドキュメント',
      createdAt: new Date().toISOString(),
      imageUrl: previewImages[0],
    };
    window.localStorage.setItem(LIGHTCHAIN_BOARD_STORAGE_KEY, JSON.stringify([nextDocument, ...existing]));
    setSaved(true);
    navigate('/board');
  };

  const handleDownload = () => {
    if (typeof window === 'undefined') return;
    const payload = JSON.stringify({ title: title.trim() || '名称未設定ドキュメント', exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(title.trim() || '名称未設定ドキュメント').replace(/[\\/:*?"<>|]/g, '_')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-[calc(100vh-50px)] bg-[#242829] text-white" data-testid="lightchain-board-edit-page">
      <div className="flex min-h-[calc(100vh-50px)] flex-col">
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => navigate('/board')} className="rounded p-2 text-neutral-300 hover:bg-white/10" aria-label="デザインドキュメントへ戻る">←</button>
            <FileText className="size-5 shrink-0 text-neutral-300" aria-hidden="true" />
            <label className="min-w-0">
              <span className="sr-only">ドキュメント名</span>
              <input
                value={title}
                onChange={(event) => { setTitle(event.target.value); setSaved(false); }}
                className="w-64 max-w-[45vw] truncate border-0 bg-transparent text-sm font-semibold outline-none focus:ring-1 focus:ring-cyan-200"
                aria-label="ドキュメント名"
              />
            </label>
            <span className="text-xs text-neutral-500" aria-live="polite">{saved ? '保存されました' : '未保存'}</span>
          </div>
          <button type="button" onClick={handleDownload} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 hover:bg-white/10">
            <Download className="size-4" aria-hidden="true" />
            ダウンロード
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-16 shrink-0 flex-col items-center gap-3 border-r border-white/10 py-5 sm:flex" aria-label="ボードツール">
            <button type="button" className="rounded-lg bg-white/10 p-3 text-white" aria-label="選択ツール">↖</button>
            <button type="button" className="rounded-lg p-3 text-neutral-400 hover:bg-white/10 hover:text-white" aria-label="画像を追加">＋</button>
          </aside>
          <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-5 p-6" aria-label="デザインボード">
            <div className="flex w-full max-w-4xl items-center justify-center overflow-hidden rounded-md border border-white/10 bg-[#1a1e1f] p-8 shadow-2xl">
              <div className="flex aspect-[4/3] w-full max-w-3xl items-center justify-center bg-white shadow-xl" style={{ transform: `scale(${zoom / 61})` }}>
                <div className="text-center text-neutral-300">
                  <FileText className="mx-auto size-10 text-neutral-300" aria-hidden="true" />
                  <p className="mt-3 text-sm text-neutral-500">デザインドキュメント</p>
                  <p className="mt-1 text-xs text-neutral-400">素材や提案をここに配置できます</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 rounded-full bg-[#303536] px-4 py-2 text-xs text-neutral-300" aria-label="ズーム操作">
              <button type="button" onClick={() => setZoom((value) => Math.max(25, value - 10))} aria-label="ズームアウト">−</button>
              <span>{zoom} %</span>
              <button type="button" onClick={() => setZoom((value) => Math.min(200, value + 10))} aria-label="ズームイン">＋</button>
              <button type="button" onClick={handleSave} className="ml-2 rounded-full bg-[#63d2ca] px-4 py-1.5 font-semibold text-[#142122]">保存</button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
