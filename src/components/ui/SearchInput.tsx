import { useState, useRef, useEffect } from 'react';
import { Search, X, Clock, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  suggestions?: string[];
  recentSearches?: string[];
  onClearRecent?: () => void;
  className?: string;
  showAIHint?: boolean;
}

export function SearchInput({
  value,
  onChange,
  placeholder = '検索...',
  suggestions = [],
  recentSearches = [],
  onClearRecent,
  className,
  showAIHint = false,
}: SearchInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleFocus = () => {
    setIsFocused(true);
    if (recentSearches.length > 0 || suggestions.length > 0) {
      setShowDropdown(true);
    }
  };

  const handleSelect = (searchValue: string) => {
    onChange(searchValue);
    setShowDropdown(false);
    inputRef.current?.blur();
  };

  const handleClear = () => {
    onChange('');
    inputRef.current?.focus();
  };

  const filteredSuggestions = suggestions.filter((s) =>
    s.toLowerCase().includes(value.toLowerCase())
  );

  const hasDropdownContent =
    (value === '' && recentSearches.length > 0) ||
    (value !== '' && filteredSuggestions.length > 0);

  return (
    <div className={clsx('relative', className)}>
      {/* Input */}
      <div
        className={clsx(
          'relative flex items-center rounded-xl border transition-all duration-200',
          isFocused
            ? 'border-primary-300 dark:border-primary-700 ring-2 ring-primary-500/20'
            : 'border-neutral-200 dark:border-neutral-700',
          'bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm'
        )}
      >
        <Search className="absolute left-3 w-4 h-4 text-neutral-400" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (e.target.value && suggestions.length > 0) {
              setShowDropdown(true);
            }
          }}
          onFocus={handleFocus}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-2.5 bg-transparent text-sm text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none"
        />
        
        {/* Clear button */}
        <AnimatePresence>
          {value && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={handleClear}
              className="absolute right-3 p-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
            >
              <X className="w-4 h-4 text-neutral-400" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* AI Hint */}
      {showAIHint && isFocused && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute left-0 right-0 -top-8 flex items-center justify-center gap-1.5 text-xs text-primary-600 dark:text-primary-400"
        >
          <Sparkles className="w-3 h-3" />
          <span>自然言語で検索できます（例: 「赤いドレス」）</span>
        </motion.div>
      )}

      {/* Dropdown */}
      <AnimatePresence>
        {showDropdown && hasDropdownContent && (
          <motion.div
            ref={dropdownRef}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-surface-900 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-xl z-20 overflow-hidden"
          >
            {/* Recent searches */}
            {value === '' && recentSearches.length > 0 && (
              <div className="p-2">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    最近の検索
                  </span>
                  {onClearRecent && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        onClearRecent();
                      }}
                      className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      クリア
                    </button>
                  )}
                </div>
                {recentSearches.slice(0, 5).map((search, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelect(search)}
                    className="w-full px-3 py-2 text-left text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
                  >
                    {search}
                  </button>
                ))}
              </div>
            )}

            {/* Suggestions */}
            {value !== '' && filteredSuggestions.length > 0 && (
              <div className="p-2">
                {filteredSuggestions.slice(0, 8).map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelect(suggestion)}
                    className="w-full px-3 py-2 text-left text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
                  >
                    <span className="font-medium">{suggestion.substring(0, value.length)}</span>
                    {suggestion.substring(value.length)}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
