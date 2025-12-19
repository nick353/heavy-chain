import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, Bell, Moon, Sun } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { HeavyChainLogo } from '../icons';

interface MobileHeaderProps {
  onMenuToggle: () => void;
  isMenuOpen: boolean;
}

export function MobileHeader({ onMenuToggle, isMenuOpen }: MobileHeaderProps) {
  const location = useLocation();
  const { profile } = useAuthStore();
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [hasNotifications] = useState(true); // Demo

  useEffect(() => {
    const saved = localStorage.getItem('darkMode');
    setIsDarkMode(saved === 'true');
  }, []);

  const toggleDarkMode = () => {
    const newValue = !isDarkMode;
    setIsDarkMode(newValue);
    localStorage.setItem('darkMode', String(newValue));
    if (newValue) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const getPageTitle = () => {
    const path = location.pathname;
    if (path === '/dashboard') return 'ダッシュボード';
    if (path === '/generate') return '画像生成';
    if (path.startsWith('/canvas')) return 'キャンバス';
    if (path === '/gallery') return 'ギャラリー';
    if (path === '/brand/settings') return 'ブランド設定';
    return 'Heavy Chain';
  };

  return (
    <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white/90 dark:bg-surface-900/90 backdrop-blur-xl border-b border-neutral-200/50 dark:border-white/10">
      <div className="flex items-center justify-between h-14 px-4">
        {/* Left: Menu button */}
        <button
          onClick={onMenuToggle}
          className="p-2 -ml-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors"
          aria-label={isMenuOpen ? 'メニューを閉じる' : 'メニューを開く'}
        >
          <AnimatePresence mode="wait">
            {isMenuOpen ? (
              <motion.div
                key="close"
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <X className="w-6 h-6 text-neutral-700 dark:text-neutral-300" />
              </motion.div>
            ) : (
              <motion.div
                key="menu"
                initial={{ rotate: 90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: -90, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Menu className="w-6 h-6 text-neutral-700 dark:text-neutral-300" />
              </motion.div>
            )}
          </AnimatePresence>
        </button>

        {/* Center: Title or Logo */}
        <div className="flex-1 flex items-center justify-center">
          <Link to="/dashboard" className="flex items-center">
            <HeavyChainLogo height={28} showText={false} />
            <span className="ml-2 font-display font-semibold text-neutral-900 dark:text-white">
              {getPageTitle()}
            </span>
          </Link>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          {/* Dark mode toggle */}
          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors"
            aria-label={isDarkMode ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
          >
            {isDarkMode ? (
              <Sun className="w-5 h-5 text-amber-500" />
            ) : (
              <Moon className="w-5 h-5 text-neutral-500" />
            )}
          </button>

          {/* Notifications */}
          <button
            className="relative p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors"
            aria-label="通知"
          >
            <Bell className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
            {hasNotifications && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
            )}
          </button>

          {/* Profile */}
          <Link
            to="/brand/settings"
            className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary-400 to-gold-DEFAULT p-[2px] ml-1"
          >
            <div className="w-full h-full rounded-full overflow-hidden bg-white dark:bg-surface-900">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={profile.name || 'プロフィール'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-neutral-100 dark:bg-neutral-800 text-neutral-500 text-xs font-medium">
                  {profile?.name?.[0] || 'U'}
                </div>
              )}
            </div>
          </Link>
        </div>
      </div>
    </header>
  );
}
