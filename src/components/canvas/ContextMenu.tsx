import { useEffect, useRef } from 'react';
import {
  Copy,
  Trash2,
  Download,
  Layers,
  ChevronUp,
  ChevronDown,
  Edit3,
  Palette,
  Scissors,
  Maximize2,
  RefreshCw,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Group,
  Sparkles,
  Grid3x3,
  Users,
  Globe,
  Layout
} from 'lucide-react';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  selectedObjectId: string | null;
  onAction: (action: string) => void;
  isLocked?: boolean;
  isVisible?: boolean;
  hasMultipleSelected?: boolean;
  objectType?: 'image' | 'text' | 'shape' | 'frame' | null;
}

export function ContextMenu({
  x,
  y,
  onClose,
  selectedObjectId,
  onAction,
  isLocked = false,
  isVisible = true,
  hasMultipleSelected = false,
  objectType = null,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust position if menu would go off screen
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (rect.right > viewportWidth) {
        menuRef.current.style.left = `${x - rect.width}px`;
      }
      if (rect.bottom > viewportHeight) {
        menuRef.current.style.top = `${y - rect.height}px`;
      }
    }
  }, [x, y]);

interface MenuItem {
  type?: string;
  label: string;
  id?: string;
  icon?: any;
  shortcut?: string;
  danger?: boolean;
}

  const menuItems: MenuItem[] = selectedObjectId ? [
    // Edit actions
    { type: 'header', label: '編集' },
    { id: 'duplicate', label: '複製', icon: Copy, shortcut: '⌘D' },
    { id: 'delete', label: '削除', icon: Trash2, shortcut: 'Del', danger: true },
    { type: 'separator', label: '' },
    
    // Transform actions
    { type: 'header', label: '配置' },
    { id: 'bringToFront', label: '最前面へ', icon: ChevronUp },
    { id: 'sendToBack', label: '最背面へ', icon: ChevronDown },
    { type: 'separator', label: '' },

    // Visibility & Lock
    { 
      id: isLocked ? 'unlock' : 'lock', 
      label: isLocked ? 'ロック解除' : 'ロック', 
      icon: isLocked ? Unlock : Lock 
    },
    { 
      id: isVisible ? 'hide' : 'show', 
      label: isVisible ? '非表示' : '表示', 
      icon: isVisible ? EyeOff : Eye 
    },
    { type: 'separator', label: '' },

    // Group actions (if multiple selected)
    ...(hasMultipleSelected ? [
      { id: 'group', label: 'グループ化', icon: Group },
    ] : []),

    // AI Edit actions (for images only)
    ...(objectType === 'image' ? [
      { type: 'header', label: 'AI編集' },
      { id: 'editWithPrompt', label: 'プロンプトで編集', icon: Edit3 },
      { id: 'removeBackground', label: '背景削除', icon: Scissors },
      { id: 'colorVariations', label: 'カラバリ生成', icon: Palette },
      { id: 'upscale', label: 'アップスケール', icon: Maximize2 },
      { id: 'generateVariations', label: 'バリエーション生成', icon: RefreshCw },
      { type: 'separator', label: '' },
      { type: 'header', label: 'さらに生成' },
      { id: 'designGacha', label: 'デザインガチャ', icon: Sparkles },
      { id: 'productShots', label: '商品カット生成', icon: Grid3x3 },
      { id: 'modelMatrix', label: 'モデルマトリクス', icon: Users },
      { id: 'multilingualBanner', label: '多言語バナー', icon: Globe },
      { id: 'sceneCoordinate', label: 'シーン別配置', icon: Layout },
      { type: 'separator', label: '' },
    ] as MenuItem[] : []),

    // Export
    { id: 'download', label: 'ダウンロード', icon: Download },
  ] : [
    // No object selected - canvas actions
    { type: 'header', label: 'キャンバス' },
    { id: 'addImage', label: '画像を追加', icon: Layers },
    { id: 'addText', label: 'テキストを追加', icon: Edit3 },
    { id: 'paste', label: '貼り付け', icon: Copy, shortcut: '⌘V' },
    { type: 'separator', label: '' },
    { id: 'selectAll', label: 'すべて選択', shortcut: '⌘A' },
    { id: 'resetView', label: '表示をリセット' },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed bg-white dark:bg-neutral-800 rounded-xl shadow-xl border border-neutral-200 dark:border-neutral-700 py-2 min-w-[200px] z-[100]"
      style={{ left: x, top: y }}
    >
      {menuItems.map((item, index) => {
        if (item.type === 'separator') {
          return (
            <div 
              key={`sep-${index}`} 
              className="h-px bg-neutral-200 dark:bg-neutral-700 my-1 mx-2" 
            />
          );
        }

        if (item.type === 'header') {
          return (
            <div 
              key={`header-${index}`}
              className="px-3 py-1 text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider"
            >
              {item.label}
            </div>
          );
        }

        const Icon = item.icon;

        return (
          <button
            key={item.id}
            onClick={() => {
              onAction(item.id!);
              onClose();
            }}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors ${
              item.danger ? 'text-red-600 dark:text-red-400' : 'text-neutral-700 dark:text-neutral-200'
            }`}
          >
            {Icon && <Icon className="w-4 h-4" />}
            <span className="flex-1 text-left">{item.label}</span>
            {item.shortcut && (
              <span className="text-xs text-neutral-400 dark:text-neutral-500">
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}






