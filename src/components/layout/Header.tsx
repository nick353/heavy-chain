import { Link } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { Button } from '../ui';

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-surface-950/80 backdrop-blur-lg border-b border-neutral-200/50 dark:border-neutral-800/50 transition-all duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo Area */}
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-600 to-primary-800 rounded-xl flex items-center justify-center shadow-lg shadow-primary-500/20 group-hover:shadow-primary-500/40 transition-all duration-500">
              <Layers className="w-6 h-6 text-white" />
            </div>
            <span className="font-display text-2xl font-semibold text-neutral-900 dark:text-white tracking-wide">
              Heavy Chain
            </span>
          </Link>

          {/* Right Actions */}
          <div className="flex items-center gap-4">
            <Link to="/login">
              <Button variant="ghost" className="font-medium text-neutral-600 dark:text-neutral-300 hover:text-primary-600 dark:hover:text-primary-400">
                ログイン
              </Button>
            </Link>
            <Link to="/signup">
              <Button className="shadow-glow hover:shadow-elegant transition-all duration-300">
                無料で始める
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
