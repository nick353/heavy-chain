import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';

export function Layout() {
  const { user } = useAuthStore();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
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

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 text-neutral-800 dark:text-neutral-100 font-sans transition-colors duration-500 overflow-x-hidden">
      {showSidebar ? (
        <div className="flex min-h-screen">
          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="lg:hidden fixed top-4 left-4 z-[60] p-2 rounded-xl bg-white/80 dark:bg-surface-900/80 backdrop-blur-md shadow-soft border border-white/50 dark:border-surface-700"
          >
            {isMobileMenuOpen ? (
              <X className="w-6 h-6 text-neutral-700 dark:text-neutral-300" />
            ) : (
              <Menu className="w-6 h-6 text-neutral-700 dark:text-neutral-300" />
            )}
          </button>

          {/* Mobile Overlay */}
          <AnimatePresence>
            {isMobileMenuOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsMobileMenuOpen(false)}
                className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
              />
            )}
          </AnimatePresence>

          {/* Sidebar - Desktop: always visible, Mobile: slide in/out */}
          {/* Desktop Sidebar */}
          <div className="hidden lg:block">
            <Sidebar />
          </div>
          
          {/* Mobile Sidebar */}
          <AnimatePresence>
            {isMobileMenuOpen && (
              <motion.div
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="lg:hidden fixed left-0 top-0 z-50 h-screen"
              >
                <Sidebar />
              </motion.div>
            )}
          </AnimatePresence>

          <main className="flex-1 ml-0 lg:ml-[280px] p-4 pt-16 lg:pt-8 lg:p-12 transition-all duration-500 relative">
            {/* Background decorative elements */}
            <div className="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
              <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-primary-200/20 blur-[100px] dark:bg-primary-900/10 animate-float" />
              <div className="absolute bottom-[-10%] left-[-5%] w-[600px] h-[600px] rounded-full bg-accent-200/20 blur-[120px] dark:bg-accent-900/10 animate-pulse-slow" />
              <div className="absolute top-[40%] left-[30%] w-[300px] h-[300px] rounded-full bg-gold-light/10 blur-[80px] animate-float" style={{ animationDelay: '2s' }} />
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="w-full max-w-7xl mx-auto"
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      ) : (
        <>
          <Header />
          <main>
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
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
          className: '!bg-white/80 !backdrop-blur-md !border !border-white/50 !shadow-elegant !rounded-xl !text-neutral-800 dark:!bg-surface-900/80 dark:!border-surface-700 dark:!text-white',
          style: {
            padding: '16px',
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
