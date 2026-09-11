import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, CreditCard, Gauge, Loader2, AlertTriangle } from 'lucide-react';
import { cloudflareDataPlane, type CloudflareImageUsage } from '../lib/cloudflareApi';
import { useAuthStore } from '../stores/authStore';

export function UsageStats({ className }: { className?: string }) {
  const { currentBrand, user } = useAuthStore();
  const brandId = currentBrand?.id;
  const scope = user && brandId ? `${user.id}:${brandId}` : null;
  const [record,setRecord] = useState<{ scope: string; value: CloudflareImageUsage } | null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [revision,setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(v => v + 1);
    window.addEventListener('heavy-image-usage-changed',refresh);
    return () => window.removeEventListener('heavy-image-usage-changed',refresh);
  },[]);
  useEffect(() => {
    let current = true;
    setError(null); setRecord(null);
    if (!scope || !brandId) { setLoading(false); return; }
    if (!cloudflareDataPlane) { setLoading(false); setError('Cloudflareの利用量計測へまだ接続していません。'); return; }
    setLoading(true);
    cloudflareDataPlane.getImageUsage(brandId).then(value => {
      if (current) setRecord({ scope,value });
    }).catch(() => { if (current) setError('利用量を取得できませんでした。残数や料金は未確認です。'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  },[scope,brandId,revision]);
  const summary = record?.scope === scope ? record?.value : null;
  if (!scope) return <div className={className}><p className="text-sm text-neutral-600 dark:text-neutral-300">ブランドを選択すると利用量を確認できます。</p></div>;
  if (loading) return <div className={className} role="status"><div className="h-24 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" aria-label="利用量を取得中" /></div>;
  if (!summary) return <div className={className}><p role="status" className="text-sm text-amber-800 dark:text-amber-200">{error ?? '利用量は未確認です。'}</p><button type="button" onClick={() => setRevision(v => v+1)} className="mt-2 text-sm underline">再読込</button></div>;
  const number = (value: number | null) => value === null ? '未計測' : value.toLocaleString();
  const items = [
    { label: 'アプリ内枠',value: summary.planName,icon: CreditCard },
    { label: '今月の残り',value: `${summary.remainingUnits.toLocaleString()}枚`,icon: Gauge },
    { label: '生成・保存済み',value: `${number(summary.completedImages)}枚`,icon: CheckCircle2 },
    { label: '処理中・予約',value: `${number(summary.runningImages)}枚`,icon: Loader2 },
    { label: '結果・保存が未確定',value: `${number(summary.uncertainImages)}枚`,icon: AlertTriangle },
    { label: '月間上限',value: `${summary.monthlyQuota.toLocaleString()}枚`,icon: Gauge },
  ];
  return <section className={className} aria-label="画像AIの利用状況">
    <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3 sm:gap-4">
      {items.map((item,index) => <motion.div key={item.label} initial={{ opacity: 0,y: 12 }} animate={{ opacity: 1,y: 0 }} transition={{ delay: index*0.04 }}
        className="rounded-xl border border-neutral-200 bg-white p-4 text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white">
        <div className="mb-2 flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300"><item.icon className="h-4 w-4" />{item.label}</div>
        <p className="text-xl font-semibold">{item.value}</p>
      </motion.div>)}
    </div>
    <p className="mt-3 text-xs leading-5 text-neutral-600 dark:text-neutral-300">
      UTC月次・Cloudflare画像AIのみ。{summary.imageAIEnabled ? '' : '現在、画像AIは未公開です。'}結果不明の依頼は残数を保留し、再推論せず照合します。
      推計費用: {summary.estimatedMicroUSD === null ? '未計測' : `$${(summary.estimatedMicroUSD/1_000_000).toFixed(6)}`}。
      {summary.unknownEstimateCount ? `未計測の推論${summary.unknownEstimateCount}件を含みます。` : ''}
      実請求額・アカウント全体の無料枠残量ではありません。
    </p>
  </section>;
}
