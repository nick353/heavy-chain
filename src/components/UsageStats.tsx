import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Image, Folder, Heart, Clock, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

interface Stats {
  totalImages: number;
  thisMonthImages: number;
  favoriteImages: number;
  totalProjects: number;
  storageUsedMB: number;
  mostUsedFeature: string | null;
  recentActivity: Array<{
    type: 'generation' | 'favorite' | 'project';
    timestamp: Date;
    details: string;
  }>;
}

interface UsageStatsProps {
  className?: string;
}

export function UsageStats({ className }: UsageStatsProps) {
  const { currentBrand } = useAuthStore();
  const [stats, setStats] = useState<Stats>({
    totalImages: 0,
    thisMonthImages: 0,
    favoriteImages: 0,
    totalProjects: 0,
    storageUsedMB: 0,
    mostUsedFeature: null,
    recentActivity: [],
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (currentBrand) {
      fetchStats();
    }
  }, [currentBrand]);

  const fetchStats = async () => {
    if (!currentBrand) return;

    try {
      // Get total images
      const { count: totalCount } = await supabase
        .from('generated_images')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', currentBrand.id);

      // Get this month's images
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { count: monthCount } = await supabase
        .from('generated_images')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', currentBrand.id)
        .gte('created_at', startOfMonth.toISOString());

      // Get favorites count
      const { count: favCount } = await supabase
        .from('generated_images')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', currentBrand.id)
        .eq('is_favorite', true);

      setStats(prev => ({
        ...prev,
        totalImages: totalCount || 0,
        thisMonthImages: monthCount || 0,
        favoriteImages: favCount || 0,
      }));
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const statItems = [
    {
      label: '今月の生成数',
      value: stats.thisMonthImages,
      icon: TrendingUp,
      color: 'text-blue-500',
      bgColor: 'bg-blue-50 dark:bg-blue-900/20',
      suffix: '枚',
    },
    {
      label: '累計生成数',
      value: stats.totalImages,
      icon: Image,
      color: 'text-purple-500',
      bgColor: 'bg-purple-50 dark:bg-purple-900/20',
      suffix: '枚',
    },
    {
      label: 'お気に入り',
      value: stats.favoriteImages,
      icon: Heart,
      color: 'text-rose-500',
      bgColor: 'bg-rose-50 dark:bg-rose-900/20',
      suffix: '枚',
    },
  ];

  if (isLoading) {
    return (
      <div className={className}>
        <div className="animate-pulse grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-neutral-100 dark:bg-neutral-800 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="grid grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
        {statItems.map((item, index) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="bg-white dark:bg-surface-900 rounded-xl sm:rounded-2xl p-3 sm:p-4 lg:p-6 border border-neutral-100 dark:border-white/5 shadow-sm"
          >
            <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-4">
              <div className={`p-1.5 sm:p-2 ${item.bgColor} rounded-lg`}>
                <item.icon className={`w-4 h-4 sm:w-5 sm:h-5 ${item.color}`} />
              </div>
              <span className="text-[10px] sm:text-xs lg:text-sm font-medium text-neutral-500 dark:text-neutral-400 hidden sm:block">
                {item.label}
              </span>
            </div>
            <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-neutral-900 dark:text-white font-display">
              {item.value.toLocaleString()}
              <span className="text-xs sm:text-sm lg:text-base font-normal text-neutral-400 ml-1 sm:ml-2">
                {item.suffix}
              </span>
            </p>
            <span className="text-[10px] text-neutral-400 sm:hidden">{item.label}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
