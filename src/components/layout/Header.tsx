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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12">
        <div className="flex items-center justify-between h-16 sm:h-24">
          {/* Logo Area */}
          <Link to="/" className="flex items-center group hover:scale-105 transition-transform duration-300">
            <HeavyChainLogo height={36} showText={true} className="sm:h-12" />
          </Link>

          {/* Right Actions */}
          <div className="flex items-center gap-2 sm:gap-6">
            {/* Dark Mode Toggle */}
            <button
              onClick={toggleDarkMode}
              className="p-2 sm:p-2.5 rounded-xl hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
              aria-label={isDarkMode ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
            >
              {isDarkMode ? (
                <Sun className="w-5 h-5 text-amber-500" />
              ) : (
                <Moon className="w-5 h-5 text-neutral-500" />
              )}
            </button>

            <Link to="/login">
              <Button variant="ghost" className="text-sm sm:text-base font-medium text-neutral-600 dark:text-neutral-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors duration-300 relative group overflow-hidden px-3 sm:px-4">
                <span className="relative z-10">ログイン</span>
                <span className="absolute bottom-0 left-0 w-full h-[2px] bg-primary-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
              </Button>
            </Link>
            <Link to="/signup" className="hidden sm:block">
              <Button className="shadow-glow hover:shadow-elegant transition-all duration-500 hover:scale-105 active:scale-95 bg-gradient-to-r from-primary-600 to-primary-500 border-none">
                無料で始める
              </Button>
            </Link>
            <Link to="/signup" className="sm:hidden">
              <Button size="sm" className="shadow-glow bg-gradient-to-r from-primary-600 to-primary-500 border-none">
                無料
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
