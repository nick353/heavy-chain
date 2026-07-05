import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MoreVertical, Trash2, Edit3, Search, X } from 'lucide-react';
import { fetchAccessibleBrandsForCurrentUser, useAuthStore } from '../stores/authStore';
import {
  IconSparkles,
  IconArrowRight,
  IconClock,
  IconLayout,
  IconHelp,
  IconPlus,
  IconPalette,
  IconFolder
} from '../components/icons';
import { useCanvasStore, type CanvasProject } from '../stores/canvasStore';
import { supabase } from '../lib/supabase';
import { withSignedImageUrls } from '../lib/storage';
import { Button, Modal, Input, Textarea } from '../components/ui';
import { Onboarding, useOnboarding } from '../components/Onboarding';
import { UsageStats } from '../components/UsageStats';
import type { Brand, GeneratedImage } from '../types/database';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchWorkspaceActivity, emptyWorkspaceActivity, type WorkspaceActivity } from '../lib/workspaceActivity';
import { CreditSummaryPanel, FailureRetryCard, JobQueuePanel, WorkspaceGuidePanel } from '../components/workspace';
import { LightchainParityHub } from '../components/LightchainParityHub';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number]
    }
  }
};

const logDashboardFetchError = (message: string, error: unknown) => {
  if (import.meta.env.DEV) {
    console.error(message, error);
  }
};

const canvasObjectTypeLabels: Record<CanvasProject['objects'][number]['type'], string> = {
  image: '画像 image',
  text: 'テキスト text',
  shape: '図形 shape',
  frame: 'フレーム frame',
};

export function DashboardPage() {
  const navigate = useNavigate();
  const { user, currentBrand, setCurrentBrand } = useAuthStore();
  const { createProject, deleteProject, loadProject, clearCanvas, getRecentProjects, projects } = useCanvasStore();
  const { showOnboarding, completeOnboarding, resetOnboarding } = useOnboarding(user?.id);
  const [recentImages, setRecentImages] = useState<GeneratedImage[]>([]);
  const [failedRecentImageIds, setFailedRecentImageIds] = useState<Set<string>>(new Set());
  const [workspaceActivity, setWorkspaceActivity] = useState<WorkspaceActivity>(emptyWorkspaceActivity);
  const [isActivityLoading, setIsActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [, setIsLoading] = useState(true);
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [projectMenuOpen, setProjectMenuOpen] = useState<string | null>(null);
  const [brandForm, setBrandForm] = useState({
    name: '',
    toneDescription: '',
    targetAudience: ''
  });
  const [isCreatingBrand, setIsCreatingBrand] = useState(false);

  const checkBrands = useCallback(async (): Promise<Brand | null> => {
    if (!user) {
      setIsLoading(false);
      return null;
    }

    try {
      setIsLoading(true);
      const userId = user.id;
      const brands = await fetchAccessibleBrandsForCurrentUser(userId);
      if (useAuthStore.getState().user?.id !== userId) return null;

      if (!brands || brands.length === 0) {
        setCurrentBrand(null);
        setShowBrandModal(true);
        setIsLoading(false);
        return null;
      } else {
        const latestCurrentBrand = useAuthStore.getState().currentBrand;
        const currentBrandIsAccessible = latestCurrentBrand && brands.some((brand) => brand.id === latestCurrentBrand.id);
        const nextBrand = currentBrandIsAccessible ? latestCurrentBrand : brands[0];
        if (nextBrand.id !== latestCurrentBrand?.id) {
          setCurrentBrand(nextBrand);
        }
        setShowBrandModal(false);
        setIsLoading(false);
        // ブランド設定後にuseEffectが再実行されて画像を取得する
        return nextBrand;
      }
    } catch (error) {
      logDashboardFetchError('Failed to check brands:', error);
      toast.error('ブランド情報の取得に失敗しました');
      setIsLoading(false);
      return null;
    }
  }, [setCurrentBrand, user]);

  const fetchRecentImages = useCallback(async (brandOverride?: Brand | null) => {
    const targetBrand = brandOverride ?? currentBrand;
    if (!targetBrand) {
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('generated_images')
        .select('*')
        .eq('brand_id', targetBrand.id)
        .order('created_at', { ascending: false })
        .limit(6);

      if (error) {
        logDashboardFetchError('Failed to fetch images:', error);
        toast.error('画像の取得に失敗しました');
        if (useAuthStore.getState().currentBrand?.id !== targetBrand.id) return;
        setRecentImages([]);
        setFailedRecentImageIds(new Set());
      } else {
        const signedImages = await withSignedImageUrls(data || []);
        if (useAuthStore.getState().currentBrand?.id !== targetBrand.id) return;
        setRecentImages(signedImages);
        setFailedRecentImageIds(new Set());
      }
    } catch (error) {
      logDashboardFetchError('Failed to fetch images:', error);
      toast.error('画像の取得に失敗しました');
      if (useAuthStore.getState().currentBrand?.id !== targetBrand.id) return;
      setRecentImages([]);
      setFailedRecentImageIds(new Set());
    } finally {
      if (useAuthStore.getState().currentBrand?.id === targetBrand.id) {
        setIsLoading(false);
      }
    }
  }, [currentBrand]);

  const fetchActivity = useCallback(async (brandOverride?: Brand | null) => {
    const targetBrand = brandOverride ?? currentBrand;
    if (!targetBrand) {
      setWorkspaceActivity(emptyWorkspaceActivity);
      setActivityError(null);
      setIsActivityLoading(false);
      return;
    }

    setIsActivityLoading(true);
    setActivityError(null);
    try {
      const nextActivity = await fetchWorkspaceActivity(targetBrand.id);
      if (useAuthStore.getState().currentBrand?.id !== targetBrand.id) return;
      setWorkspaceActivity(nextActivity);
    } catch (error) {
      if (useAuthStore.getState().currentBrand?.id !== targetBrand.id) return;
      logDashboardFetchError('Failed to load workspace activity:', error);
      setActivityError('workspace activity');
    } finally {
      if (useAuthStore.getState().currentBrand?.id === targetBrand.id) {
        setIsActivityLoading(false);
      }
    }
  }, [currentBrand]);

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      if (!user) {
        // ユーザーがいない場合はローディングを解除
        if (mounted) setIsLoading(false);
        return;
      }

      const resolvedBrand = await checkBrands();
      if (resolvedBrand) await Promise.all([fetchRecentImages(resolvedBrand), fetchActivity(resolvedBrand)]);
    };

    loadData();

    return () => {
      mounted = false;
    };
  }, [currentBrand, user, checkBrands, fetchRecentImages, fetchActivity]);

  const handleCreateBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!brandForm.name.trim()) {
      toast.error('ブランド名を入力してください');
      return;
    }

    setIsCreatingBrand(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        toast.error('ログインが必要です');
        return;
      }

      const { data, error } = await supabase
        .rpc('create_brand', {
          p_name: brandForm.name,
          p_tone_description: brandForm.toneDescription || null,
          p_target_audience: brandForm.targetAudience || null
        });

      if (error) throw error;

      setCurrentBrand(data as Brand);
      setShowBrandModal(false);
      toast.success('ブランドを作成しました');
    } catch (error: any) {
      toast.error(error.message || 'ブランドの作成に失敗しました');
    } finally {
      setIsCreatingBrand(false);
    }
  };

  const handleCreateNewProject = () => {
    if (!newProjectName.trim()) {
      toast.error('プロジェクト名を入力してください');
      return;
    }
    
    const projectId = createProject(newProjectName, currentBrand?.id);
    setShowNewProjectModal(false);
    setNewProjectName('');
    toast.success('新規プロジェクトを作成しました');
    navigate(`/canvas/${projectId}`);
  };

  const handleOpenProject = (project: CanvasProject) => {
    loadProject(project.id);
    navigate(`/canvas/${project.id}`);
  };

  const handleDeleteProject = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteProject(projectId);
    setProjectMenuOpen(null);
    toast.success('プロジェクトを削除しました');
  };

  const handleNewCanvas = () => {
    clearCanvas();
    navigate('/canvas/new');
  };

  const getImageUrl = (image: GeneratedImage) => {
    // まずimage_urlを確認（直接URL）
    if (image.image_url) {
      return image.image_url;
    }
    
    // storage_pathを使用
    const path = image.storage_path;
    if (!path) {
      logDashboardFetchError('Image path is empty for image:', image.id);
      return '';
    }
    try {
      // storage_pathがすでに完全なURLの場合はそのまま返す
      if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
        return path;
      }
      return '';
    } catch (error) {
      logDashboardFetchError(`Failed to get image URL for path: ${path}`, error);
      return '';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'たった今';
    if (diffMins < 60) return `${diffMins}分前`;
    if (diffHours < 24) return `${diffHours}時間前`;
    if (diffDays < 7) return `${diffDays}日前`;
    return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  };

  const normalizedProjectSearch = projectSearchQuery.trim().toLowerCase();
  const visibleProjects = useMemo(() => {
    if (!normalizedProjectSearch) {
      return getRecentProjects(6);
    }

    return [...projects]
      .filter((project) => {
        const updatedDate = new Date(project.updatedAt);
        const objectTypes = project.objects
          .map((object) => canvasObjectTypeLabels[object.type] || object.type)
          .join(' ');
        const searchable = [
          project.name,
          project.brandId || '',
          objectTypes,
          updatedDate.toLocaleDateString('ja-JP'),
          updatedDate.toLocaleDateString('en-US'),
        ].join(' ').toLowerCase();
        return searchable.includes(normalizedProjectSearch);
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 24);
  }, [getRecentProjects, normalizedProjectSearch, projects]);

  const isSearchingProjects = normalizedProjectSearch.length > 0;
  const displayableRecentImages = recentImages.filter((image) => Boolean(getImageUrl(image)) && !failedRecentImageIds.has(image.id));
  const unresolvedRecentImageCount = recentImages.length - displayableRecentImages.length;

  return (
    <>
      {/* Onboarding */}
      {showOnboarding && <Onboarding onComplete={completeOnboarding} userId={user?.id} />}

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8"
      >
        <motion.section
          variants={itemVariants}
          className="mb-6 overflow-hidden rounded-[28px] border border-white/10 bg-[#050707] shadow-[0_24px_80px_rgba(0,0,0,0.35)] sm:mb-8"
          data-testid="dashboard-internal-beta-start"
        >
          <div className="flex flex-col gap-8 px-6 py-8 sm:px-10 sm:py-10 lg:px-12 lg:py-12">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h1 className="text-4xl font-semibold tracking-normal text-white sm:text-5xl lg:text-6xl">
                  HEAVY CHAIN AI
                </h1>
                <p className="mt-4 max-w-4xl text-sm leading-6 text-neutral-300 sm:text-base">
                  アパレル特化のAIデザインワークスペース。指示を入力するか、目的別の4カテゴリから開始します。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={resetOnboarding}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-4 text-sm font-semibold text-neutral-200 transition hover:border-white/25 hover:bg-white/[0.12]"
                >
                  <IconHelp className="h-4 w-4" size={16} />
                  チュートリアルを見る
                </button>
                <a
                  href="#dashboard-workflow"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-4 text-sm font-semibold text-white transition hover:border-white/25 hover:bg-white/[0.12]"
                >
                  制作ワークフロー
                  <IconArrowRight className="h-4 w-4" size={16} />
                </a>
              </div>
            </div>

            <form
              className="flex min-h-[76px] items-center gap-3 rounded-full border border-cyan-300/70 bg-[#050707] px-5 shadow-[0_0_0_1px_rgba(103,232,249,0.12)] focus-within:border-cyan-200"
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                const prompt = String(formData.get('dashboardPrompt') || '').trim();
                const searchParams = new URLSearchParams({ feature: 'campaign-image' });
                if (prompt) searchParams.set('prompt', prompt);
                navigate(`/generate?${searchParams.toString()}`);
              }}
            >
              <Search className="h-6 w-6 shrink-0 text-cyan-300" />
              <input
                name="dashboardPrompt"
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-white outline-none placeholder:text-neutral-500 sm:text-base"
                placeholder="指示を入力してください... 例: モデルの着せ替え、夏のSNSバナー、背景削除"
                aria-label="制作したい内容"
              />
              <button
                type="submit"
                className="inline-flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-full bg-cyan-300 px-6 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-200"
              >
                開始
                <IconArrowRight className="h-4 w-4" size={16} />
              </button>
            </form>
          </div>
        </motion.section>

        <motion.section id="dashboard-workflow" variants={itemVariants} className="mb-8 sm:mb-12 lg:mb-16">
          <LightchainParityHub compactOnMobile />
        </motion.section>

        {/* Workspace Activity */}
        <motion.section variants={itemVariants} className="mb-8 sm:mb-12 lg:mb-16">
          <div className="mb-4 sm:mb-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-300">Today</p>
            <h2 className="mt-1 text-lg sm:text-xl lg:text-2xl font-semibold text-neutral-900 dark:text-white font-display">今日の作業状況</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
              進行中の生成、失敗したジョブ、利用状況をまとめて確認できます。
            </p>
          </div>
          {isActivityLoading ? (
            <div className="grid gap-4 lg:grid-cols-4">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className="h-52 animate-pulse rounded-2xl bg-neutral-100 dark:bg-surface-900" />
              ))}
            </div>
          ) : activityError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50/70 p-5 dark:border-red-900/60 dark:bg-red-950/25">
              <h3 className="text-base font-semibold text-red-800 dark:text-red-200">読み込み失敗</h3>
              <p className="mt-2 text-sm text-red-700 dark:text-red-300">
                作業状況を取得できませんでした。接続状態を確認して再読み込みしてください。
              </p>
              <button
                type="button"
                onClick={() => void fetchActivity()}
                className="mt-4 rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-800 disabled:opacity-60"
                disabled={isActivityLoading}
              >
                再読み込み
              </button>
            </div>
          ) : (
            <>
              <div
                className="grid gap-3 sm:hidden"
                data-testid="mobile-dashboard-activity-summary"
              >
                <div className="grid grid-cols-3 gap-2">
                  <Link
                    to="/jobs"
                    className="rounded-2xl border border-white/10 bg-white/[0.06] p-3"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">進行中</p>
                    <p className="mt-1 text-xl font-semibold text-neutral-950 dark:text-white">{workspaceActivity.activeJobs.length}</p>
                  </Link>
                  <Link
                    to="/jobs"
                    className="rounded-2xl border border-white/10 bg-white/[0.06] p-3"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">失敗</p>
                    <p className="mt-1 text-xl font-semibold text-neutral-950 dark:text-white">{workspaceActivity.failedJobs.length}</p>
                  </Link>
                  <Link
                    to="/credits"
                    className="rounded-2xl border border-white/10 bg-white/[0.06] p-3"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">残り</p>
                    <p className="mt-1 text-xl font-semibold text-neutral-950 dark:text-white">{workspaceActivity.creditSummary.remainingUnits.toLocaleString()}</p>
                  </Link>
                </div>
                <Link
                  to="/jobs"
                  className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white/70 px-4 py-3 text-sm font-semibold text-neutral-700 shadow-soft dark:border-neutral-800 dark:bg-white/[0.06] dark:text-neutral-200"
                  data-testid="mobile-dashboard-activity-detail-link"
                >
                  詳細なジョブ状況を見る
                  <IconArrowRight className="h-4 w-4" size={16} />
                </Link>
              </div>
              <div
                className="hidden gap-4 sm:grid lg:grid-cols-4"
                data-testid="dashboard-workspace-activity-detail"
              >
                <JobQueuePanel activeJobs={workspaceActivity.activeJobs} completedJobs={workspaceActivity.completedJobs} className="lg:col-span-2" />
                <FailureRetryCard failedJobs={workspaceActivity.failedJobs} />
                <CreditSummaryPanel summary={workspaceActivity.creditSummary} />
                <WorkspaceGuidePanel className="lg:col-span-4" />
              </div>
            </>
          )}
        </motion.section>

        <motion.nav
          variants={itemVariants}
          className="mb-8 grid grid-cols-3 gap-2 sm:hidden"
          aria-label="モバイル管理導線"
          data-testid="mobile-dashboard-management-links"
        >
          <Link
            to="/history"
            className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-center text-xs font-semibold text-neutral-800 dark:text-neutral-100"
          >
            履歴
          </Link>
          <Link
            to="/canvas"
            className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-center text-xs font-semibold text-neutral-800 dark:text-neutral-100"
          >
            Canvas
          </Link>
          <Link
            to="/credits"
            className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-center text-xs font-semibold text-neutral-800 dark:text-neutral-100"
          >
            利用状況
          </Link>
        </motion.nav>

        {/* Canvas Projects */}
        <motion.div
          variants={itemVariants}
          className="mb-8 hidden sm:block sm:mb-12 lg:mb-16"
          data-testid="dashboard-desktop-projects"
        >
          <div className="flex items-center justify-between mb-4 sm:mb-6 lg:mb-8">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <IconFolder className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" size={20} />
              </div>
              <h2 className="text-lg sm:text-xl lg:text-2xl font-semibold text-neutral-900 dark:text-white font-display">プロジェクト</h2>
            </div>
            <button
              onClick={() => setShowNewProjectModal(true)}
              className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-primary-500 hover:bg-primary-600 text-white text-xs sm:text-sm font-medium transition-colors flex items-center gap-1.5 sm:gap-2 shadow-md hover:shadow-lg"
            >
              <IconPlus className="w-3.5 h-3.5 sm:w-4 sm:h-4" size={16} />
              <span className="hidden sm:inline">新規作成</span>
              <span className="sm:hidden">新規</span>
            </button>
          </div>

          {projects.length > 0 ? (
            <>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="relative block sm:max-w-sm flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                  <input
                    value={projectSearchQuery}
                    onChange={(event) => setProjectSearchQuery(event.target.value)}
                    placeholder="プロジェクト名・素材種別で検索"
                    className="w-full rounded-xl border border-neutral-200 bg-white/80 py-2.5 pl-10 pr-10 text-sm text-neutral-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-neutral-700 dark:bg-neutral-900/70 dark:text-white dark:focus:border-primary-500 dark:focus:ring-primary-900/40"
                    aria-label="プロジェクトを検索"
                  />
                  {projectSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setProjectSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                      aria-label="プロジェクト検索をクリア"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </label>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {isSearchingProjects
                    ? `${visibleProjects.length}件 / 全${projects.length}件`
                    : `最近の${visibleProjects.length}件 / 全${projects.length}件`}
                </p>
              </div>

              {visibleProjects.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 sm:gap-4 lg:gap-6">
              {/* New Canvas Card */}
              <button
                onClick={handleNewCanvas}
                className="group aspect-[4/3] rounded-xl sm:rounded-2xl border-2 border-dashed border-neutral-200 dark:border-neutral-800 flex flex-col items-center justify-center gap-2 sm:gap-3 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all duration-300"
              >
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 group-hover:bg-white dark:group-hover:bg-neutral-700">
                  <IconPlus className="w-5 h-5 sm:w-6 sm:h-6 text-neutral-400 group-hover:text-blue-500" size={24} />
                </div>
                <span className="text-xs sm:text-sm font-medium text-neutral-400 group-hover:text-blue-600">新規</span>
              </button>

              {/* Project Cards */}
              {visibleProjects.map((project, i) => (
                <motion.div
                  key={project.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => handleOpenProject(project)}
                  className="group aspect-[4/3] rounded-xl sm:rounded-2xl overflow-hidden bg-white dark:bg-neutral-800 cursor-pointer relative shadow-sm hover:shadow-lg transition-all duration-300 border border-neutral-100 dark:border-neutral-700"
                >
                  {/* Thumbnail or Placeholder */}
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20">
                    {project.thumbnail ? (
                      <img src={project.thumbnail} alt={project.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <IconLayout className="w-8 h-8 sm:w-12 sm:h-12 text-neutral-300 dark:text-neutral-600" size={48} />
                      </div>
                    )}
                  </div>

                  {/* Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                  {/* Project Info */}
                  <div className="absolute bottom-0 left-0 right-0 p-2 sm:p-3 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-sm">
                    <h3 className="font-medium text-xs sm:text-sm text-neutral-800 dark:text-white truncate">
                      {project.name}
                    </h3>
                    <p className="text-[10px] sm:text-xs text-neutral-500 dark:text-neutral-400">
                      {formatDate(project.updatedAt)}
                    </p>
                  </div>

                  {/* Menu Button */}
                  <div className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setProjectMenuOpen(projectMenuOpen === project.id ? null : project.id);
                      }}
                      className="p-1 sm:p-1.5 rounded-lg bg-white/80 dark:bg-neutral-800/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 sm:transition-opacity hover:bg-white dark:hover:bg-neutral-700"
                      style={{ opacity: projectMenuOpen === project.id ? 1 : undefined }}
                      aria-label={`${project.name}のメニューを開く`}
                    >
                      <MoreVertical className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-neutral-600 dark:text-neutral-300" />
                    </button>

                    {/* Dropdown Menu */}
                    <AnimatePresence>
                      {projectMenuOpen === project.id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -10 }}
                          className="absolute top-full right-0 mt-1 w-28 sm:w-32 bg-white dark:bg-neutral-800 rounded-lg sm:rounded-xl shadow-xl border border-neutral-100 dark:border-neutral-700 py-1 z-20"
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenProject(project);
                            }}
                            className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-left text-xs sm:text-sm text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 flex items-center gap-2"
                            aria-label={`${project.name}を開く`}
                          >
                            <Edit3 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            開く
                          </button>
                          <button
                            onClick={(e) => handleDeleteProject(project.id, e)}
                            className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-left text-xs sm:text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                            aria-label={`${project.name}を削除`}
                          >
                            <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            削除
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-neutral-200 bg-white/70 p-6 text-center dark:border-neutral-800 dark:bg-white/5">
                  <h3 className="text-base font-semibold text-neutral-900 dark:text-white">一致するプロジェクトがありません</h3>
                  <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                    別の名前、日付、画像・テキストなどの素材種別で検索してください。
                  </p>
                  <button
                    type="button"
                    onClick={() => setProjectSearchQuery('')}
                    className="mt-4 rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                  >
                    検索をクリア
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="bg-white/50 dark:bg-white/5 backdrop-blur-sm rounded-3xl p-12 border border-neutral-200/50 dark:border-white/5 text-center">
              <div className="w-24 h-24 bg-gradient-to-br from-blue-100 to-purple-100/50 dark:from-blue-900/30 dark:to-purple-900/30 rounded-3xl flex items-center justify-center mx-auto mb-8 animate-float">
                <IconLayout className="w-10 h-10 text-blue-600 dark:text-blue-400" size={40} />
              </div>
              <h3 className="text-2xl font-semibold text-neutral-900 dark:text-white mb-4 font-display">
                キャンバスで自由に編集
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-8 max-w-md mx-auto leading-relaxed">
                生成した画像を配置して、派生画像を管理。デザインワークフローを効率化できます。
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button 
                  size="lg" 
                  className="rounded-full shadow-glow hover:shadow-glow-lg" 
                  leftIcon={<IconPlus className="w-5 h-5" size={20} />}
                  onClick={() => setShowNewProjectModal(true)}
                >
                  新規プロジェクト作成
                </Button>
              </div>
            </div>
          )}
        </motion.div>

        {/* Recent Images */}
        <motion.div
          variants={itemVariants}
          className="mb-8 hidden sm:block sm:mb-12 lg:mb-16"
          data-testid="dashboard-desktop-recent-images"
        >
          <div className="flex items-center justify-between mb-4 sm:mb-6 lg:mb-8">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-neutral-100 dark:bg-neutral-800 rounded-lg">
                <IconClock className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-500 dark:text-neutral-400" size={20} />
              </div>
              <h2 className="text-lg sm:text-xl lg:text-2xl font-semibold text-neutral-900 dark:text-white font-display">最近の生成</h2>
            </div>
            <Link
              to="/gallery"
              className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 text-xs sm:text-sm font-medium hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors flex items-center gap-1.5 sm:gap-2 group"
            >
              <span className="hidden sm:inline">すべて見る</span>
              <span className="sm:hidden">全て</span>
              <IconArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 group-hover:translate-x-1 transition-transform" size={16} />
            </Link>
          </div>

          {recentImages.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 sm:gap-4 lg:gap-6">
              {displayableRecentImages.map((image, i) => (
                <motion.div
                  key={image.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="group aspect-square rounded-xl sm:rounded-2xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 cursor-pointer relative shadow-sm hover:shadow-lg transition-all duration-300"
                  data-testid="dashboard-recent-image-card"
                  onClick={() => navigate(`/gallery?image=${image.id}`)}
                >
                  {getImageUrl(image) ? (
                    <img
                      src={getImageUrl(image)}
                      alt=""
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                      loading="lazy"
                      onError={() => {
                        logDashboardFetchError(`Failed to load image: ${image.storage_path || image.image_url || 'unknown'}`, image);
                        setFailedRecentImageIds((previous) => new Set(previous).add(image.id));
                      }}
                    />
                  ) : (
                    null
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="absolute bottom-2 left-2 right-2 sm:bottom-3 sm:left-3 sm:right-3">
                      <p className="text-white text-[10px] sm:text-xs font-medium truncate opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                        {new Date(image.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
              {unresolvedRecentImageCount > 0 && (
                <div
                  className="col-span-2 sm:col-span-3 xl:col-span-2 rounded-2xl border border-amber-200/70 bg-amber-50/80 p-5 text-left dark:border-amber-900/50 dark:bg-amber-950/20"
                  data-testid="dashboard-recent-image-recovery"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Preview check</p>
                  <h3 className="mt-2 text-base font-semibold text-neutral-950 dark:text-white">最近の成果物を確認中</h3>
                  <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                    {unresolvedRecentImageCount}件の成果物はプレビューURLを確認中です。壊れた画像として並べず、GalleryかJobsから状態を確認できます。
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      to="/gallery"
                      className="rounded-xl bg-neutral-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-950"
                    >
                      Galleryで確認
                    </Link>
                    <Link
                      to="/jobs"
                      className="rounded-xl border border-neutral-200 bg-white/80 px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:bg-white dark:border-neutral-800 dark:bg-white/[0.06] dark:text-neutral-200"
                    >
                      Jobsを見る
                    </Link>
                  </div>
                </div>
              )}
              
              {/* Add New Button */}
              <Link to="/generate" className="group aspect-square rounded-xl sm:rounded-2xl border-2 border-dashed border-neutral-200 dark:border-neutral-800 flex flex-col items-center justify-center gap-2 sm:gap-3 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-primary-50/50 dark:hover:bg-primary-900/10 transition-all duration-300">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 group-hover:bg-white dark:group-hover:bg-neutral-700">
                  <IconPlus className="w-5 h-5 sm:w-6 sm:h-6 text-neutral-400 group-hover:text-primary-500" size={24} />
                </div>
                <span className="text-xs sm:text-sm font-medium text-neutral-400 group-hover:text-primary-600">新規</span>
              </Link>
            </div>
          ) : (
            <div className="bg-white/50 dark:bg-white/5 backdrop-blur-sm rounded-3xl p-12 border border-neutral-200/50 dark:border-white/5 text-center">
              <div className="w-24 h-24 bg-gradient-to-br from-primary-100 to-gold-light/50 dark:from-primary-900/30 dark:to-gold-dark/30 rounded-3xl flex items-center justify-center mx-auto mb-8 animate-float">
                <IconPalette className="w-10 h-10 text-primary-600 dark:text-primary-400" size={40} />
              </div>
              <h3 className="text-2xl font-semibold text-neutral-900 dark:text-white mb-4 font-display">
                クリエイティブな旅を始めましょう
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-8 max-w-md mx-auto leading-relaxed">
                まだ生成画像はありません。商品画像やプロンプトを入れると、ここに成果物が並びます。
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link to="/generate">
                  <Button size="lg" className="rounded-full shadow-glow hover:shadow-glow-lg" leftIcon={<IconSparkles className="w-5 h-5" size={20} />}>
                    画像を生成する
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </motion.div>

        {/* Usage quota */}
        <motion.div variants={itemVariants} className="hidden sm:block" data-testid="dashboard-desktop-usage">
          <UsageStats />
        </motion.div>
      </motion.div>

      {/* Brand Creation Modal */}
      <Modal
        isOpen={showBrandModal}
        onClose={() => {}}
        title="ブランドを作成"
        size="md"
        footer={
          <Button
            type="submit"
            form="brand-create-form"
            isLoading={isCreatingBrand}
            className="w-full py-4 text-lg shadow-glow"
            size="lg"
          >
            ブランドを作成してはじめる
          </Button>
        }
      >
        <form id="brand-create-form" onSubmit={handleCreateBrand} className="space-y-6">
          <div className="bg-primary-50/50 dark:bg-primary-900/20 rounded-2xl p-6 border border-primary-100 dark:border-primary-800/30">
            <div className="flex gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-800 flex items-center justify-center flex-shrink-0">
                <IconSparkles className="w-5 h-5 text-primary-600 dark:text-primary-400" size={20} />
              </div>
              <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">
                <span className="font-semibold text-primary-700 dark:text-primary-300 block mb-1">ようこそ、Heavy Chainへ！</span>
                まずはあなたのブランドを作成しましょう。AIがブランドの世界観を学習し、最適な画像を生成します。
              </p>
            </div>
          </div>
          
          <div className="space-y-4">
            <Input
              label="ブランド名"
              placeholder="例: URBAN STYLE"
              value={brandForm.name}
              onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })}
              required
              className="text-lg"
            />
            
            <Textarea
              label="世界観・トーン（任意）"
              placeholder="例: シンプルで洗練された大人のカジュアルスタイル。都会的でありながらリラックス感のある雰囲気。"
              value={brandForm.toneDescription}
              onChange={(e) => setBrandForm({ ...brandForm, toneDescription: e.target.value })}
              rows={3}
            />
            
            <Input
              label="ターゲット層（任意）"
              placeholder="例: 30代〜40代の働く男性"
              value={brandForm.targetAudience}
              onChange={(e) => setBrandForm({ ...brandForm, targetAudience: e.target.value })}
            />
          </div>
        </form>
      </Modal>

      {/* New Project Modal */}
      <Modal
        isOpen={showNewProjectModal}
        onClose={() => setShowNewProjectModal(false)}
        title="新規プロジェクト"
        size="sm"
      >
        <div className="space-y-6">
          <Input
            label="プロジェクト名"
            placeholder="例: 夏コレクション2024"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            autoFocus
          />
          
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => setShowNewProjectModal(false)}
              className="flex-1"
            >
              キャンセル
            </Button>
            <Button
              onClick={handleCreateNewProject}
              className="flex-1"
              leftIcon={<IconPlus className="w-4 h-4" size={16} />}
            >
              作成
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
