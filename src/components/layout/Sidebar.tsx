import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  Layers, 
  Home, 
  Sparkles, 
  Image as ImageIcon, 
  Settings, 
  LogOut, 
  Users, 
  ChevronRight,
  Moon,
  Sun,
  PenTool
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuthStore } from '../../stores/authStore';
import clsx from 'clsx';

interface SidebarProps {
  collapsed?: boolean;
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const location = useLocation();
  const { user, profile, signOut, currentBrand } = useAuthStore();
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('darkMode');
    if (saved === 'true') {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    }
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

  const isActive = (path: string) => {
    if (path === '/dashboard' && location.pathname === '/dashboard') return true;
    if (path !== '/dashboard' && location.pathname.startsWith(path)) return true;
    return false;
  };

  const menuItems = [
    { icon: Home, label: 'ダッシュボード', path: '/dashboard' },
    { icon: Sparkles, label: '画像生成', path: '/generate' },
    { icon: PenTool, label: 'キャンバス', path: '/canvas' },
    { icon: ImageIcon, label: 'ギャラリー', path: '/gallery' },
  ];

  const bottomItems = [
    { icon: Users, label: 'チーム管理', path: '/brand/settings' },
    { icon: Settings, label: '設定', path: '/settings' },
  ];

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 80 : 280 }}
      className={clsx(
        "fixed left-0 top-0 h-screen z-50 w-[280px]",
        "glass-panel border-r border-white/20",
        "flex flex-col transition-all duration-500 ease-out"
      )}
    >
      {/* Logo Area */}
      <div className="h-20 flex items-center px-6 border-b border-white/10">
        <Link to="/dashboard" className="flex items-center gap-3 group">
          <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center shadow-glow group-hover:shadow-elegant transition-all duration-500">
            <Layers className="w-6 h-6 text-white" />
          </div>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="font-display text-xl font-medium text-primary-900 dark:text-primary-100 tracking-wide"
            >
              Heavy Chain
            </motion.span>
          )}
        </Link>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 py-8 px-4 space-y-2 overflow-y-auto scrollbar-hide">
        {menuItems.map((item) => {
          const active = isActive(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={clsx(
                "relative flex items-center gap-3 px-4 py-3.5 rounded-xl group transition-all duration-300",
                active 
                  ? "text-primary-900 dark:text-white bg-white/50 dark:bg-white/10 shadow-soft" 
                  : "text-neutral-600 dark:text-neutral-400 hover:bg-white/30 dark:hover:bg-white/5 hover:text-primary-800 dark:hover:text-primary-200"
              )}
            >
              {active && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute left-0 w-1 h-8 bg-primary-500 rounded-r-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                />
              )}
              <item.icon className={clsx(
                "w-5 h-5 transition-colors duration-300",
                active ? "text-primary-600 dark:text-primary-400" : "text-neutral-400 group-hover:text-primary-500"
              )} />
              {!collapsed && (
                <span className="font-medium tracking-wide">{item.label}</span>
              )}
              {!collapsed && active && (
                <ChevronRight className="w-4 h-4 ml-auto text-primary-400" />
              )}
            </Link>
          );
        })}

        <div className="pt-8 pb-2 px-4">
          {!collapsed && (
            <p className="text-xs font-medium text-neutral-400 uppercase tracking-widest-plus mb-4">
              Management
            </p>
          )}
        </div>

        {bottomItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={clsx(
              "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300",
              isActive(item.path)
                ? "text-primary-900 dark:text-white bg-white/50 shadow-soft"
                : "text-neutral-600 dark:text-neutral-400 hover:bg-white/30 hover:text-primary-800"
            )}
          >
            <item.icon className="w-5 h-5 text-neutral-400 group-hover:text-primary-500" />
            {!collapsed && (
              <span className="font-medium tracking-wide">{item.label}</span>
            )}
          </Link>
        ))}
      </nav>

      {/* User Profile & Settings */}
      <div className="p-4 border-t border-white/10 bg-white/30 dark:bg-black/20 backdrop-blur-lg">
        <div className="flex items-center gap-3 mb-4 px-2">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary-400 to-gold-DEFAULT p-[2px]">
            <div className="w-full h-full rounded-full overflow-hidden bg-white">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-neutral-100 text-neutral-500">
                  {profile?.name?.[0] || user?.email?.[0] || 'U'}
                </div>
              )}
            </div>
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-900 dark:text-white truncate">
                {profile?.name || 'Guest User'}
              </p>
              <p className="text-xs text-neutral-500 truncate">
                {currentBrand?.name || 'No Brand'}
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={toggleDarkMode}
            className="flex-1 flex items-center justify-center p-2 rounded-lg hover:bg-white/50 dark:hover:bg-white/10 transition-colors text-neutral-600 dark:text-neutral-400"
            title="Toggle Theme"
          >
            {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            onClick={() => signOut()}
            className="flex-1 flex items-center justify-center p-2 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors text-neutral-600 dark:text-neutral-400"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.aside>
  );
}


