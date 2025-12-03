import { useState, useEffect, useRef } from 'react';
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
  
  const [form, setForm] = useState({
    name: '',
    toneDescription: '',
    targetAudience: '',
    primaryColor: '#806a54',
    secondaryColor: '#c4a57c',
  });

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
    }
  }, [currentBrand]);

  const fetchMembers = async () => {
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

      if (error) throw error;
      setMembers((data || []) as unknown as BrandMember[]);
    } catch (error) {
      console.error('Failed to fetch members:', error);
    } finally {
      setIsLoading(false);
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
    if (!file || !currentBrand) return;

    try {
      const ext = file.name.split('.').pop();
      const path = `${currentBrand.id}/logo.${ext}`;
      
      const { error: uploadError } = await supabase.storage
        .from('brand-assets')
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('brand-assets')
        .getPublicUrl(path);

      const { error: updateError } = await supabase
        .from('brands')
        .update({ logo_url: urlData.publicUrl })
        .eq('id', currentBrand.id);

      if (updateError) throw updateError;

      setCurrentBrand({ ...currentBrand, logo_url: urlData.publicUrl });
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
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => navigate('/dashboard')}
          className="p-2 hover:bg-neutral-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-neutral-600" />
        </button>
        <div>
          <h1 className="text-2xl font-display font-semibold text-neutral-900">
            ブランド設定
          </h1>
          <p className="text-neutral-500">
            ブランド情報とチームメンバーを管理
          </p>
        </div>
      </div>

      <div className="space-y-8">
        {/* Brand Info */}
        <div className="bg-white rounded-2xl shadow-soft p-6">
          <h2 className="text-lg font-semibold text-neutral-800 mb-6">
            ブランド情報
          </h2>

          {/* Logo */}
          <div className="flex items-center gap-6 mb-6">
            <div className="w-24 h-24 bg-neutral-100 rounded-xl flex items-center justify-center overflow-hidden">
              {currentBrand.logo_url ? (
                <img 
                  src={currentBrand.logo_url} 
                  alt="Logo" 
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-3xl font-bold text-neutral-400">
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
              >
                <Upload className="w-4 h-4 mr-2" />
                ロゴをアップロード
              </Button>
              <p className="text-xs text-neutral-500 mt-2">
                推奨: 512x512px, PNG/JPG
              </p>
            </div>
          </div>

          <div className="space-y-4">
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
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                <Palette className="w-4 h-4 inline-block mr-1" />
                ブランドカラー
              </label>
              <div className="flex gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.primaryColor}
                    onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                    className="w-10 h-10 rounded-lg cursor-pointer border border-neutral-200"
                  />
                  <span className="text-sm text-neutral-600">プライマリ</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.secondaryColor}
                    onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })}
                    className="w-10 h-10 rounded-lg cursor-pointer border border-neutral-200"
                  />
                  <span className="text-sm text-neutral-600">セカンダリ</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end mt-6 pt-6 border-t border-neutral-100">
            <Button onClick={handleSave} isLoading={isSaving}>
              <Save className="w-4 h-4 mr-2" />
              保存
            </Button>
          </div>
        </div>

        {/* Team Members */}
        <div className="bg-white rounded-2xl shadow-soft p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-neutral-800">
              <Users className="w-5 h-5 inline-block mr-2" />
              チームメンバー
            </h2>
            <Button size="sm" onClick={() => setShowInviteModal(true)}>
              <Plus className="w-4 h-4 mr-1" />
              招待
            </Button>
          </div>

          {isLoading ? (
            <div className="py-8 text-center">
              <div className="spinner mx-auto" />
            </div>
          ) : members.length === 0 ? (
            <div className="py-8 text-center text-neutral-500">
              チームメンバーはまだいません
            </div>
          ) : (
            <div className="space-y-3">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-4 bg-neutral-50 rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                      {member.user?.avatar_url ? (
                        <img 
                          src={member.user.avatar_url} 
                          alt="" 
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        <span className="text-sm font-medium text-primary-700">
                          {member.user?.name?.charAt(0) || '?'}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-neutral-800">
                        {member.user?.name || 'Unknown'}
                        {member.user_id === user?.id && (
                          <span className="ml-2 text-xs text-neutral-500">(あなた)</span>
                        )}
                      </p>
                      <p className="text-sm text-neutral-500">{member.user?.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {member.role === 'owner' ? (
                      <span className="px-3 py-1 bg-primary-100 text-primary-700 text-sm font-medium rounded-full">
                        {ROLE_LABELS[member.role]}
                      </span>
                    ) : member.user_id !== user?.id ? (
                      <>
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member.id, e.target.value)}
                          className="px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-sm"
                        >
                          <option value="admin">管理者</option>
                          <option value="editor">編集者</option>
                          <option value="viewer">閲覧者</option>
                        </select>
                        <button
                          onClick={() => handleRemoveMember(member.id)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <span className="px-3 py-1 bg-neutral-100 text-neutral-600 text-sm rounded-full">
                        {ROLE_LABELS[member.role]}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
        <div className="space-y-4">
          {inviteCode ? (
            <>
              <div className="bg-green-50 rounded-xl p-4 text-center">
                <Check className="w-8 h-8 text-green-600 mx-auto mb-2" />
                <p className="text-green-800 font-medium mb-1">招待を作成しました</p>
                <p className="text-sm text-green-600">
                  以下の招待コードを{inviteEmail}に共有してください
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1 px-4 py-3 bg-neutral-100 rounded-lg font-mono text-lg text-center">
                  {inviteCode}
                </div>
                <Button onClick={handleCopyCode}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>

              <p className="text-xs text-neutral-500 text-center">
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
            </>
          ) : (
            <>
              <Input
                label="メールアドレス"
                type="email"
                placeholder="member@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  権限
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full px-4 py-2.5 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="admin">管理者 - 全機能利用可能</option>
                  <option value="editor">編集者 - 画像生成・編集可能</option>
                  <option value="viewer">閲覧者 - 閲覧・ダウンロードのみ</option>
                </select>
              </div>

              <div className="flex gap-2 pt-4">
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
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}



