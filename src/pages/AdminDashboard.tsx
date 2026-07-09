import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Users, 
  Image, 
  TrendingUp, 
  DollarSign, 
  AlertTriangle,
  Bell,
  Search,
  Filter,
  CheckCircle,
  Eye,
  Activity,
  Clock,
  Camera,
  ExternalLink,
  KeyRound,
  MessageSquare
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Input, Modal } from '../components/ui';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';

interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  totalImages: number;
  totalCost: number;
  totalUsageUnits: number;
  edgeRunCount: number;
  averageDurationMs: number;
}

interface User {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  is_admin: boolean;
}

interface ModerationItem {
  id: string;
  image_url: string;
  reported_at: string;
  reason: string;
  user_id: string;
  status: 'pending' | 'approved' | 'rejected';
}

type RunwayMcpConnectionStatus = 'pending' | 'approved' | 'rejected' | 'revoked';
type FeedbackStatus = 'new' | 'in_progress' | 'done';
type FeedbackType = 'lost' | 'cutout' | 'result' | 'save' | 'speed' | 'other';

interface RunwayMcpApproval {
  id: string;
  brand_id: string;
  status: RunwayMcpConnectionStatus;
  requested_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  revoked_at: string | null;
  updated_at: string;
  brand?: {
    id: string;
    name: string;
  } | null;
}

interface FeedbackSubmission {
  id: string;
  user_id: string;
  brand_id: string | null;
  type: FeedbackType;
  message: string;
  email: string | null;
  page_url: string;
  pathname: string;
  viewport: any;
  user_agent: string | null;
  screenshot_path: string | null;
  screenshot_capture_status: 'captured' | 'screenshot_capture_failed' | 'screenshot_upload_failed';
  status: FeedbackStatus;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  user?: {
    email: string | null;
    name: string | null;
  } | null;
  brand?: {
    name: string | null;
  } | null;
}

interface RunwayBrandSubscription {
  brand_id: string;
  status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  plan: {
    code: string | null;
    name: string | null;
    is_active: boolean | null;
    runway_mcp_generation: boolean;
  } | null;
}

const RUNWAY_STATUS_LABELS: Record<RunwayMcpConnectionStatus, string> = {
  pending: '承認待ち',
  approved: '承認済み',
  rejected: '却下',
  revoked: '取消済み',
};

const RUNWAY_STATUS_STYLES: Record<RunwayMcpConnectionStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  revoked: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

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
  'https://heavy-chain.zeabur.app',
  'https://heavy-chain.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const getSafeFeedbackUrl = (value: string) => {
  try {
    const url = value.startsWith('/') ? new URL(value, 'https://heavy-chain.zeabur.app') : new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !SAFE_FEEDBACK_URL_ORIGINS.has(url.origin)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

const getPlanLabel = (subscription: RunwayBrandSubscription | null | undefined) => (
  subscription?.plan?.name || subscription?.plan?.code || 'Free'
);

export function AdminDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const initialTab = (
    requestedTab === 'users' ||
    requestedTab === 'runway' ||
    requestedTab === 'feedback' ||
    requestedTab === 'moderation' ||
    requestedTab === 'announcements'
  ) ? requestedTab : 'overview';
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    activeUsers: 0,
    totalImages: 0,
    totalCost: 0,
    totalUsageUnits: 0,
    edgeRunCount: 0,
    averageDurationMs: 0,
  });
  const [users, setUsers] = useState<User[]>([]);
  const [runwayApprovals, setRunwayApprovals] = useState<RunwayMcpApproval[]>([]);
  const [runwaySubscriptionsByBrand, setRunwaySubscriptionsByBrand] = useState<Record<string, RunwayBrandSubscription>>({});
  const [feedbackItems, setFeedbackItems] = useState<FeedbackSubmission[]>([]);
  const [_moderationQueue, _setModerationQueue] = useState<ModerationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingRunwayBrandId, setUpdatingRunwayBrandId] = useState<string | null>(null);
  const [updatingFeedbackId, setUpdatingFeedbackId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'runway' | 'feedback' | 'moderation' | 'announcements'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackSubmission | null>(null);
  const [feedbackScreenshotUrl, setFeedbackScreenshotUrl] = useState<string | null>(null);
  const [feedbackNoteDraft, setFeedbackNoteDraft] = useState('');
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    content: '',
    type: 'info' as 'info' | 'warning' | 'maintenance',
  });

  useEffect(() => {
    fetchStats();
    fetchUsers();
    fetchRunwayApprovals();
    fetchFeedbackItems();
  }, []);

  useEffect(() => {
    if (
      requestedTab === 'overview' ||
      requestedTab === 'users' ||
      requestedTab === 'runway' ||
      requestedTab === 'feedback' ||
      requestedTab === 'moderation' ||
      requestedTab === 'announcements'
    ) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  const fetchStats = async () => {
    try {
      // Get user count
      const { count: userCount, error: userError } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });

      if (userError) {
        console.error('Failed to fetch user count:', userError);
      }

      // Get image count
      const { count: imageCount, error: imageError } = await supabase
        .from('generated_images')
        .select('*', { count: 'exact', head: true });

      if (imageError) {
        console.error('Failed to fetch image count:', imageError);
      }

      // Get total API cost
      const { data: costData, error: costError } = await supabase
        .from('api_usage_logs')
        .select('cost_usd');

      if (costError) {
        console.error('Failed to fetch cost data:', costError);
      }

      const totalCost = costData?.reduce((sum, log) => sum + (log.cost_usd || 0), 0) || 0;

      const { data: usageData, error: usageError } = await supabase
        .from('usage_events')
        .select('units,status');

      if (usageError) {
        console.error('Failed to fetch usage events:', usageError);
      }

      const totalUsageUnits = usageData?.reduce((sum, event) => (
        event.status === 'reserved' || event.status === 'succeeded'
          ? sum + (event.units || 0)
          : sum
      ), 0) || 0;

      const { data: edgeRunData, error: edgeRunError } = await supabase
        .from('edge_function_runs')
        .select('duration_ms,status');

      if (edgeRunError) {
        console.error('Failed to fetch edge run data:', edgeRunError);
      }

      const completedDurations = edgeRunData
        ?.map((run) => run.duration_ms)
        .filter((duration): duration is number => typeof duration === 'number') || [];
      const averageDurationMs = completedDurations.length > 0
        ? Math.round(completedDurations.reduce((sum, duration) => sum + duration, 0) / completedDurations.length)
        : 0;

      // Get active users (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { count: activeCount, error: activeError } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('updated_at', thirtyDaysAgo.toISOString());

      if (activeError) {
        console.error('Failed to fetch active users:', activeError);
      }

      setStats({
        totalUsers: userCount || 0,
        activeUsers: activeCount || 0,
        totalImages: imageCount || 0,
        totalCost,
        totalUsageUnits,
        edgeRunCount: edgeRunData?.length || 0,
        averageDurationMs,
      });
    } catch (error) {
      console.error('Failed to fetch stats:', error);
      toast.error('統計情報の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchFeedbackItems = async () => {
    try {
      const { data, error } = await supabase
        .from('feedback_submissions')
        .select('*, user:users(email, name), brand:brands(name)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('Failed to fetch feedback:', error);
        setFeedbackItems([]);
        return;
      }

      setFeedbackItems((data || []) as unknown as FeedbackSubmission[]);
    } catch (error) {
      console.error('Failed to fetch feedback:', error);
      setFeedbackItems([]);
    }
  };

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('Failed to fetch users:', error);
        toast.error('ユーザー情報の取得に失敗しました');
        setUsers([]);
        return;
      }
      
      setUsers(data || []);
    } catch (error) {
      console.error('Failed to fetch users:', error);
      toast.error('ユーザー情報の取得に失敗しました');
      setUsers([]);
    }
  };

  const fetchRunwayApprovals = async () => {
    try {
      const { data, error } = await supabase
        .from('runway_mcp_connection_approvals')
        .select('id, brand_id, status, requested_at, approved_at, rejected_at, revoked_at, updated_at, brand:brands(id, name)')
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Failed to fetch Runway MCP approvals:', error);
        setRunwayApprovals([]);
        return;
      }

      const approvals = (data || []) as unknown as RunwayMcpApproval[];
      setRunwayApprovals(approvals);

      const brandIds = Array.from(new Set(approvals.map((approval) => approval.brand_id))).filter(Boolean);
      if (brandIds.length === 0) {
        setRunwaySubscriptionsByBrand({});
        return;
      }

      const subscriptionResult = await supabase
        .from('brand_subscriptions')
        .select('brand_id, status, current_period_start, current_period_end, plans(code, name, is_active, features)')
        .in('brand_id', brandIds);

      if (subscriptionResult.error) {
        console.error('Failed to fetch Runway MCP subscriptions:', subscriptionResult.error);
        setRunwaySubscriptionsByBrand({});
        return;
      }

      const subscriptionMap = Object.fromEntries(((subscriptionResult.data || []) as any[]).map((row) => {
        const plan = Array.isArray(row?.plans) ? row.plans[0] : row?.plans;
        const subscription: RunwayBrandSubscription = {
          brand_id: row.brand_id,
          status: row.status || null,
          current_period_start: row.current_period_start || null,
          current_period_end: row.current_period_end || null,
          plan: plan ? {
            code: plan.code || null,
            name: plan.name || null,
            is_active: plan.is_active ?? null,
            runway_mcp_generation: plan.features?.runway_mcp_generation === true,
          } : null,
        };
        return [row.brand_id, subscription];
      }));

      setRunwaySubscriptionsByBrand(subscriptionMap);
    } catch (error) {
      console.error('Failed to fetch Runway MCP approvals:', error);
      setRunwayApprovals([]);
      setRunwaySubscriptionsByBrand({});
    }
  };

  const handleRunwayApprovalUpdate = async (
    brandId: string,
    status: RunwayMcpConnectionStatus,
  ) => {
    if (updatingRunwayBrandId) return;

    try {
      setUpdatingRunwayBrandId(brandId);
      const { error } = await supabase.rpc('admin_update_runway_mcp_connection', {
        p_brand_id: brandId,
        p_status: status,
      });

      if (error) throw error;

      toast.success(`Runway MCP接続を${RUNWAY_STATUS_LABELS[status]}にしました`);
      await fetchRunwayApprovals();
    } catch (error: any) {
      toast.error(error.message || 'Runway MCP接続状態の更新に失敗しました');
    } finally {
      setUpdatingRunwayBrandId(null);
    }
  };

  const handlePublishAnnouncement = async () => {
    if (!announcementForm.title.trim() || !announcementForm.content.trim()) {
      toast.error('タイトルと内容を入力してください');
      return;
    }

    try {
      const { error } = await supabase.from('admin_announcements').insert({
        title: announcementForm.title,
        content: announcementForm.content,
        type: announcementForm.type,
      });

      if (error) throw error;

      toast.success('お知らせを公開しました');
      setShowAnnouncementModal(false);
      setAnnouncementForm({ title: '', content: '', type: 'info' });
    } catch {
      toast.error('公開に失敗しました');
    }
  };

  const openFeedbackDetail = async (item: FeedbackSubmission) => {
    setSelectedFeedback(item);
    setFeedbackNoteDraft(item.admin_note || '');
    setFeedbackScreenshotUrl(null);

    if (!item.screenshot_path) return;

    const { data, error } = await supabase.storage
      .from('feedback-screenshots')
      .createSignedUrl(item.screenshot_path, 60 * 10);

    if (error) {
      console.error('Failed to create feedback screenshot URL:', error);
      return;
    }

    setFeedbackScreenshotUrl(data.signedUrl);
  };

  const updateFeedback = async (
    item: FeedbackSubmission,
    updates: Partial<Pick<FeedbackSubmission, 'status' | 'admin_note'>>,
  ) => {
    try {
      setUpdatingFeedbackId(item.id);
      const nextStatus = updates.status || item.status;
      const { error } = await supabase
        .from('feedback_submissions')
        .update({
          ...updates,
          resolved_at: nextStatus === 'done' ? new Date().toISOString() : null,
        })
        .eq('id', item.id);

      if (error) throw error;

      toast.success('フィードバックを更新しました');
      await fetchFeedbackItems();
      setSelectedFeedback((current) => current?.id === item.id
        ? { ...current, ...updates, resolved_at: nextStatus === 'done' ? new Date().toISOString() : null }
        : current);
    } catch (error: any) {
      toast.error(error.message || 'フィードバック更新に失敗しました');
    } finally {
      setUpdatingFeedbackId(null);
    }
  };

  const filteredUsers = users.filter(user =>
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const runwayApprovedCount = runwayApprovals.filter((approval) => approval.status === 'approved').length;
  const runwayPendingCount = runwayApprovals.filter((approval) => approval.status === 'pending').length;
  const runwayReadyCount = runwayApprovals.filter((approval) => approval.status === 'approved').length;
  const runwayBlockedCount = runwayApprovals.filter((approval) => approval.status !== 'approved').length;
  const feedbackOpenCount = feedbackItems.filter((item) => item.status !== 'done').length;

  const StatCard = ({ icon: Icon, label, value, trend, color }: any) => (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-soft backdrop-blur-sm hover:shadow-elegant transition-all duration-300">
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
        {typeof value === 'number' && label.includes('コスト') 
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

  return (
    <div className="min-h-screen bg-[#050607] text-neutral-100">
      {/* Header */}
      <header className="glass-nav px-6 py-4 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">管理者ダッシュボード</h1>
            <p className="text-sm text-neutral-400">Lightchain システム管理</p>
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
        <div className="flex gap-1 p-1 rounded-xl mb-8 w-fit border border-white/10 bg-white/[0.04] shadow-none backdrop-blur-sm">
          {[
            { id: 'overview', label: '概要' },
            { id: 'users', label: 'ユーザー' },
            { id: 'runway', label: 'Runway MCP' },
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
                  ? 'bg-cyan-300 text-neutral-950 shadow-none'
                  : 'text-neutral-400 hover:text-white'
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
                trend={12}
                color="bg-blue-500"
              />
              <StatCard
                icon={Users}
                label="アクティブユーザー"
                value={stats.activeUsers}
                trend={8}
                color="bg-green-500"
              />
              <StatCard
                icon={Image}
                label="生成画像数"
                value={stats.totalImages}
                trend={24}
                color="bg-purple-500"
              />
              <StatCard
                icon={DollarSign}
                label="API総コスト"
                value={stats.totalCost}
                color="bg-orange-500"
              />
              <StatCard
                icon={Activity}
                label="利用ユニット"
                value={stats.totalUsageUnits}
                color="bg-cyan-500"
              />
              <StatCard
                icon={Clock}
                label="Edge実行数"
                value={stats.edgeRunCount}
                color="bg-rose-500"
              />
              <StatCard
                icon={MessageSquare}
                label="未完了フィードバック"
                value={feedbackOpenCount}
                color="bg-indigo-500"
              />
            </div>

            {/* Usage chart placeholder */}
            <div className="rounded-2xl border border-white/10 bg-neutral-950 p-8 shadow-soft">
              <h2 className="mb-4 text-lg font-semibold text-white">利用状況</h2>
              <div className="flex h-64 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                <p className="text-neutral-400">
                  平均 Edge 実行時間: {stats.averageDurationMs.toLocaleString()}ms
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
            className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 shadow-soft"
          >
            <div className="border-b border-white/10 p-6">
              <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                  <input
                    type="text"
                    placeholder="ユーザーを検索..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-10 pr-4 text-sm text-white transition-all focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
                  />
                </div>
                <Button variant="secondary" size="sm" leftIcon={<Filter className="w-4 h-4" />}>
                  フィルター
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-white/[0.04] text-left">
                  <tr>
                    <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-400">ユーザー</th>
                    <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-400">登録日</th>
                    <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-400">権限</th>
                    <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-400">アクション</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="transition-colors hover:bg-white/[0.04]">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-300/15 font-medium text-cyan-100">
                            {user.name?.charAt(0) || user.email?.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">{user.name || 'Unknown'}</p>
                            <p className="text-xs text-neutral-400">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-neutral-300">
                        {new Date(user.created_at).toLocaleDateString('ja-JP')}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`
                          inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium
                          ${user.is_admin
                            ? 'bg-cyan-300/10 text-cyan-100'
                            : 'bg-emerald-300/10 text-emerald-100'
                          }
                        `}>
                          <CheckCircle className="w-3.5 h-3.5" />
                          {user.is_admin ? '管理者' : '一般ユーザー'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button className="rounded-lg p-2 text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-white">
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

        {/* Runway MCP approvals */}
        {activeTab === 'runway' && (
          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid gap-4 md:grid-cols-4"
            >
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-soft backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">承認済み</p>
                <p className="mt-2 text-2xl font-semibold text-neutral-900 dark:text-white">{runwayApprovedCount}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-soft backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">承認待ち</p>
                <p className="mt-2 text-2xl font-semibold text-neutral-900 dark:text-white">{runwayPendingCount}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-soft backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">生成承認OK</p>
                <p className="mt-2 text-2xl font-semibold text-green-700 dark:text-green-300">{runwayReadyCount}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-soft backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">承認待ち/停止</p>
                <p className="mt-2 text-2xl font-semibold text-amber-700 dark:text-amber-300">{runwayBlockedCount}</p>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-amber-200 bg-amber-50/80 p-5 dark:border-amber-800 dark:bg-amber-950/20"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" />
                <div>
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                    本番生成 readiness
                  </p>
                  <p className="mt-1 text-sm leading-6 text-amber-800 dark:text-amber-200">
                    この画面では接続承認を確認します。Runway MCPブリッジ本体はSupabase secretsで管理し、値はUIに保存しません。
                    本番生成前は `npm run verify:runway-readiness` で `RUNWAY_MCP_BRIDGE_URL` / `RUNWAY_MCP_BRIDGE_TOKEN` とbridge疎通を確認してください。
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl overflow-hidden border border-white/10 bg-white/[0.04] shadow-soft backdrop-blur-sm"
            >
              <div className="p-6 border-b border-neutral-100 dark:border-neutral-700">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-neutral-800 dark:text-white">
                    <KeyRound className="w-5 h-5 inline-block mr-2" />
                    Runway MCP承認
                  </h2>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                    ここでは接続状態だけを管理します。MCPブリッジのURLやトークンは保存しません。
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={fetchRunwayApprovals}>
                  更新
                </Button>
              </div>
            </div>

            {runwayApprovals.length === 0 ? (
              <div className="p-12 text-center text-neutral-500 dark:text-neutral-400">
                Runway MCP接続申請はまだありません
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-neutral-50 dark:bg-neutral-800/50 text-left">
                    <tr>
                      <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">ブランド</th>
                      <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">状態</th>
                      <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">プラン</th>
                      <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">更新日</th>
                      <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">アクション</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
                    {runwayApprovals.map((approval) => {
                      const isUpdatingRunwayApproval = updatingRunwayBrandId === approval.brand_id;
                      const subscription = runwaySubscriptionsByBrand[approval.brand_id];
                      const generationApproved = approval.status === 'approved';

                      return (
                        <tr key={approval.id} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/50 transition-colors">
                        <td className="px-6 py-4">
                          <p className="text-sm font-medium text-neutral-800 dark:text-white">
                            {approval.brand?.name || approval.brand_id}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${RUNWAY_STATUS_STYLES[approval.status]}`}>
                            {RUNWAY_STATUS_LABELS[approval.status]}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ${
                              generationApproved
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                            }`}>
                              {generationApproved ? '生成承認済み' : '承認未完了'}
                            </span>
                            <span className="text-xs text-neutral-500 dark:text-neutral-400">
                              {getPlanLabel(subscription)}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-neutral-600 dark:text-neutral-300">
                          {new Date(approval.updated_at).toLocaleString('ja-JP')}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleRunwayApprovalUpdate(approval.brand_id, 'approved')}
                              isLoading={isUpdatingRunwayApproval}
                              disabled={approval.status === 'approved' || isUpdatingRunwayApproval}
                            >
                              承認
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleRunwayApprovalUpdate(approval.brand_id, 'rejected')}
                              disabled={approval.status === 'rejected' || isUpdatingRunwayApproval}
                            >
                              却下
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRunwayApprovalUpdate(approval.brand_id, 'revoked')}
                              disabled={approval.status === 'revoked' || isUpdatingRunwayApproval}
                            >
                              取消
                            </Button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            </motion.div>
          </div>
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
              className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 shadow-soft"
            >
              <div className="flex items-center justify-between gap-4 border-b border-white/10 p-6">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    <MessageSquare className="mr-2 inline-block h-5 w-5" />
                    社内betaフィードバック
                  </h2>
                  <p className="mt-1 text-sm text-neutral-400">
                    右下ボタンから送られたコメントと画面スクショを確認します。
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={fetchFeedbackItems}>
                  更新
                </Button>
              </div>

              {feedbackItems.length === 0 ? (
                <div className="p-12 text-center text-neutral-400">
                  フィードバックはまだありません
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-white/[0.04] text-left">
                      <tr>
                        <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-400">状態</th>
                        <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-400">内容</th>
                        <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-400">ページ</th>
                        <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-400">投稿者</th>
                        <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-400">日時</th>
                        <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-neutral-400">詳細</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {feedbackItems.map((item) => (
                        <tr key={item.id} className="transition-colors hover:bg-white/[0.04]">
                          <td className="px-6 py-4">
                            <select
                              value={item.status}
                              disabled={updatingFeedbackId === item.id}
                              onChange={(event) => updateFeedback(item, { status: event.target.value as FeedbackStatus })}
                              className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
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
                            <p className="mt-2 truncate text-sm text-neutral-200">
                              {item.message}
                            </p>
                          </td>
                          <td className="px-6 py-4 text-sm text-neutral-300">
                            {getSafeFeedbackUrl(item.page_url) ? (
                              <a
                                href={getSafeFeedbackUrl(item.page_url) || undefined}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex max-w-[220px] items-center gap-1 truncate text-cyan-300 hover:underline"
                              >
                                {item.pathname}
                                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                              </a>
                            ) : (
                              <span className="inline-flex max-w-[220px] truncate">{item.pathname || '不明なページ'}</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm text-neutral-300">
                            <p>{item.email || item.user?.email || '未入力'}</p>
                            {item.brand?.name && (
                              <p className="text-xs text-neutral-400">{item.brand.name}</p>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm text-neutral-300">
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
            className="rounded-2xl border border-white/10 bg-neutral-950 p-12 text-center shadow-soft"
          >
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white/[0.04]">
              <AlertTriangle className="w-10 h-10 text-neutral-400" />
            </div>
            <h3 className="mb-2 text-xl font-medium text-white">
              レビュー待ちのコンテンツはありません
            </h3>
            <p className="text-neutral-400">
              不適切なコンテンツが報告されると、ここに表示されます
            </p>
          </motion.div>
        )}

        {/* Announcements */}
        {activeTab === 'announcements' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl border border-white/10 bg-neutral-950 p-12 text-center shadow-soft"
          >
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-cyan-300/10">
              <Bell className="w-10 h-10 text-cyan-300" />
            </div>
            <h3 className="mb-2 text-xl font-medium text-white">
              お知らせ履歴
            </h3>
            <p className="mb-8 text-neutral-400">
              過去に配信したお知らせが表示されます
            </p>
            <Button onClick={() => setShowAnnouncementModal(true)} className="border-none bg-cyan-300 text-neutral-950">
              新規お知らせを作成
            </Button>
          </motion.div>
        )}
      </div>

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
              <span className="inline-flex rounded-full bg-white/[0.05] px-2.5 py-1 text-xs font-medium text-neutral-200">
                {FEEDBACK_TYPE_LABELS[selectedFeedback.type]}
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {new Date(selectedFeedback.created_at).toLocaleString('ja-JP')}
              </span>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">コメント</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-100">
                {selectedFeedback.message}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-white/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">ページ</p>
                {getSafeFeedbackUrl(selectedFeedback.page_url) ? (
                  <a
                    href={getSafeFeedbackUrl(selectedFeedback.page_url) || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 break-all text-sm text-cyan-300 hover:underline"
                  >
                    {selectedFeedback.page_url}
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                ) : (
                  <p className="mt-2 break-all text-sm text-neutral-300">
                    {selectedFeedback.page_url || '不明なページ'}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-white/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">投稿者 / 環境</p>
                <p className="mt-2 text-sm text-neutral-100">
                  {selectedFeedback.email || selectedFeedback.user?.email || '未入力'}
                </p>
                <p className="mt-1 text-xs text-neutral-400">
                  {selectedFeedback.viewport?.width || '?'} x {selectedFeedback.viewport?.height || '?'} / {selectedFeedback.screenshot_capture_status}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">スクショ</p>
              {feedbackScreenshotUrl ? (
                <img
                  src={feedbackScreenshotUrl}
                  alt="フィードバック画面スクショ"
                  className="max-h-[420px] w-full rounded-lg object-contain object-top"
                />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg bg-white/[0.04] text-sm text-neutral-400">
                  スクショはありません
                </div>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-neutral-300">
                管理メモ
              </label>
              <textarea
                value={feedbackNoteDraft}
                onChange={(event) => setFeedbackNoteDraft(event.target.value)}
                rows={4}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white transition-all focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
                placeholder="対応内容や次のアクションを記録"
              />
            </div>

            <div className="flex flex-wrap justify-between gap-3 border-t border-white/10 pt-4">
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
        onClose={() => setShowAnnouncementModal(false)}
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
            <label className="mb-1.5 block text-sm font-medium text-neutral-300">
              内容
            </label>
            <textarea
              value={announcementForm.content}
              onChange={(e) => setAnnouncementForm({ ...announcementForm, content: e.target.value })}
              className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white transition-all focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
              rows={4}
              placeholder="お知らせの内容を入力..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-300">
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
                      ? 'bg-cyan-300 text-neutral-950 shadow-md'
                      : 'bg-white/[0.04] text-neutral-400 hover:bg-white/[0.07]'
                    }
                  `}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
            <Button variant="ghost" onClick={() => setShowAnnouncementModal(false)}>
              キャンセル
            </Button>
            <Button onClick={handlePublishAnnouncement} className="border-none bg-cyan-300 text-neutral-950">
              配信
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
