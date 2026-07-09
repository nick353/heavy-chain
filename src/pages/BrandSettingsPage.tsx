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
  Check
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

const ROLE_LABELS: Record<string, string> = {
  owner: 'オーナー',
  admin: '管理者',
  editor: '編集者',
  viewer: '閲覧者',
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
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  
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

  useEffect(() => {
    if (currentBrand) {
      setForm({
        name: currentBrand.name || '',
        toneDescription: currentBrand.tone_description || '',
        targetAudience: currentBrand.target_audience || '',
        primaryColor: (currentBrand.brand_colors as any)?.primary || '#806a54',
        secondaryColor: (currentBrand.brand_colors as any)?.secondary || '#c4a57c',
      });
      setLogoLoadFailed(false);
      fetchMembers();
    }
  }, [currentBrand, fetchMembers]);

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
    <div className="mx-auto max-w-6xl px-4 py-8 text-white sm:px-6 lg:px-8">
      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="mb-8 flex items-center gap-4"
      >
        <button
          onClick={() => navigate('/dashboard')}
          className="rounded-full border border-white/10 bg-white/[0.06] p-3 text-neutral-300 transition-colors hover:bg-cyan-300/10 hover:text-white"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-3xl font-semibold text-white">
            ブランド設定
          </h1>
          <p className="mt-1 text-neutral-400">
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
          className="rounded-[28px] border border-white/10 bg-neutral-950 p-8 shadow-soft"
        >
          <h2 className="mb-6 text-lg font-semibold text-white">
            ブランド情報
          </h2>
          <p className="mb-6 text-sm text-neutral-400">
            Lightchain側の月間 quota は通常アカウントの生成条件に含まれ、Apple sandbox tester は実請求なしの検証アカウントとして扱われます。
          </p>

          {/* Logo */}
          <div className="flex items-center gap-6 mb-8">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl bg-white/[0.04] shadow-inner">
              {currentBrand.logo_url && !logoLoadFailed ? (
                <img 
                  src={currentBrand.logo_url} 
                  alt="Logo" 
                  className="w-full h-full object-cover"
                  onError={() => setLogoLoadFailed(true)}
                />
              ) : (
                <span
                  data-testid="brand-logo-fallback"
                  className="font-display text-3xl font-bold text-neutral-400"
                >
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
                className="border border-white/10 bg-white/[0.05] text-neutral-200 shadow-sm hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-white"
              >
                <Upload className="w-4 h-4 mr-2" />
                ロゴをアップロード
              </Button>
              <p className="mt-2 text-xs text-neutral-400">
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
              <label className="mb-2 block text-sm font-medium text-neutral-300">
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
                      className="h-12 w-12 rounded-xl border-2 border-white/10 shadow-sm"
                      style={{ backgroundColor: form.primaryColor }}
                    />
                  </div>
                  <span className="text-sm text-neutral-400">プライマリ</span>
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
                      className="h-12 w-12 rounded-xl border-2 border-white/10 shadow-sm"
                      style={{ backgroundColor: form.secondaryColor }}
                    />
                  </div>
                  <span className="text-sm text-neutral-400">セカンダリ</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 flex justify-end border-t border-white/10 pt-6">
            <Button onClick={handleSave} isLoading={isSaving} className="border-none bg-cyan-300 text-neutral-950 shadow-[0_14px_40px_rgba(34,211,238,0.18)] transition-all hover:bg-cyan-200 hover:shadow-glow-lg">
              <Save className="w-4 h-4 mr-2" />
              保存
            </Button>
          </div>
        </motion.div>

        {/* Team Members */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="rounded-[28px] border border-white/10 bg-neutral-950 p-8 shadow-soft"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-white">
              <Users className="w-5 h-5 inline-block mr-2" />
              チームメンバー
            </h2>
            <Button size="sm" onClick={() => setShowInviteModal(true)} className="border-none bg-cyan-300 text-neutral-950 shadow-[0_14px_40px_rgba(34,211,238,0.18)]">
              <Plus className="w-4 h-4 mr-1" />
              招待
            </Button>
          </div>

          {isLoading ? (
            <div className="py-12 text-center">
              <div className="spinner mx-auto" />
            </div>
          ) : members.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-white/10 py-12 text-center text-neutral-400">
              チームメンバーはまだいません
            </div>
          ) : (
            <div className="space-y-3">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] p-4 transition-all hover:bg-white/[0.07]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-300/15">
                      {member.user?.avatar_url ? (
                        <img 
                          src={member.user.avatar_url} 
                          alt="" 
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        <span className="text-sm font-medium text-cyan-200">
                          {member.user?.name?.charAt(0) || '?'}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-white">
                        {member.user?.name || 'Unknown'}
                        {member.user_id === user?.id && (
                          <span className="ml-2 text-xs text-neutral-400">(あなた)</span>
                        )}
                      </p>
                      <p className="text-sm text-neutral-400">{member.user?.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {member.role === 'owner' ? (
                      <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-sm font-medium text-cyan-100">
                        {ROLE_LABELS[member.role]}
                      </span>
                    ) : member.user_id !== user?.id ? (
                      <>
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member.id, e.target.value)}
                          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
                        >
                          <option value="admin">管理者</option>
                          <option value="editor">編集者</option>
                          <option value="viewer">閲覧者</option>
                        </select>
                        <button
                          onClick={() => handleRemoveMember(member.id)}
                          className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-300/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-neutral-400">
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
              <div className="rounded-xl border border-green-300/20 bg-green-300/[0.08] p-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-300/15">
                  <Check className="w-6 h-6 text-green-300" />
                </div>
                <p className="mb-1 font-medium text-green-100">招待を作成しました</p>
                <p className="text-sm text-green-200">
                  以下の招待コードを{inviteEmail}に共有してください
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 font-mono text-center text-lg tracking-wider text-white">
                  {inviteCode}
                </div>
                <Button onClick={handleCopyCode} variant="secondary" className="h-full aspect-square p-0 w-12 flex items-center justify-center">
                  {copied ? <Check className="w-5 h-5 text-green-300" /> : <Copy className="w-5 h-5" />}
                </Button>
              </div>

              <p className="text-center text-xs text-neutral-400">
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
                <label className="mb-2 block text-sm font-medium text-neutral-300">
                  権限
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
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
