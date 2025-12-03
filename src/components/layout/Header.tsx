import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { 
  LogOut, 
  User, 
  Settings, 
  ChevronDown,
  Layers,
  Image,
  Sparkles,
  Users,
  Palette,
  Plus,
  Check,
  Shield,
  Moon,
  Sun,
  Keyboard
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../lib/supabase';
import { Button } from '../ui';

interface Brand {
  id: string;
  name: string;
  logo_url: string | null;
}

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, currentBrand, setCurrentBrand, signOut } = useAuthStore();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isBrandMenuOpen, setIsBrandMenuOpen] = useState(false);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const brandMenuRef = useRef<HTMLDivElement>(null);

  // Load brands
  useEffect(() => {
    if (user) {
      loadBrands();
    }
  }, [user]);

  // Load dark mode preference
  useEffect(() => {
    const saved = localStorage.getItem('darkMode');
    if (saved === 'true') {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    }
  }, []);

  const loadBrands = async () => {
    const { data } = await supabase
      .from('brand_members')
      .select('brand:brands(id, name, logo_url)')
      .eq('user_id', user!.id);

    if (data) {
      setBrands(data.map((d: any) => d.brand).filter(Boolean));
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const handleBrandChange = (brand: Brand) => {
    setCurrentBrand(brand as any);
    setIsBrandMenuOpen(false);
  };

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

  const isActive = (path: string) => location.pathname === path;

  return (
    <>
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-lg border-b border-neutral-100 dark:border-neutral-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/dashboard" className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-gradient-to-br from-primary-700 to-accent-600 rounded-xl flex items-center justify-center">
                <Layers className="w-5 h-5 text-white" />
              </div>
              <span className="font-display text-xl font-semibold text-neutral-800 dark:text-white">
                Heavy Chain
              </span>
            </Link>

            {/* Navigation */}
            {user && (
              <nav className="hidden md:flex items-center gap-1">
                <Link
                  to="/generate"
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    isActive('/generate')
                      ? 'text-primary-700 bg-primary-50 dark:bg-primary-900/50'
                      : 'text-neutral-600 dark:text-neutral-300 hover:text-primary-700 hover:bg-primary-50 dark:hover:bg-primary-900/30'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  画像生成
                </Link>
                <Link
                  to="/gallery"
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    isActive('/gallery')
                      ? 'text-primary-700 bg-primary-50 dark:bg-primary-900/50'
                      : 'text-neutral-600 dark:text-neutral-300 hover:text-primary-700 hover:bg-primary-50 dark:hover:bg-primary-900/30'
                  }`}
                >
                  <Image className="w-4 h-4" />
                  ギャラリー
                </Link>
              </nav>
            )}

            {/* Right side */}
            <div className="flex items-center gap-3">
              {user ? (
                <>
                  {/* Brand Selector with Dropdown */}
                  {currentBrand && (
                    <div className="relative" ref={brandMenuRef}>
                      <button
                        onClick={() => setIsBrandMenuOpen(!isBrandMenuOpen)}
                        className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-primary-50 dark:bg-primary-900/50 hover:bg-primary-100 dark:hover:bg-primary-900/70 rounded-lg transition-colors"
                      >
                        <div className="w-6 h-6 bg-primary-200 dark:bg-primary-700 rounded flex items-center justify-center">
                          {currentBrand.logo_url ? (
                            <img src={currentBrand.logo_url} alt="" className="w-full h-full rounded object-cover" />
                          ) : (
                            <span className="text-xs font-semibold text-primary-700 dark:text-primary-200">
                              {currentBrand.name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <span className="text-sm font-medium text-primary-800 dark:text-primary-200 max-w-[120px] truncate">
                          {currentBrand.name}
                        </span>
                        <ChevronDown className="w-4 h-4 text-primary-600 dark:text-primary-300" />
                      </button>

                      {isBrandMenuOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setIsBrandMenuOpen(false)}
                          />
                          <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-neutral-800 rounded-xl shadow-elegant border border-neutral-100 dark:border-neutral-700 py-2 z-20 animate-scale-in">
                            <div className="px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                              ブランド切り替え
                            </div>
                            {brands.map((brand) => (
                              <button
                                key={brand.id}
                                onClick={() => handleBrandChange(brand)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
                              >
                                <div className="w-8 h-8 bg-primary-100 dark:bg-primary-800 rounded flex items-center justify-center flex-shrink-0">
                                  {brand.logo_url ? (
                                    <img src={brand.logo_url} alt="" className="w-full h-full rounded object-cover" />
                                  ) : (
                                    <span className="text-sm font-semibold text-primary-700 dark:text-primary-200">
                                      {brand.name.charAt(0).toUpperCase()}
                                    </span>
                                  )}
                                </div>
                                <span className="flex-1 text-sm font-medium text-neutral-800 dark:text-neutral-200 text-left truncate">
                                  {brand.name}
                                </span>
                                {currentBrand.id === brand.id && (
                                  <Check className="w-4 h-4 text-primary-600" />
                                )}
                              </button>
                            ))}
                            
                            <div className="border-t border-neutral-100 dark:border-neutral-700 mt-2 pt-2">
                              <Link
                                to="/brand/settings"
                                onClick={() => setIsBrandMenuOpen(false)}
                                className="flex items-center gap-2 px-3 py-2.5 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
                              >
                                <Settings className="w-4 h-4" />
                                ブランド設定
                              </Link>
                              <Link
                                to="/brand/settings"
                                onClick={() => setIsBrandMenuOpen(false)}
                                className="flex items-center gap-2 px-3 py-2.5 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
                              >
                                <Users className="w-4 h-4" />
                                チーム管理
                              </Link>
                              <button
                                onClick={() => {
                                  setIsBrandMenuOpen(false);
                                  // TODO: Show create brand modal
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                              >
                                <Plus className="w-4 h-4" />
                                新しいブランドを作成
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* User Menu */}
                  <div className="relative">
                    <button
                      onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                      className="flex items-center gap-2 p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
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
                        <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-neutral-800 rounded-xl shadow-elegant border border-neutral-100 dark:border-neutral-700 py-2 z-20 animate-scale-in">
                          <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-700">
                            <p className="text-sm font-medium text-neutral-800 dark:text-white">
                              {profile?.name || 'ユーザー'}
                            </p>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                              {user.email}
                            </p>
                          </div>
                          
                          <div className="py-1">
                            <button
                              onClick={toggleDarkMode}
                              className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                {isDarkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                                ダークモード
                              </div>
                              <div className={`w-9 h-5 rounded-full transition-colors ${isDarkMode ? 'bg-primary-600' : 'bg-neutral-200'}`}>
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform mt-0.5 ${isDarkMode ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'}`} />
                              </div>
                            </button>
                            
                            <button
                              onClick={() => {
                                setShowShortcuts(true);
                                setIsUserMenuOpen(false);
                              }}
                              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
                            >
                              <Keyboard className="w-4 h-4" />
                              キーボードショートカット
                            </button>
                          </div>

                          <div className="border-t border-neutral-100 dark:border-neutral-700 py-1">
                            <Link
                              to="/admin"
                              className="flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
                              onClick={() => setIsUserMenuOpen(false)}
                            >
                              <Shield className="w-4 h-4" />
                              管理者ダッシュボード
                            </Link>
                          </div>

                          <div className="border-t border-neutral-100 dark:border-neutral-700 py-1">
                            <button
                              onClick={handleSignOut}
                              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            >
                              <LogOut className="w-4 h-4" />
                              ログアウト
                            </button>
                          </div>
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

      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setShowShortcuts(false)}
        >
          <div 
            className="w-full max-w-md bg-white dark:bg-neutral-800 rounded-2xl shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-neutral-800 dark:text-white">
                <Keyboard className="w-5 h-5 inline-block mr-2" />
                キーボードショートカット
              </h2>
              <button
                onClick={() => setShowShortcuts(false)}
                className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">
                  キャンバス操作
                </h3>
                <div className="space-y-2">
                  {[
                    { keys: ['⌘', 'Z'], action: '元に戻す' },
                    { keys: ['⌘', '⇧', 'Z'], action: 'やり直す' },
                    { keys: ['⌘', 'D'], action: '複製' },
                    { keys: ['⌘', 'A'], action: '全選択' },
                    { keys: ['Delete'], action: '削除' },
                    { keys: ['⌘', 'S'], action: '保存' },
                  ].map((shortcut, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5">
                      <span className="text-sm text-neutral-700 dark:text-neutral-300">{shortcut.action}</span>
                      <div className="flex gap-1">
                        {shortcut.keys.map((key, j) => (
                          <kbd key={j} className="px-2 py-1 bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 text-xs rounded font-mono">
                            {key}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">
                  表示
                </h3>
                <div className="space-y-2">
                  {[
                    { keys: ['⌘', '+'], action: 'ズームイン' },
                    { keys: ['⌘', '-'], action: 'ズームアウト' },
                    { keys: ['⌘', '0'], action: 'ズームリセット' },
                    { keys: ['G'], action: 'グリッド表示切替' },
                  ].map((shortcut, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5">
                      <span className="text-sm text-neutral-700 dark:text-neutral-300">{shortcut.action}</span>
                      <div className="flex gap-1">
                        {shortcut.keys.map((key, j) => (
                          <kbd key={j} className="px-2 py-1 bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 text-xs rounded font-mono">
                            {key}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
