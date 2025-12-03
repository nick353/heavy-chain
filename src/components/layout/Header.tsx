import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  LogOut, 
  User, 
  Settings, 
  ChevronDown,
  Layers,
  Image,
  Sparkles
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui';

export function Header() {
  const navigate = useNavigate();
  const { user, profile, currentBrand, signOut } = useAuthStore();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-lg border-b border-neutral-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-gradient-to-br from-primary-700 to-accent-600 rounded-xl flex items-center justify-center">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <span className="font-display text-xl font-semibold text-neutral-800">
              Heavy Chain
            </span>
          </Link>

          {/* Navigation */}
          {user && (
            <nav className="hidden md:flex items-center gap-1">
              <Link
                to="/generate"
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-neutral-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                画像生成
              </Link>
              <Link
                to="/gallery"
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-neutral-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
              >
                <Image className="w-4 h-4" />
                ギャラリー
              </Link>
            </nav>
          )}

          {/* Right side */}
          <div className="flex items-center gap-4">
            {user ? (
              <>
                {/* Brand Selector */}
                {currentBrand && (
                  <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-primary-50 rounded-lg">
                    <div className="w-6 h-6 bg-primary-200 rounded flex items-center justify-center">
                      <span className="text-xs font-semibold text-primary-700">
                        {currentBrand.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className="text-sm font-medium text-primary-800">
                      {currentBrand.name}
                    </span>
                  </div>
                )}

                {/* User Menu */}
                <div className="relative">
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="flex items-center gap-2 p-1.5 hover:bg-neutral-100 rounded-lg transition-colors"
                  >
                    <div className="w-8 h-8 bg-gradient-to-br from-primary-400 to-accent-400 rounded-full flex items-center justify-center">
                      {profile?.avatar_url ? (
                        <img
                          src={profile.avatar_url}
                          alt={profile.name || ''}
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        <User className="w-4 h-4 text-white" />
                      )}
                    </div>
                    <ChevronDown className="w-4 h-4 text-neutral-400" />
                  </button>

                  {isUserMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsUserMenuOpen(false)}
                      />
                      <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-elegant border border-neutral-100 py-2 z-20 animate-scale-in">
                        <div className="px-4 py-2 border-b border-neutral-100">
                          <p className="text-sm font-medium text-neutral-800">
                            {profile?.name || 'ユーザー'}
                          </p>
                          <p className="text-xs text-neutral-500 truncate">
                            {user.email}
                          </p>
                        </div>
                        <Link
                          to="/settings"
                          className="flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors"
                          onClick={() => setIsUserMenuOpen(false)}
                        >
                          <Settings className="w-4 h-4" />
                          設定
                        </Link>
                        <button
                          onClick={handleSignOut}
                          className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <LogOut className="w-4 h-4" />
                          ログアウト
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Link to="/login">
                  <Button variant="ghost">ログイン</Button>
                </Link>
                <Link to="/signup">
                  <Button>無料で始める</Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

