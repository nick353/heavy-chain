import { useState, useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Header } from './Header';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import { motion, AnimatePresence } from 'framer-motion';
import { FeedbackButton } from '../ui/FeedbackForm';
import { SkipLink, KeyboardShortcuts, defaultShortcuts } from '../ui';
import { lightchainCategories } from '../../lib/lightchainParityCatalog';
import {
  getLightchainUnifiedRouteAliases,
  lightchainUnifiedFeatureCatalog,
} from '../../lib/lightchainUnifiedFeatureCatalog';
import { HeavyChainLogo } from '../icons';
import { ChevronDown, Globe2, HelpCircle, History, User, UserCircle } from 'lucide-react';

export function Layout() {
  const { user, profile, signOut } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [isLightAccountMenuOpen, setIsLightAccountMenuOpen] = useState(false);
  const [isLightAccountDetailOpen, setIsLightAccountDetailOpen] = useState(false);
  const lightchainAvatarUrl = profile?.avatar_url
    || (typeof user?.user_metadata?.avatar_url === 'string' ? user.user_metadata.avatar_url : null)
    || (typeof user?.user_metadata?.picture === 'string' ? user.user_metadata.picture : null);
  
  // Determine if we should show sidebar (only for authenticated users on dashboard pages)
  // Exclude public pages and auth pages
  const isPublicPage = ['/login', '/signup', '/forgot-password', '/'].includes(location.pathname);
  const showSidebar = user && !isPublicPage;
  const lightchainParityAliases = lightchainUnifiedFeatureCatalog
    .flatMap((feature) => [feature.route, ...getLightchainUnifiedRouteAliases(feature.id)])
    .filter((route) => route !== '/brand/settings')
    .concat(['/generate', '/editor/changeColor']);
  const lightchainDirectRoutes = [
    '/marketing',
    '/creator',
    '/agent',
    '/model',
    '/model-library/model-custom-form',
    '/tools/fabric',
    '/tools/printing',
    '/tools/line-draft-to-tile',
    '/tools/line',
    '/tools/pattern-to-vector',
    '/tools/svg-convert',
    '/tools/reactor',
    '/tools/vector-special',
    '/printing',
    '/editor/changeColor',
    '/editor/pattern',
    '/editor/patternDesign',
    '/model-base/style',
    '/designProduction',
    '/flow/integration',
    '/flow/laboratory',
    '/flow/orientedDesign',
    '/asset-center',
    '/canvas/new',
    '/workflows/design-exploration',
    '/workflows/ec-product-set',
    '/workflows/sns-campaign',
    '/flow/GenerateShortVideo',
  ] as const;
  const lightchainWorkspaceRoutes = ['/gallery', '/history', '/jobs'] as const;
  const isLightchainRoute = location.pathname === '/dashboard'
    || location.pathname.startsWith('/lightchain')
    || lightchainParityAliases.some((route) => location.pathname === route || location.pathname.startsWith(`${route}/`))
    || lightchainDirectRoutes.some((route) => location.pathname === route || location.pathname.startsWith(`${route}/`))
    || lightchainWorkspaceRoutes.some((route) => location.pathname === route || location.pathname.startsWith(`${route}/`));
  const isLightchainPrintRoute = location.pathname === '/lightchain/printing-image';

  const handleLightchainSignOut = async () => {
    await signOut();
    setIsLightAccountMenuOpen(false);
    setIsLightAccountDetailOpen(false);
    navigate('/login', { replace: true });
  };

  // Handle scroll for header transparency effects
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setIsLightAccountMenuOpen(false);
    setIsLightAccountDetailOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = isLightchainRoute ? 'Lightchain AI' : 'Heavy Chain | AI制作ワークスペース';
    return () => {
      document.title = previousTitle;
    };
  }, [isLightchainRoute]);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 text-neutral-800 dark:text-neutral-100 font-sans transition-colors duration-700 overflow-x-clip selection:bg-primary-200 selection:text-primary-900">
      {/* Skip Link for Accessibility */}
      <SkipLink />
      
      {/* Keyboard Shortcuts Help */}
      {showSidebar && !isLightchainRoute && <KeyboardShortcuts shortcuts={defaultShortcuts} />}
      
      {showSidebar ? (
        <div className="dark min-h-screen bg-[#070b0d] text-white">
          <header className={`sticky top-0 z-40 border-b border-white/10 bg-[#070b0d]/95 backdrop-blur-xl ${isLightchainRoute ? 'h-[50px]' : ''} ${isLightchainPrintRoute ? 'lightchain-route-header' : ''}`}>
            <div className={`mx-auto flex items-center justify-between gap-4 lightchain-route-header-inner ${isLightchainRoute ? 'h-[49px] max-w-none px-6' : 'h-[70px] max-w-[1800px] px-4 sm:px-6 lg:px-8'}`}>
              <div className={`flex items-center ${isLightchainRoute ? 'gap-4' : 'gap-7'}`}>
                {isLightchainRoute ? (
                  <Link to="/" aria-label="Lightchain AI" className="flex h-6 shrink-0 items-center gap-2 text-[13px] font-semibold tracking-[0.24em] text-white">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/80 bg-white text-[10px] font-black tracking-normal text-neutral-950">◌</span>
                    LIGHTCHAIN
                  </Link>
                ) : (
                  <Link to="/dashboard" className="flex items-center gap-2 text-sm font-semibold tracking-[0.24em] text-white">
                    <HeavyChainLogo height={28} showText={false} className="shrink-0" />
                    HEAVY CHAIN
                  </Link>
                )}
                {isLightchainRoute && (
                  <button
                    type="button"
                    className="hidden h-8 w-[100px] items-center justify-center gap-1 rounded-full px-0 py-1.5 text-sm text-neutral-300 transition hover:bg-white/10 hover:text-white sm:inline-flex"
                    aria-label="日本語"
                  >
                    <Globe2 className="h-4 w-4" />
                    日本語
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                )}
                {!isLightchainRoute && (
                  <div className="hidden items-center gap-2 text-sm text-neutral-300 md:flex">
                    {lightchainCategories.map((category) => (
                      <Link
                        key={category.id}
                        to={`/lightchain?category=${category.id}`}
                        className="rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white"
                      >
                        {category.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              <div className={`flex items-center text-neutral-300 ${isLightchainRoute ? 'gap-4' : 'gap-2'}`}>
                {!isLightchainRoute && (
                  <Link to="/history" className="hidden items-center gap-2 rounded-full px-3 py-2 text-sm transition hover:bg-white/10 hover:text-white sm:flex">
                    <History className="h-4 w-4" />
                    生成履歴
                  </Link>
                )}
                {isLightchainRoute ? (
                  <button
                    type="button"
                    className="hidden h-8 w-[132px] items-center justify-center gap-2 rounded-full px-0 py-1.5 text-sm text-neutral-300 transition hover:bg-white/10 hover:text-white sm:inline-flex"
                    aria-label="ヘルプセンター"
                  >
                    <HelpCircle className="h-4 w-4" />
                    ヘルプセンター
                  </button>
                ) : (
                  <Link to="/jobs" className="hidden items-center gap-2 rounded-full px-3 py-2 text-sm transition hover:bg-white/10 hover:text-white sm:flex">
                    <HelpCircle className="h-4 w-4" />
                    ジョブ
                  </Link>
                )}
                {isLightchainRoute ? (
                  <div className="flex h-8 w-[61px] items-center justify-end border-l border-white/10 pl-4">
                    <div className="relative">
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[#62666a]/90 text-[#202426] transition hover:bg-[#74797d]"
                      aria-label="avatar"
                      aria-expanded={isLightAccountMenuOpen}
                      onClick={() => setIsLightAccountMenuOpen((open) => !open)}
                    >
                      {lightchainAvatarUrl ? (
                        <img src={lightchainAvatarUrl} alt="avatar" className="h-full w-full rounded-full object-cover" />
                      ) : (
                        <User className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                      )}
                    </button>
                    {isLightAccountMenuOpen && (
                      <div className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-2xl border border-neutral-200 bg-white py-2 text-sm text-neutral-800 shadow-2xl">
                        {isLightAccountDetailOpen ? (
                          <>
                            <button type="button" onClick={() => setIsLightAccountDetailOpen(false)} className="flex w-full items-center gap-2 px-4 py-3 text-left font-semibold transition hover:bg-neutral-100">
                              <span aria-hidden="true">‹</span> アカウント
                            </button>
                            <div className="border-t border-neutral-200 px-4 py-3">
                              <p className="font-semibold">マイアカウント</p>
                              <p className="mt-3 font-medium">{typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : 'ユーザー'}</p>
                              <p className="mt-1 text-xs text-neutral-500">{user?.email ?? ''}</p>
                              <Link to="/change-password" className="mt-4 block text-xs text-neutral-600 underline transition hover:text-neutral-900">パスワードを変更する</Link>
                            </div>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => setIsLightAccountDetailOpen(true)} className="block w-full px-4 py-3 text-left transition hover:bg-neutral-100">マイアカウント</button>
                            <Link to="/designProduction" className="block px-4 py-3 transition hover:bg-neutral-100">デザインドキュメント</Link>
                            <Link to="/asset-center" className="block px-4 py-3 transition hover:bg-neutral-100">ライブラリー</Link>
                            <Link to="/brand/settings" className="block px-4 py-3 transition hover:bg-neutral-100">チーム管理</Link>
                            <div className="my-1 border-t border-neutral-200" />
                            <button type="button" className="block w-full px-4 py-3 text-left text-neutral-500 transition hover:bg-neutral-100">透かし（ウォーターマーク）表示</button>
                            <button type="button" onClick={() => void handleLightchainSignOut()} className="block w-full px-4 py-3 text-left text-neutral-500 transition hover:bg-neutral-100">ログアウト</button>
                          </>
                        )}
                      </div>
                    )}
                    </div>
                  </div>
                ) : (
                  <Link to="/brand/settings" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/15" aria-label="アカウント">
                    <UserCircle className="h-5 w-5" />
                  </Link>
                )}
              </div>
            </div>
            {!isLightchainRoute && (
              <div className="flex gap-2 overflow-x-auto px-4 pb-3 md:hidden">
                {lightchainCategories.map((category) => (
                  <Link
                    key={category.id}
                    to={`/lightchain?category=${category.id}`}
                    className="shrink-0 rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-neutral-200"
                  >
                    {category.label}
                  </Link>
                ))}
              </div>
            )}
          </header>

          <main id="main-content" className={`${isLightchainPrintRoute ? 'min-h-[calc(100vh-48px)] bg-[#070b0d]' : isLightchainRoute ? 'min-h-[calc(100vh-50px)] bg-[#171b1c]' : 'min-h-[calc(100vh-70px)] bg-[#070b0d]'} ${isLightchainRoute ? 'px-0 py-0' : 'px-3 py-5 sm:px-5 lg:px-8'}`} tabIndex={-1}>
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className={isLightchainRoute ? 'w-full' : 'mx-auto w-full max-w-[1800px]'}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
          {!isLightchainRoute && <FeedbackButton />}
        </div>
      ) : (
        <>
          <div className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${scrolled ? 'glass-nav py-2' : 'bg-transparent py-4'}`}>
            <Header />
          </div>
          <main id="main-content" className="pt-20 min-h-screen" tabIndex={-1}>
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, filter: "blur(10px)" }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
        </>
      )}
      
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          className: '!bg-white/90 !backdrop-blur-xl !border !border-white/50 !shadow-elegant !rounded-2xl !text-neutral-800 dark:!bg-surface-900/90 dark:!border-surface-700 dark:!text-white font-medium',
          style: {
            padding: '16px 24px',
          },
          success: {
            iconTheme: {
              primary: '#c58851', // Gold
              secondary: '#fff',
            },
          },
          error: {
            iconTheme: {
              primary: '#b03a3a', // Burgundy
              secondary: '#fff',
            },
          },
        }}
      />
    </div>
  );
}
