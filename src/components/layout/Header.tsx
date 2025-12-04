import { Link } from 'react-router-dom';
import { Button } from '../ui';
import { HeavyChainLogo } from '../icons';

export function Header() {
  return (
    <header className="w-full transition-all duration-500">
      <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12">
        <div className="flex items-center justify-between h-24">
          {/* Logo Area */}
          <Link to="/" className="flex items-center group hover:scale-105 transition-transform duration-300">
            <HeavyChainLogo height={48} showText={true} />
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
