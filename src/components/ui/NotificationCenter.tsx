import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, Check, Sparkles, Image, Users, AlertCircle, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

export interface Notification {
  id: string;
  type: 'success' | 'info' | 'warning' | 'generation_complete';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  link?: string;
  imageUrl?: string;
}

interface NotificationCenterProps {
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onDismiss: (id: string) => void;
}

const iconMap = {
  success: Check,
  info: Bell,
  warning: AlertCircle,
  generation_complete: Sparkles,
};

const colorMap = {
  success: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  info: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  warning: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  generation_complete: 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400',
};

export function NotificationCenter({
  notifications,
  onMarkAsRead,
  onMarkAllAsRead,
  onDismiss,
}: NotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const formatTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'たった今';
    if (diffMins < 60) return `${diffMins}分前`;
    if (diffHours < 24) return `${diffHours}時間前`;
    if (diffDays < 7) return `${diffDays}日前`;
    return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="relative">
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors"
        aria-label="通知を表示"
      >
        <Bell className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white dark:bg-surface-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-800 z-50 overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
                <h3 className="font-semibold text-neutral-900 dark:text-white">
                  通知
                </h3>
                {unreadCount > 0 && (
                  <button
                    onClick={onMarkAllAsRead}
                    className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    すべて既読にする
                  </button>
                )}
              </div>

              {/* Notifications List */}
              <div className="max-h-[400px] overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="py-12 text-center">
                    <Bell className="w-10 h-10 text-neutral-300 dark:text-neutral-600 mx-auto mb-3" />
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      通知はありません
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {notifications.map((notification) => {
                      const Icon = iconMap[notification.type];
                      const content = (
                        <div
                          className={clsx(
                            'flex gap-3 p-4 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors group',
                            !notification.read && 'bg-primary-50/50 dark:bg-primary-900/10'
                          )}
                          onClick={() => {
                            onMarkAsRead(notification.id);
                            if (notification.link) setIsOpen(false);
                          }}
                        >
                          {/* Icon or Image */}
                          <div className="flex-shrink-0">
                            {notification.imageUrl ? (
                              <img
                                src={notification.imageUrl}
                                alt=""
                                className="w-10 h-10 rounded-lg object-cover"
                              />
                            ) : (
                              <div
                                className={clsx(
                                  'w-10 h-10 rounded-lg flex items-center justify-center',
                                  colorMap[notification.type]
                                )}
                              >
                                <Icon className="w-5 h-5" />
                              </div>
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p
                                className={clsx(
                                  'text-sm font-medium truncate',
                                  notification.read
                                    ? 'text-neutral-700 dark:text-neutral-300'
                                    : 'text-neutral-900 dark:text-white'
                                )}
                              >
                                {notification.title}
                              </p>
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onDismiss(notification.id);
                                }}
                                className="p-1 -mr-1 opacity-0 group-hover:opacity-100 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded transition-all"
                              >
                                <X className="w-3 h-3 text-neutral-400" />
                              </button>
                            </div>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2 mt-0.5">
                              {notification.message}
                            </p>
                            <p className="text-[10px] text-neutral-400 mt-1">
                              {formatTime(notification.timestamp)}
                            </p>
                          </div>

                          {/* Link indicator */}
                          {notification.link && (
                            <ChevronRight className="w-4 h-4 text-neutral-300 dark:text-neutral-600 flex-shrink-0 self-center" />
                          )}
                        </div>
                      );

                      return notification.link ? (
                        <Link key={notification.id} to={notification.link}>
                          {content}
                        </Link>
                      ) : (
                        <div key={notification.id}>{content}</div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              {notifications.length > 0 && (
                <div className="px-4 py-3 border-t border-neutral-100 dark:border-neutral-800">
                  <Link
                    to="/notifications"
                    className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                    onClick={() => setIsOpen(false)}
                  >
                    すべての通知を見る
                  </Link>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// Hook to manage notifications
export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([
    // Demo notifications
    {
      id: '1',
      type: 'generation_complete',
      title: '画像生成が完了しました',
      message: '4枚のデザインガチャ画像が生成されました。ギャラリーで確認できます。',
      timestamp: new Date(Date.now() - 5 * 60 * 1000),
      read: false,
      link: '/gallery',
    },
    {
      id: '2',
      type: 'info',
      title: '新機能: モデルマトリクス',
      message: '体型×年齢違いの着用イメージを一括生成できるようになりました。',
      timestamp: new Date(Date.now() - 60 * 60 * 1000),
      read: false,
    },
  ]);

  const addNotification = (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    const newNotification: Notification = {
      ...notification,
      id: Date.now().toString(),
      timestamp: new Date(),
      read: false,
    };
    setNotifications((prev) => [newNotification, ...prev]);
  };

  const markAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const dismissNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return {
    notifications,
    addNotification,
    markAsRead,
    markAllAsRead,
    dismissNotification,
  };
}
