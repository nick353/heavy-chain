import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './stores/authStore';
import { Layout } from './components/layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  LandingPage,
  LoginPage,
  SignupPage,
  AuthCallbackPage,
  DashboardPage,
  GeneratePage,
  GalleryPage,
  CanvasEditorPage,
  AdminDashboard,
  ForgotPasswordPage,
  BrandSettingsPage
} from './pages';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

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
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/signup"
        element={
          <PublicRoute>
            <SignupPage />
          </PublicRoute>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicRoute>
            <ForgotPasswordPage />
          </PublicRoute>
        }
      />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
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
                <DashboardPage />
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/generate"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                <GeneratePage />
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/gallery"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                <GalleryPage />
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/brand/settings"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                <BrandSettingsPage />
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
            <CanvasEditorPage />
          </ProtectedRoute>
        }
      />

      {/* Admin Dashboard */}
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminDashboard />
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
