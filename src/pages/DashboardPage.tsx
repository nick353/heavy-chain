import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MoreVertical, Trash2, Edit3 } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import {
  IconSparkles,
  IconImage,
  IconArrowRight,
  IconClock,
  IconTrending,
  IconLayout,
  IconHelp,
  IconPlus,
  IconChevronRight,
  IconPalette,
  IconFolder
} from '../components/icons';
import { useCanvasStore, type CanvasProject } from '../stores/canvasStore';
import { supabase } from '../lib/supabase';
import { Button, Modal, Input, Textarea } from '../components/ui';
import { Onboarding, useOnboarding } from '../components/Onboarding';
import type { GeneratedImage } from '../types/database';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

const quickActions = [
  {
    id: 'text-to-image',
    title: '画像生成',
    description: 'プロンプトから画像を生成',
    icon: IconSparkles,
    href: '/generate',
    color: 'from-primary-500 to-gold-DEFAULT',
    delay: 0
  },
  {
    id: 'canvas',
    title: 'キャンバス',
    description: 'フリーキャンバスで編集',
    icon: IconLayout,
    href: '/canvas/new',
    color: 'from-blue-500 to-purple-500',
    delay: 0.1
  },
  {
    id: 'gallery',
    title: 'ギャラリー',
    description: '生成した画像を管理',
    icon: IconImage,
    href: '/gallery',
    color: 'from-accent-500 to-pink-500',
    delay: 0.2
  }
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number]
    }
  }
};

export function DashboardPage() {
  const navigate = useNavigate();
  const { user, profile, currentBrand, setCurrentBrand } = useAuthStore();
  const { projects, createProject, deleteProject, loadProject, clearCanvas, getRecentProjects } = useCanvasStore();
  const { showOnboarding, completeOnboarding, resetOnboarding } = useOnboarding();
  const [recentImages, setRecentImages] = useState<GeneratedImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [projectMenuOpen, setProjectMenuOpen] = useState<string | null>(null);
  const [brandForm, setBrandForm] = useState({
    name: '',
    toneDescription: '',
    targetAudience: ''
  });
  const [isCreatingBrand, setIsCreatingBrand] = useState(false);

  const recentProjects = getRecentProjects(6);

  useEffect(() => {
    if (!currentBrand && user) {
      checkBrands();
    } else if (currentBrand) {
      fetchRecentImages();
    } else if (!user) {
      // ユーザーがいない場合はローディングを解除
      setIsLoading(false);
    }
  }, [currentBrand, user]);

  const checkBrands = async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    try {
      const { data: brands, error } = await supabase
        .from('brands')
        .select('*')
        .eq('owner_id', user.id)
        .limit(1);

      if (error) {
        console.error('Failed to check brands:', error);
        setIsLoading(false);
        return;
      }

      if (!brands || brands.length === 0) {
        setShowBrandModal(true);
        setIsLoading(false);
      } else {
        setCurrentBrand(brands[0]);
        // ブランド設定後に画像を取得するので、ここではローディングを解除しない
      }
    } catch (error) {
      console.error('Failed to check brands:', error);
      toast.error('ブランド情報の取得に失敗しました');
      setIsLoading(false);
    }
  };

  const fetchRecentImages = async () => {
    if (!currentBrand) {
      setIsLoading(false);
      return;
    }
    
    try {
      const { data, error } = await supabase
        .from('generated_images')
        .select('*')
        .eq('brand_id', currentBrand.id)
        .order('created_at', { ascending: false })
        .limit(6);

      if (error) {
        console.error('Failed to fetch images:', error);
        toast.error('画像の取得に失敗しました');
        setRecentImages([]);
      } else {
        setRecentImages(data || []);
      }
    } catch (error) {
      console.error('Failed to fetch images:', error);
      toast.error('画像の取得に失敗しました');
      setRecentImages([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!brandForm.name.trim()) {
      toast.error('ブランド名を入力してください');
      return;
    }

    setIsCreatingBrand(true);
    try {
      const { data, error } = await supabase
        .from('brands')
        .insert({
          owner_id: user!.id,
          name: brandForm.name,
          tone_description: brandForm.toneDescription || null,
          target_audience: brandForm.targetAudience || null
        })
        .select()
        .single();

      if (error) throw error;

      // Create brand member entry
      await supabase.from('brand_members').insert({
        brand_id: data.id,
        user_id: user!.id,
        role: 'owner',
        joined_at: new Date().toISOString()
      });

      setCurrentBrand(data);
      setShowBrandModal(false);
      toast.success('ブランドを作成しました');
    } catch (error: any) {
      toast.error(error.message || 'ブランドの作成に失敗しました');
    } finally {
      setIsCreatingBrand(false);
    }
  };

  const handleCreateNewProject = () => {
    if (!newProjectName.trim()) {
      toast.error('プロジェクト名を入力してください');
      return;
    }
    
    const projectId = createProject(newProjectName, currentBrand?.id);
    setShowNewProjectModal(false);
    setNewProjectName('');
    toast.success('新規プロジェクトを作成しました');
    navigate(`/canvas/${projectId}`);
  };

  const handleOpenProject = (project: CanvasProject) => {
    loadProject(project.id);
    navigate(`/canvas/${project.id}`);
  };

  const handleDeleteProject = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteProject(projectId);
    setProjectMenuOpen(null);
    toast.success('プロジェクトを削除しました');
  };

  const handleNewCanvas = () => {
    clearCanvas();
    navigate('/canvas/new');
  };

  const getImageUrl = (path: string) => {
    if (!path) {
      console.warn('Image path is empty');
      return '';
    }
    try {
      const { data } = supabase.storage.from('generated-images').getPublicUrl(path);
      return data.publicUrl || '';
    } catch (error) {
      console.error('Failed to get image URL:', error);
      return '';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
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

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'おはようございます';
    if (hour < 18) return 'こんにちは';
    return 'こんばんは';
  };

  return (
    <>
      {/* Onboarding */}
      {showOnboarding && <Onboarding onComplete={completeOnboarding} />}

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8"
      >
        {/* Welcome Section */}
        <motion.div variants={itemVariants} className="mb-6 sm:mb-10 flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4">
          <div>
            <p className="text-xs sm:text-sm font-medium text-primary-600 dark:text-primary-400 mb-1 sm:mb-2 uppercase tracking-wider">Dashboard</p>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-display font-semibold text-neutral-900 dark:text-white">
              {getGreeting()}、<span className="text-neutral-500 dark:text-neutral-400">{profile?.name || 'ゲスト'}さん</span>
            </h1>
          </div>
          <button
            onClick={resetOnboarding}
            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 hover:bg-white/50 dark:hover:bg-white/5 rounded-full transition-colors border border-transparent hover:border-neutral-200 dark:hover:border-neutral-700"
          >
            <IconHelp className="w-3.5 h-3.5 sm:w-4 sm:h-4" size={16} />
            <span className="hidden sm:inline">チュートリアルを見る</span>
            <span className="sm:hidden">ヘルプ</span>
          </button>
        </motion.div>

        {/* Quick Actions */}
        <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 lg:gap-6 mb-8 sm:mb-12 lg:mb-16">
          {quickActions.map((action) => (
            <Link
              key={action.id}
              to={action.href}
              className="group relative overflow-hidden rounded-2xl sm:rounded-3xl bg-white dark:bg-surface-900 border border-neutral-100 dark:border-white/5 p-5 sm:p-6 lg:p-8 shadow-sm hover:shadow-floating transition-all duration-500 hover:-translate-y-1"
            >
              {/* Background Gradient */}
              <div className={`absolute top-0 right-0 w-32 sm:w-48 h-32 sm:h-48 bg-gradient-to-br ${action.color} opacity-[0.08] rounded-full -translate-y-1/4 translate-x-1/4 group-hover:scale-125 transition-transform duration-700 blur-3xl`} />
              
              <div className="relative z-10 flex items-start gap-4">
                <div className={`w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br ${action.color} rounded-xl sm:rounded-2xl flex items-center justify-center shadow-md group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 flex-shrink-0`}>
                  <action.icon className="w-6 h-6 sm:w-7 sm:h-7 text-white" size={28} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg sm:text-xl lg:text-2xl font-semibold text-neutral-900 dark:text-white mb-1 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                    {action.title}
                  </h3>
                  <p className="text-sm sm:text-base text-neutral-500 dark:text-neutral-400 leading-relaxed">
                    {action.description}
                  </p>
                </div>
                <IconChevronRight className="w-5 h-5 text-neutral-400 group-hover:text-primary-500 group-hover:translate-x-1 transition-all flex-shrink-0" size={20} />
              </div>
            </Link>
          ))}
        </motion.div>

        {/* Canvas Projects */}
        <motion.div variants={itemVariants} className="mb-8 sm:mb-12 lg:mb-16">
          <div className="flex items-center justify-between mb-4 sm:mb-6 lg:mb-8">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <IconFolder className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" size={20} />
              </div>
              <h2 className="text-lg sm:text-xl lg:text-2xl font-semibold text-neutral-900 dark:text-white font-display">プロジェクト</h2>
            </div>
            <button
              onClick={() => setShowNewProjectModal(true)}
              className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-primary-500 hover:bg-primary-600 text-white text-xs sm:text-sm font-medium transition-colors flex items-center gap-1.5 sm:gap-2 shadow-md hover:shadow-lg"
            >
              <IconPlus className="w-3.5 h-3.5 sm:w-4 sm:h-4" size={16} />
              <span className="hidden sm:inline">新規作成</span>
              <span className="sm:hidden">新規</span>
            </button>
          </div>

          {recentProjects.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 sm:gap-4 lg:gap-6">
              {/* New Canvas Card */}
              <button
                onClick={handleNewCanvas}
                className="group aspect-[4/3] rounded-xl sm:rounded-2xl border-2 border-dashed border-neutral-200 dark:border-neutral-800 flex flex-col items-center justify-center gap-2 sm:gap-3 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all duration-300"
              >
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 group-hover:bg-white dark:group-hover:bg-neutral-700">
                  <IconPlus className="w-5 h-5 sm:w-6 sm:h-6 text-neutral-400 group-hover:text-blue-500" size={24} />
                </div>
                <span className="text-xs sm:text-sm font-medium text-neutral-400 group-hover:text-blue-600">新規</span>
              </button>

              {/* Project Cards */}
              {recentProjects.map((project, i) => (
                <motion.div
                  key={project.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => handleOpenProject(project)}
                  className="group aspect-[4/3] rounded-xl sm:rounded-2xl overflow-hidden bg-white dark:bg-neutral-800 cursor-pointer relative shadow-sm hover:shadow-lg transition-all duration-300 border border-neutral-100 dark:border-neutral-700"
                >
                  {/* Thumbnail or Placeholder */}
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20">
                    {project.thumbnail ? (
                      <img src={project.thumbnail} alt={project.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <IconLayout className="w-8 h-8 sm:w-12 sm:h-12 text-neutral-300 dark:text-neutral-600" size={48} />
                      </div>
                    )}
                  </div>

                  {/* Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                  {/* Project Info */}
                  <div className="absolute bottom-0 left-0 right-0 p-2 sm:p-3 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-sm">
                    <h3 className="font-medium text-xs sm:text-sm text-neutral-800 dark:text-white truncate">
                      {project.name}
                    </h3>
                    <p className="text-[10px] sm:text-xs text-neutral-500 dark:text-neutral-400">
                      {formatDate(project.updatedAt)}
                    </p>
                  </div>

                  {/* Menu Button */}
                  <div className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setProjectMenuOpen(projectMenuOpen === project.id ? null : project.id);
                      }}
                      className="p-1 sm:p-1.5 rounded-lg bg-white/80 dark:bg-neutral-800/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 sm:transition-opacity hover:bg-white dark:hover:bg-neutral-700"
                      style={{ opacity: projectMenuOpen === project.id ? 1 : undefined }}
                    >
                      <MoreVertical className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-neutral-600 dark:text-neutral-300" />
                    </button>

                    {/* Dropdown Menu */}
                    <AnimatePresence>
                      {projectMenuOpen === project.id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -10 }}
                          className="absolute top-full right-0 mt-1 w-28 sm:w-32 bg-white dark:bg-neutral-800 rounded-lg sm:rounded-xl shadow-xl border border-neutral-100 dark:border-neutral-700 py-1 z-20"
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenProject(project);
                            }}
                            className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-left text-xs sm:text-sm text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 flex items-center gap-2"
                          >
                            <Edit3 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            開く
                          </button>
                          <button
                            onClick={(e) => handleDeleteProject(project.id, e)}
                            className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-left text-xs sm:text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                          >
                            <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            削除
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="bg-white/50 dark:bg-white/5 backdrop-blur-sm rounded-3xl p-12 border border-neutral-200/50 dark:border-white/5 text-center">
              <div className="w-24 h-24 bg-gradient-to-br from-blue-100 to-purple-100/50 dark:from-blue-900/30 dark:to-purple-900/30 rounded-3xl flex items-center justify-center mx-auto mb-8 animate-float">
                <IconLayout className="w-10 h-10 text-blue-600 dark:text-blue-400" size={40} />
              </div>
              <h3 className="text-2xl font-semibold text-neutral-900 dark:text-white mb-4 font-display">
                キャンバスで自由に編集
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-8 max-w-md mx-auto leading-relaxed">
                生成した画像を配置して、派生画像を管理。デザインワークフローを効率化できます。
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button 
                  size="lg" 
                  className="rounded-full shadow-glow hover:shadow-glow-lg" 
                  leftIcon={<IconPlus className="w-5 h-5" size={20} />}
                  onClick={() => setShowNewProjectModal(true)}
                >
                  新規プロジェクト作成
                </Button>
              </div>
            </div>
          )}
        </motion.div>

        {/* Recent Images */}
        <motion.div variants={itemVariants} className="mb-8 sm:mb-12 lg:mb-16">
          <div className="flex items-center justify-between mb-4 sm:mb-6 lg:mb-8">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-neutral-100 dark:bg-neutral-800 rounded-lg">
                <IconClock className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-500 dark:text-neutral-400" size={20} />
              </div>
              <h2 className="text-lg sm:text-xl lg:text-2xl font-semibold text-neutral-900 dark:text-white font-display">最近の生成</h2>
            </div>
            <Link
              to="/gallery"
              className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 text-xs sm:text-sm font-medium hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors flex items-center gap-1.5 sm:gap-2 group"
            >
              <span className="hidden sm:inline">すべて見る</span>
              <span className="sm:hidden">全て</span>
              <IconArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 group-hover:translate-x-1 transition-transform" size={16} />
            </Link>
          </div>

          {recentImages.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 sm:gap-4 lg:gap-6">
              {recentImages.map((image, i) => (
                <motion.div
                  key={image.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="group aspect-square rounded-xl sm:rounded-2xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 cursor-pointer relative shadow-sm hover:shadow-lg transition-all duration-300"
                  onClick={() => navigate(`/gallery?image=${image.id}`)}
                >
                  {getImageUrl(image.storage_path) ? (
                    <img
                      src={getImageUrl(image.storage_path)}
                      alt=""
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                      loading="lazy"
                      onError={(e) => {
                        console.error('Failed to load image:', image.storage_path);
                        e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3Ctext fill="%23999" x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle"%3E画像なし%3C/text%3E%3C/svg%3E';
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-neutral-200 dark:bg-neutral-700">
                      <span className="text-neutral-400 text-sm">読込失敗</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="absolute bottom-2 left-2 right-2 sm:bottom-3 sm:left-3 sm:right-3">
                      <p className="text-white text-[10px] sm:text-xs font-medium truncate opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                        {new Date(image.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
              
              {/* Add New Button */}
              <Link to="/generate" className="group aspect-square rounded-xl sm:rounded-2xl border-2 border-dashed border-neutral-200 dark:border-neutral-800 flex flex-col items-center justify-center gap-2 sm:gap-3 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-primary-50/50 dark:hover:bg-primary-900/10 transition-all duration-300">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 group-hover:bg-white dark:group-hover:bg-neutral-700">
                  <IconPlus className="w-5 h-5 sm:w-6 sm:h-6 text-neutral-400 group-hover:text-primary-500" size={24} />
                </div>
                <span className="text-xs sm:text-sm font-medium text-neutral-400 group-hover:text-primary-600">新規</span>
              </Link>
            </div>
          ) : (
            <div className="bg-white/50 dark:bg-white/5 backdrop-blur-sm rounded-3xl p-12 border border-neutral-200/50 dark:border-white/5 text-center">
              <div className="w-24 h-24 bg-gradient-to-br from-primary-100 to-gold-light/50 dark:from-primary-900/30 dark:to-gold-dark/30 rounded-3xl flex items-center justify-center mx-auto mb-8 animate-float">
                <IconPalette className="w-10 h-10 text-primary-600 dark:text-primary-400" size={40} />
              </div>
              <h3 className="text-2xl font-semibold text-neutral-900 dark:text-white mb-4 font-display">
                クリエイティブな旅を始めましょう
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-8 max-w-md mx-auto leading-relaxed">
                まだ画像がありません。日本語でプロンプトを入力するだけで、AIがあなたの想像を形にします。
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link to="/generate">
                  <Button size="lg" className="rounded-full shadow-glow hover:shadow-glow-lg" leftIcon={<IconSparkles className="w-5 h-5" size={20} />}>
                    画像を生成する
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </motion.div>

        {/* Stats Grid */}
        <motion.div variants={itemVariants} className="grid grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
          <div className="bg-white dark:bg-surface-900 rounded-xl sm:rounded-2xl p-3 sm:p-4 lg:p-6 border border-neutral-100 dark:border-white/5 shadow-sm">
            <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-4">
              <div className="p-1.5 sm:p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <IconTrending className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" size={20} />
              </div>
              <span className="text-[10px] sm:text-xs lg:text-sm font-medium text-neutral-500 dark:text-neutral-400 hidden sm:block">今月の生成数</span>
            </div>
            <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-neutral-900 dark:text-white font-display">
              {recentImages.length}
              <span className="text-xs sm:text-sm lg:text-base font-normal text-neutral-400 ml-1 sm:ml-2">枚</span>
            </p>
            <span className="text-[10px] text-neutral-400 sm:hidden">生成数</span>
          </div>
          
          <div className="bg-white dark:bg-surface-900 rounded-xl sm:rounded-2xl p-3 sm:p-4 lg:p-6 border border-neutral-100 dark:border-white/5 shadow-sm">
            <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-4">
              <div className="p-1.5 sm:p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                <IconFolder className="w-4 h-4 sm:w-5 sm:h-5 text-purple-500" size={20} />
              </div>
              <span className="text-[10px] sm:text-xs lg:text-sm font-medium text-neutral-500 dark:text-neutral-400 hidden sm:block">プロジェクト数</span>
            </div>
            <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-neutral-900 dark:text-white font-display">
              {projects.length}
              <span className="text-xs sm:text-sm lg:text-base font-normal text-neutral-400 ml-1 sm:ml-2">個</span>
            </p>
            <span className="text-[10px] text-neutral-400 sm:hidden">プロジェクト</span>
          </div>

          <div className="bg-white dark:bg-surface-900 rounded-xl sm:rounded-2xl p-3 sm:p-4 lg:p-6 border border-neutral-100 dark:border-white/5 shadow-sm">
            <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-4">
              <div className="p-1.5 sm:p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                <IconSparkles className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-500" size={20} />
              </div>
              <span className="text-[10px] sm:text-xs lg:text-sm font-medium text-neutral-500 dark:text-neutral-400 hidden sm:block">お気に入り</span>
            </div>
            <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-neutral-900 dark:text-white font-display">
              {recentImages.filter(img => img.is_favorite).length}
              <span className="text-xs sm:text-sm lg:text-base font-normal text-neutral-400 ml-1 sm:ml-2">枚</span>
            </p>
            <span className="text-[10px] text-neutral-400 sm:hidden">お気に入り</span>
          </div>
        </motion.div>
      </motion.div>

      {/* Brand Creation Modal */}
      <Modal
        isOpen={showBrandModal}
        onClose={() => {}}
        title="ブランドを作成"
        size="md"
        footer={
          <Button
            type="submit"
            form="brand-create-form"
            isLoading={isCreatingBrand}
            className="w-full py-4 text-lg shadow-glow"
            size="lg"
          >
            ブランドを作成してはじめる
          </Button>
        }
      >
        <form id="brand-create-form" onSubmit={handleCreateBrand} className="space-y-6">
          <div className="bg-primary-50/50 dark:bg-primary-900/20 rounded-2xl p-6 border border-primary-100 dark:border-primary-800/30">
            <div className="flex gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-800 flex items-center justify-center flex-shrink-0">
                <IconSparkles className="w-5 h-5 text-primary-600 dark:text-primary-400" size={20} />
              </div>
              <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">
                <span className="font-semibold text-primary-700 dark:text-primary-300 block mb-1">ようこそ、Heavy Chainへ！</span>
                まずはあなたのブランドを作成しましょう。AIがブランドの世界観を学習し、最適な画像を生成します。
              </p>
            </div>
          </div>
          
          <div className="space-y-4">
            <Input
              label="ブランド名"
              placeholder="例: URBAN STYLE"
              value={brandForm.name}
              onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })}
              required
              className="text-lg"
            />
            
            <Textarea
              label="世界観・トーン（任意）"
              placeholder="例: シンプルで洗練された大人のカジュアルスタイル。都会的でありながらリラックス感のある雰囲気。"
              value={brandForm.toneDescription}
              onChange={(e) => setBrandForm({ ...brandForm, toneDescription: e.target.value })}
              rows={3}
            />
            
            <Input
              label="ターゲット層（任意）"
              placeholder="例: 30代〜40代の働く男性"
              value={brandForm.targetAudience}
              onChange={(e) => setBrandForm({ ...brandForm, targetAudience: e.target.value })}
            />
          </div>
        </form>
      </Modal>

      {/* New Project Modal */}
      <Modal
        isOpen={showNewProjectModal}
        onClose={() => setShowNewProjectModal(false)}
        title="新規プロジェクト"
        size="sm"
      >
        <div className="space-y-6">
          <Input
            label="プロジェクト名"
            placeholder="例: 夏コレクション2024"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            autoFocus
          />
          
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => setShowNewProjectModal(false)}
              className="flex-1"
            >
              キャンセル
            </Button>
            <Button
              onClick={handleCreateNewProject}
              className="flex-1"
              leftIcon={<IconPlus className="w-4 h-4" size={16} />}
            >
              作成
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
