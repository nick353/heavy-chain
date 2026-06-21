import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { isWorkspacePathActive, mobileNavItems } from './navigation';

export function MobileNav() {
  const location = useLocation();

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 dark:bg-surface-900/90 backdrop-blur-xl border-t border-neutral-200/50 dark:border-white/10 safe-area-pb">
      <div className="grid h-16 grid-cols-5 items-center gap-1 px-2">
        {mobileNavItems.map((item) => {
          const active = isWorkspacePathActive(location.pathname, item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className="relative flex h-full min-w-0 flex-col items-center justify-center group"
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
                  {item.mobileLabel}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
