import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Keyboard, X } from 'lucide-react';

interface Shortcut {
  keys: string[];
  description: string;
  category?: string;
}

interface KeyboardShortcutsProps {
  shortcuts: Shortcut[];
  triggerKey?: string; // Key to open/close the modal
}

export function KeyboardShortcuts({ shortcuts, triggerKey = '?' }: KeyboardShortcutsProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === triggerKey) {
        e.preventDefault();
        setIsOpen(!isOpen);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [isOpen, triggerKey]);

  // Group shortcuts by category
  const grouped = shortcuts.reduce((acc, shortcut) => {
    const category = shortcut.category || '一般';
    if (!acc[category]) acc[category] = [];
    acc[category].push(shortcut);
    return acc;
  }, {} as Record<string, Shortcut[]>);

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-20 left-4 lg:bottom-6 lg:left-6 z-40 p-3 rounded-xl bg-white/80 dark:bg-surface-900/80 backdrop-blur-md shadow-lg border border-neutral-200 dark:border-neutral-700 hover:shadow-xl transition-all group"
        aria-label="キーボードショートカットを表示"
      >
        <Keyboard className="w-5 h-5 text-neutral-500 dark:text-neutral-400 group-hover:text-primary-500 transition-colors" />
      </button>

      {/* Modal */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            />

            {/* Content */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg mx-4 bg-white dark:bg-surface-900 rounded-2xl shadow-2xl z-50 overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 dark:border-neutral-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                    <Keyboard className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
                  </div>
                  <h2 className="font-semibold text-neutral-900 dark:text-white">
                    キーボードショートカット
                  </h2>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                >
                  <X className="w-5 h-5 text-neutral-400" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 max-h-[60vh] overflow-y-auto space-y-6">
                {Object.entries(grouped).map(([category, items]) => (
                  <div key={category}>
                    <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
                      {category}
                    </h3>
                    <div className="space-y-2">
                      {items.map((shortcut, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between py-2"
                        >
                          <span className="text-sm text-neutral-700 dark:text-neutral-300">
                            {shortcut.description}
                          </span>
                          <div className="flex items-center gap-1">
                            {shortcut.keys.map((key, j) => (
                              <span key={j} className="flex items-center">
                                <kbd className="px-2 py-1 bg-neutral-100 dark:bg-neutral-800 rounded-md text-xs font-mono text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700">
                                  {key}
                                </kbd>
                                {j < shortcut.keys.length - 1 && (
                                  <span className="mx-1 text-neutral-400">+</span>
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
                <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center">
                  <kbd className="px-1.5 py-0.5 bg-neutral-200 dark:bg-neutral-700 rounded text-[10px] font-mono">?</kbd>
                  <span className="ml-2">を押してこのダイアログを表示/非表示</span>
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// Default shortcuts for the app
export const defaultShortcuts: Shortcut[] = [
  { keys: ['?'], description: 'ショートカット一覧を表示', category: '一般' },
  { keys: ['⌘', 'K'], description: 'クイック検索を開く', category: '一般' },
  { keys: ['Esc'], description: 'モーダルを閉じる', category: '一般' },
  { keys: ['G', 'D'], description: 'ダッシュボードへ移動', category: 'ナビゲーション' },
  { keys: ['G', 'G'], description: '画像生成へ移動', category: 'ナビゲーション' },
  { keys: ['G', 'L'], description: 'ギャラリーへ移動', category: 'ナビゲーション' },
  { keys: ['G', 'C'], description: 'キャンバスへ移動', category: 'ナビゲーション' },
  { keys: ['←', '→'], description: '画像をナビゲート', category: 'ギャラリー' },
  { keys: ['F'], description: 'お気に入りに追加/削除', category: 'ギャラリー' },
  { keys: ['⌘', 'S'], description: '保存', category: 'キャンバス' },
  { keys: ['⌘', 'Z'], description: '元に戻す', category: 'キャンバス' },
  { keys: ['⌘', 'Shift', 'Z'], description: 'やり直し', category: 'キャンバス' },
  { keys: ['Space'], description: 'キャンバスをパン', category: 'キャンバス' },
];

