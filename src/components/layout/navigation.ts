import type { ComponentType } from 'react';
import { BriefcaseBusiness, CreditCard, FlaskConical, LayoutGrid, Palette, Shirt, UserRound, Video } from 'lucide-react';
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
  showInMobileNav?: boolean;
}

export const workspaceNavItems: WorkspaceNavItem[] = [
  { icon: IconHome, label: 'ホーム', mobileLabel: 'ホーム', path: '/dashboard', group: 'main', showInMobileNav: true },
  { icon: IconSparkles, label: '画像生成', mobileLabel: '生成', path: '/generate', group: 'main', showInMobileNav: true },
  { icon: IconUsers, label: 'AIフィッティング', mobileLabel: 'フィット', path: '/fitting', group: 'main', showInMobileNav: true },
  { icon: IconShoppingBag, label: 'マーケティング', mobileLabel: '販促', path: '/marketing', group: 'main', showInMobileNav: true },
  { icon: Shirt, label: 'スタジオ', mobileLabel: 'スタジオ', path: '/studio', group: 'main' },
  { icon: UserRound, label: 'モデルライブラリ', mobileLabel: 'モデル', path: '/models', group: 'main' },
  { icon: Palette, label: '柄・グラフィック', mobileLabel: '柄', path: '/patterns/workbench', group: 'main' },
  { icon: Video, label: '動画', mobileLabel: '動画', path: '/video', group: 'main' },
  { icon: FlaskConical, label: 'ラボ', mobileLabel: 'ラボ', path: '/lab', group: 'main' },
  { icon: LayoutGrid, label: '素材ワークベンチ', mobileLabel: '素材', path: '/lightchain', group: 'main' },
  { icon: IconClock, label: '履歴', mobileLabel: '履歴', path: '/history', group: 'main', showInMobileNav: true },
  { icon: BriefcaseBusiness, label: 'ジョブ', mobileLabel: 'ジョブ', path: '/jobs', group: 'main' },
  { icon: CreditCard, label: 'クレジット', mobileLabel: 'クレジット', path: '/credits', group: 'main' },
  { icon: IconPen, label: 'キャンバス', mobileLabel: 'キャンバス', path: '/canvas', group: 'main' },
  { icon: IconImage, label: 'ギャラリー', mobileLabel: 'ギャラリー', path: '/gallery', group: 'main' },
  { icon: IconSettings, label: 'ブランド設定', mobileLabel: '設定', path: '/brand/settings', group: 'settings' },
];

export const mobileNavItems = workspaceNavItems.filter((item) => item.showInMobileNav);

export const isWorkspacePathActive = (pathname: string, path: string) => {
  if (path === '/dashboard') return pathname === '/dashboard';
  return pathname === path || pathname.startsWith(`${path}/`);
};

export const getWorkspacePageTitle = (pathname: string) => {
  const item = workspaceNavItems.find((navItem) => isWorkspacePathActive(pathname, navItem.path));
  return item?.label ?? 'Lightchain';
};
