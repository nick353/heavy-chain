import { useEffect, useState } from 'react';
import { ChevronsRight, Download, Info, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { asGeneratedImageListRow, cloudflareDataPlane } from '../../lib/cloudflareApi';
import type { GeneratedImageListRow } from '../../lib/generatedImageQuery';
import { withSignedImageUrls } from '../../lib/storage';
import { thumbnailImageUrl } from '../../lib/mediaThumbnail';
import { downloadValidatedImage } from '../../lib/imageDownload';
import { getLightchainUnifiedRouteAliases, lightchainUnifiedFeatureCatalog } from '../../lib/lightchainUnifiedFeatureCatalog';

/**
 * Light's 生成履歴 panel, measured on /tools/vector-special at 1440×900: it replaces the result column in place
 * (the URL does not change). Header: 生成履歴 ⓘ, 全削除 and a collapse button; each item is "title date" with
 * download/delete buttons above a large preview. Like Light, it lists every tool's results, newest first.
 */
const HISTORY_LIMIT = 50;

const isVideo = (image: GeneratedImageListRow) => /video|動画/i.test(image.feature_type || '');

const featureIdOf = (featureType: string | null) => featureType?.match(/^lightchain-(.+?)(?:-provider-result)?$/)?.[1] ?? null;

export const lightchainHistoryTitle = (featureType: string | null): string => {
  const id = featureIdOf(featureType);
  const feature = id ? lightchainUnifiedFeatureCatalog.find((entry) => entry.id === id) : undefined;
  return feature?.title ?? (featureType ? featureType.replaceAll('-', ' ') : '生成画像');
};

/** The tool screen that reopens this result with its saved inputs, or null when the result has no tool to return to. */
export const lightchainHistoryResumeHref = (image: Pick<GeneratedImageListRow, 'feature_type' | 'job_id'>): string | null => {
  const id = featureIdOf(image.feature_type);
  if (!id || !image.job_id) return null;
  const route = getLightchainUnifiedRouteAliases(id)[0] ?? `/lightchain/${id}`;
  const [path, query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  params.set('resumeJob', image.job_id);
  return `${path}?${params.toString()}`;
};

const formatDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function LightchainHistoryPanel({ onClose, locked = false }: { onClose: () => void; locked?: boolean }) {
  const navigate = useNavigate();
  const brandId = useAuthStore((state) => state.currentBrand?.id);
  const [items, setItems] = useState<GeneratedImageListRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setItems(null); setFailed(false);
    if (!brandId || !cloudflareDataPlane) { setItems([]); return; }
    let cancelled = false;
    void (async () => {
      const rows = (await cloudflareDataPlane.listGeneratedImages(brandId, { order: 'newest', limit: HISTORY_LIMIT, offset: 0 }))
        .map(asGeneratedImageListRow)
        .filter((row) => !isVideo(row));
      // Rows carry only storage_path; the readable URL exists after signing.
      const signed = (await withSignedImageUrls(rows)).filter((row) => row.image_url);
      if (rows.length > 0 && signed.length === 0) throw new Error('history_media_unavailable');
      if (!cancelled) setItems(signed);
    })().catch(() => { if (!cancelled) { setItems([]); setFailed(true); } });
    return () => { cancelled = true; };
  }, [brandId]);

  const removeImages = async (targets: GeneratedImageListRow[]) => {
    if (!cloudflareDataPlane || busy) return;
    setBusy(true);
    const removed = new Set<string>();
    try {
      const context = await cloudflareDataPlane.captureArtifactPersistenceContext({ assertContext: () => undefined });
      for (const image of targets) {
        await cloudflareDataPlane.deleteGeneratedImage(image.id, context);
        removed.add(image.id);
      }
      toast.success(targets.length > 1 ? '生成履歴をすべて削除しました' : '生成履歴を1件削除しました');
    } catch {
      toast.error('削除に失敗しました');
    } finally {
      setItems((current) => current?.filter((image) => !removed.has(image.id)) ?? current);
      setBusy(false);
    }
  };

  const confirmDelete = (image: GeneratedImageListRow) => {
    if (window.confirm(`「${lightchainHistoryTitle(image.feature_type)}」の生成結果を削除しますか？この操作は元に戻せません。`)) void removeImages([image]);
  };

  const confirmDeleteAll = () => {
    if (!items?.length) return;
    if (window.confirm(`表示中の生成履歴 ${items.length} 件をすべて削除しますか？この操作は元に戻せません。`)) void removeImages(items);
  };

  const download = async (image: GeneratedImageListRow) => {
    try {
      await downloadValidatedImage(image.image_url as string, `${lightchainHistoryTitle(image.feature_type)}-${image.id.slice(0, 8)}.png`, 'history_panel_download');
    } catch {
      toast.error('ダウンロードに失敗しました');
    }
  };

  return (
    <section data-testid="lightchain-history-panel" aria-label="生成履歴" className="historyContent absolute inset-0 z-20 flex flex-col bg-[#232728] px-6 pt-4">
      <div className="flex w-full items-center gap-2 text-sm font-semibold">
        <h2 className="text-base text-white">生成履歴</h2>
        <span title={`最新${HISTORY_LIMIT}件を表示します`} className="text-white/50"><Info aria-hidden="true" className="h-4 w-4" /></span>
        <button type="button" onClick={confirmDeleteAll} disabled={busy || !items?.length} className="ml-2 inline-flex items-center gap-1 text-white/70 transition hover:text-white disabled:opacity-40">
          <Trash2 aria-hidden="true" className="h-4 w-4" />全削除
        </button>
        <button type="button" aria-label="生成履歴を閉じる" onClick={onClose} className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/[0.08] hover:text-white">
          <ChevronsRight aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      <div className="mt-4 flex h-[calc(100%-45px)] flex-col items-center gap-y-4 overflow-y-auto pb-6 scrollbar-hide">
        {items === null ? (
          [0, 1].map((key) => <div key={key} className="h-64 w-full shrink-0 animate-pulse rounded-lg bg-white/[0.04]" />)
        ) : items.length === 0 ? (
          <p className="mt-24 text-sm text-neutral-400">{failed ? '生成履歴を読み込めませんでした' : 'まだ生成履歴がありません'}</p>
        ) : items.map((image) => {
          const resumeHref = lightchainHistoryResumeHref(image);
          const title = lightchainHistoryTitle(image.feature_type);
          return (
            <article key={image.id} data-testid="lightchain-history-item" className="w-full shrink-0">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm"><span className="font-semibold text-white">{title}</span><span className="ml-2 text-neutral-400">{formatDate(image.created_at)}</span></p>
                <button type="button" aria-label={`${title} をダウンロード`} onClick={() => void download(image)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.08] text-white/80 transition hover:bg-white/[0.14]"><Download aria-hidden="true" className="h-4 w-4" /></button>
                <button type="button" aria-label={`${title} を削除`} onClick={() => confirmDelete(image)} disabled={busy} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.08] text-white/80 transition hover:bg-white/[0.14] disabled:opacity-40"><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
              </div>
              <button
                type="button"
                disabled={!resumeHref || locked}
                title={resumeHref ? 'この生成結果の入力で開く' : undefined}
                onClick={() => { if (resumeHref) { onClose(); navigate(resumeHref); } }}
                className="mt-3 block max-w-[320px] overflow-hidden rounded-lg bg-black/20 disabled:cursor-default"
              >
                <img src={thumbnailImageUrl(image.image_url) ?? image.image_url ?? ''} alt={title} loading="lazy" className="max-h-[480px] w-auto object-contain" />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
