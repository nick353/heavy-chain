import { Link } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { Button } from '../ui';

export function Header() {
  return (
    <header className="w-full transition-all duration-500">
      <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12">
        <div className="flex items-center justify-between h-24">
          {/* Logo Area */}
          <Link to="/" className="flex items-center gap-4 group">
            <div className="w-12 h-12 relative">
              <div className="absolute inset-0 bg-primary-500 rounded-xl rotate-3 opacity-20 group-hover:rotate-12 transition-transform duration-500 ease-out" />
              <div className="absolute inset-0 bg-gradient-to-br from-primary-600 to-primary-800 rounded-xl flex items-center justify-center shadow-lg shadow-primary-500/30 group-hover:shadow-primary-500/50 group-hover:-translate-y-1 transition-all duration-500 ease-out">
                <Layers className="w-6 h-6 text-white" />
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-display text-2xl font-semibold text-neutral-900 dark:text-white tracking-wide leading-none">
                Heavy Chain
              </span>
              <span className="text-[10px] text-neutral-500 uppercase tracking-[0.3em] opacity-0 group-hover:opacity-100 transition-opacity duration-500 -ml-0.5 mt-1">
                Design Suite
              </span>
            </div>
          </Link>

          {/* Right Actions */}
          <div className="flex items-center gap-6">
            <Link to="/login">
              <Button variant="ghost" className="text-base font-medium text-neutral-600 dark:text-neutral-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors duration-300 relative group overflow-hidden">
                <span className="relative z-10">ログイン</span>
                <span className="absolute bottom-0 left-0 w-full h-[2px] bg-primary-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
              </Button>
            </Link>
            <Link to="/signup">
              <Button className="shadow-glow hover:shadow-elegant transition-all duration-500 hover:scale-105 active:scale-95 bg-gradient-to-r from-primary-600 to-primary-500 border-none">
                無料で始める
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
