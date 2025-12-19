import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { MobileHeader } from './MobileHeader';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import { motion, AnimatePresence } from 'framer-motion';
import { FeedbackButton } from '../ui/FeedbackForm';
import { SkipLink, KeyboardShortcuts, defaultShortcuts } from '../ui';

export function Layout() {
  const { user } = useAuthStore();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  
  // Determine if we should show sidebar (only for authenticated users on dashboard pages)
  // Exclude public pages and auth pages
  const isPublicPage = ['/login', '/signup', '/forgot-password', '/'].includes(location.pathname);
  const showSidebar = user && !isPublicPage;

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // Close mobile menu on window resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
      
      {/* Grainy Texture Overlay for Film Look */}
      <div className="grain-overlay" />

      {/* Ambient Background Lights - Dynamic & Organic */}
      <div className="fixed inset-0 overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-20%] right-[-10%] w-[80vw] h-[80vw] max-w-[800px] max-h-[800px] rounded-full bg-gradient-to-br from-primary-200/30 to-transparent blur-[100px] dark:from-primary-900/20 animate-float mix-blend-multiply dark:mix-blend-screen" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[70vw] h-[70vw] max-w-[700px] max-h-[700px] rounded-full bg-gradient-to-tr from-accent-200/20 to-transparent blur-[120px] dark:from-accent-900/20 animate-float-delayed mix-blend-multiply dark:mix-blend-screen" />
        <div className="absolute top-[40%] left-[20%] w-[40vw] h-[40vw] max-w-[400px] max-h-[400px] rounded-full bg-gold-light/10 blur-[80px] animate-pulse-slow mix-blend-overlay dark:mix-blend-normal" />
      </div>

      {showSidebar ? (
        <div className="flex min-h-screen relative z-10">
          {/* Mobile Header */}
          <MobileHeader
            isMenuOpen={isMobileMenuOpen}
            onMenuToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          />

          {/* Mobile Overlay */}
          <AnimatePresence>
            {isMobileMenuOpen && (
              <motion.div
                initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
                animate={{ opacity: 1, backdropFilter: "blur(4px)" }}
                exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
                onClick={() => setIsMobileMenuOpen(false)}
                className="lg:hidden fixed inset-0 z-40 bg-black/20 dark:bg-black/60"
              />
            )}
          </AnimatePresence>

          {/* Sidebar - Desktop: always visible, Mobile: slide in/out */}
          {/* Desktop Sidebar */}
          <div className="hidden lg:block sticky top-0 h-screen overflow-y-auto scrollbar-hide">
            <Sidebar />
          </div>
          
          {/* Mobile Sidebar Drawer */}
          <AnimatePresence>
            {isMobileMenuOpen && (
              <motion.div
                initial={{ x: -320, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -320, opacity: 0 }}
                transition={{ type: "spring", damping: 30, stiffness: 300 }}
                className="lg:hidden fixed left-0 top-0 z-50 h-screen shadow-2xl"
              >
                <Sidebar />
              </motion.div>
            )}
          </AnimatePresence>

          <main id="main-content" className="flex-1 w-full min-w-0 p-4 pt-16 pb-20 lg:pt-8 lg:pb-10 lg:p-10 transition-all duration-500 relative perspective-1000" tabIndex={-1}>
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.98, filter: "blur(10px)" }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="w-full max-w-7xl mx-auto"
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>

          {/* Mobile Bottom Navigation */}
          <MobileNav />

          {/* Feedback Button */}
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
