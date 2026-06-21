import type { ComponentType } from 'react';
import {
  IconClock,
  IconHome,
  IconImage,
  IconPen,
  IconSettings,
  IconShoppingBag,
  IconSparkles,
  IconUsers,
} from '../icons';

export interface WorkspaceNavItem {
  icon: ComponentType<{ className?: string; size?: number }>;
  label: string;
  mobileLabel: string;
  path: string;
  group: 'main' | 'settings';
}

export const workspaceNavItems: WorkspaceNavItem[] = [
  { icon: IconHome, label: 'ホーム', mobileLabel: 'ホーム', path: '/dashboard', group: 'main' },
  { icon: IconUsers, label: 'AIフィッティング', mobileLabel: 'フィット', path: '/fitting', group: 'main' },
  { icon: IconShoppingBag, label: 'マーケティング', mobileLabel: '販促', path: '/marketing', group: 'main' },
  { icon: IconClock, label: '履歴', mobileLabel: '履歴', path: '/history', group: 'main' },
  { icon: IconPen, label: 'キャンバス', mobileLabel: 'キャンバス', path: '/canvas', group: 'main' },
  { icon: IconImage, label: 'ギャラリー', mobileLabel: 'ギャラリー', path: '/gallery', group: 'main' },
  { icon: IconSettings, label: 'ブランド設定', mobileLabel: '設定', path: '/brand/settings', group: 'settings' },
];

export const legacyGenerateNavItem: WorkspaceNavItem = {
  icon: IconSparkles,
  label: '画像生成',
  mobileLabel: '生成',
  path: '/generate',
  group: 'main',
};

export const isWorkspacePathActive = (pathname: string, path: string) => {
  if (path === '/dashboard') return pathname === '/dashboard';
  return pathname === path || pathname.startsWith(`${path}/`);
};
