import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './stores/authStore';
import { Layout } from './components/layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  BRAND_LIKENESS_BLOCK_COPY,
  GENERATION_LEGAL_COPY,
  UPLOAD_RIGHTS_CONFIRMATION_LABEL,
} from './lib/legalSafetyGuard';

const LandingPage = lazy(() => import('./pages/LandingPage').then((module) => ({ default: module.LandingPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const SignupPage = lazy(() => import('./pages/SignupPage').then((module) => ({ default: module.SignupPage })));
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage').then((module) => ({ default: module.AuthCallbackPage })));
const SharedImagePage = lazy(() => import('./pages/SharedImagePage').then((module) => ({ default: module.SharedImagePage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const GeneratePage = lazy(() => import('./pages/GeneratePage').then((module) => ({ default: module.GeneratePage })));
const GenerateLightchainEntry = lazy(() => import('./components/GenerateLightchainEntry').then((module) => ({ default: module.GenerateLightchainEntry })));
const WorkflowBoardPage = lazy(() => import('./pages/WorkflowBoardPage').then((module) => ({ default: module.WorkflowBoardPage })));
const FittingPage = lazy(() => import('./pages/FittingPage').then((module) => ({ default: module.FittingPage })));
const MarketingWorkspacePage = lazy(() => import('./pages/MarketingWorkspacePage').then((module) => ({ default: module.MarketingWorkspacePage })));
const FashionStudioPage = lazy(() => import('./pages/FashionStudioPage').then((module) => ({ default: module.FashionStudioPage })));
const ModelLibraryPage = lazy(() => import('./pages/ModelLibraryPage').then((module) => ({ default: module.ModelLibraryPage })));
const PatternWorkspacePage = lazy(() => import('./pages/PatternWorkspacePage').then((module) => ({ default: module.PatternWorkspacePage })));
const VideoWorkstationPage = lazy(() => import('./pages/VideoWorkstationPage').then((module) => ({ default: module.VideoWorkstationPage })));
const LabPage = lazy(() => import('./pages/LabPage').then((module) => ({ default: module.LabPage })));
const LightchainWorkbenchPage = lazy(() => import('./pages/LightchainWorkbenchPage').then((module) => ({ default: module.LightchainWorkbenchPage })));
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((module) => ({ default: module.HistoryPage })));
const JobsPage = lazy(() => import('./pages/JobsPage').then((module) => ({ default: module.JobsPage })));
const CreditsPage = lazy(() => import('./pages/CreditsPage').then((module) => ({ default: module.CreditsPage })));
const GalleryPage = lazy(() => import('./pages/GalleryPage').then((module) => ({ default: module.GalleryPage })));
const CanvasEditorPage = lazy(() => import('./pages/CanvasEditorPage').then((module) => ({ default: module.CanvasEditorPage })));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard').then((module) => ({ default: module.AdminDashboard })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then((module) => ({ default: module.ForgotPasswordPage })));
const BrandSettingsPage = lazy(() => import('./pages/BrandSettingsPage').then((module) => ({ default: module.BrandSettingsPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

const loadingRouteCopy: Record<string, { eyebrow: string; title: string; description: string; actions: string[] }> = {
  '/dashboard': {
    eyebrow: 'Home',
    title: '制作ワークフローを準備しています',
    description: '商品画像、素材ワークベンチ、Canvas、ジョブ状況へすぐ戻れるようにワークスペースを準備しています。',
    actions: ['商品画像から始める', '素材ワークベンチを開く', 'ジョブ状況を見る'],
  },
  '/jobs': {
    eyebrow: 'Production Queue',
    title: '制作キューを準備しています',
    description: '進行中、止まった作業、完了した成果物を確認できるようにしています。',
    actions: ['止まった作業を確認', '成果物を開く', '新しく作る'],
  },
  '/gallery': {
    eyebrow: 'Gallery',
    title: 'ギャラリーを準備しています',
    description: '保存済み画像、Canvas再編集、お気に入りを確認できるようにしています。',
    actions: ['成果物を確認', 'Canvasへ追加', '新しく生成'],
  },
  '/marketing': {
    eyebrow: 'Marketing',
    title: 'マーケティング画面を準備しています',
    description: '商品画像から販促brief、Canvas保存、Gallery確認へ進む導線を準備しています。',
    actions: ['販促briefを作る', 'Canvasへ保存', 'Galleryで確認'],
  },
  '/fitting': {
    eyebrow: 'AI Fitting',
    title: 'AIフィッティング画面を準備しています',
    description: '衣服画像、モデル条件、着用画像の制作フローを準備しています。',
    actions: ['衣服画像を入れる', 'モデル条件を選ぶ', 'Canvasへ保存'],
  },
  '/studio': {
    eyebrow: 'Fashion Studio',
    title: 'Fashion Studioを準備しています',
    description: '服、モデル、背景、小物を組み合わせる撮影注文票を準備しています。',
    actions: ['素材を入れる', '構図を確認', 'Galleryで確認'],
  },
  '/models': {
    eyebrow: 'Model Library',
    title: 'モデルライブラリを準備しています',
    description: '顔、ポーズ、体型、年齢層などのモデル条件を準備しています。',
    actions: ['モデル条件を選ぶ', '生成条件へ渡す', 'Canvasへ保存'],
  },
  '/patterns': {
    eyebrow: 'Pattern Workspace',
    title: '柄ワークスペースを準備しています',
    description: '柄、配置、リピート、商品への見え方を確認できる画面を準備しています。',
    actions: ['柄を作る', '配置を確認', 'Galleryで確認'],
  },
  '/video': {
    eyebrow: 'Video',
    title: '動画ワークスペースを準備しています',
    description: 'Storyboard、ショット構成、CTAを確認できる画面を準備しています。',
    actions: ['Storyboardを作る', 'ショットを確認', 'Galleryで確認'],
  },
  '/lab': {
    eyebrow: 'Lab',
    title: 'Lab画面を準備しています',
    description: '仮説、評価軸、採用候補を確認できる画面を準備しています。',
    actions: ['仮説を作る', '評価軸を見る', '採用候補を確認'],
  },
  '/canvas/new': {
    eyebrow: 'Canvas',
    title: 'Canvasを準備しています',
    description: '画像配置、Gallery追加、書き出しの編集画面を準備しています。',
    actions: ['画像を置く', 'Galleryから追加', '書き出す'],
  },
  '/history': {
    eyebrow: 'History',
    title: '生成履歴を準備しています',
    description: '過去の生成、再利用、Canvas再編集の導線を準備しています。',
    actions: ['履歴を見る', 'Galleryへ移動', 'Canvasで再編集'],
  },
  '/credits': {
    eyebrow: 'Credits',
    title: '利用状況を準備しています',
    description: '残量、利用量、次にできる作業を確認できる画面を準備しています。',
    actions: ['利用状況を見る', '生成へ戻る', 'ジョブを見る'],
  },
  '/brand/settings': {
    eyebrow: 'Brand',
    title: 'ブランド設定を準備しています',
    description: '制作前の準備状態、権利確認、ブランド情報を確認できる画面を準備しています。',
    actions: ['準備状態を見る', '生成へ戻る', 'Galleryで確認'],
  },
};

function getLoadingCopy(pathname: string) {
  if (pathname.startsWith('/generate')) {
    return {
      eyebrow: 'Generate',
      title: '生成画面を準備しています',
      description: '素材アップロード、権利確認、生成の準備をしています。',
      actions: ['素材を入れる', '権利確認を行う', '生成する'],
    };
  }
  if (pathname.startsWith('/lightchain')) {
    return {
      eyebrow: 'Material Workbench',
      title: '素材ワークベンチを準備しています',
      description: 'アップロード、AIマスク認識、抽出、Canvas保存の導線を準備しています。',
      actions: ['画像をアップロード', 'AIマスク認識', 'Canvasに保存'],
    };
  }
  return loadingRouteCopy[pathname] ?? {
    eyebrow: 'Workspace',
    title: 'ワークスペースを準備しています',
    description: '認証状態とブランド設定を確認しています。時間がかかる場合でも、画面を閉じずに再読み込みできます。',
    actions: ['再読み込み', 'ログイン確認', '状態を確認'],
  };
}

function WorkspaceLoadingFallback({ authRecovery = false }: { authRecovery?: boolean }) {
  const location = useLocation();
  const copy = getLoadingCopy(location.pathname);

  return (
    <div className="min-h-screen bg-surface-50 px-4 py-8 dark:bg-surface-950">
      <div className="mx-auto flex min-h-[60vh] max-w-5xl flex-col justify-center">
        <div className="max-w-2xl">
          <div className="mb-5 flex items-center gap-3">
            <div className="spinner" />
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary-600 dark:text-primary-300">
              {copy.eyebrow}
            </p>
          </div>
          <h1 className="text-2xl font-display font-semibold text-neutral-950 dark:text-white sm:text-3xl">
            {copy.title}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
            {copy.description}
          </p>
          {authRecovery ? (
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-xl bg-neutral-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
              >
                再読み込み
              </button>
              <a
                href="/login"
                className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 dark:border-neutral-800 dark:bg-white/[0.06] dark:text-neutral-200 dark:hover:bg-white/[0.1]"
              >
                ログイン画面へ
              </a>
            </div>
          ) : null}
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {copy.actions.map((label) => (
            <div
              key={label}
              className="rounded-2xl border border-neutral-200 bg-white/70 p-4 shadow-sm dark:border-neutral-800 dark:bg-white/[0.06]"
            >
              <div className="mb-3 h-8 w-8 rounded-xl bg-primary-100 dark:bg-primary-900/40" />
              <p className="text-sm font-semibold text-neutral-900 dark:text-white">{label}</p>
              <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                読み込み後にこの導線をそのまま使えます。
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PageLoading() {
  return <WorkspaceLoadingFallback />;
}

function lazyPage(page: React.ReactNode) {
  return <Suspense fallback={<PageLoading />}>{page}</Suspense>;
}

// Protected Route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isInitialized, authRecoveryRequired } = useAuthStore();

  // 初期化が完了していない、またはローディング中の場合
  if (!isInitialized || isLoading || authRecoveryRequired) {
    return <WorkspaceLoadingFallback authRecovery />;
  }

  // 認証されていない場合
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, isLoading, isInitialized, authRecoveryRequired } = useAuthStore();
  const [profileWaitExpired, setProfileWaitExpired] = useState(false);

  useEffect(() => {
    const shouldWaitForProfile = Boolean(user && profile === null && isInitialized && !isLoading && !authRecoveryRequired);
    if (!shouldWaitForProfile) {
      setProfileWaitExpired(false);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setProfileWaitExpired(true);
    }, 15_000);

    return () => window.clearTimeout(timeoutId);
  }, [authRecoveryRequired, isInitialized, isLoading, profile, user]);

  if (!isInitialized || isLoading || authRecoveryRequired || (user && profile === null && !profileWaitExpired)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
        <div className="text-center">
          <div className="spinner mb-4" />
          <p className="text-neutral-500 dark:text-neutral-400">
            {authRecoveryRequired ? 'ログイン状態を確認できませんでした。再読み込みしてください。' : '読み込み中...'}
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!profile?.is_admin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

// Public Route wrapper (redirects to dashboard if already logged in)
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isInitialized, authRecoveryRequired } = useAuthStore();

  // 初期化が完了していない、またはローディング中の場合
  if (!isInitialized || (isLoading && !authRecoveryRequired)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
        <div className="text-center">
          <div className="spinner mb-4" />
          <p className="text-neutral-500 dark:text-neutral-400">読み込み中...</p>
        </div>
      </div>
    );
  }

  // すでにログイン済みの場合
  if (user && !authRecoveryRequired) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function StaticInfoPage({
  title,
  description,
  sections,
}: {
  title: string;
  description: string;
  sections: Array<{ heading: string; body: string }>;
}) {
  return (
    <main className="min-h-screen bg-surface-50 dark:bg-surface-950 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <a
          href="/"
          className="text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
        >
          Heavy Chainへ戻る
        </a>
        <div className="mt-8 glass-panel rounded-2xl p-6 sm:p-8">
          <h1 className="text-2xl font-display font-semibold text-neutral-900 dark:text-white">
            {title}
          </h1>
          <p className="mt-3 text-neutral-600 dark:text-neutral-300">
            {description}
          </p>
          <div className="mt-8 space-y-6">
            {sections.map((section) => (
              <section key={section.heading}>
                <h2 className="text-base font-semibold text-neutral-900 dark:text-white">
                  {section.heading}
                </h2>
                <p className="mt-2 text-sm leading-7 text-neutral-600 dark:text-neutral-300">
                  {section.body}
                </p>
              </section>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

function AppRoutes() {
  const { initialize, isInitialized } = useAuthStore();

  useEffect(() => {
    let mounted = true;
    
    const initAuth = async () => {
      if (!isInitialized && mounted) {
        try {
          await initialize();
        } catch (error) {
          if (import.meta.env.DEV) {
            console.error('Failed to initialize authentication:', error);
          }
        }
      }
    };

    initAuth();

    return () => {
      mounted = false;
    };
  }, [initialize, isInitialized]);

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={lazyPage(<LandingPage />)} />
      <Route
        path="/login"
        element={
          <PublicRoute>
            {lazyPage(<LoginPage />)}
          </PublicRoute>
        }
      />
      <Route
        path="/signup"
        element={
          <PublicRoute>
            {lazyPage(<SignupPage />)}
          </PublicRoute>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicRoute>
            {lazyPage(<ForgotPasswordPage />)}
          </PublicRoute>
        }
      />
      <Route path="/auth/callback" element={lazyPage(<AuthCallbackPage />)} />
      <Route path="/share/:token" element={lazyPage(<SharedImagePage />)} />
      <Route
        path="/terms"
        element={
          <StaticInfoPage
            title="利用規約"
            description="Heavy Chainの利用条件を確認できます。"
            sections={[
              {
                heading: 'サービスの利用',
                body: 'Heavy Chainはアパレル向け画像生成と制作支援を行うサービスです。法令や第三者の権利を侵害する用途では利用できません。',
              },
              {
                heading: '生成物と責任',
                body: GENERATION_LEGAL_COPY,
              },
              {
                heading: 'アップロード素材の権利',
                body: UPLOAD_RIGHTS_CONFIRMATION_LABEL + '。衣服写真、モデル画像、ロゴ、ブランド素材、作品、参考画像をアップロードする場合も同じです。',
              },
              {
                heading: '禁止事項',
                body: `不正アクセス、秘密情報の入力、権利侵害、他者になりすます行為、サービスの安定運用を妨げる行為は禁止します。${BRAND_LIKENESS_BLOCK_COPY}`,
              },
            ]}
          />
        }
      />
      <Route
        path="/privacy"
        element={
          <StaticInfoPage
            title="プライバシーポリシー"
            description="Heavy Chainで扱う情報と保護方針を確認できます。"
            sections={[
              {
                heading: '取得する情報',
                body: 'アカウント情報、ブランド設定、プロンプト、生成履歴、生成ジョブ、生成画像、アップロード素材、利用状況など、サービス提供に必要な情報を扱います。',
              },
              {
                heading: '利用目的',
                body: '認証、画像生成、利用量管理、品質改善、問い合わせ対応、セキュリティ保護のために利用します。',
              },
              {
                heading: '秘密情報の扱い',
                body: 'APIキー、認証情報、個人情報は必要最小限で扱い、画面や証跡に表示しない運用を前提にします。',
              },
              {
                heading: '保持と削除',
                body: '生成handoff用の一時素材は生成完了または検証後のcleanup対象とし、プロジェクト資産は利用者の削除またはアカウント運用方針に従って保持されます。最終保持期間は公開前に運営者が確定します。',
              },
            ]}
          />
        }
      />
      <Route
        path="/legal"
        element={
          <StaticInfoPage
            title="特商法表記"
            description="販売者情報や問い合わせ先を確認できます。"
            sections={[
              {
                heading: '提供サービス',
                body: 'アパレル向けAI画像生成、編集、管理、制作補助機能を提供します。',
              },
              {
                heading: '料金',
                body: '現在このサービスでは、運営者が有効化するまで課金、支払い、購入、checkout、外部公開は扱いません。将来の料金条件は、公開前に運営者が確定した画面表示または契約条件に従います。',
              },
              {
                heading: '問い合わせ',
                body: 'サービスに関する問い合わせは、サイト上の問い合わせ導線または運営者が指定する連絡先から行ってください。',
              },
            ]}
          />
        }
      />
      <Route
        path="/contact"
        element={
          <StaticInfoPage
            title="お問い合わせ"
            description="Heavy Chainの導入相談、不具合報告、権利確認、運用相談はこちらを確認してください。"
            sections={[
              {
                heading: '連絡先',
                body: '現在の問い合わせ先は contact@heavy-chain.app です。サービス名、ブランド名、対象URL、発生日時、画面や生成物の状況を添えて連絡してください。',
              },
              {
                heading: '不具合報告',
                body: '生成、Gallery、Canvas、ログイン、モバイル表示の問題は、再現手順、期待動作、実際の動作、スクリーンショットまたはURLを添えると確認が早くなります。',
              },
              {
                heading: '対応しない自動操作',
                body: '支払い、購入、外部公開、本人確認、秘密情報入力などの不可逆操作は、利用者の明示確認なしに自動実行しません。',
              },
            ]}
          />
        }
      />

      {/* Protected routes with layout */}
      <Route element={<Layout />}>
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<DashboardPage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/generate"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<GeneratePage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/workflows/:workflowId"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<WorkflowBoardPage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/fitting"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<FittingPage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/marketing"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<MarketingWorkspacePage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/studio"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<FashionStudioPage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/models"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<ModelLibraryPage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/patterns"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<PatternWorkspacePage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/video"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<VideoWorkstationPage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lab"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<LabPage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lightchain"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(
                  <div className="py-10">
                    <GenerateLightchainEntry />
                  </div>
                )}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lightchain/:toolId"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<LightchainWorkbenchPage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/history"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<HistoryPage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/jobs"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<JobsPage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/credits"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<CreditsPage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/gallery"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<GalleryPage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/brand/settings"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {lazyPage(<BrandSettingsPage />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
      </Route>

      {/* Canvas Editor (full screen, no layout) */}
      <Route
        path="/canvas/:projectId?"
        element={
          <ProtectedRoute>
            {lazyPage(<CanvasEditorPage />)}
          </ProtectedRoute>
        }
      />

      {/* Admin Dashboard */}
      <Route
        path="/admin"
        element={
          <AdminRoute>
            {lazyPage(<AdminDashboard />)}
          </AdminRoute>
        }
      />

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
