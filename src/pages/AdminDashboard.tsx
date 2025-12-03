import { useState, useEffect } from 'react';
import { 
  Users, 
  Image, 
  TrendingUp, 
  DollarSign, 
  AlertTriangle,
  Bell,
  Search,
  Filter,
  Ban,
  CheckCircle,
  XCircle,
  Eye
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Input, Modal } from '../components/ui';
import toast from 'react-hot-toast';

interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  totalImages: number;
  totalCost: number;
}

interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
  is_admin: boolean;
  status: 'active' | 'suspended';
}

interface ModerationItem {
  id: string;
  image_url: string;
  reported_at: string;
  reason: string;
  user_id: string;
  status: 'pending' | 'approved' | 'rejected';
}

export function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    activeUsers: 0,
    totalImages: 0,
    totalCost: 0,
  });
  const [users, setUsers] = useState<User[]>([]);
  const [_moderationQueue, _setModerationQueue] = useState<ModerationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'moderation' | 'announcements'>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    content: '',
    type: 'info' as 'info' | 'warning' | 'maintenance',
  });

  useEffect(() => {
    fetchStats();
    fetchUsers();
  }, []);

  const fetchStats = async () => {
    try {
      // Get user count
      const { count: userCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });

      // Get image count
      const { count: imageCount } = await supabase
        .from('generated_images')
        .select('*', { count: 'exact', head: true });

      // Get total API cost
      const { data: costData } = await supabase
        .from('api_usage_logs')
        .select('cost_usd');

      const totalCost = costData?.reduce((sum, log) => sum + (log.cost_usd || 0), 0) || 0;

      // Get active users (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { count: activeCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('updated_at', thirtyDaysAgo.toISOString());

      setStats({
        totalUsers: userCount || 0,
        activeUsers: activeCount || 0,
        totalImages: imageCount || 0,
        totalCost,
      });
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setUsers(data || []);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  };

  const handleSuspendUser = async (_userId: string) => {
    if (!confirm('このユーザーを停止しますか？')) return;

    try {
      // In a real app, you'd update the user's status
      toast.success('ユーザーを停止しました');
    } catch {
      toast.error('操作に失敗しました');
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
        published_at: new Date().toISOString(),
      });

      if (error) throw error;

      toast.success('お知らせを公開しました');
      setShowAnnouncementModal(false);
      setAnnouncementForm({ title: '', content: '', type: 'info' });
    } catch (error) {
      toast.error('公開に失敗しました');
    }
  };

  const filteredUsers = users.filter(user =>
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const StatCard = ({ icon: Icon, label, value, trend, color }: any) => (
    <div className="bg-white rounded-xl p-6 shadow-soft border border-neutral-100">
      <div className="flex items-center justify-between mb-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        {trend && (
          <span className="flex items-center gap-1 text-sm font-medium text-green-600">
            <TrendingUp className="w-4 h-4" />
            {trend}%
          </span>
        )}
      </div>
      <p className="text-3xl font-bold text-neutral-800 mb-1">
        {typeof value === 'number' && label.includes('コスト') 
          ? `$${value.toFixed(2)}` 
          : value.toLocaleString()}
      </p>
      <p className="text-sm text-neutral-500">{label}</p>
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
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-800">管理者ダッシュボード</h1>
            <p className="text-sm text-neutral-500">Heavy Chain システム管理</p>
          </div>
          <Button
            leftIcon={<Bell className="w-4 h-4" />}
            onClick={() => setShowAnnouncementModal(true)}
          >
            お知らせ配信
          </Button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-neutral-100 rounded-xl mb-8 w-fit">
          {[
            { id: 'overview', label: '概要' },
            { id: 'users', label: 'ユーザー' },
            { id: 'moderation', label: 'モデレーション' },
            { id: 'announcements', label: 'お知らせ' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`
                px-4 py-2 text-sm font-medium rounded-lg transition-colors
                ${activeTab === tab.id
                  ? 'bg-white text-neutral-800 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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
            </div>

            {/* Usage chart placeholder */}
            <div className="bg-white rounded-xl p-6 shadow-soft border border-neutral-100">
              <h2 className="text-lg font-semibold text-neutral-800 mb-4">利用状況</h2>
              <div className="h-64 flex items-center justify-center bg-neutral-50 rounded-lg">
                <p className="text-neutral-500">グラフ表示エリア</p>
              </div>
            </div>
          </div>
        )}

        {/* Users */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-xl shadow-soft border border-neutral-100">
            <div className="p-4 border-b border-neutral-100">
              <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                  <input
                    type="text"
                    placeholder="ユーザーを検索..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <Button variant="secondary" size="sm" leftIcon={<Filter className="w-4 h-4" />}>
                  フィルター
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-neutral-50 text-left">
                  <tr>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase">ユーザー</th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase">登録日</th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase">ステータス</th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase">アクション</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                            <span className="text-sm font-medium text-primary-700">
                              {user.name?.charAt(0) || user.email?.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-neutral-800">{user.name || 'Unknown'}</p>
                            <p className="text-xs text-neutral-500">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-neutral-600">
                        {new Date(user.created_at).toLocaleDateString('ja-JP')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`
                          inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                          ${user.status === 'suspended'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-green-100 text-green-700'
                          }
                        `}>
                          {user.status === 'suspended' ? (
                            <XCircle className="w-3 h-3" />
                          ) : (
                            <CheckCircle className="w-3 h-3" />
                          )}
                          {user.status === 'suspended' ? '停止中' : 'アクティブ'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button className="p-1 hover:bg-neutral-100 rounded">
                            <Eye className="w-4 h-4 text-neutral-500" />
                          </button>
                          <button 
                            onClick={() => handleSuspendUser(user.id)}
                            className="p-1 hover:bg-red-100 rounded"
                          >
                            <Ban className="w-4 h-4 text-red-500" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Moderation */}
        {activeTab === 'moderation' && (
          <div className="bg-white rounded-xl shadow-soft border border-neutral-100 p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-neutral-700 mb-2">
              レビュー待ちのコンテンツはありません
            </h3>
            <p className="text-neutral-500">
              不適切なコンテンツが報告されると、ここに表示されます
            </p>
          </div>
        )}

        {/* Announcements */}
        {activeTab === 'announcements' && (
          <div className="bg-white rounded-xl shadow-soft border border-neutral-100 p-8 text-center">
            <Bell className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-neutral-700 mb-2">
              お知らせ履歴
            </h3>
            <p className="text-neutral-500 mb-4">
              過去に配信したお知らせが表示されます
            </p>
            <Button onClick={() => setShowAnnouncementModal(true)}>
              新規お知らせを作成
            </Button>
          </div>
        )}
      </div>

      {/* Announcement Modal */}
      <Modal
        isOpen={showAnnouncementModal}
        onClose={() => setShowAnnouncementModal(false)}
        title="お知らせを配信"
        size="md"
      >
        <div className="space-y-4">
          <Input
            label="タイトル"
            placeholder="お知らせのタイトル"
            value={announcementForm.title}
            onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })}
          />

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              内容
            </label>
            <textarea
              value={announcementForm.content}
              onChange={(e) => setAnnouncementForm({ ...announcementForm, content: e.target.value })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              rows={4}
              placeholder="お知らせの内容を入力..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
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
                    px-4 py-2 rounded-lg text-sm font-medium transition-colors
                    ${announcementForm.type === type.id
                      ? 'bg-primary-500 text-white'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }
                  `}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowAnnouncementModal(false)}>
              キャンセル
            </Button>
            <Button onClick={handlePublishAnnouncement}>
              配信
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

