import { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  Mail, 
  Crown, 
  Shield, 
  Edit3, 
  Eye,
  Trash2,
  Copy,
  Check,
  Link2
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { Button, Input, Modal } from './ui';
import toast from 'react-hot-toast';

interface BrandMember {
  user_id: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  joined_at: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  };
}

interface Invitation {
  id: string;
  email: string | null;
  code: string;
  role: string;
  expires_at: string;
  used_at: string | null;
}

const roleConfig = {
  owner: { icon: Crown, label: 'オーナー', color: 'text-yellow-600 bg-yellow-50' },
  admin: { icon: Shield, label: '管理者', color: 'text-blue-600 bg-blue-50' },
  editor: { icon: Edit3, label: '編集者', color: 'text-green-600 bg-green-50' },
  viewer: { icon: Eye, label: '閲覧者', color: 'text-neutral-600 bg-neutral-100' },
};

export function TeamManagement() {
  const { currentBrand, user } = useAuthStore();
  const [members, setMembers] = useState<BrandMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'viewer'>('editor');
  const [isInviting, setIsInviting] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const currentUserRole = members.find(m => m.user_id === user?.id)?.role;
  const canManageMembers = currentUserRole === 'owner' || currentUserRole === 'admin';

  useEffect(() => {
    if (currentBrand) {
      fetchMembers();
      fetchInvitations();
    }
  }, [currentBrand]);

  const fetchMembers = async () => {
    if (!currentBrand) return;

    try {
      const { data, error } = await supabase
        .from('brand_members')
        .select(`
          user_id,
          role,
          joined_at,
          user:users(id, name, email, avatar_url)
        `)
        .eq('brand_id', currentBrand.id);

      if (error) throw error;
      setMembers(data as any || []);
    } catch (error) {
      console.error('Failed to fetch members:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchInvitations = async () => {
    if (!currentBrand) return;

    try {
      const { data, error } = await supabase
        .from('invitations')
        .select('*')
        .eq('brand_id', currentBrand.id)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString());

      if (error) throw error;
      setInvitations(data || []);
    } catch (error) {
      console.error('Failed to fetch invitations:', error);
    }
  };

  const handleInvite = async () => {
    if (!currentBrand) return;

    setIsInviting(true);
    try {
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

      const { data, error } = await supabase
        .from('invitations')
        .insert({
          brand_id: currentBrand.id,
          email: inviteEmail || null,
          code,
          role: inviteRole,
          expires_at: expiresAt.toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      setInvitations([...invitations, data]);
      setShowInviteModal(false);
      setInviteEmail('');
      toast.success('招待を作成しました');

      // Copy invite link to clipboard
      const inviteLink = `${window.location.origin}/invite?code=${code}`;
      await navigator.clipboard.writeText(inviteLink);
      toast.success('招待リンクをコピーしました');
    } catch (error) {
      toast.error('招待の作成に失敗しました');
    } finally {
      setIsInviting(false);
    }
  };

  const handleCopyCode = async (code: string) => {
    const inviteLink = `${window.location.origin}/invite?code=${code}`;
    await navigator.clipboard.writeText(inviteLink);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
    toast.success('招待リンクをコピーしました');
  };

  const handleRevokeInvitation = async (id: string) => {
    try {
      const { error } = await supabase
        .from('invitations')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setInvitations(invitations.filter(i => i.id !== id));
      toast.success('招待を取り消しました');
    } catch (error) {
      toast.error('招待の取り消しに失敗しました');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm('このメンバーを削除しますか？')) return;

    try {
      const { error } = await supabase
        .from('brand_members')
        .delete()
        .eq('brand_id', currentBrand!.id)
        .eq('user_id', userId);

      if (error) throw error;

      setMembers(members.filter(m => m.user_id !== userId));
      toast.success('メンバーを削除しました');
    } catch (error) {
      toast.error('メンバーの削除に失敗しました');
    }
  };

  const handleChangeRole = async (userId: string, newRole: string) => {
    try {
      const { error } = await supabase
        .from('brand_members')
        .update({ role: newRole })
        .eq('brand_id', currentBrand!.id)
        .eq('user_id', userId);

      if (error) throw error;

      setMembers(members.map(m => 
        m.user_id === userId ? { ...m, role: newRole as any } : m
      ));
      toast.success('権限を変更しました');
    } catch (error) {
      toast.error('権限の変更に失敗しました');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-neutral-500" />
          <h2 className="text-lg font-semibold text-neutral-800">チームメンバー</h2>
          <span className="px-2 py-0.5 bg-neutral-100 rounded-full text-sm text-neutral-600">
            {members.length}人
          </span>
        </div>
        {canManageMembers && (
          <Button
            size="sm"
            leftIcon={<UserPlus className="w-4 h-4" />}
            onClick={() => setShowInviteModal(true)}
          >
            招待
          </Button>
        )}
      </div>

      {/* Members list */}
      <div className="bg-white rounded-xl border border-neutral-200 divide-y divide-neutral-100">
        {members.map((member) => {
          const roleInfo = roleConfig[member.role];
          const RoleIcon = roleInfo.icon;
          const isCurrentUser = member.user_id === user?.id;
          const canModify = canManageMembers && !isCurrentUser && member.role !== 'owner';

          return (
            <div key={member.user_id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                  {member.user.avatar_url ? (
                    <img 
                      src={member.user.avatar_url} 
                      alt="" 
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    <span className="text-sm font-medium text-primary-700">
                      {member.user.name?.charAt(0) || member.user.email.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <div>
                  <p className="font-medium text-neutral-800">
                    {member.user.name || 'Unknown'}
                    {isCurrentUser && (
                      <span className="ml-2 text-xs text-neutral-400">(あなた)</span>
                    )}
                  </p>
                  <p className="text-sm text-neutral-500">{member.user.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {canModify ? (
                  <select
                    value={member.role}
                    onChange={(e) => handleChangeRole(member.user_id, e.target.value)}
                    className="text-sm border border-neutral-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="admin">管理者</option>
                    <option value="editor">編集者</option>
                    <option value="viewer">閲覧者</option>
                  </select>
                ) : (
                  <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${roleInfo.color}`}>
                    <RoleIcon className="w-3 h-3" />
                    {roleInfo.label}
                  </span>
                )}

                {canModify && (
                  <button
                    onClick={() => handleRemoveMember(member.user_id)}
                    className="p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pending invitations */}
      {invitations.length > 0 && canManageMembers && (
        <div>
          <h3 className="text-sm font-medium text-neutral-600 mb-3">保留中の招待</h3>
          <div className="space-y-2">
            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex items-center justify-between p-3 bg-neutral-50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-neutral-400" />
                  <div>
                    <p className="text-sm text-neutral-700">
                      {invitation.email || '招待コード: ' + invitation.code}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {roleConfig[invitation.role as keyof typeof roleConfig]?.label} ・
                      有効期限: {new Date(invitation.expires_at).toLocaleDateString('ja-JP')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopyCode(invitation.code)}
                    className="p-1.5 text-neutral-400 hover:text-primary-500 hover:bg-primary-50 rounded-lg transition-colors"
                    title="招待リンクをコピー"
                  >
                    {copiedCode === invitation.code ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => handleRevokeInvitation(invitation.id)}
                    className="p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="招待を取り消し"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite Modal */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title="チームメンバーを招待"
      >
        <div className="space-y-4">
          <Input
            label="メールアドレス（任意）"
            type="email"
            placeholder="example@company.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            helperText="空欄の場合、招待コードで招待できます"
          />

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              権限
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['admin', 'editor', 'viewer'] as const).map((role) => {
                const info = roleConfig[role];
                const Icon = info.icon;
                return (
                  <button
                    key={role}
                    onClick={() => setInviteRole(role)}
                    className={`
                      flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all
                      ${inviteRole === role
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-neutral-200 hover:border-neutral-300'
                      }
                    `}
                  >
                    <Icon className={`w-5 h-5 ${inviteRole === role ? 'text-primary-600' : 'text-neutral-400'}`} />
                    <span className="text-sm font-medium">{info.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowInviteModal(false)}>
              キャンセル
            </Button>
            <Button
              onClick={handleInvite}
              isLoading={isInviting}
              leftIcon={<Link2 className="w-4 h-4" />}
            >
              招待リンクを作成
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

