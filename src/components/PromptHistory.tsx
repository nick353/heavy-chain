import { useState, useEffect } from 'react';
import { History, X, Clock, Star, StarOff, Trash2, Search } from 'lucide-react';

export interface PromptHistoryItem {
  id: string;
  prompt: string;
  timestamp: number;
  isFavorite: boolean;
  featureType?: string;
}

interface PromptHistoryProps {
  onSelect: (prompt: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

const MAX_HISTORY_ITEMS = 50;
const STORAGE_KEY = 'heavy_chain_prompt_history';

export function usePromptHistory() {
  const [history, setHistory] = useState<PromptHistoryItem[]>([]);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load prompt history:', e);
    }
  };

  const saveHistory = (items: PromptHistoryItem[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      setHistory(items);
    } catch (e) {
      console.error('Failed to save prompt history:', e);
    }
  };

  const addToHistory = (prompt: string, featureType?: string) => {
    if (!prompt.trim()) return;

    const newItem: PromptHistoryItem = {
      id: Date.now().toString(),
      prompt: prompt.trim(),
      timestamp: Date.now(),
      isFavorite: false,
      featureType,
    };

    // Check for duplicates
    const existingIndex = history.findIndex(
      (item) => item.prompt.toLowerCase() === prompt.toLowerCase()
    );

    let newHistory: PromptHistoryItem[];

    if (existingIndex !== -1) {
      // Move existing item to top and update timestamp
      const existing = history[existingIndex];
      newHistory = [
        { ...existing, timestamp: Date.now() },
        ...history.slice(0, existingIndex),
        ...history.slice(existingIndex + 1),
      ];
    } else {
      newHistory = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
    }

    saveHistory(newHistory);
  };

  const toggleFavorite = (id: string) => {
    const newHistory = history.map((item) =>
      item.id === id ? { ...item, isFavorite: !item.isFavorite } : item
    );
    saveHistory(newHistory);
  };

  const removeFromHistory = (id: string) => {
    const newHistory = history.filter((item) => item.id !== id);
    saveHistory(newHistory);
  };

  const clearHistory = () => {
    saveHistory([]);
  };

  return {
    history,
    addToHistory,
    toggleFavorite,
    removeFromHistory,
    clearHistory,
  };
}

export function PromptHistory({ onSelect, isOpen, onClose }: PromptHistoryProps) {
  const { history, toggleFavorite, removeFromHistory, clearHistory } = usePromptHistory();
  const [searchQuery, setSearchQuery] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  if (!isOpen) return null;

  const filteredHistory = history.filter((item) => {
    const matchesSearch = item.prompt
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesFavorite = !showFavoritesOnly || item.isFavorite;
    return matchesSearch && matchesFavorite;
  });

  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'たった今';
    if (minutes < 60) return `${minutes}分前`;
    if (hours < 24) return `${hours}時間前`;
    if (days < 7) return `${days}日前`;
    return new Date(timestamp).toLocaleDateString('ja-JP');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-white dark:bg-neutral-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 dark:border-neutral-700">
          <div className="flex items-center gap-3">
            <History className="w-5 h-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-neutral-800 dark:text-white">
              プロンプト履歴
            </h2>
            <span className="text-sm text-neutral-500 dark:text-neutral-400">
              ({filteredHistory.length}件)
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-neutral-500" />
          </button>
        </div>

        {/* Search & Filter */}
        <div className="px-6 py-3 border-b border-neutral-100 dark:border-neutral-700 flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input
              type="text"
              placeholder="プロンプトを検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-neutral-50 dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              showFavoritesOnly
                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'
                : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'
            }`}
          >
            <Star className="w-4 h-4" />
            お気に入り
          </button>
          {history.length > 0 && (
            <button
              onClick={() => {
                if (confirm('全ての履歴を削除しますか？')) {
                  clearHistory();
                }
              }}
              className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              title="全て削除"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* History List */}
        <div className="max-h-[400px] overflow-y-auto">
          {filteredHistory.length === 0 ? (
            <div className="py-12 text-center">
              <History className="w-12 h-12 text-neutral-300 dark:text-neutral-600 mx-auto mb-3" />
              <p className="text-neutral-500 dark:text-neutral-400">
                {searchQuery
                  ? '検索結果がありません'
                  : showFavoritesOnly
                  ? 'お気に入りのプロンプトがありません'
                  : 'まだ履歴がありません'}
              </p>
              <p className="text-sm text-neutral-400 dark:text-neutral-500 mt-1">
                画像を生成すると、ここにプロンプトが保存されます
              </p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-100 dark:divide-neutral-700">
              {filteredHistory.map((item) => (
                <div
                  key={item.id}
                  className="px-6 py-4 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-4">
                    <button
                      onClick={() => {
                        onSelect(item.prompt);
                        onClose();
                      }}
                      className="flex-1 text-left"
                    >
                      <p className="text-sm text-neutral-800 dark:text-neutral-200 line-clamp-2 mb-1">
                        {item.prompt}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-neutral-400">
                        <Clock className="w-3 h-3" />
                        {formatTime(item.timestamp)}
                        {item.featureType && (
                          <>
                            <span>•</span>
                            <span>{item.featureType}</span>
                          </>
                        )}
                      </div>
                    </button>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => toggleFavorite(item.id)}
                        className={`p-1.5 rounded transition-colors ${
                          item.isFavorite
                            ? 'text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
                            : 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-600'
                        }`}
                        title={item.isFavorite ? 'お気に入りを解除' : 'お気に入りに追加'}
                      >
                        {item.isFavorite ? (
                          <Star className="w-4 h-4 fill-current" />
                        ) : (
                          <StarOff className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => removeFromHistory(item.id)}
                        className="p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                        title="削除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-neutral-50 dark:bg-neutral-700/50 text-xs text-neutral-500 dark:text-neutral-400 text-center">
          最新{MAX_HISTORY_ITEMS}件まで保存されます
        </div>
      </div>
    </div>
  );
}


