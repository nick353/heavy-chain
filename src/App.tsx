import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './stores/authStore';
import { Layout } from './components/layout';
import { ErrorBoundary } from './components/ErrorBoundary';

const LandingPage = lazy(() => import('./pages/LandingPage').then((module) => ({ default: module.LandingPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const SignupPage = lazy(() => import('./pages/SignupPage').then((module) => ({ default: module.SignupPage })));
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage').then((module) => ({ default: module.AuthCallbackPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const GeneratePage = lazy(() => import('./pages/GeneratePage').then((module) => ({ default: module.GeneratePage })));
const WorkflowBoardPage = lazy(() => import('./pages/WorkflowBoardPage').then((module) => ({ default: module.WorkflowBoardPage })));
const FittingPage = lazy(() => import('./pages/FittingPage').then((module) => ({ default: module.FittingPage })));
const MarketingWorkspacePage = lazy(() => import('./pages/MarketingWorkspacePage').then((module) => ({ default: module.MarketingWorkspacePage })));
const FashionStudioPage = lazy(() => import('./pages/FashionStudioPage').then((module) => ({ default: module.FashionStudioPage })));
const ModelLibraryPage = lazy(() => import('./pages/ModelLibraryPage').then((module) => ({ default: module.ModelLibraryPage })));
const PatternWorkspacePage = lazy(() => import('./pages/PatternWorkspacePage').then((module) => ({ default: module.PatternWorkspacePage })));
const VideoWorkstationPage = lazy(() => import('./pages/VideoWorkstationPage').then((module) => ({ default: module.VideoWorkstationPage })));
const LabPage = lazy(() => import('./pages/LabPage').then((module) => ({ default: module.LabPage })));
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

function PageLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
      <div className="text-center">
        <div className="spinner mb-4" />
        <p className="text-neutral-500 dark:text-neutral-400">読み込み中...</p>
      </div>
    </div>
  );
}

function lazyPage(page: React.ReactNode) {
  return <Suspense fallback={<PageLoading />}>{page}</Suspense>;
}

// Protected Route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isInitialized } = useAuthStore();

  // 初期化が完了していない、またはローディング中の場合
  if (!isInitialized || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
        <div className="text-center">
          <div className="spinner mb-4" />
          <p className="text-neutral-500 dark:text-neutral-400">読み込み中...</p>
        </div>
      </div>
    );
  }

  // 認証されていない場合
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, isLoading, isInitialized } = useAuthStore();

  if (!isInitialized || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
        <div className="text-center">
          <div className="spinner mb-4" />
          <p className="text-neutral-500 dark:text-neutral-400">読み込み中...</p>
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
  const { user, isLoading, isInitialized } = useAuthStore();

  // 初期化が完了していない、またはローディング中の場合
  if (!isInitialized || isLoading) {
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
  if (user) {
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
          console.error('Failed to initialize authentication:', error);
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
                body: '生成結果は利用者が内容を確認したうえで使用してください。公開前にはブランド、権利、表現、品質を必ず確認してください。',
              },
              {
                heading: '禁止事項',
                body: '不正アクセス、秘密情報の入力、権利侵害、他者になりすます行為、サービスの安定運用を妨げる行為は禁止します。',
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
                body: 'アカウント情報、ブランド設定、生成履歴、利用状況など、サービス提供に必要な情報を扱います。',
              },
              {
                heading: '利用目的',
                body: '認証、画像生成、利用量管理、品質改善、問い合わせ対応、セキュリティ保護のために利用します。',
              },
              {
                heading: '秘密情報の扱い',
                body: 'APIキー、認証情報、個人情報は必要最小限で扱い、画面や証跡に表示しない運用を前提にします。',
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
                body: '画面上または契約書に表示された料金条件に従います。無料期間やプラン条件は変更される場合があります。',
              },
              {
                heading: '問い合わせ',
                body: 'サービスに関する問い合わせは、サイト上の問い合わせ導線または運営者が指定する連絡先から行ってください。',
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
