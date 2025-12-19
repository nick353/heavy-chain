import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cloud, CloudOff, Check, Loader2, AlertCircle } from 'lucide-react';
import clsx from 'clsx';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

interface AutoSaveIndicatorProps {
  status: SaveStatus;
  lastSaved?: Date | null;
  className?: string;
  showText?: boolean;
}

export function AutoSaveIndicator({
  status,
  lastSaved,
  className,
  showText = true,
}: AutoSaveIndicatorProps) {
  const formatLastSaved = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffMs / (1000 * 60));

    if (diffSecs < 10) return 'たった今保存';
    if (diffSecs < 60) return `${diffSecs}秒前に保存`;
    if (diffMins < 60) return `${diffMins}分前に保存`;
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) + 'に保存';
  };

  const config = {
    idle: {
      icon: Cloud,
      text: '変更なし',
      color: 'text-neutral-400',
      bgColor: 'bg-neutral-100 dark:bg-neutral-800',
    },
    saving: {
      icon: Loader2,
      text: '保存中...',
      color: 'text-blue-500',
      bgColor: 'bg-blue-50 dark:bg-blue-900/20',
      animate: true,
    },
    saved: {
      icon: Check,
      text: lastSaved ? formatLastSaved(lastSaved) : '保存済み',
      color: 'text-green-500',
      bgColor: 'bg-green-50 dark:bg-green-900/20',
    },
    error: {
      icon: AlertCircle,
      text: '保存に失敗',
      color: 'text-red-500',
      bgColor: 'bg-red-50 dark:bg-red-900/20',
    },
    offline: {
      icon: CloudOff,
      text: 'オフライン',
      color: 'text-amber-500',
      bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    },
  };

  const currentConfig = config[status];
  const Icon = currentConfig.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
        currentConfig.bgColor,
        currentConfig.color,
        className
      )}
    >
      <Icon
        className={clsx(
          'w-3.5 h-3.5',
          'animate' in currentConfig && currentConfig.animate && 'animate-spin'
        )}
      />
      {showText && <span>{currentConfig.text}</span>}
    </motion.div>
  );
}

// Hook for auto-save functionality
export function useAutoSave<T>(
  data: T,
  onSave: (data: T) => Promise<void>,
  options: {
    debounceMs?: number;
    enabled?: boolean;
  } = {}
) {
  const { debounceMs = 3000, enabled = true } = options;
  
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const previousDataRef = useRef<string>('');
  const timeoutRef = useRef<NodeJS.Timeout>();

  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      setIsOnline(false);
      setStatus('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Debounced save
  const save = useCallback(async () => {
    if (!enabled || !isOnline) return;

    const currentDataString = JSON.stringify(data);
    if (currentDataString === previousDataRef.current) return;

    setStatus('saving');

    try {
      await onSave(data);
      previousDataRef.current = currentDataString;
      setLastSaved(new Date());
      setStatus('saved');
    } catch (error) {
      console.error('Auto-save failed:', error);
      setStatus('error');
    }
  }, [data, onSave, enabled, isOnline]);

  // Trigger save on data change
  useEffect(() => {
    if (!enabled) return;

    const currentDataString = JSON.stringify(data);
    if (currentDataString === previousDataRef.current) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setStatus('idle');
    timeoutRef.current = setTimeout(save, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [data, save, debounceMs, enabled]);

  // Force save (for manual save button)
  const forceSave = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    await save();
  }, [save]);

  return {
    status,
    lastSaved,
    isOnline,
    forceSave,
  };
}
