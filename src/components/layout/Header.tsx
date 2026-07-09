import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { Button } from '../ui';
import { HeavyChainLogo } from '../icons';

export function Header() {
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

  return (
    <header className="w-full transition-all duration-500">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-12">
        <div className="flex h-16 items-center justify-between sm:h-24">
          <Link to="/dashboard" className="group flex items-center gap-3 transition-transform duration-300 hover:scale-[1.02]">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-xs font-semibold tracking-[0.28em] text-cyan-200">
              HC
            </span>
            <HeavyChainLogo height={34} showText={true} className="sm:h-12" />
          </Link>

          <div className="flex items-center gap-2 sm:gap-6">
            <button
              onClick={toggleDarkMode}
              className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 transition-colors hover:border-cyan-300/30 hover:bg-cyan-300/10 dark:hover:bg-white/10"
              aria-label={isDarkMode ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
            >
              {isDarkMode ? (
                <Sun className="w-5 h-5 text-amber-500" />
              ) : (
                <Moon className="w-5 h-5 text-neutral-500" />
              )}
            </button>

            <Link to="/login">
              <Button variant="ghost" className="group relative overflow-hidden border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-neutral-200 transition-colors duration-300 hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-white sm:px-4 sm:text-base">
                <span className="relative z-10">ログイン</span>
                <span className="absolute bottom-0 left-0 h-[2px] w-full origin-left scale-x-0 transform bg-cyan-300 transition-transform duration-300 group-hover:scale-x-100" />
              </Button>
            </Link>
            <Link to="/signup" className="hidden sm:block">
              <Button className="border-none bg-gradient-to-r from-cyan-300 via-sky-300 to-indigo-300 text-neutral-950 shadow-[0_14px_40px_rgba(34,211,238,0.18)] transition-all duration-500 hover:scale-105 active:scale-95">
                無料で始める
              </Button>
            </Link>
            <Link to="/signup" className="sm:hidden">
              <Button size="sm" className="border-none bg-gradient-to-r from-cyan-300 via-sky-300 to-indigo-300 text-neutral-950">
                無料
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
