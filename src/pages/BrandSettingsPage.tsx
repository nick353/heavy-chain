import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  AlertCircle,
  CheckCircle2,
  CreditCard,
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

interface BrandRunwaySubscription {
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

interface RunwayMcpOAuthConnection {
  connected: boolean;
  bridgeConfigured?: boolean;
  connection: {
    status: string;
    expires_at: string | null;
    last_verified_at: string | null;
    last_error: string | null;
    updated_at: string;
  } | null;
  verificationError?: string | null;
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

const getPlanLabel = (subscription: BrandRunwaySubscription | null) => {
  return subscription?.plan?.name || subscription?.plan?.code || 'Free';
};

function getRunwayReadinessIssues({
  approved,
  bridgeConfigured,
}: {
  approved: boolean;
  bridgeConfigured: boolean;
}) {
  const issues: string[] = [];
  if (!approved) issues.push('接続承認が必要です');
  if (!bridgeConfigured) issues.push('本番ブリッジが未設定です');
  return issues;
}

export function BrandSettingsPage() {
  const navigate = useNavigate();
  const { currentBrand, setCurrentBrand, user, profile } = useAuthStore();
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
  const [runwaySubscription, setRunwaySubscription] = useState<BrandRunwaySubscription | null>(null);
  const [runwayOAuthConnection, setRunwayOAuthConnection] = useState<RunwayMcpOAuthConnection | null>(null);
  const [isRequestingRunwayApproval, setIsRequestingRunwayApproval] = useState(false);
  const [isConnectingRunwayMcp, setIsConnectingRunwayMcp] = useState(false);
  
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

  const fetchRunwaySubscription = useCallback(async () => {
    if (!currentBrand) return;

    try {
      const { data, error } = await supabase
        .from('brand_subscriptions')
        .select('status, current_period_start, current_period_end, plans(code, name, is_active, features)')
        .eq('brand_id', currentBrand.id)
        .maybeSingle();

      if (error) {
        console.error('Failed to fetch Runway MCP subscription:', error);
        setRunwaySubscription(null);
        return;
      }

      const row = data as any;
      const plan = Array.isArray(row?.plans) ? row.plans[0] : row?.plans;
      setRunwaySubscription(row ? {
        status: row.status || null,
        current_period_start: row.current_period_start || null,
        current_period_end: row.current_period_end || null,
        plan: plan ? {
          code: plan.code || null,
          name: plan.name || null,
          is_active: plan.is_active ?? null,
          runway_mcp_generation: plan.features?.runway_mcp_generation === true,
        } : null,
      } : null);
    } catch (error) {
      console.error('Failed to fetch Runway MCP subscription:', error);
      setRunwaySubscription(null);
    }
  }, [currentBrand]);

  const fetchRunwayOAuthConnection = useCallback(async () => {
    if (!currentBrand) return;

    try {
      const { data, error } = await supabase.functions.invoke('runway-mcp-connection-status', {
        body: { brandId: currentBrand.id },
      });
      if (error) {
        setRunwayOAuthConnection(null);
        return;
      }
      setRunwayOAuthConnection((data || null) as RunwayMcpOAuthConnection | null);
    } catch {
      setRunwayOAuthConnection(null);
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
      fetchRunwaySubscription();
      fetchRunwayOAuthConnection();
    }
  }, [currentBrand, fetchMembers, fetchRunwayApproval, fetchRunwaySubscription, fetchRunwayOAuthConnection]);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('runway_mcp');
    if (result === 'connected') {
      toast.success('Runway MCPに接続しました');
      fetchRunwayApproval();
      fetchRunwayOAuthConnection();
      window.history.replaceState({}, '', window.location.pathname);
    } else if (result === 'failed') {
      toast.error('Runway MCP接続に失敗しました');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [fetchRunwayApproval, fetchRunwayOAuthConnection]);

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
      if (profile?.is_admin) {
        navigate('/admin?tab=runway');
      }
    } catch (error: any) {
      toast.error(error.message || 'Runway MCP接続の申請に失敗しました');
    } finally {
      setIsRequestingRunwayApproval(false);
    }
  };

  const handleConnectRunwayMcp = async () => {
    if (!currentBrand) return;

    setIsConnectingRunwayMcp(true);
    try {
      const { data, error } = await supabase.functions.invoke('runway-mcp-connect-start', {
        body: {
          brandId: currentBrand.id,
          returnTo: '/brand/settings',
        },
      });
      if (error) throw error;
      const authorizationUrl = (data as { authorizationUrl?: string } | null)?.authorizationUrl;
      if (!authorizationUrl) throw new Error('Runway認証URLを作成できませんでした');
      window.location.assign(authorizationUrl);
    } catch (error: any) {
      toast.error(error.message || 'Runway MCP接続を開始できませんでした');
      setIsConnectingRunwayMcp(false);
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

  const runwayStatus = runwayApproval?.status || 'not_requested';
  const runwayApproved = runwayStatus === 'approved';
  const runwayOAuthConnected = runwayOAuthConnection?.connected === true;
  const runwayBridgeConfigured = runwayOAuthConnection?.bridgeConfigured === true;
  const runwayReadyInApp = runwayApproved && runwayBridgeConfigured;
  const runwayReadinessIssues = getRunwayReadinessIssues({
    approved: runwayApproved,
    bridgeConfigured: runwayBridgeConfigured,
  });
  const runwayPlanLabel = getPlanLabel(runwaySubscription);
  const runwayPeriodEnd = runwaySubscription?.current_period_end
    ? new Date(runwaySubscription.current_period_end).toLocaleDateString('ja-JP')
    : null;
  const runwayReadinessLabel = runwayReadyInApp
    ? 'サイト側の条件は満たしています'
    : runwayReadinessIssues.join(' / ');
  const brandProfileComplete = Boolean(form.name.trim() && form.toneDescription.trim() && form.targetAudience.trim());
  const setupItems = [
    {
      label: 'ブランド情報',
      ready: brandProfileComplete,
      detail: brandProfileComplete ? '生成プロンプトへ反映できます' : '世界観とターゲット層を入力',
    },
    {
      label: 'Runway接続',
      ready: runwayReadyInApp,
      detail: runwayReadyInApp ? '生成条件は準備済み' : runwayReadinessLabel || '接続確認が必要',
    },
    {
      label: 'チーム',
      ready: members.length > 0,
      detail: members.length > 0 ? `${members.length}名が参加中` : '共同編集者を招待できます',
    },
    {
      label: '権利確認',
      ready: true,
      detail: '生成前に素材権利を確認します',
    },
  ];
  const readySetupCount = setupItems.filter((item) => item.ready).length;

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
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="glass-panel rounded-2xl p-5 sm:p-6"
          data-testid="brand-settings-readiness-panel"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-300">
                Workspace readiness
              </p>
              <h2 className="mt-1 text-lg font-semibold text-neutral-900 dark:text-white">
                生成前に整えること
              </h2>
              <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                ブランド情報、Runway接続、権利確認の状態を見て、すぐ制作へ戻れます。
              </p>
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-white/70 px-4 py-3 text-sm dark:border-neutral-800 dark:bg-white/[0.06]">
              <span className="font-semibold text-neutral-900 dark:text-white">{readySetupCount}</span>
              <span className="text-neutral-500 dark:text-neutral-400"> / {setupItems.length} ready</span>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {setupItems.map((item) => (
              <div
                key={item.label}
                className={`rounded-xl border p-3 ${
                  item.ready
                    ? 'border-green-200 bg-green-50/75 dark:border-green-900/60 dark:bg-green-950/20'
                    : 'border-amber-200 bg-amber-50/75 dark:border-amber-900/60 dark:bg-amber-950/20'
                }`}
                data-testid="brand-settings-readiness-item"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-white">
                  {item.ready ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-300" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
                  )}
                  {item.label}
                </div>
                <p className="mt-2 text-xs leading-5 text-neutral-600 dark:text-neutral-300">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
          <div
            className="mt-5 grid gap-2 sm:grid-cols-3"
            data-testid="brand-settings-next-actions"
          >
            <Link
              to="/generate?feature=campaign-image"
              className="flex min-h-11 items-center justify-center rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
            >
              生成へ進む
            </Link>
            <Link
              to="/gallery"
              className="flex min-h-11 items-center justify-center rounded-xl border border-neutral-200 bg-white/75 px-4 text-sm font-semibold text-neutral-700 transition hover:bg-white dark:border-neutral-800 dark:bg-white/[0.06] dark:text-neutral-200"
            >
              素材を見る
            </Link>
            <Link
              to="/credits"
              className="flex min-h-11 items-center justify-center rounded-xl border border-neutral-200 bg-white/75 px-4 text-sm font-semibold text-neutral-700 transition hover:bg-white dark:border-neutral-800 dark:bg-white/[0.06] dark:text-neutral-200"
            >
              利用状況
            </Link>
          </div>
        </motion.section>

        {/* Runway MCP Connection */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="glass-panel rounded-2xl p-8"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <h2 className="flex items-center gap-2 text-xl font-semibold text-neutral-800 dark:text-white">
                <KeyRound className="w-5 h-5" />
                Runway MCP接続
              </h2>
              <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                このブランドでRunway生成を使うため、管理者承認とHosted Runway MCPブリッジの状態を確認します。
              </p>
              <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">
                Hosted bridge とサイト承認が完了するまで、Runway MCPを使う画像生成は使用量予約前に停止します。
                Heavy Chain側の月間 quota は通常アカウントの生成条件に含まれ、Apple sandbox tester はテスト用 bypass の対象です。
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                <div className="rounded-xl border border-neutral-200 bg-white/55 p-3 dark:border-neutral-700 dark:bg-neutral-800/55">
                  <div className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-white">
                    {runwayApproved ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-500" />
                    )}
                    接続承認
                  </div>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {RUNWAY_APPROVAL_LABELS[runwayStatus]}
                  </p>
                </div>
                <div className="rounded-xl border border-neutral-200 bg-white/55 p-3 dark:border-neutral-700 dark:bg-neutral-800/55">
                  <div className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-white">
                    {runwayBridgeConfigured ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <KeyRound className="h-4 w-4 text-amber-500" />
                    )}
                    Hosted bridge
                  </div>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {runwayBridgeConfigured ? '設定済み' : '未設定'}
                  </p>
                </div>
                <div className="rounded-xl border border-neutral-200 bg-white/55 p-3 dark:border-neutral-700 dark:bg-neutral-800/55">
                  <div className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-white">
                    <CreditCard className="h-4 w-4 text-neutral-500" />
                    利用量管理
                  </div>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {runwayPlanLabel}{runwayPeriodEnd ? ` / ${runwayPeriodEnd}まで` : ''}
                  </p>
                </div>
                <div className={`rounded-xl border p-3 ${
                  runwayReadyInApp
                    ? 'border-green-200 bg-green-50/80 dark:border-green-800 dark:bg-green-900/20'
                    : 'border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-900/20'
                }`}>
                  <div className={`flex items-center gap-2 text-sm font-semibold ${
                    runwayReadyInApp ? 'text-green-800 dark:text-green-200' : 'text-amber-800 dark:text-amber-200'
                  }`}>
                    {runwayReadyInApp ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <AlertCircle className="h-4 w-4" />
                    )}
                    生成可否
                  </div>
                  <p className={`mt-1 text-xs ${
                    runwayReadyInApp ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'
                  }`}>
                    {runwayReadinessLabel}
                  </p>
                </div>
              </div>
              <p className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900/40 dark:text-neutral-200">
                Runway生成には、Runway MCP承認とHosted bridge接続が必要です。Heavy Chain側の利用量管理は表示のみで、現時点では生成可否を止めません。
              </p>
              {runwayReadinessIssues.length > 0 && (
                <ul className="mt-3 space-y-1 rounded-xl border border-amber-200 bg-white/70 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-neutral-950/50 dark:text-amber-200">
                  {runwayReadinessIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
              {runwayApproval?.updated_at && (
                <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
                  最終更新: {new Date(runwayApproval.updated_at).toLocaleString('ja-JP')}
                </p>
              )}
            </div>

            <div className="flex w-full flex-col gap-3 rounded-xl border border-neutral-200 bg-white/60 p-4 dark:border-neutral-700 dark:bg-neutral-800/60 lg:w-80">
              <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-medium ${RUNWAY_APPROVAL_STYLES[runwayApproval?.status || 'not_requested']}`}>
                {RUNWAY_APPROVAL_LABELS[runwayApproval?.status || 'not_requested']}
              </span>
              {runwayApproval?.status === 'pending' && (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  申請済みです。管理者の承認後に生成できます。
                </p>
              )}
              {runwayOAuthConnection?.verificationError && (
                <p className="text-sm text-red-700 dark:text-red-300">
                  Runway接続確認に失敗しました。
                </p>
              )}
              {runwayApproval?.status === 'approved' && (
                <p className={`text-sm ${runwayReadyInApp ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
                  {runwayReadyInApp
                    ? 'このブランドはRunway MCP生成のサイト条件を満たしています。'
                    : `接続は承認済みですが、${runwayReadinessIssues.join(' / ')} のためRunway生成は停止します。`}
                </p>
              )}
              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleConnectRunwayMcp}
                  isLoading={isConnectingRunwayMcp}
                  className="w-full shadow-sm"
                >
                  {runwayOAuthConnected ? 'Runwayを再接続' : 'Runwayに接続'}
                </Button>
                {!runwayApproved && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleRequestRunwayApproval}
                    isLoading={isRequestingRunwayApproval}
                    disabled={runwayApproval?.status === 'pending'}
                    className="w-full"
                  >
                    {runwayApproval?.status === 'pending' ? '承認申請済み' : '承認だけ申請'}
                  </Button>
                )}
                {profile?.is_admin && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => navigate('/admin?tab=runway')}
                    className="w-full"
                  >
                    管理者承認画面を開く
                  </Button>
                )}
              </div>
            </div>
          </div>
        </motion.div>

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
