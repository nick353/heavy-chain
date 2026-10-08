import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react';
import { ChevronsRight, Download, FolderHeart, Info, Send, Trash2, WandSparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { asGeneratedImageListRow, cloudflareDataPlane } from '../../lib/cloudflareApi';
import type { GeneratedImageListRow } from '../../lib/generatedImageQuery';
import { withSignedImageUrls } from '../../lib/storage';
import { thumbnailImageUrl } from '../../lib/mediaThumbnail';
import { downloadValidatedImage } from '../../lib/imageDownload';
import { saveWorkspaceArtifactBestEffort } from '../../lib/localWorkspaceArtifacts';
import { groupHistoryEntries, lightchainHistoryResumeHref, lightchainHistoryTitle } from '../../lib/lightchainHistoryEntries';

/**
 * Light's 生成履歴 panel, measured at 1440×900 (/tools/vector-special and /tools/printing after a generation): it replaces
 * the result column in place (the URL does not change). Header: 生成履歴 ⓘ, 全削除 and a collapse button. Each entry is one
 * generation: "title date" with 32px download-all / delete-all buttons, then its images in a two-column grid of 314px
 * tiles; hovering a tile shows download / save to library / delete (top right) and edit / send (bottom left).
 * Like Light, it lists every tool's results, newest first, and loads older entries as the list is scrolled.
 */
const PAGE_SIZE = 40;

const isVideo = (image: GeneratedImageListRow) => /video|動画/i.test(image.feature_type || '');

const formatDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const SEND_TARGETS = [
  { label: 'Canvasで編集', href: (id: string) => `/canvas/new?sourceArtifactId=${encodeURIComponent(id)}` },
  { label: 'AIフィッティング', href: (id: string) => `/model?libraryArtifactId=${encodeURIComponent(id)}` },
  { label: '生地イメージ', href: (id: string) => `/tools/fabric?libraryArtifactId=${encodeURIComponent(id)}&librarySlot=fabric-design` },
  { label: 'プリントイメージ', href: (id: string) => `/tools/printing?libraryArtifactId=${encodeURIComponent(id)}&librarySlot=printing-design` },
] as const;

const tileButton = 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition hover:text-white disabled:opacity-40';
const headerButton = 'inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.12] text-white/80 transition hover:bg-white/[0.2] disabled:opacity-40';

export function LightchainHistoryPanel({ onClose, locked = false }: { onClose: () => void; locked?: boolean }) {
  const navigate = useNavigate();
  const brandId = useAuthStore((state) => state.currentBrand?.id);
  const userId = useAuthStore((state) => state.user?.id);
  const [rows, setRows] = useState<GeneratedImageListRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendMenuFor, setSendMenuFor] = useState<string | null>(null);
  const pageState = useRef({ offset: 0, done: false, loading: false });

  const loadPage = useCallback(async (reset: boolean) => {
    if (!brandId || !cloudflareDataPlane) { setRows([]); return; }
    const state = pageState.current;
    if (state.loading || (!reset && state.done)) return;
    state.loading = true;
    const offset = reset ? 0 : state.offset;
    try {
      const page = (await cloudflareDataPlane.listGeneratedImages(brandId, { order: 'newest', limit: PAGE_SIZE, offset }))
        .map(asGeneratedImageListRow);
      state.offset = offset + page.length;
      state.done = page.length < PAGE_SIZE;
      const visible = page.filter((row) => !isVideo(row));
      // Rows carry only storage_path; the readable URL exists after signing.
      const signed = (await withSignedImageUrls(visible)).filter((row) => row.image_url);
      if (visible.length > 0 && signed.length === 0) throw new Error('history_media_unavailable');
      setRows((current) => (reset || !current ? signed : [...current, ...signed.filter((row) => !current.some((item) => item.id === row.id))]));
    } catch {
      if (reset) { setRows([]); setFailed(true); } else toast.error('過去の生成履歴を読み込めませんでした');
    } finally {
      state.loading = false;
    }
  }, [brandId]);

  useEffect(() => {
    pageState.current = { offset: 0, done: false, loading: false };
    setRows(null); setFailed(false);
    void loadPage(true);
  }, [loadPage]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 600) void loadPage(false);
  };

  const removeImages = async (targets: GeneratedImageListRow[], message: string) => {
    if (!cloudflareDataPlane || busy) return;
    setBusy(true);
    const removed = new Set<string>();
    try {
      const context = await cloudflareDataPlane.captureArtifactPersistenceContext();
      for (const image of targets) {
        await cloudflareDataPlane.deleteGeneratedImage(image.id, context);
        removed.add(image.id);
      }
      toast.success(message);
    } catch {
      toast.error('削除に失敗しました');
    } finally {
      setRows((current) => current?.filter((image) => !removed.has(image.id)) ?? current);
      setBusy(false);
    }
  };

  const confirmRemove = (targets: GeneratedImageListRow[], label: string) => {
    if (window.confirm(`${label}を削除しますか？この操作は元に戻せません。`)) {
      void removeImages(targets, targets.length > 1 ? `${targets.length}件の生成結果を削除しました` : '生成結果を1件削除しました');
    }
  };

  const download = async (images: GeneratedImageListRow[]) => {
    try {
      for (const image of images) {
        await downloadValidatedImage(image.image_url as string, `${lightchainHistoryTitle(image.feature_type)}-${image.id.slice(0, 8)}.png`, 'history_panel_download');
      }
    } catch {
      toast.error('ダウンロードに失敗しました');
    }
  };

  /** Registers the result as a library artifact (same step as the library's 登録), optionally opening another tool with it. */
  const registerInLibrary = async (image: GeneratedImageListRow, hrefFor?: (artifactId: string) => string) => {
    if (!brandId || !image.image_url || busy) return;
    setBusy(true);
    try {
      const persistenceContext = await cloudflareDataPlane?.captureArtifactPersistenceContext();
      const result = await saveWorkspaceArtifactBestEffort({
        brandId,
        scopeId: userId,
        featureType: image.feature_type || 'lightchain-library-generated',
        title: lightchainHistoryTitle(image.feature_type),
        imageUrl: image.image_url,
        prompt: image.prompt,
        createdAt: image.created_at,
        metadata: { librarySource: 'generation', libraryGroup: '生成履歴', remoteImageId: image.id, sourceImageId: image.id, sourceStoragePath: image.storage_path },
      }, { persistenceContext });
      if (!result.localPersisted || (cloudflareDataPlane && !result.remote)) throw new Error('library_register_unconfirmed');
      if (hrefFor) { onClose(); navigate(hrefFor(result.artifact.id)); } else toast.success('ライブラリーに保存しました');
    } catch {
      toast.error('ライブラリーへの保存を確認できませんでした');
    } finally {
      setBusy(false);
    }
  };

  const entries = rows ? groupHistoryEntries(rows) : null;

  return (
    <section data-testid="lightchain-history-panel" aria-label="生成履歴" className="historyContent absolute inset-0 z-20 flex flex-col bg-[#232728]">
      <div className="flex w-full items-center gap-2 px-4 pt-4 text-sm font-semibold">
        <h2 className="text-base text-white">生成履歴</h2>
        <span title="生成結果は新しい順に表示されます" className="text-white/50"><Info aria-hidden="true" className="h-3 w-3" /></span>
        <button type="button" onClick={() => rows?.length && confirmRemove(rows, `表示中の生成履歴 ${rows.length} 件`)} disabled={busy || !rows?.length} className="ml-2 inline-flex h-6 items-center gap-1.5 rounded px-2.5 text-white transition hover:bg-white/[0.08] disabled:opacity-40">
          <Trash2 aria-hidden="true" className="h-4 w-4" />全削除
        </button>
        <button type="button" aria-label="生成履歴を閉じる" onClick={onClose} className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded bg-white/[0.08] text-white/70 transition hover:bg-white/[0.14] hover:text-white">
          <ChevronsRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 flex-1 overflow-y-auto px-4 pb-6 scrollbar-hide" onScroll={onScroll} data-testid="lightchain-history-list">
        {entries === null ? (
          [0, 1].map((key) => <div key={key} className="mb-6 h-[360px] w-full animate-pulse rounded-lg bg-white/[0.04]" />)
        ) : entries.length === 0 ? (
          <p className="mt-24 text-center text-sm text-neutral-400">{failed ? '生成履歴を読み込めませんでした' : 'まだ生成履歴がありません'}</p>
        ) : entries.map((entry) => (
          <article key={entry.key} data-testid="lightchain-history-item" className="mb-8 px-4">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm"><span className="font-semibold text-white">{entry.title}</span><span className="ml-1 text-neutral-400">{formatDate(entry.createdAt)}</span></p>
              <button type="button" aria-label={`${entry.title} をすべてダウンロード`} onClick={() => void download(entry.images)} className={headerButton}><Download aria-hidden="true" className="h-4 w-4" /></button>
              <button type="button" aria-label={`${entry.title} を削除`} onClick={() => confirmRemove(entry.images, `「${entry.title}」の生成結果 ${entry.images.length} 件`)} disabled={busy} className={headerButton}><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {entry.images.map((image) => {
                const resumeHref = lightchainHistoryResumeHref(image);
                return (
                  <figure key={image.id} className="group relative aspect-square overflow-hidden rounded-sm bg-[#d9d9d9]/10">
                    <img src={thumbnailImageUrl(image.image_url) ?? image.image_url ?? ''} alt={entry.title} loading="lazy" className="size-full object-contain" />
                    <div className="absolute right-2 top-2 flex rounded-lg bg-black/70 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                      <button type="button" aria-label="ダウンロード" onClick={() => void download([image])} className={tileButton}><Download aria-hidden="true" className="h-4 w-4" /></button>
                      <button type="button" aria-label="ライブラリーに保存" onClick={() => void registerInLibrary(image)} disabled={busy} className={tileButton}><FolderHeart aria-hidden="true" className="h-4 w-4" /></button>
                      <button type="button" aria-label="この画像を削除" onClick={() => confirmRemove([image], 'この画像')} disabled={busy} className={tileButton}><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
                    </div>
                    <div className="absolute bottom-2 left-2 flex rounded-lg bg-black/70 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                      <button type="button" aria-label="この生成結果の入力で編集" disabled={!resumeHref || locked} onClick={() => { if (resumeHref) { onClose(); navigate(resumeHref); } }} className={tileButton}><WandSparkles aria-hidden="true" className="h-4 w-4" /></button>
                      <button type="button" aria-label="ほかのツールに送る" aria-expanded={sendMenuFor === image.id} disabled={busy || locked} onClick={() => setSendMenuFor((current) => (current === image.id ? null : image.id))} className={tileButton}><Send aria-hidden="true" className="h-4 w-4" /></button>
                    </div>
                    {sendMenuFor === image.id && (
                      <div role="menu" className="absolute bottom-12 left-2 z-10 w-40 rounded-lg border border-white/10 bg-[#171b1c] p-1 shadow-xl">
                        {SEND_TARGETS.map((target) => (
                          <button key={target.label} type="button" role="menuitem" onClick={() => { setSendMenuFor(null); void registerInLibrary(image, target.href); }} className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10">{target.label}</button>
                        ))}
                      </div>
                    )}
                  </figure>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
