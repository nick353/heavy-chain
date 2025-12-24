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
          <ProtectedRoute>
            <AdminDashboard />
          </ProtectedRoute>
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
