import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/**
 * The header's language and help menus and the two full-screen panels the help menu opens (通知 / よくあるご質問).
 * Geometry follows Light's dropdowns at 1440×900: the language menu is 160px wide and right-aligned to its trigger,
 * the help menu is 200px wide and left-aligned to its trigger, both 8px under the 50px header. The panel content is
 * Heavy's own (Heavy's update notes and answers about Heavy), never Light's announcements.
 */

const menuSurface = 'absolute top-[36.5px] z-[60] flex flex-col gap-1 rounded-xl border border-white/10 p-2 text-neutral-100 shadow-2xl';

export function LanguageMenu({ onClose }: { onClose: () => void }) {
  const item = 'relative flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-normal leading-5 outline-none';
  return (
    <div role="menu" aria-label="日本語" className={`${menuSurface} right-0 w-40 bg-[#2b2f31]`}>
      {/* Heavy is Japanese only for now; the other languages are listed as Light does but are not selectable yet. */}
      <div role="menuitem" aria-disabled="true" className={`${item} cursor-not-allowed text-neutral-500`}><span>简体中文</span></div>
      <button type="button" role="menuitemradio" aria-checked="true" onClick={onClose} className={`${item} bg-white/10 text-white`}>
        <span>日本語</span>
        <Check className="h-4 w-4 text-white" aria-hidden="true" />
      </button>
      <div role="menuitem" aria-disabled="true" className={`${item} cursor-not-allowed text-neutral-500`}><span>English</span></div>
    </div>
  );
}

export function HelpMenu({ unread, onOpen }: { unread: boolean; onOpen: (panel: 'notifications' | 'faq') => void }) {
  const item = 'relative flex min-h-8 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-normal leading-6 text-neutral-100 outline-none transition hover:bg-white/10 focus:bg-white/10';
  return (
    <div role="menu" aria-label="ヘルプセンター" className={`${menuSurface} left-0 w-[200px] min-w-[200px] bg-[#2b2f31]`}>
      <button type="button" role="menuitem" onClick={() => onOpen('notifications')} className={`${item} pr-2`}>
        <span className="flex w-full min-w-0 items-center justify-between gap-2">
          <span className="truncate">通知</span>
          {unread && <span data-testid="heavy-notifications-unread" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#FF4D50]" aria-label="未読あり" />}
        </span>
      </button>
      <button type="button" role="menuitem" onClick={() => onOpen('faq')} className={`${item} whitespace-nowrap`}>よくあるご質問（FAQ）</button>
    </div>
  );
}

type NoticeCategory = 'system' | 'changelog' | 'notice';
const categoryLabel: Record<NoticeCategory, string> = { system: 'システムからのお知らせ', changelog: '更新履歴', notice: 'システム通知' };

/** Heavy's own update notes, newest first. Each date is the day the change reached production (https://heavychain.app). */
export const heavyNotifications: { id: string; category: NoticeCategory; date: string; title: string; body: string[] }[] = [
  {
    id: '2026-10-07-header-help',
    category: 'changelog',
    date: '2026-10-07',
    title: 'ヘッダーに言語メニューとヘルプセンターを追加',
    body: ['ヘルプセンターから、この通知とよくあるご質問を開けるようになりました。'],
  },
  {
    id: '2026-10-07-board-server',
    category: 'changelog',
    date: '2026-10-07',
    title: 'デザインドキュメントをサーバーに保存',
    body: ['デザインドキュメント（ページ・テキスト・画像・図形）は自動でサーバーに保存され、別の端末からも同じ内容で開けます。', 'ドキュメントのコピーと削除にも対応しました。'],
  },
  {
    id: '2026-10-06-inputs-restore',
    category: 'changelog',
    date: '2026-10-06',
    title: '入力内容の保存と復元',
    body: ['プリント修正・色調整・画像調整などの入力とアップロード画像をプロジェクトに保存し、再読み込みしても元の状態から続けられます。'],
  },
  {
    id: '2026-10-06-image-speed',
    category: 'system',
    date: '2026-10-06',
    title: '画像の表示を高速化しました',
    body: ['同じ画像を表示するときの読み込みをまとめ、一覧や履歴の画像が表示されるまでの時間を短くしました。'],
  },
];

const latestNotificationId = heavyNotifications[0]?.id ?? '';
const seenKey = (userId: string | null | undefined) => (userId ? `heavy:notifications-seen:v1:${userId}` : null);

/** Unread dot state: the newest note differs from the one the user last opened (kept per user in this browser). */
export function useHeavyNotificationsSeen(userId: string | null | undefined) {
  const key = seenKey(userId);
  const [seenId, setSeenId] = useState<string | null>(null);
  useEffect(() => {
    try { setSeenId(key ? localStorage.getItem(key) : null); } catch { setSeenId(null); }
  }, [key]);
  const markSeen = () => {
    setSeenId(latestNotificationId);
    try { if (key) localStorage.setItem(key, latestNotificationId); } catch { /* storage unavailable */ }
  };
  return { unread: Boolean(latestNotificationId) && seenId !== latestNotificationId, markSeen };
}

function FullScreenPanel({ title, titleClassName, onClose, children }: { title: string; titleClassName: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    // Light: a full-screen blurred layer over the workspace (content starts 56px from the top); clicking outside the content closes it.
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[99999] flex flex-col bg-[#202426]/90 px-6 pb-6 pt-14 text-neutral-100 backdrop-blur-sm" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <h3 className={titleClassName}>{title}</h3>
      {children}
    </div>
  );
}

export function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'all' | NoticeCategory>('all');
  const tabs: { id: 'all' | NoticeCategory; label: string }[] = [
    { id: 'all', label: 'すべて表示' },
    { id: 'system', label: categoryLabel.system },
    { id: 'changelog', label: categoryLabel.changelog },
    { id: 'notice', label: categoryLabel.notice },
  ];
  const items = useMemo(() => heavyNotifications.filter((item) => tab === 'all' || item.category === tab), [tab]);
  return (
    <FullScreenPanel title="通知" titleClassName="mx-auto text-2xl font-normal leading-[28.8px]" onClose={onClose}>
      <div className="mx-auto flex h-px w-[768px] max-w-full grow flex-col gap-2" onClick={(event) => event.stopPropagation()}>
        <div role="tablist" className="mx-auto mt-4 flex h-10 w-fit items-center justify-center rounded-xl border border-[#3B3E3F] bg-[#242829] p-[3px] text-neutral-400">
          {tabs.map(({ id, label }) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex-1 whitespace-nowrap rounded border border-transparent px-6 py-1 text-sm font-medium leading-[21px] transition ${tab === id ? 'bg-white/15 text-white shadow-sm' : 'hover:text-neutral-200'}`}>{label}</button>
          ))}
        </div>
        <div className="my-4 h-0 w-full border-b border-white/10" />
        <div role="tabpanel" className="h-px w-full grow overflow-auto px-6">
          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-500">お知らせはありません</p>
          ) : items.map((item) => (
            <div key={item.id} className="flex w-full gap-4 border-b border-white/10 px-4 py-6">
              <div className="w-[104px] shrink-0 text-sm leading-[21px]">
                <p className="text-neutral-100">{categoryLabel[item.category]}</p>
                <p className="mt-2 text-neutral-500">{item.date}</p>
              </div>
              <div className="flex grow flex-col gap-4 text-sm leading-[21px]">
                <p className="text-white">{item.title}</p>
                {item.body.map((line) => <p key={line} className="text-neutral-400">{line}</p>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </FullScreenPanel>
  );
}

/** Answers describe Heavy Chain itself. */
const heavyFaq: { section: string; items: { q: string; a: string }[] }[] = [
  {
    section: 'AI機能関連',
    items: [
      { q: '生成された画像に著作権上の問題はありませんか？', a: '生成した画像の利用はご自身の判断と責任で行ってください。商品化や広告に使う前に、既存の商標・意匠・人物などに似ていないかを必ず確認してください。' },
      { q: 'メンズ・レディース・キッズ商品の生成に対応していますか？', a: '対応しています。入力欄で対象（メンズ・レディース・キッズなど）や商品カテゴリーを指定して生成できます。' },
      { q: 'ベクターデータのダウンロードには対応していますか？', a: 'パターンのベクター化（SVG変換）の機能で、画像をSVGに変換してダウンロードできます。' },
    ],
  },
  {
    section: 'インフラ関連',
    items: [
      { q: '推奨ブラウザや使用可能なブラウザに指定はありますか？', a: '最新版の Google Chrome をおすすめします。' },
      { q: 'パソコンの推奨スペックや必要な動作環境はありますか？', a: '画像の生成はサーバー側で行うため、特別なスペックは必要ありません。画面の幅が1440px程度あるパソコンで快適に操作できます。' },
      { q: 'iPad やスマートフォンでも利用できますか？', a: '表示はできますが、編集や生成の操作はパソコンでのご利用をおすすめします。' },
    ],
  },
  {
    section: 'アカウントについて',
    items: [
      { q: '同じアカウントを複数人で共有して利用できますか？', a: 'アカウントは1人1つでご利用ください。複数人で使う場合は、チーム管理からメンバーを追加してください。' },
    ],
  },
];

export function FaqPanel({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <FullScreenPanel title="よくあるご質問（FAQ）❓" titleClassName="mx-auto shrink-0 text-center text-[32px] font-bold leading-10 text-white" onClose={onClose}>
      <div className="mx-auto mt-6 flex min-h-0 w-full max-w-[1280px] flex-1 flex-col overflow-y-auto overflow-x-hidden scrollbar-hide" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-col gap-6 pb-8">
          {heavyFaq.map(({ section, items }) => (
            <section key={section} className="flex w-full flex-col rounded-3xl bg-[#242829] px-6 py-8 sm:px-12 md:px-24">
              <h4 className="flex h-20 shrink-0 items-center py-4 text-xl font-bold text-white">{section}</h4>
              {items.map(({ q, a }) => {
                const isOpen = open === q;
                return (
                  <div key={q} className="peer overflow-hidden border-t border-white/10 transition-[background-color,border-radius,border-color] duration-200 ease-out hover:rounded-2xl hover:border-t-transparent hover:bg-white/10 peer-hover:border-t-transparent">
                    <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : q)} className="flex min-h-20 w-full items-center justify-between gap-4 px-6 text-left text-sm font-medium text-white">
                      <span>{q}</span>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-neutral-400 transition ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                    {isOpen && <p className="px-6 pb-6 text-sm leading-6 text-neutral-300">{a}</p>}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </FullScreenPanel>
  );
}
