import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { asGeneratedImageListRow, cloudflareDataPlane } from '../../lib/cloudflareApi';
import type { GeneratedImageListRow } from '../../lib/generatedImageQuery';
import { withSignedImageUrls } from '../../lib/storage';
import { thumbnailImageUrl } from '../../lib/mediaThumbnail';
import { NON_GENERATION_TYPES } from '../../lib/lightchainHistoryEntries';

/** Images the user put in themselves: library uploads and the references attached to a design chat. */
const UPLOAD_TYPES = new Set([...NON_GENERATION_TYPES, 'design-dialogue-reference']);
const isUpload = (row: GeneratedImageListRow) => UPLOAD_TYPES.has((row.feature_type ?? '').replace(/^lightchain-/, ''));
const FILTERS = [['uploads', 'アップロード'], ['generated', '生成画像'], ['all', 'すべて']] as const;
type Filter = typeof FILTERS[number][0];
const PAGE_SIZE = 60;

/**
 * Light's アセット tab of the canvas's left panel: 「マイライブラリー」 with a filter, then the user's images in three columns.
 * Picking one hands it to the chat as a reference.
 */
export function DesignAssetLibrary({ brandId, onPick }: { brandId: string; onPick: (imageId: string) => void }) {
  const [filter, setFilter] = useState<Filter>('uploads');
  const [rows, setRows] = useState<GeneratedImageListRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null); setFailed(false);
    if (!brandId || !cloudflareDataPlane) { setRows([]); return () => { cancelled = true; }; }
    void (async () => {
      const page = (await cloudflareDataPlane!.listGeneratedImages(brandId, { order: 'newest', limit: PAGE_SIZE })).map(asGeneratedImageListRow)
        .filter((row) => !/video|動画/i.test(row.feature_type || ''))
        .filter((row) => filter === 'all' || (filter === 'uploads') === isUpload(row));
      const signed = (await withSignedImageUrls(page)).filter((row) => row.image_url);
      if (!cancelled) setRows(signed);
    })().catch(() => { if (!cancelled) { setRows([]); setFailed(true); } });
    return () => { cancelled = true; };
  }, [brandId, filter]);

  return <div className="flex min-h-0 flex-1 flex-col" data-testid="design-asset-panel">
    <div className="flex h-12 shrink-0 items-center justify-between px-4">
      <h3 className="text-base font-medium text-white">マイライブラリー</h3>
      <label className="relative flex h-8 items-center gap-1 rounded-lg border border-white/10 px-2 text-sm text-neutral-200">
        {FILTERS.find(([value]) => value === filter)?.[1]}<ChevronDown className="h-3.5 w-3.5 text-neutral-500" />
        <select aria-label="絞り込み" value={filter} onChange={(event) => setFilter(event.target.value as Filter)} className="absolute inset-0 cursor-pointer opacity-0">
          {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      {rows === null ? <p className="py-8 text-center text-sm text-neutral-400">読み込み中…</p>
        : failed ? <p className="py-8 text-center text-sm text-neutral-400">アセットを読み込めませんでした</p>
        : rows.length === 0 ? <p className="py-8 text-center text-sm text-neutral-400">画像はまだありません</p>
        : <div className="grid grid-cols-3 gap-2">{rows.map((row) => <button key={row.id} type="button" data-testid="design-asset-item" onClick={() => onPick(row.id)}
          title={row.prompt?.split('\n')[0] || undefined} className="aspect-square overflow-hidden rounded-lg bg-white/5 hover:ring-2 hover:ring-[#0bcabc]">
          <img src={thumbnailImageUrl(row.image_url) ?? row.image_url ?? ''} alt="" loading="lazy" className="h-full w-full object-cover" /></button>)}</div>}
    </div>
  </div>;
}
