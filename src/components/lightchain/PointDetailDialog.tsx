import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cloudflareDataPlane, type CloudflareImageUsage, type CloudflareImageUsageEvent } from '../../lib/cloudflareApi';
import { useAuthStore } from '../../stores/authStore';

/** Japanese names for the server's image actions (ポイントイベント column). */
const ACTION_LABELS: Record<string, string> = {
  'generate-image': '画像生成',
  'edit-image': '画像編集',
  'model-matrix': 'モデル画像',
  'optimize-prompt': 'プロンプト最適化',
  'chat-plan': 'チャット',
  'image-plan': '画像プラン',
};

const formatEventDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

/**
 * Light opens ポイント詳細 from the credits badge (measured 2026-10-28): ポイント残高 / 消費ポイント, then a table of
 * アカウント・ポイントイベント・日付・ポイント変更 with the change in red. Heavy has no purchase flow, so there is no チャージ.
 */
export function PointDetailDialog({ onClose }: { onClose: () => void }) {
  const brandId = useAuthStore((state) => state.currentBrand?.id);
  const [usage, setUsage] = useState<CloudflareImageUsage | null>(null);
  const [events, setEvents] = useState<CloudflareImageUsageEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!brandId || !cloudflareDataPlane) { setFailed(true); return () => { cancelled = true; }; }
    void Promise.all([cloudflareDataPlane.getImageUsage(brandId), cloudflareDataPlane.getImageUsageEvents(brandId)])
      .then(([summary, list]) => { if (!cancelled) { setUsage(summary); setEvents(list.events); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [brandId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const consumed = usage ? Math.max(0, usage.monthlyQuota - usage.remainingUnits) : null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60" onClick={onClose} data-testid="point-detail-dialog">
      <div role="dialog" aria-modal="true" aria-label="ポイント詳細" className="flex max-h-[500px] w-[904px] max-w-[calc(100vw-32px)] flex-col rounded-xl border border-white/10 bg-[#25292b] text-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-12 flex-none items-center justify-between border-b border-white/10 px-6">
          <h2 className="text-base font-semibold">ポイント詳細</h2>
          <button type="button" aria-label="閉じる" onClick={onClose} className="rounded p-1 text-neutral-300 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="flex items-center gap-[120px] rounded-2xl bg-white/[0.06] px-6 py-6">
            <div><p className="text-sm text-neutral-300">ポイント残高</p><p className="mt-2 text-3xl font-semibold">{usage ? usage.remainingUnits : '—'}</p></div>
            <div><p className="text-sm text-neutral-300">消費ポイント</p><p className="mt-2 text-3xl font-semibold">{consumed ?? '—'}</p></div>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <div className="grid grid-cols-[1.2fr_1.3fr_1.3fr_1fr] bg-white/[0.04] px-4 py-3 text-sm text-neutral-300">
              <span>アカウント</span><span>ポイントイベント</span><span>日付</span><span>ポイント変更</span>
            </div>
            {failed ? <p className="px-4 py-8 text-center text-sm text-neutral-400">ポイントの履歴を読み込めませんでした</p>
              : events === null ? <p className="px-4 py-8 text-center text-sm text-neutral-400">読み込み中…</p>
              : events.length === 0 ? <p className="px-4 py-8 text-center text-sm text-neutral-400">ポイントの履歴はありません</p>
              : events.map((event) => (
                <div key={event.requestId} className="grid grid-cols-[1.2fr_1.3fr_1.3fr_1fr] items-center border-t border-white/10 px-4 py-4 text-sm" data-testid="point-detail-row">
                  <span className="min-w-0"><span className="block truncate">{event.userName || event.userEmail || '—'}</span>{event.userName && event.userEmail && <span className="block truncate text-neutral-300">{event.userEmail}</span>}</span>
                  <span className="truncate">{ACTION_LABELS[event.action] ?? event.action}</span>
                  <span>{formatEventDate(event.createdAt)}</span>
                  <span className="text-red-400">-{event.units}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The credits badge as a button that opens ポイント詳細, keeping each screen's own badge styling. */
export function PointDetailButton({ className, children }: { className: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label="残りクレジット" aria-haspopup="dialog" className={`${className} cursor-pointer`} onClick={() => setOpen(true)} data-testid="point-detail-open">{children}</button>
      {open && <PointDetailDialog onClose={() => setOpen(false)} />}
    </>
  );
}
