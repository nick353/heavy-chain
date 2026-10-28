import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, LogOut, Search, Stamp, User, UserRound, Users, X } from 'lucide-react';
import { cloudflareDataPlane, type CloudflareBrandMember, type CloudflareImageUsage } from '../../lib/cloudflareApi';
import { useAuthStore } from '../../stores/authStore';

export type AccountCenterTab = 'account' | 'team' | 'watermark';

const ROLE_LABELS: Record<string, string> = { owner: '管理者', admin: '管理者', editor: '編集者', viewer: '閲覧者' };
const formatDate = (iso: string | null | undefined) => {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

/**
 * Light's account window (measured 2026-10-28): マイアカウント / チーム管理 / 透かし（ウォーターマーク）表示 on the left with
 * ログアウト at the bottom. マイアカウント shows the profile and パスワードを変更する; チーム管理 shows the tenant's points and
 * its accounts (アカウント・登録時間・ユーザー・アカウント状態・操作) with 追加. Heavy has no point purchase or per-account
 * allocation, so only the balance and used points are shown, and members are edited on the brand settings page.
 */
export function AccountCenterDialog({ initialTab, userName, avatarUrl, watermarkOn, onToggleWatermark, onSignOut, onClose }: {
  initialTab: AccountCenterTab; userName: string; avatarUrl?: string; watermarkOn: boolean;
  onToggleWatermark: () => void; onSignOut: () => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<AccountCenterTab>(initialTab);
  const { user, currentBrand } = useAuthStore();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const navItem = (id: AccountCenterTab, label: string, Icon: typeof User) => (
    <button type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm ${tab === id ? 'bg-white/10 text-white' : 'text-neutral-300 hover:bg-white/5'}`}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{label}</button>
  );
  const title = tab === 'account' ? 'マイアカウント' : tab === 'team' ? 'チーム管理' : '透かし（ウォーターマーク）表示';
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose} data-testid="account-center-dialog">
      <div role="dialog" aria-modal="true" aria-label={title} className="flex h-[640px] max-h-[calc(100vh-32px)] w-[1080px] max-w-full overflow-hidden rounded-2xl border border-white/10 bg-[#25292b] text-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <nav className="flex w-60 shrink-0 flex-col border-r border-white/10 p-4" aria-label="アカウント">
          <p className="mb-6 px-3 pt-2 text-base font-semibold tracking-wide">HEAVY CHAIN</p>
          <div role="tablist" aria-label="アカウントの項目" className="flex flex-col gap-1">
            {navItem('account', 'マイアカウント', UserRound)}
            {navItem('team', 'チーム管理', Users)}
            {navItem('watermark', '透かし（ウォーターマーク）表示', Stamp)}
          </div>
          <button type="button" onClick={onSignOut} className="mt-auto flex items-center gap-2 border-t border-white/10 px-3 pt-4 text-sm text-neutral-300 hover:text-white"><LogOut className="h-4 w-4" aria-hidden="true" />ログアウト</button>
        </nav>
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[80px] shrink-0 items-center justify-between border-b border-white/10 px-6">
            <h2 className="text-base font-semibold">{title}</h2>
            <button type="button" aria-label="閉じる" onClick={onClose} className="rounded p-1 text-neutral-300 hover:bg-white/10"><X className="h-5 w-5" /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {tab === 'account' && (
              <div className="flex items-start justify-between gap-4" data-testid="account-center-profile">
                <div className="flex items-center gap-4">
                  <span className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white/5">
                    {avatarUrl ? <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" /> : <User className="h-10 w-10 text-neutral-400" />}</span>
                  <div>
                    <p className="text-lg font-semibold">{userName}</p>
                    <p className="mt-1 break-all text-sm text-neutral-400">{user?.email ?? ''}</p>
                    <p className="mt-1 text-sm text-neutral-400">{currentBrand?.name ?? ''}</p>
                    <Link to="/account/delete" onClick={onClose} data-testid="account-menu-delete" className="mt-4 inline-block text-xs text-[#f39aa5] underline hover:text-[#ffc2ca]">アカウントを削除する</Link>
                  </div>
                </div>
                <Link to="/change-password" onClick={onClose} className="flex h-8 items-center rounded-lg bg-white/10 px-6 text-sm text-neutral-100 hover:bg-white/15">パスワードを変更する</Link>
              </div>
            )}
            {tab === 'team' && <TeamPanel onClose={onClose} />}
            {tab === 'watermark' && (
              <div className="max-w-xl" data-testid="account-center-watermark">
                <button type="button" role="switch" aria-checked={watermarkOn} onClick={onToggleWatermark} className="flex w-full items-center justify-between rounded-xl bg-white/[0.06] px-5 py-4 text-left">
                  <span><span className="block text-sm font-medium">ダウンロード画像に透かしを入れる</span><span className="mt-1 block text-xs text-neutral-400">オンにすると、保存する画像の右下に透かしが入ります。</span></span>
                  <span aria-hidden="true" className={`relative h-5 w-9 shrink-0 rounded-full transition ${watermarkOn ? 'bg-[#5fcfc4]' : 'bg-white/25'}`}><span className={`absolute top-0.5 size-4 rounded-full bg-white transition ${watermarkOn ? 'left-[18px]' : 'left-0.5'}`} /></span>
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function TeamPanel({ onClose }: { onClose: () => void }) {
  const brand = useAuthStore((state) => state.currentBrand);
  const [usage, setUsage] = useState<CloudflareImageUsage | null>(null);
  const [members, setMembers] = useState<CloudflareBrandMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!brand?.id || !cloudflareDataPlane) { setFailed(true); return () => { cancelled = true; }; }
    void Promise.all([cloudflareDataPlane.getImageUsage(brand.id), cloudflareDataPlane.listBrandMembers(brand.id)])
      .then(([summary, list]) => { if (!cancelled) { setUsage(summary); setMembers(list); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [brand?.id]);
  const consumed = usage ? Math.max(0, usage.monthlyQuota - usage.remainingUnits) : null;
  const needle = query.trim().toLowerCase();
  const shown = (members ?? []).filter((member) => !needle || `${member.user?.name ?? ''} ${member.user?.email ?? ''}`.toLowerCase().includes(needle));
  return (
    <div data-testid="account-center-team">
      <p className="text-base font-semibold">{brand?.name ?? ''}</p>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3"><p className="text-xs text-neutral-300">ポイント残高</p><p className="mt-2 text-lg font-semibold">{usage ? usage.remainingUnits.toLocaleString('ja-JP') : '—'}</p></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3"><p className="text-xs text-neutral-300">消費ポイント</p><p className="mt-2 text-lg font-semibold text-[#0bcabc]">{consumed !== null ? consumed.toLocaleString('ja-JP') : '—'}</p></div>
      </div>
      <label className="mt-5 flex h-9 w-80 max-w-full items-center gap-2 rounded-lg border border-white/10 px-3 text-sm text-neutral-300">
        <Search className="h-4 w-4" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="アカウントまたはニックネームを入力してください" aria-label="アカウントを検索" className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-neutral-500" />
      </label>
      <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/[0.04] text-neutral-300"><tr><th className="px-4 py-3 font-normal">アカウント</th><th className="px-4 py-3 font-normal">登録時間</th><th className="px-4 py-3 font-normal">ユーザー</th><th className="px-4 py-3 font-normal">アカウント状態</th><th className="px-4 py-3 font-normal">操作</th></tr></thead>
          <tbody>
            {failed && <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-400">チームの情報を読み込めませんでした</td></tr>}
            {!failed && !members && <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-400">読み込み中…</td></tr>}
            {members && shown.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-400">該当するアカウントはありません</td></tr>}
            {shown.map((member) => <tr key={member.user_id} className="border-t border-white/10" data-testid="account-center-member">
              <td className="px-4 py-3"><span className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5"><User className="h-5 w-5 text-neutral-400" /></span>
                <span className="min-w-0"><span className="block truncate">{member.user?.name || '—'}</span><span className="block truncate text-xs text-neutral-400">{member.user?.email ?? ''}</span></span></span></td>
              <td className="px-4 py-3 text-neutral-300">{formatDate(member.joined_at)}</td>
              <td className="px-4 py-3">{ROLE_LABELS[member.role] ?? member.role}</td>
              <td className="px-4 py-3 text-[#0bcabc]"><span className="inline-flex items-center gap-1"><Check className="h-4 w-4" />正常</span></td>
              <td className="px-4 py-3"><Link to="/brand/settings" onClick={onClose} className="text-[#0bcabc] hover:underline">編集する</Link></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <Link to="/brand/settings?invite=1" onClick={onClose} className="mt-4 inline-flex h-8 items-center rounded-lg bg-[#0bcabc] px-6 text-sm font-medium text-neutral-950 hover:bg-[#3dd8cc]" data-testid="account-center-add">追加</Link>
    </div>
  );
}
