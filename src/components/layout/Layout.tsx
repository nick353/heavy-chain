import { useState, useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import { motion, AnimatePresence } from 'framer-motion';
import { FeedbackButton } from '../ui/FeedbackForm';
import { SkipLink, KeyboardShortcuts, defaultShortcuts } from '../ui';
import { lightchainCategories } from '../../lib/lightchainParityCatalog';
import { HelpCircle, History, UserCircle } from 'lucide-react';

export function Layout() {
  const { user } = useAuthStore();
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  
  // Determine if we should show sidebar (only for authenticated users on dashboard pages)
  // Exclude public pages and auth pages
  const isPublicPage = ['/login', '/signup', '/forgot-password', '/'].includes(location.pathname);
  const showSidebar = user && !isPublicPage;

  // Handle scroll for header transparency effects
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 text-neutral-800 dark:text-neutral-100 font-sans transition-colors duration-700 overflow-x-hidden selection:bg-primary-200 selection:text-primary-900">
      {/* Skip Link for Accessibility */}
      <SkipLink />
      
      {/* Keyboard Shortcuts Help */}
      {showSidebar && <KeyboardShortcuts shortcuts={defaultShortcuts} />}
      
      {showSidebar ? (
        <div className="dark min-h-screen bg-[#070b0d] text-white">
          <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070b0d]/95 backdrop-blur-xl">
            <div className="mx-auto flex h-[70px] max-w-[1800px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
              <div className="flex items-center gap-7">
                <Link to="/dashboard" className="text-sm font-semibold tracking-[0.32em] text-white">
                  HEAVYCHAIN
                </Link>
                <div className="hidden items-center gap-2 text-sm text-neutral-300 md:flex">
                  {lightchainCategories.map((category) => (
                    <Link
                      key={category.id}
                      to={`/generate?category=${category.id}`}
                      className="rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white"
                    >
                      {category.label}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 text-neutral-300">
                <Link to="/history" className="hidden items-center gap-2 rounded-full px-3 py-2 text-sm transition hover:bg-white/10 hover:text-white sm:flex">
                  <History className="h-4 w-4" />
                  生成履歴
                </Link>
                <Link to="/jobs" className="hidden items-center gap-2 rounded-full px-3 py-2 text-sm transition hover:bg-white/10 hover:text-white sm:flex">
                  <HelpCircle className="h-4 w-4" />
                  ジョブ
                </Link>
                <Link to="/brand/settings" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/15" aria-label="アカウント">
                  <UserCircle className="h-5 w-5" />
                </Link>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto px-4 pb-3 md:hidden">
              {lightchainCategories.map((category) => (
                <Link
                  key={category.id}
                  to={`/generate?category=${category.id}`}
                  className="shrink-0 rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-neutral-200"
                >
                  {category.label}
                </Link>
              ))}
            </div>
          </header>

          <main id="main-content" className="min-h-[calc(100vh-70px)] bg-[#070b0d] px-3 py-5 sm:px-5 lg:px-8" tabIndex={-1}>
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="mx-auto w-full max-w-[1800px]"
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
          <FeedbackButton />
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
