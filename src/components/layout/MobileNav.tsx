import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import {
  IconHome,
  IconSparkles,
  IconImage,
  IconPen,
} from '../icons';

const navItems = [
  { icon: IconHome, label: 'ホーム', path: '/dashboard' },
  { icon: IconSparkles, label: '生成', path: '/generate' },
  { icon: IconPen, label: 'キャンバス', path: '/canvas' },
  { icon: IconImage, label: 'ギャラリー', path: '/gallery' },
];

export function MobileNav() {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/dashboard' && location.pathname === '/dashboard') return true;
    if (path !== '/dashboard' && location.pathname.startsWith(path)) return true;
    return false;
  };

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 dark:bg-surface-900/90 backdrop-blur-xl border-t border-neutral-200/50 dark:border-white/10 safe-area-pb">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const active = isActive(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className="relative flex flex-col items-center justify-center flex-1 h-full group"
            >
              {active && (
                <motion.div
                  layoutId="mobileNavActive"
                  className="absolute inset-x-2 top-1 bottom-1 bg-primary-50 dark:bg-primary-900/30 rounded-xl"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <div className="relative z-10 flex flex-col items-center gap-1">
                <item.icon
                  className={clsx(
                    'w-5 h-5 transition-all duration-200',
                    active
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-neutral-400 dark:text-neutral-500 group-active:scale-90'
                  )}
                  size={20}
                />
                <span
                  className={clsx(
                    'text-[10px] font-medium transition-colors',
                    active
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-neutral-500 dark:text-neutral-400'
                  )}
                >
                  {item.label}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
