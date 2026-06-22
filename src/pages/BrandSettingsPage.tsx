import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Upload, 
  Palette, 
  Users, 
  Save,
  Trash2,
  Plus,
  Copy,
  Check,
  KeyRound
} from 'lucide-react';
import { Button, Input, Textarea, Modal } from '../components/ui';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';

interface BrandMember {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  };
}

type RunwayMcpConnectionStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

interface RunwayMcpConnectionApproval {
  id: string;
  brand_id: string;
  status: RunwayMcpConnectionStatus;
  requested_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  revoked_at: string | null;
  updated_at: string;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'オーナー',
  admin: '管理者',
  editor: '編集者',
  viewer: '閲覧者',
};

const RUNWAY_APPROVAL_LABELS: Record<RunwayMcpConnectionStatus | 'not_requested', string> = {
  not_requested: '未申請',
  pending: '承認待ち',
  approved: '承認済み',
  rejected: '却下',
  revoked: '取消済み',
};

const RUNWAY_APPROVAL_STYLES: Record<RunwayMcpConnectionStatus | 'not_requested', string> = {
  not_requested: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  revoked: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

export function BrandSettingsPage() {
  const navigate = useNavigate();
  const { currentBrand, setCurrentBrand, user } = useAuthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [members, setMembers] = useState<BrandMember[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [inviteCode, setInviteCode] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [runwayApproval, setRunwayApproval] = useState<RunwayMcpConnectionApproval | null>(null);
  const [isRequestingRunwayApproval, setIsRequestingRunwayApproval] = useState(false);
  
  const [form, setForm] = useState({
    name: '',
    toneDescription: '',
    targetAudience: '',
    primaryColor: '#806a54',
    secondaryColor: '#c4a57c',
  });

  const fetchMembers = useCallback(async () => {
    if (!currentBrand) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('brand_members')
        .select(`
          id,
          user_id,
          role,
          joined_at,
          user:users(id, name, email, avatar_url)
        `)
        .eq('brand_id', currentBrand.id);

      if (error) {
        console.error('Failed to fetch members:', error);
        toast.error('メンバー情報の取得に失敗しました');
        setMembers([]);
        return;
      }
      
      setMembers((data || []) as unknown as BrandMember[]);
    } catch (error) {
      console.error('Failed to fetch members:', error);
      toast.error('メンバー情報の取得に失敗しました');
      setMembers([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentBrand]);

  const fetchRunwayApproval = useCallback(async () => {
    if (!currentBrand) return;

    try {
      const { data, error } = await supabase
        .from('runway_mcp_connection_approvals')
        .select('id, brand_id, status, requested_at, approved_at, rejected_at, revoked_at, updated_at')
        .eq('brand_id', currentBrand.id)
        .maybeSingle();

      if (error) {
        console.error('Failed to fetch Runway MCP approval:', error);
        setRunwayApproval(null);
        return;
      }

      setRunwayApproval((data || null) as RunwayMcpConnectionApproval | null);
    } catch (error) {
      console.error('Failed to fetch Runway MCP approval:', error);
      setRunwayApproval(null);
    }
  }, [currentBrand]);

  useEffect(() => {
    if (currentBrand) {
      setForm({
        name: currentBrand.name || '',
        toneDescription: currentBrand.tone_description || '',
        targetAudience: currentBrand.target_audience || '',
        primaryColor: (currentBrand.brand_colors as any)?.primary || '#806a54',
        secondaryColor: (currentBrand.brand_colors as any)?.secondary || '#c4a57c',
      });
      fetchMembers();
      fetchRunwayApproval();
    }
  }, [currentBrand, fetchMembers, fetchRunwayApproval]);

  const handleRequestRunwayApproval = async () => {
    if (!currentBrand) return;

    setIsRequestingRunwayApproval(true);
    try {
      const { data, error } = await supabase.rpc('request_runway_mcp_connection', {
        p_brand_id: currentBrand.id,
      });

      if (error) throw error;

      setRunwayApproval(data as RunwayMcpConnectionApproval);
      toast.success('Runway MCP接続を申請しました');
    } catch (error: any) {
      toast.error(error.message || 'Runway MCP接続の申請に失敗しました');
    } finally {
      setIsRequestingRunwayApproval(false);
    }
  };

  const handleSave = async () => {
    if (!currentBrand) return;
    
    setIsSaving(true);
    try {
      const { data, error } = await supabase
        .from('brands')
        .update({
          name: form.name,
          tone_description: form.toneDescription || null,
          target_audience: form.targetAudience || null,
          brand_colors: {
            primary: form.primaryColor,
            secondary: form.secondaryColor,
          },
        })
        .eq('id', currentBrand.id)
        .select()
        .single();

      if (error) throw error;
      
      setCurrentBrand(data);
      toast.success('ブランド情報を保存しました');
    } catch (error: any) {
      toast.error(error.message || '保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentBrand || !user) return;

    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/${currentBrand.id}/logo.${ext}`;
      
      const { error: uploadError } = await supabase.storage
        .from('brand-assets')
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData, error: signedUrlError } = await supabase.storage
        .from('brand-assets')
        .createSignedUrl(path, 60 * 60 * 24 * 7);

      if (signedUrlError || !urlData?.signedUrl) throw signedUrlError || new Error('Failed to create signed logo URL');

      const { error: updateError } = await supabase
        .from('brands')
        .update({ logo_url: urlData.signedUrl })
        .eq('id', currentBrand.id);

      if (updateError) throw updateError;

      setCurrentBrand({ ...currentBrand, logo_url: urlData.signedUrl });
      toast.success('ロゴをアップロードしました');
    } catch (error: any) {
      toast.error(error.message || 'アップロードに失敗しました');
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !currentBrand) return;

    setIsInviting(true);
    try {
      // Generate invite code
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

      const { error } = await supabase
        .from('invitations')
        .insert({
          brand_id: currentBrand.id,
          email: inviteEmail,
          code,
          role: inviteRole,
          expires_at: expiresAt.toISOString(),
        });

      if (error) throw error;

      setInviteCode(code);
      toast.success('招待を作成しました');
    } catch (error: any) {
      toast.error(error.message || '招待の作成に失敗しました');
    } finally {
      setIsInviting(false);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('コードをコピーしました');
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm('このメンバーを削除しますか？')) return;

    try {
      const { error } = await supabase
        .from('brand_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;

      setMembers(members.filter(m => m.id !== memberId));
      toast.success('メンバーを削除しました');
    } catch (error: any) {
      toast.error(error.message || 'メンバーの削除に失敗しました');
    }
  };

  const handleRoleChange = async (memberId: string, newRole: string) => {
    try {
      const { error } = await supabase
        .from('brand_members')
        .update({ role: newRole })
        .eq('id', memberId);

      if (error) throw error;

      setMembers(members.map(m => 
        m.id === memberId ? { ...m, role: newRole } : m
      ));
      toast.success('権限を変更しました');
    } catch (error: any) {
      toast.error(error.message || '権限の変更に失敗しました');
    }
  };

  if (!currentBrand) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-neutral-500">ブランドが選択されていません</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center gap-4 mb-8"
      >
        <button
          onClick={() => navigate('/dashboard')}
          className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors text-neutral-600 dark:text-neutral-400"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-display font-semibold text-neutral-900 dark:text-white">
            ブランド設定
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            ブランド情報とチームメンバーを管理
          </p>
        </div>
      </motion.div>

      <div className="space-y-8">
        {/* Brand Info */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="glass-panel rounded-2xl p-8"
        >
          <h2 className="text-lg font-semibold text-neutral-800 dark:text-white mb-6">
            ブランド情報
          </h2>

          {/* Logo */}
          <div className="flex items-center gap-6 mb-8">
            <div className="w-24 h-24 bg-neutral-100 dark:bg-neutral-800 rounded-2xl flex items-center justify-center overflow-hidden shadow-inner">
              {currentBrand.logo_url ? (
                <img 
                  src={currentBrand.logo_url} 
                  alt="Logo" 
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-3xl font-bold text-neutral-400 dark:text-neutral-600 font-display">
                  {form.name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="shadow-sm"
              >
                <Upload className="w-4 h-4 mr-2" />
                ロゴをアップロード
              </Button>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2">
                推奨: 512x512px, PNG/JPG
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <Input
              label="ブランド名"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />

            <Textarea
              label="世界観・トーン"
              placeholder="ブランドの世界観やトーンを説明してください"
              value={form.toneDescription}
              onChange={(e) => setForm({ ...form, toneDescription: e.target.value })}
              rows={3}
            />

            <Input
              label="ターゲット層"
              placeholder="例: 30代〜40代の働く女性"
              value={form.targetAudience}
              onChange={(e) => setForm({ ...form, targetAudience: e.target.value })}
            />

            {/* Brand Colors */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                <Palette className="w-4 h-4 inline-block mr-1.5" />
                ブランドカラー
              </label>
              <div className="flex gap-6">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <input
                      type="color"
                      value={form.primaryColor}
                      onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                      className="w-12 h-12 rounded-xl cursor-pointer border-0 p-0 opacity-0 absolute inset-0"
                    />
                    <div 
                      className="w-12 h-12 rounded-xl border-2 border-white dark:border-neutral-700 shadow-sm"
                      style={{ backgroundColor: form.primaryColor }}
                    />
                  </div>
                  <span className="text-sm text-neutral-600 dark:text-neutral-400">プライマリ</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <input
                      type="color"
                      value={form.secondaryColor}
                      onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })}
                      className="w-12 h-12 rounded-xl cursor-pointer border-0 p-0 opacity-0 absolute inset-0"
                    />
                    <div 
                      className="w-12 h-12 rounded-xl border-2 border-white dark:border-neutral-700 shadow-sm"
                      style={{ backgroundColor: form.secondaryColor }}
                    />
                  </div>
                  <span className="text-sm text-neutral-600 dark:text-neutral-400">セカンダリ</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end mt-8 pt-6 border-t border-neutral-100 dark:border-neutral-800">
            <Button onClick={handleSave} isLoading={isSaving} className="shadow-glow hover:shadow-glow-lg transition-all">
              <Save className="w-4 h-4 mr-2" />
              保存
            </Button>
          </div>
        </motion.div>

        {/* Runway MCP Connection */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="glass-panel rounded-2xl p-8"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-neutral-800 dark:text-white">
                <KeyRound className="w-5 h-5 inline-block mr-2" />
                Runway MCP接続
              </h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                生成に使うMCPブリッジの実値はサーバー側で管理され、ここには保存されません。
              </p>
            </div>
            <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-medium ${RUNWAY_APPROVAL_STYLES[runwayApproval?.status || 'not_requested']}`}>
              {RUNWAY_APPROVAL_LABELS[runwayApproval?.status || 'not_requested']}
            </span>
          </div>

          <div className="mt-6 rounded-xl border border-neutral-200 bg-white/50 p-4 dark:border-neutral-700 dark:bg-neutral-800/50">
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              承認済みになるまで、Runway MCPを使う画像生成は使用量予約前に停止します。
              サブスクが切れている場合も、承認状態に関係なく生成は停止します。
            </p>
            {runwayApproval?.updated_at && (
              <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
                最終更新: {new Date(runwayApproval.updated_at).toLocaleString('ja-JP')}
              </p>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <Button
              onClick={handleRequestRunwayApproval}
              isLoading={isRequestingRunwayApproval}
              disabled={runwayApproval?.status === 'approved'}
              className="shadow-sm"
            >
              {runwayApproval?.status === 'approved' ? '承認済み' : '接続を申請'}
            </Button>
          </div>
        </motion.div>

        {/* Team Members */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="glass-panel rounded-2xl p-8"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-neutral-800 dark:text-white">
              <Users className="w-5 h-5 inline-block mr-2" />
              チームメンバー
            </h2>
            <Button size="sm" onClick={() => setShowInviteModal(true)} className="shadow-sm">
              <Plus className="w-4 h-4 mr-1" />
              招待
            </Button>
          </div>

          {isLoading ? (
            <div className="py-12 text-center">
              <div className="spinner mx-auto" />
            </div>
          ) : members.length === 0 ? (
            <div className="py-12 text-center text-neutral-500 dark:text-neutral-400 border-2 border-dashed border-neutral-200 dark:border-neutral-800 rounded-xl">
              チームメンバーはまだいません
            </div>
          ) : (
            <div className="space-y-3">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-4 bg-white/50 dark:bg-neutral-800/50 rounded-xl border border-neutral-100 dark:border-neutral-700/50 transition-all hover:bg-white/80 dark:hover:bg-neutral-800"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center">
                      {member.user?.avatar_url ? (
                        <img 
                          src={member.user.avatar_url} 
                          alt="" 
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
                          {member.user?.name?.charAt(0) || '?'}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-neutral-800 dark:text-white">
                        {member.user?.name || 'Unknown'}
                        {member.user_id === user?.id && (
                          <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">(あなた)</span>
                        )}
                      </p>
                      <p className="text-sm text-neutral-500 dark:text-neutral-400">{member.user?.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {member.role === 'owner' ? (
                      <span className="px-3 py-1 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-sm font-medium rounded-full border border-primary-200 dark:border-primary-800">
                        {ROLE_LABELS[member.role]}
                      </span>
                    ) : member.user_id !== user?.id ? (
                      <>
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member.id, e.target.value)}
                          className="px-3 py-1.5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          <option value="admin">管理者</option>
                          <option value="editor">編集者</option>
                          <option value="viewer">閲覧者</option>
                        </select>
                        <button
                          onClick={() => handleRemoveMember(member.id)}
                          className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <span className="px-3 py-1 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 text-sm rounded-full border border-neutral-200 dark:border-neutral-700">
                        {ROLE_LABELS[member.role]}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* Invite Modal */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => {
          setShowInviteModal(false);
          setInviteEmail('');
          setInviteCode('');
        }}
        title="メンバーを招待"
      >
        <div className="space-y-6">
          {inviteCode ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-6 text-center border border-green-100 dark:border-green-800">
                <div className="w-12 h-12 bg-green-100 dark:bg-green-800/50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Check className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <p className="text-green-800 dark:text-green-200 font-medium mb-1">招待を作成しました</p>
                <p className="text-sm text-green-600 dark:text-green-300">
                  以下の招待コードを{inviteEmail}に共有してください
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1 px-4 py-3 bg-neutral-100 dark:bg-neutral-800 rounded-xl font-mono text-lg text-center tracking-wider border border-neutral-200 dark:border-neutral-700">
                  {inviteCode}
                </div>
                <Button onClick={handleCopyCode} variant="secondary" className="h-full aspect-square p-0 w-12 flex items-center justify-center">
                  {copied ? <Check className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5" />}
                </Button>
              </div>

              <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center">
                この招待コードは7日間有効です
              </p>

              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setInviteEmail('');
                  setInviteCode('');
                }}
              >
                別のメンバーを招待
              </Button>
            </motion.div>
          ) : (
            <div className="space-y-4">
              <Input
                label="メールアドレス"
                type="email"
                placeholder="member@example.com"
                autoComplete="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />

              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  権限
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-neutral-900 dark:text-white"
                >
                  <option value="admin">管理者 - 全機能利用可能</option>
                  <option value="editor">編集者 - 画像生成・編集可能</option>
                  <option value="viewer">閲覧者 - 閲覧・ダウンロードのみ</option>
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setShowInviteModal(false)}
                >
                  キャンセル
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleInvite}
                  isLoading={isInviting}
                  disabled={!inviteEmail.trim()}
                >
                  招待を作成
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
