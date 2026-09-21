import { useState, useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
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
import { LightchainLogo } from '../LightchainLogo';
import { ChevronDown, Globe2, HelpCircle, History, UserCircle } from 'lucide-react';

// Source logo provenance: src="/assets/lightchain-logo.svg". The inline component avoids a remote asset dependency.

export function Layout() {
  const { user } = useAuthStore();
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  
  // Determine if we should show sidebar (only for authenticated users on dashboard pages)
  // Exclude public pages and auth pages
  const isPublicPage = ['/login', '/login-m', '/signup', '/forgot-password', '/'].includes(location.pathname);
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
    '/model-library',
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

  // Handle scroll for header transparency effects
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = isLightchainRoute ? 'Lightchain AI' : 'Heavy Chain | AI制作ワークスペース';
    return () => {
      document.title = previousTitle;
    };
  }, [isLightchainRoute]);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 text-neutral-800 dark:text-neutral-100 font-sans transition-colors duration-700 overflow-x-clip selection:bg-primary-200 selection:text-primary-900">
      {/* Lightchain's source header does not render the global skip-link control. */}
      {!isLightchainRoute && <SkipLink />}
      
      {/* Keyboard Shortcuts Help */}
      {showSidebar && !isLightchainRoute && <KeyboardShortcuts shortcuts={defaultShortcuts} />}
      
      {showSidebar ? (
        <div className={`dark min-h-screen bg-[#070b0d] text-white ${isLightchainRoute ? 'flex h-screen flex-col overflow-hidden' : ''}`}>
          <header className={`sticky top-0 z-40 border-b border-white/10 bg-[#070b0d]/95 backdrop-blur-xl ${isLightchainRoute ? 'h-[50px]' : ''} ${isLightchainPrintRoute ? 'lightchain-route-header' : ''}`}>
            <div className={`mx-auto flex items-center justify-between gap-4 lightchain-route-header-inner ${isLightchainRoute ? 'h-[49px] max-w-none px-6' : 'h-[70px] max-w-[1800px] px-4 sm:px-6 lg:px-8'}`}>
              <div className={`flex items-center ${isLightchainRoute ? 'gap-4' : 'gap-7'}`}>
                {isLightchainRoute ? (
                  <Link to="/" aria-label="Lightchain AI" className="flex h-6 shrink-0 items-center text-white">
                    <LightchainLogo />
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
                        to={`/designProduction?category=${category.id}`}
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
                {!isLightchainRoute && (
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
                    to={`/designProduction?category=${category.id}`}
                    className="shrink-0 rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-neutral-200"
                  >
                    {category.label}
                  </Link>
                ))}
              </div>
            )}
          </header>

          <main id="main-content" className={`${isLightchainPrintRoute ? 'min-h-[calc(100vh-48px)] bg-[#070b0d]' : isLightchainRoute ? 'min-h-0 flex-1 overflow-y-auto scrollbar-hide bg-[#171b1c]' : 'min-h-[calc(100vh-70px)] bg-[#070b0d]'} ${isLightchainRoute ? 'px-0 py-0' : 'px-3 py-5 sm:px-5 lg:px-8'}`} tabIndex={-1}>
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
