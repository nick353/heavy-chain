import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Users, 
  Image, 
  TrendingUp, 
  DollarSign, 
  AlertTriangle,
  Bell,
  Search,
  CheckCircle,
  Eye,
  Activity,
  Clock,
  Camera,
  ExternalLink,
  MessageSquare
} from 'lucide-react';
import { cloudflareDataPlane, type CloudflareAdminStats, type CloudflareAdminUser,
  type CloudflareFeedback, type CloudflareAnnouncement } from '../lib/cloudflareApi';
import { Button, Input, Modal } from '../components/ui';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';

type DashboardStats = CloudflareAdminStats;
type User = CloudflareAdminUser;

type FeedbackStatus = 'new' | 'in_progress' | 'done';
type FeedbackType = 'lost' | 'cutout' | 'result' | 'save' | 'speed' | 'other';

type FeedbackSubmission = CloudflareFeedback;

const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: '未対応',
  in_progress: '対応中',
  done: '完了',
};

const FEEDBACK_STATUS_STYLES: Record<FeedbackStatus, string> = {
  new: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  done: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  lost: 'どこを押すかわからない',
  cutout: '切り抜きがうまくいかない',
  result: '生成結果が微妙',
  save: '保存先がわからない',
  speed: '動作が遅い',
  other: 'その他',
};

const SAFE_FEEDBACK_URL_ORIGINS = new Set([
  'https://heavy-chain.com',
  'https://heavy-chain-web.nichika2000823.workers.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const getSafeFeedbackUrl = (value: string) => {
  try {
    const url = value.startsWith('/')
      ? new URL(value, 'https://heavy-chain-web.nichika2000823.workers.dev')
      : new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !SAFE_FEEDBACK_URL_ORIGINS.has(url.origin)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

export function AdminDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const initialTab = (
    requestedTab === 'users' ||
    requestedTab === 'feedback' ||
    requestedTab === 'moderation' ||
    requestedTab === 'announcements'
  ) ? requestedTab : 'overview';
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    activeUsers: 0,
    totalImages: 0,
    totalCost: null,
    totalUsageUnits: null,
    edgeRunCount: null,
    averageDurationMs: null,
    meteringStatus: 'not_configured',
    activeUsersBasis: 'profile_updated_last_30_days',
  });
  const [users, setUsers] = useState<User[]>([]);
  const [feedbackItems, setFeedbackItems] = useState<FeedbackSubmission[]>([]);
  const [announcements, setAnnouncements] = useState<CloudflareAnnouncement[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const announcementRequest = useRef<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingFeedbackId, setUpdatingFeedbackId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'feedback' | 'moderation' | 'announcements'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [adminsOnly, setAdminsOnly] = useState(false);
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackSubmission | null>(null);
  const [feedbackScreenshotUrl, setFeedbackScreenshotUrl] = useState<string | null>(null);
  const [feedbackScreenshotError, setFeedbackScreenshotError] = useState(false);
  const [feedbackNoteDraft, setFeedbackNoteDraft] = useState('');
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    content: '',
    type: 'info' as 'info' | 'warning' | 'maintenance',
  });

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    setFeedbackScreenshotUrl(null);
    setFeedbackScreenshotError(false);
    if (!selectedFeedback?.screenshot_path || selectedFeedback.submission_state !== 'accepted' || !cloudflareDataPlane) return;
    let active = true; let blobURL: string | null = null;
    cloudflareDataPlane.readFeedbackScreenshot(selectedFeedback.id).then(blob => {
      if (!active) return;
      blobURL = URL.createObjectURL(blob); setFeedbackScreenshotUrl(blobURL);
    }).catch(() => { if (active) { setFeedbackScreenshotError(true); toast.error('添付画像を確認できませんでした'); } });
    return () => { active = false; if (blobURL) URL.revokeObjectURL(blobURL); };
  }, [selectedFeedback?.id, selectedFeedback?.screenshot_path, selectedFeedback?.submission_state]);

  useEffect(() => {
    if (
      requestedTab === 'overview' ||
      requestedTab === 'users' ||
      requestedTab === 'feedback' ||
      requestedTab === 'moderation' ||
      requestedTab === 'announcements'
    ) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  const loadDashboard = async () => {
    setIsLoading(true); setLoadError(null);
    try {
      if (!cloudflareDataPlane) throw new Error('管理画面のCloudflare接続が未設定です');
      const [nextStats, nextUsers, nextFeedback, nextAnnouncements] = await Promise.all([
        cloudflareDataPlane.getAdminStats(), cloudflareDataPlane.listAdminUsers(),
        cloudflareDataPlane.listAdminFeedback(), cloudflareDataPlane.listAnnouncements(),
      ]);
      setStats(nextStats); setUsers(nextUsers); setFeedbackItems(nextFeedback); setAnnouncements(nextAnnouncements);
    } catch (error) {
      setLoadError(error instanceof Error && error.message.includes('_403_')
        ? '管理者権限を確認できません。' : '管理情報を読み込めませんでした。接続を確認して再読み込みしてください。');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchFeedbackItems = async () => {
    try {
      if (!cloudflareDataPlane) throw new Error('unavailable');
      setFeedbackItems(await cloudflareDataPlane.listAdminFeedback());
    } catch { toast.error('フィードバックの更新を確認できませんでした'); }
  };

  const handlePublishAnnouncement = async () => {
    if (!announcementForm.title.trim() || !announcementForm.content.trim()) {
      toast.error('タイトルと内容を入力してください');
      return;
    }

    try {
      if (isPublishing) return;
      setIsPublishing(true);
      if (!cloudflareDataPlane) throw new Error('unavailable');
      announcementRequest.current ??= crypto.randomUUID();
      const published = await cloudflareDataPlane.publishAnnouncement({ ...announcementForm, request_id: announcementRequest.current });
      setAnnouncements(current => [published, ...current.filter(item => item.id !== published.id)]);
      announcementRequest.current = null;

      toast.success('お知らせを公開しました');
      setShowAnnouncementModal(false);
      setAnnouncementForm({ title: '', content: '', type: 'info' });
    } catch {
      toast.error('公開結果を確認できません。同じ内容で再確認してください。');
    } finally { setIsPublishing(false); }
  };

  const openFeedbackDetail = (item: FeedbackSubmission) => {
    setSelectedFeedback(item);
    setFeedbackNoteDraft(item.admin_note || '');
    setFeedbackScreenshotUrl(null);

  };

  const updateFeedback = async (
    item: FeedbackSubmission,
    updates: Partial<Pick<FeedbackSubmission, 'status' | 'admin_note'>>,
  ) => {
    try {
      setUpdatingFeedbackId(item.id);
      if (!cloudflareDataPlane) throw new Error('unavailable');
      const updated = await cloudflareDataPlane.updateAdminFeedback(item.id, { ...updates, revision: item.revision });

      toast.success('フィードバックを更新しました');
      setFeedbackItems(current => current.map(row => row.id === item.id ? updated : row));
      setSelectedFeedback((current) => current?.id === item.id
        ? updated
        : current);
    } catch (error: any) {
      toast.error(error.message?.includes('_409_') ? '別の更新がありました。一覧を更新して内容を確認してください。' : 'フィードバック更新を確認できませんでした');
    } finally {
      setUpdatingFeedbackId(null);
    }
  };

  const filteredUsers = users.filter(user =>
    (!adminsOnly || user.is_admin) && (user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.name?.toLowerCase().includes(searchQuery.toLowerCase()))
  );
  const feedbackOpenCount = feedbackItems.filter((item) => item.status !== 'done').length;

  const StatCard = ({ icon: Icon, label, value, trend, color }: any) => (
    <div className="glass-card p-6 hover:shadow-elegant transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-md ${color}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        {trend && (
          <span className="flex items-center gap-1 text-sm font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-full">
            <TrendingUp className="w-3 h-3" />
            {trend}%
          </span>
        )}
      </div>
      <p className="text-3xl font-bold text-neutral-800 dark:text-white mb-1 font-display">
        {value === null ? '未計測' : typeof value === 'number' && label.includes('コスト')
          ? `$${value.toFixed(2)}` 
          : value.toLocaleString()}
      </p>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{label}</p>
    </div>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

  if (loadError) return <div className="p-12 text-center text-neutral-900 dark:text-white" role="alert">
    <p>{loadError}</p><Button onClick={loadDashboard} className="mt-4">再読み込み</Button>
  </div>;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      {/* Header */}
      <header className="glass-nav px-6 py-4 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-800 dark:text-white">管理者ダッシュボード</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Heavy Chain システム管理</p>
          </div>
          <Button
            leftIcon={<Bell className="w-4 h-4" />}
            onClick={() => setShowAnnouncementModal(true)}
            className="shadow-glow hover:shadow-glow-lg"
          >
            お知らせ配信
          </Button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl mb-8 w-fit shadow-inner">
          {[
            { id: 'overview', label: '概要' },
            { id: 'users', label: 'ユーザー' },
            { id: 'feedback', label: 'フィードバック' },
            { id: 'moderation', label: 'モデレーション' },
            { id: 'announcements', label: 'お知らせ' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as typeof activeTab);
                if (tab.id === 'overview') {
                  setSearchParams({});
                } else {
                  setSearchParams({ tab: tab.id });
                }
              }}
              className={`
                px-4 py-2 text-sm font-medium rounded-lg transition-all
                ${activeTab === tab.id
                  ? 'bg-white dark:bg-neutral-700 text-neutral-800 dark:text-white shadow-sm'
                  : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview */}
        {activeTab === 'overview' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-8"
          >
            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <StatCard
                icon={Users}
                label="総ユーザー数"
                value={stats.totalUsers}
                color="bg-blue-500"
              />
              <StatCard
                icon={Users}
                label="30日以内のプロフィール更新"
                value={stats.activeUsers}
                color="bg-green-500"
              />
              <StatCard
                icon={Image}
                label="生成画像数"
                value={stats.totalImages}
                color="bg-purple-500"
              />
              <StatCard
                icon={DollarSign}
                label="画像AI推計費用（USD）"
                value={stats.estimatedImageCostUSD ?? null}
                color="bg-orange-500"
              />
              <StatCard
                icon={Activity}
                label="画像AI保存済み枚数"
                value={stats.totalUsageUnits}
                color="bg-cyan-500"
              />
              <StatCard
                icon={Clock}
                label="画像AI推論試行数"
                value={stats.inferenceAttempts ?? null}
                color="bg-rose-500"
              />
              <StatCard
                icon={MessageSquare}
                label="未完了フィードバック（最新100件）"
                value={feedbackOpenCount}
                color="bg-indigo-500"
              />
            </div>

            {/* Usage chart placeholder */}
            <div className="glass-panel rounded-2xl p-8 shadow-soft">
              <h2 className="text-lg font-semibold text-neutral-800 dark:text-white mb-4">利用状況</h2>
              <div className="h-64 flex items-center justify-center bg-neutral-50 dark:bg-neutral-800/50 rounded-xl border border-neutral-100 dark:border-neutral-700/50">
                <p className="text-neutral-500 dark:text-neutral-400">
                  {stats.averageImageInferenceMs == null ? '画像AIの推論時間は未計測です。'
                    : `平均画像AI推論時間: ${stats.averageImageInferenceMs.toLocaleString()}ms。`}
                  {' '}費用はモデル単価による推計で、実請求・無料枠残量ではありません。
                  {stats.unmeasuredInferenceAttempts ? ` 未計測の推論: ${stats.unmeasuredInferenceAttempts}件。` : ''}
                  {' '}全APIのCPU時間・実行数・R2/D1料金は未計測です。
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Users */}
        {activeTab === 'users' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel rounded-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-neutral-100 dark:border-neutral-700">
              <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                  <input
                    type="text"
                    placeholder="最新100ユーザーを検索..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                  />
                </div>
                <label className="text-sm text-neutral-800 dark:text-neutral-200">
                  <input type="checkbox" checked={adminsOnly} onChange={event => setAdminsOnly(event.target.checked)} className="mr-2" />管理者のみ
                </label>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-neutral-50 dark:bg-neutral-800/50 text-left">
                  <tr>
                    <th className="px-6 py-4 text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">ユーザー</th>
                    <th className="px-6 py-4 text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">登録日</th>
                    <th className="px-6 py-4 text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">権限</th>
                    <th className="px-6 py-4 text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">アクション</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900 dark:to-primary-800 flex items-center justify-center text-primary-700 dark:text-primary-300 font-medium">
                            {user.name?.charAt(0) || user.email?.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-neutral-800 dark:text-white">{user.name || 'Unknown'}</p>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-neutral-600 dark:text-neutral-300">
                        {new Date(user.created_at).toLocaleDateString('ja-JP')}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`
                          inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                          ${user.is_admin
                            ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
                            : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          }
                        `}>
                          <CheckCircle className="w-3.5 h-3.5" />
                          {user.is_admin ? '管理者' : '一般ユーザー'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setSelectedUser(user)} aria-label={`${user.name || user.email}の詳細`} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors text-neutral-500 dark:text-neutral-400">
                            <Eye className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {/* Feedback */}
        {activeTab === 'feedback' && (
          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid gap-4 md:grid-cols-3"
            >
              {(['new', 'in_progress', 'done'] as FeedbackStatus[]).map((status) => (
                <div key={status} className="glass-card p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    {FEEDBACK_STATUS_LABELS[status]}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-neutral-900 dark:text-white">
                    {feedbackItems.filter((item) => item.status === status).length}
                  </p>
                </div>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-panel rounded-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between gap-4 border-b border-neutral-100 p-6 dark:border-neutral-700">
                <div>
                  <h2 className="text-lg font-semibold text-neutral-800 dark:text-white">
                    <MessageSquare className="mr-2 inline-block h-5 w-5" />
                    社内betaフィードバック
                  </h2>
                  <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    右下ボタンから送られたコメントと画面スクショを確認します。
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={fetchFeedbackItems}>
                  更新
                </Button>
              </div>

              {feedbackItems.length === 0 ? (
                <div className="p-12 text-center text-neutral-500 dark:text-neutral-400">
                  フィードバックはまだありません
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-neutral-50 text-left dark:bg-neutral-800/50">
                      <tr>
                        <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">状態</th>
                        <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">内容</th>
                        <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">ページ</th>
                        <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">投稿者</th>
                        <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">日時</th>
                        <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">詳細</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
                      {feedbackItems.map((item) => (
                        <tr key={item.id} className="transition-colors hover:bg-neutral-50/50 dark:hover:bg-neutral-800/50">
                          <td className="px-6 py-4">
                            <select
                              value={item.status}
                              disabled={updatingFeedbackId === item.id}
                              onChange={(event) => updateFeedback(item, { status: event.target.value as FeedbackStatus })}
                              className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
                            >
                              {(['new', 'in_progress', 'done'] as FeedbackStatus[]).map((status) => (
                                <option key={status} value={status}>{FEEDBACK_STATUS_LABELS[status]}</option>
                              ))}
                            </select>
                          </td>
                          <td className="max-w-sm px-6 py-4">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${FEEDBACK_STATUS_STYLES[item.status]}`}>
                                {FEEDBACK_TYPE_LABELS[item.type]}
                              </span>
                              {item.screenshot_path && <Camera className="h-4 w-4 text-neutral-400" />}
                            </div>
                            <p className="mt-2 truncate text-sm text-neutral-700 dark:text-neutral-200">
                              {item.message}
                            </p>
                          </td>
                          <td className="px-6 py-4 text-sm text-neutral-600 dark:text-neutral-300">
                            {getSafeFeedbackUrl(item.page_url) ? (
                              <a
                                href={getSafeFeedbackUrl(item.page_url) || undefined}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex max-w-[220px] items-center gap-1 truncate text-primary-600 hover:underline dark:text-primary-300"
                              >
                                {item.pathname}
                                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                              </a>
                            ) : (
                              <span className="inline-flex max-w-[220px] truncate">{item.pathname || '不明なページ'}</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm text-neutral-600 dark:text-neutral-300">
                            <p>{item.email || item.user?.email || '未入力'}</p>
                            {item.brand?.name && (
                              <p className="text-xs text-neutral-400">{item.brand.name}</p>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm text-neutral-600 dark:text-neutral-300">
                            {new Date(item.created_at).toLocaleString('ja-JP')}
                          </td>
                          <td className="px-6 py-4">
                            <Button size="sm" variant="secondary" onClick={() => openFeedbackDetail(item)}>
                              開く
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          </div>
        )}

        {/* Moderation */}
        {activeTab === 'moderation' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel rounded-2xl p-12 text-center"
          >
            <div className="w-20 h-20 bg-neutral-100 dark:bg-neutral-800 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-10 h-10 text-neutral-400" />
            </div>
            <h3 className="text-xl font-medium text-neutral-700 dark:text-white mb-2">
              コンテンツ通報機能は未接続です
            </h3>
            <p className="text-neutral-500 dark:text-neutral-400">
              旧画面にも通報一覧の実データ接続はありません。問い合わせはフィードバックタブで確認できます。
            </p>
          </motion.div>
        )}

        {/* Announcements */}
        {activeTab === 'announcements' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel rounded-2xl p-12 text-center"
          >
            <div className="w-20 h-20 bg-primary-50 dark:bg-primary-900/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <Bell className="w-10 h-10 text-primary-500" />
            </div>
            <h3 className="text-xl font-medium text-neutral-700 dark:text-white mb-2">
              お知らせ履歴
            </h3>
            <p className="text-neutral-500 dark:text-neutral-400 mb-8">
              過去に配信したお知らせが表示されます
            </p>
            <Button onClick={() => setShowAnnouncementModal(true)} className="shadow-glow">
              新規お知らせを作成
            </Button>
            <div className="mt-8 space-y-4 text-left">
              {announcements.length === 0 && <p className="text-neutral-600 dark:text-neutral-300">公開済みのお知らせはありません。</p>}
              {announcements.map(item => <article key={item.id} className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-700">
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{new Date(item.created_at).toLocaleString('ja-JP')} · {item.type}</p>
                <h4 className="mt-2 font-semibold text-neutral-900 dark:text-white">{item.title}</h4>
                <p className="mt-2 whitespace-pre-wrap break-words text-neutral-700 dark:text-neutral-200">{item.content}</p>
              </article>)}
            </div>
          </motion.div>
        )}
      </div>

      <Modal isOpen={Boolean(selectedUser)} onClose={() => setSelectedUser(null)} title="ユーザー詳細" size="md">
        {selectedUser && <dl className="space-y-3 break-words text-neutral-900 dark:text-white">
          <div><dt>名前</dt><dd>{selectedUser.name || '未設定'}</dd></div>
          <div><dt>メール</dt><dd>{selectedUser.email}</dd></div>
          <div><dt>ユーザーID</dt><dd>{selectedUser.id}</dd></div>
          <div><dt>権限</dt><dd>{selectedUser.is_admin ? '管理者' : '一般ユーザー'}</dd></div>
          <div><dt>登録日時</dt><dd>{new Date(selectedUser.created_at).toLocaleString('ja-JP')}</dd></div>
        </dl>}
      </Modal>

      {/* Feedback Detail Modal */}
      <Modal
        isOpen={Boolean(selectedFeedback)}
        onClose={() => {
          setSelectedFeedback(null);
          setFeedbackScreenshotUrl(null);
          setFeedbackNoteDraft('');
        }}
        title="フィードバック詳細"
        size="lg"
      >
        {selectedFeedback && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${FEEDBACK_STATUS_STYLES[selectedFeedback.status]}`}>
                {FEEDBACK_STATUS_LABELS[selectedFeedback.status]}
              </span>
              <span className="inline-flex rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                {FEEDBACK_TYPE_LABELS[selectedFeedback.type]}
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {new Date(selectedFeedback.created_at).toLocaleString('ja-JP')}
              </span>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">コメント</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-800 dark:text-neutral-100">
                {selectedFeedback.message}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">ページ</p>
                {getSafeFeedbackUrl(selectedFeedback.page_url) ? (
                  <a
                    href={getSafeFeedbackUrl(selectedFeedback.page_url) || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 break-all text-sm text-primary-600 hover:underline dark:text-primary-300"
                  >
                    {selectedFeedback.page_url}
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                ) : (
                  <p className="mt-2 break-all text-sm text-neutral-600 dark:text-neutral-300">
                    {selectedFeedback.page_url || '不明なページ'}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">投稿者 / 環境</p>
                <p className="mt-2 text-sm text-neutral-800 dark:text-neutral-100">
                  {selectedFeedback.email || selectedFeedback.user?.email || '未入力'}
                </p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {selectedFeedback.viewport?.width || '?'} x {selectedFeedback.viewport?.height || '?'} / {selectedFeedback.screenshot_capture_status}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">スクショ</p>
              {feedbackScreenshotUrl ? (
                <img
                  src={feedbackScreenshotUrl}
                  alt="フィードバック画面スクショ"
                  className="max-h-[420px] w-full rounded-lg object-contain object-top"
                />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg bg-neutral-100 text-sm text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300">
                  {selectedFeedback.submission_state === 'pending' ? '本文は受付済み・添付画像の保存は未完了です'
                    : feedbackScreenshotError ? '添付画像を取得できませんでした。開き直して再確認してください'
                    : selectedFeedback.screenshot_path ? '添付画像を読み込み中です' : '添付画像はありません'}
                </div>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                管理メモ
              </label>
              <textarea
                value={feedbackNoteDraft}
                onChange={(event) => setFeedbackNoteDraft(event.target.value)}
                rows={4}
                className="w-full resize-none rounded-xl border border-neutral-200 bg-white px-4 py-3 text-neutral-900 transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
                placeholder="対応内容や次のアクションを記録"
              />
            </div>

            <div className="flex flex-wrap justify-between gap-3 border-t border-neutral-100 pt-4 dark:border-neutral-800">
              <div className="flex flex-wrap gap-2">
                {(['new', 'in_progress', 'done'] as FeedbackStatus[]).map((status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant={selectedFeedback.status === status ? 'primary' : 'secondary'}
                    disabled={updatingFeedbackId === selectedFeedback.id}
                    onClick={() => updateFeedback(selectedFeedback, { status })}
                  >
                    {FEEDBACK_STATUS_LABELS[status]}
                  </Button>
                ))}
              </div>
              <Button
                isLoading={updatingFeedbackId === selectedFeedback.id}
                onClick={() => updateFeedback(selectedFeedback, { admin_note: feedbackNoteDraft })}
              >
                メモを保存
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Announcement Modal */}
      <Modal
        isOpen={showAnnouncementModal}
        onClose={() => { if (!isPublishing) { setShowAnnouncementModal(false); announcementRequest.current = null; } }}
        title="お知らせを配信"
        size="md"
      >
        <div className="space-y-5">
          <Input
            label="タイトル"
            placeholder="お知らせのタイトル"
            value={announcementForm.title}
            onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })}
          />

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
              内容
            </label>
            <textarea
              value={announcementForm.content}
              onChange={(e) => setAnnouncementForm({ ...announcementForm, content: e.target.value })}
              className="w-full px-4 py-3 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-neutral-900 dark:text-white transition-all resize-none"
              rows={4}
              placeholder="お知らせの内容を入力..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              種類
            </label>
            <div className="flex gap-2">
              {[
                { id: 'info', label: '情報' },
                { id: 'warning', label: '警告' },
                { id: 'maintenance', label: 'メンテナンス' },
              ].map((type) => (
                <button
                  key={type.id}
                  onClick={() => setAnnouncementForm({ ...announcementForm, type: type.id as any })}
                  className={`
                    px-4 py-2 rounded-lg text-sm font-medium transition-all
                    ${announcementForm.type === type.id
                      ? 'bg-primary-500 text-white shadow-md'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                    }
                  `}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-neutral-100 dark:border-neutral-800">
            <Button variant="ghost" disabled={isPublishing} onClick={() => { setShowAnnouncementModal(false); announcementRequest.current = null; }}>
              キャンセル
            </Button>
            <Button onClick={handlePublishAnnouncement} isLoading={isPublishing} className="shadow-glow">
              配信
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
