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
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

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
    { icon: Settings, label: 'ブランド設定', path: '/brand/settings' },
  ];

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 90 : 300 }}
      className={clsx(
        "h-full z-50",
        "glass-panel border-r border-white/20 dark:border-white/5",
        "flex flex-col transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "bg-white/80 dark:bg-[#121212]/80" // slightly more opaque for better contrast
      )}
    >
      {/* Logo Area */}
      <div className="h-24 flex items-center px-8 border-b border-white/10 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary-500/5 to-transparent opacity-50" />
        <Link to="/dashboard" className="flex items-center gap-4 group relative z-10">
          <div className="w-10 h-10 relative">
            <div className="absolute inset-0 bg-primary-500 rounded-xl rotate-3 opacity-20 group-hover:rotate-6 transition-transform duration-500" />
            <div className="absolute inset-0 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center shadow-glow group-hover:shadow-glow-lg transition-all duration-500">
              <Layers className="w-5 h-5 text-white" />
            </div>
          </div>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex flex-col"
            >
              <span className="font-display text-xl font-semibold text-primary-900 dark:text-primary-100 tracking-wide leading-none">
                Heavy Chain
              </span>
              <span className="text-[10px] text-neutral-400 uppercase tracking-[0.2em] mt-1">
                Design Suite
              </span>
            </motion.div>
          )}
        </Link>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 py-8 px-4 space-y-2 overflow-y-auto scrollbar-hide">
        {menuItems.map((item) => {
          const active = isActive(item.path);
          const hovered = hoveredPath === item.path;
          
          return (
            <Link
              key={item.path}
              to={item.path}
              onMouseEnter={() => setHoveredPath(item.path)}
              onMouseLeave={() => setHoveredPath(null)}
              className={clsx(
                "relative flex items-center gap-4 px-4 py-4 rounded-xl group transition-all duration-500",
                active 
                  ? "text-primary-900 dark:text-white" 
                  : "text-neutral-600 dark:text-neutral-400 hover:text-primary-800 dark:hover:text-primary-200"
              )}
            >
              {/* Active Indicator Background */}
              {active && (
                <motion.div
                  layoutId="activeTabBg"
                  className="absolute inset-0 bg-gradient-to-r from-primary-50/80 to-white/40 dark:from-primary-900/20 dark:to-transparent rounded-xl border border-primary-100/50 dark:border-primary-800/30 shadow-sm"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                />
              )}
              
              {/* Hover Indicator Background */}
              {!active && hovered && (
                <motion.div
                  layoutId="hoverTabBg"
                  className="absolute inset-0 bg-neutral-100/50 dark:bg-white/5 rounded-xl"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                />
              )}

              <div className="relative z-10 flex items-center gap-4 w-full">
                <item.icon className={clsx(
                  "w-5 h-5 transition-all duration-500",
                  active ? "text-primary-600 dark:text-primary-400 scale-110 drop-shadow-md" : "text-neutral-400 group-hover:text-primary-500 group-hover:scale-110"
                )} />
                
                {!collapsed && (
                  <span className={clsx(
                    "font-medium tracking-wide transition-all duration-300",
                    active ? "font-semibold translate-x-1" : "group-hover:translate-x-1"
                  )}>{item.label}</span>
                )}
                
                {!collapsed && active && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-500 shadow-glow"
                  />
                )}
              </div>
            </Link>
          );
        })}

        <div className="py-6 px-6">
          {!collapsed && (
            <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-neutral-200 dark:via-neutral-700 to-transparent mb-6" />
          )}
        </div>

        {bottomItems.map((item) => {
          const active = isActive(item.path);
          return (
          <Link
            key={item.path}
            to={item.path}
            className={clsx(
              "relative flex items-center gap-4 px-4 py-3 rounded-xl group transition-all duration-300 mx-2",
              active
                ? "text-primary-900 dark:text-white bg-white/50 dark:bg-white/5 shadow-sm"
                : "text-neutral-500 dark:text-neutral-500 hover:bg-white/30 dark:hover:bg-white/5 hover:text-primary-800 dark:hover:text-neutral-300"
            )}
          >
            <item.icon className="w-5 h-5 transition-transform duration-300 group-hover:scale-110" />
            {!collapsed && (
              <span className="font-medium tracking-wide text-sm">{item.label}</span>
            )}
          </Link>
        )})}
      </nav>

      {/* User Profile & Settings - Floating Card Style */}
      <div className="p-6 mt-auto">
        <div className={clsx(
          "rounded-2xl p-4 transition-all duration-300 border backdrop-blur-md group",
          "bg-gradient-to-b from-white/50 to-white/20 border-white/40 shadow-lg shadow-neutral-200/20",
          "dark:from-surface-800/50 dark:to-surface-900/50 dark:border-white/10 dark:shadow-black/20",
          !collapsed && "hover:-translate-y-1 hover:shadow-xl"
        )}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary-400 to-gold-DEFAULT p-[2px] shadow-md group-hover:shadow-glow transition-all duration-500">
              <div className="w-full h-full rounded-full overflow-hidden bg-surface-50 dark:bg-surface-900">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-surface-100 to-surface-200 dark:from-surface-800 dark:to-surface-900 text-neutral-500 font-serif">
                    {profile?.name?.[0] || user?.email?.[0] || 'U'}
                  </div>
                )}
              </div>
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-neutral-900 dark:text-white truncate font-display tracking-wide">
                  {profile?.name || 'Guest User'}
                </p>
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate uppercase tracking-wider">
                  {currentBrand?.name || 'Free Plan'}
                </p>
              </div>
            )}
          </div>

          {!collapsed && (
            <div className="flex gap-2 pt-2 border-t border-neutral-200/50 dark:border-white/10">
              <button
                onClick={toggleDarkMode}
                className="flex-1 flex items-center justify-center p-2 rounded-lg hover:bg-white/80 dark:hover:bg-white/10 transition-all duration-300 text-neutral-500 dark:text-neutral-400 hover:text-primary-600 dark:hover:text-primary-300"
                title="Toggle Theme"
              >
                {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <div className="w-[1px] bg-neutral-200/50 dark:bg-white/10 h-8" />
              <button
                onClick={() => signOut()}
                className="flex-1 flex items-center justify-center p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 transition-all duration-300 text-neutral-500 dark:text-neutral-400"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.aside>
  );
}
