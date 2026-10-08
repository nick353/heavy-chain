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
import { ChevronDown, ChevronLeft, FileText, FolderOpen, Globe2, HelpCircle, LogOut, Stamp, User, UserCircle, UserRound, Users } from 'lucide-react';
import { isHeavyWorkspaceRuntime } from '../../lib/heavyWorkspace';
import { FaqPanel, HelpMenu, LanguageMenu, NotificationsPanel, useHeavyNotificationsSeen } from './LightchainHeaderMenus';

// Heavy Chain owns the visible identity; parity route identifiers remain internal compatibility details.

export function Layout() {
  const { user, profile, signOut, isLoading, isInitialized, authRecoveryRequired, authServiceUnavailable } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [isLightAccountMenuOpen, setIsLightAccountMenuOpen] = useState(false);
  const [isLightAccountDetailOpen, setIsLightAccountDetailOpen] = useState(false);
  const currentBrand = useAuthStore((state) => state.currentBrand);
  const lightchainUserName = (typeof user?.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim())
    || user?.email?.split('@')[0] || 'ユーザー';
  // Light's 透かし toggle is a per-user display preference; Heavy keeps it per user in this browser.
  const watermarkKey = user?.id ? `heavy:watermark-display:v1:${user.id}` : null;
  const [watermarkOn, setWatermarkOn] = useState(false);
  useEffect(() => {
    try { setWatermarkOn(Boolean(watermarkKey && localStorage.getItem(watermarkKey) === '1')); } catch { setWatermarkOn(false); }
  }, [watermarkKey]);
  const toggleWatermark = () => {
    const next = !watermarkOn;
    setWatermarkOn(next);
    try { if (watermarkKey) localStorage.setItem(watermarkKey, next ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  // Header dropdowns (language / help) and the full-screen panels the help menu opens.
  const [headerMenu, setHeaderMenu] = useState<'language' | 'help' | null>(null);
  const [helpPanel, setHelpPanel] = useState<'notifications' | 'faq' | null>(null);
  const notifications = useHeavyNotificationsSeen(user?.id);
  useEffect(() => {
    if (!headerMenu) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.('[data-light-header-menu]')) setHeaderMenu(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setHeaderMenu(null); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', onKey); };
  }, [headerMenu]);
  const openHelpPanel = (panel: 'notifications' | 'faq') => {
    setHeaderMenu(null);
    if (panel === 'notifications') notifications.markSeen();
    setHelpPanel(panel);
  };
  useEffect(() => {
    if (!isLightAccountMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.('[data-light-account-menu]')) { setIsLightAccountMenuOpen(false); setIsLightAccountDetailOpen(false); }
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [isLightAccountMenuOpen]);
  const lightMenuItem = 'flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-neutral-200 transition hover:bg-white/10 hover:text-white';
  const lightchainAvatarUrl = profile?.avatar_url
    || (typeof user?.user_metadata?.avatar_url === 'string' ? user.user_metadata.avatar_url : null)
    || (typeof user?.user_metadata?.picture === 'string' ? user.user_metadata.picture : null)
    || '/lightchain-assets/mirror/ql-hangzhou-oss/saas-avatar-new-35182e5e.webp';
  
  // Determine if we should show sidebar (only for authenticated users on dashboard pages)
  // Exclude public pages and auth pages
  const isPublicPage = ['/login', '/login-m', '/signup', '/forget-password', '/forgot-password', '/'].includes(location.pathname);
  // The Heavy deployment uses the Light Chain workspace frame for every
  // authenticated screen, including legacy Heavy aliases and settings/
  // workspace routes. Keep the public auth/legal pages on their own shell.
  // This is a visual/layout decision only; Heavy ownership and provider
  // boundaries remain enforced by the routed pages and API.
  const isHeavyWorkspacePage = isHeavyWorkspaceRuntime() && !isPublicPage;
  const showSidebar = Boolean(user && !isPublicPage);
  // Protected routes must not flash the public login CTA while a valid
  // host-only session is being hydrated. The canonical Lightchain workspace
  // keeps the authenticated shell continuous; the route guard owns the
  // eventual redirect only after auth has conclusively resolved.
  const hidePendingProtectedChrome = Boolean(
    !user && !isPublicPage && (!isInitialized || isLoading || authRecoveryRequired || authServiceUnavailable),
  );
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
    '/board',
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
  const isLightchainRoute = isHeavyWorkspacePage
    || location.pathname === '/dashboard'
    || location.pathname.startsWith('/lightchain')
    || lightchainParityAliases.some((route) => location.pathname === route || location.pathname.startsWith(`${route}/`))
    || lightchainDirectRoutes.some((route) => location.pathname === route || location.pathname.startsWith(`${route}/`))
    || lightchainWorkspaceRoutes.some((route) => location.pathname === route || location.pathname.startsWith(`${route}/`));
  const isVideoWorkstationRoute = location.pathname === '/flow/GenerateShortVideo'
    || location.pathname.startsWith('/flow/GenerateShortVideo/');
  const isLightchainPrintRoute = location.pathname === '/lightchain/printing-image'
    || (isHeavyWorkspacePage && location.pathname.endsWith('/printing-image'));

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
    const previousTitle = document.title;
    document.title = isLightchainRoute ? 'Heavy Chain AI' : 'Heavy Chain | AI制作ワークスペース';
    return () => {
      document.title = previousTitle;
    };
  }, [isLightchainRoute]);

  useEffect(() => {
    setIsLightAccountMenuOpen(false);
    setIsLightAccountDetailOpen(false);
    setHeaderMenu(null);
  }, [location.pathname, location.search]);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 text-neutral-800 dark:text-neutral-100 font-sans transition-colors duration-700 overflow-x-clip selection:bg-primary-200 selection:text-primary-900">
      {/* The compact source-compatible header does not render the global skip-link control. */}
      {!isLightchainRoute && <SkipLink />}
      
      {/* Keyboard Shortcuts Help */}
      {showSidebar && !isLightchainRoute && <KeyboardShortcuts shortcuts={defaultShortcuts} />}
      
      {showSidebar ? (
        <div className={`dark min-h-screen bg-[#070b0d] text-white ${isLightchainRoute ? 'flex h-screen flex-col overflow-hidden' : ''}`}>
          <header className={`sticky top-0 z-40 border-b border-white/10 bg-[#070b0d]/95 backdrop-blur-xl ${isLightchainRoute ? 'h-[50px]' : ''} ${isLightchainPrintRoute ? 'lightchain-route-header' : ''}`}>
            <div className={`mx-auto flex items-center justify-between gap-4 lightchain-route-header-inner ${isLightchainRoute ? 'h-[49px] max-w-none px-6' : 'h-[70px] max-w-[1800px] px-4 sm:px-6 lg:px-8'}`}>
              <div className={`flex items-center ${isLightchainRoute ? 'gap-4' : 'gap-7'}`}>
                {isLightchainRoute ? (
                  <Link to="/" aria-label="Heavy Chain" className="flex h-6 shrink-0 items-center text-white">
                    <HeavyChainLogo height={24} showText className="shrink-0" />
                  </Link>
                ) : (
                  <Link to="/dashboard" className="flex items-center gap-2 text-sm font-semibold tracking-[0.24em] text-white">
                    <HeavyChainLogo height={28} showText={false} className="shrink-0" />
                    HEAVY CHAIN
                  </Link>
                )}
                {isLightchainRoute && (
                  <div className="relative hidden sm:block" data-light-header-menu>
                    <button
                      type="button"
                      className={`inline-flex h-8 w-[100px] items-center justify-center gap-1 rounded-full px-0 py-1.5 text-sm transition hover:bg-white/10 hover:text-white ${headerMenu === 'language' ? 'bg-white/10 text-white' : 'text-neutral-300'}`}
                      aria-label="日本語"
                      aria-haspopup="menu"
                      aria-expanded={headerMenu === 'language'}
                      onClick={() => setHeaderMenu((open) => (open === 'language' ? null : 'language'))}
                    >
                      <Globe2 className="h-4 w-4" />
                      日本語
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    {headerMenu === 'language' && <LanguageMenu onClose={() => setHeaderMenu(null)} />}
                  </div>
                )}
                {/* Pages such as the design-document editor put their breadcrumb here (Light shows it next to the language menu). */}
                {isLightchainRoute && <div id="lightchain-header-context" className="contents" />}
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
                {isLightchainRoute ? (
                  <div className="relative hidden sm:block" data-light-header-menu>
                    <button
                      type="button"
                      className={`relative inline-flex h-8 w-[132px] items-center justify-center gap-2 rounded-full px-0 py-1.5 text-sm transition hover:bg-white/10 hover:text-white ${headerMenu === 'help' ? 'bg-white/10 text-white' : 'text-neutral-300'}`}
                      aria-label="ヘルプセンター"
                      aria-haspopup="menu"
                      aria-expanded={headerMenu === 'help'}
                      onClick={() => setHeaderMenu((open) => (open === 'help' ? null : 'help'))}
                    >
                      <HelpCircle className="h-4 w-4" />
                      ヘルプセンター
                    </button>
                    {headerMenu === 'help' && <HelpMenu unread={notifications.unread} onOpen={openHelpPanel} />}
                  </div>
                ) : null}
                {isLightchainRoute && <div id="lightchain-header-actions" className="contents" />}
                {isLightchainRoute ? (
                  // Light: a 16px rule (8px after help, 16px before the avatar), then the 32px avatar with a 4px right margin.
                  <div className="flex h-8 w-[61px] items-center">
                    <div className="ml-2 mr-4 h-4 w-px bg-white/10" aria-hidden="true" />
                    <div className="relative" data-light-account-menu>
                      <button
                        type="button"
                        className="mr-1 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[#62666a]/90 text-[#202426] transition hover:bg-[#74797d]"
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
                        // Light: a 240px dark menu under the avatar — account card, then groups split by rules.
                        <div role="menu" className="absolute right-0 top-[42px] z-50 w-60 rounded-xl border border-white/10 bg-[#2b2f31] px-3 py-[9px] text-sm text-neutral-200 shadow-2xl">
                          {isLightAccountDetailOpen ? (
                            <>
                              <button type="button" onClick={() => setIsLightAccountDetailOpen(false)} className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left font-semibold transition hover:bg-white/10">
                                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> マイアカウント
                              </button>
                              <div className="my-3 h-px bg-white/10" />
                              <div className="px-3 pb-2">
                                <p className="font-medium text-white">{lightchainUserName}</p>
                                <p className="mt-1 break-all text-xs text-neutral-400">{user?.email ?? ''}</p>
                                <Link to="/change-password" className="mt-4 block text-xs text-neutral-300 underline transition hover:text-white">パスワードを変更する</Link>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex h-[72px] items-center gap-2">
                                <img src={lightchainAvatarUrl} alt="avatar" className="size-12 shrink-0 rounded-full object-cover" />
                                <div className="min-w-0 px-2">
                                  <p className="truncate text-base leading-6 text-white">{lightchainUserName}</p>
                                  <p className="mt-1 truncate text-xs leading-4 text-neutral-400">{currentBrand?.name ?? ''}</p>
                                </div>
                              </div>
                              <div className="my-3 h-px bg-white/10" />
                              <button type="button" role="menuitem" onClick={() => setIsLightAccountDetailOpen(true)} className={lightMenuItem}><UserRound className="h-5 w-5" aria-hidden="true" />マイアカウント</button>
                              <div className="my-3 h-px bg-white/10" />
                              <div className="flex flex-col gap-1">
                                <Link to="/board" role="menuitem" onClick={() => setIsLightAccountMenuOpen(false)} className={lightMenuItem}><FileText className="h-5 w-5" aria-hidden="true" /><span>デザインドキュメント</span></Link>
                                <Link to="/asset-center" role="menuitem" onClick={() => setIsLightAccountMenuOpen(false)} className={lightMenuItem}><FolderOpen className="h-5 w-5" aria-hidden="true" /><span>ライブラリー</span></Link>
                              </div>
                              <div className="my-3 h-px bg-white/10" />
                              <Link to="/brand/settings" role="menuitem" onClick={() => setIsLightAccountMenuOpen(false)} className={lightMenuItem}><Users className="h-5 w-5" aria-hidden="true" /><span>チーム管理</span></Link>
                              <div className="my-3 h-px bg-white/10" />
                              <button type="button" role="menuitemcheckbox" aria-checked={watermarkOn} onClick={toggleWatermark} className={`${lightMenuItem} h-16`}>
                                <Stamp className="h-5 w-5 shrink-0" aria-hidden="true" />
                                <span className="flex-1 text-left">透かし（ウォーターマーク）表示</span>
                                <span aria-hidden="true" className={`relative h-4 w-7 shrink-0 rounded-full transition ${watermarkOn ? 'bg-[#5fcfc4]' : 'bg-white/25'}`}><span className={`absolute top-0.5 size-3 rounded-full bg-white transition ${watermarkOn ? 'left-3.5' : 'left-0.5'}`} /></span>
                              </button>
                              <div className="my-3 h-px bg-white/10" />
                              <button type="button" role="menuitem" onClick={() => void handleLightchainSignOut()} className={lightMenuItem}><LogOut className="h-5 w-5" aria-hidden="true" />ログアウト</button>
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
                    to={`/designProduction?category=${category.id}`}
                    className="shrink-0 rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-neutral-200"
                  >
                    {category.label}
                  </Link>
                ))}
              </div>
            )}
          </header>
          {helpPanel === 'notifications' && <NotificationsPanel onClose={() => setHelpPanel(null)} />}
          {helpPanel === 'faq' && <FaqPanel onClose={() => setHelpPanel(null)} />}

          <main id="main-content" className={`${isLightchainPrintRoute ? 'min-h-[calc(100vh-48px)] bg-[#070b0d]' : isLightchainRoute ? 'min-h-0 flex-1 overflow-y-auto scrollbar-hide bg-[#171b1c]' : 'min-h-[calc(100vh-70px)] bg-[#070b0d]'} ${isLightchainRoute ? 'px-0 py-0' : 'px-3 py-5 sm:px-5 lg:px-8'}`} tabIndex={-1}>
            {isVideoWorkstationRoute || isLightchainRoute ? (
              // The Light Chain shell does not fade route content in. Keeping
              // the source-shaped routes in a direct wrapper also prevents a
              // hidden-tab capture/restore from leaving the page at the
              // motion component's initial opacity of 0.
              <div className="w-full"><Outlet /></div>
            ) : (
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
            )}
          </main>
          {!isLightchainRoute && <FeedbackButton />}
        </div>
      ) : hidePendingProtectedChrome ? (
        <main id="main-content" className="min-h-screen bg-[#05090b]" tabIndex={-1}>
          <Outlet />
        </main>
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
