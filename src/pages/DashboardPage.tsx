import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Sparkles, 
  Image, 
  ArrowRight,
  Clock,
  TrendingUp,
  Layout,
  HelpCircle,
  BookOpen,
  Lightbulb,
  Zap
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { Button, Modal, Input, Textarea } from '../components/ui';
import { Onboarding, useOnboarding } from '../components/Onboarding';
import type { GeneratedImage } from '../types/database';
import toast from 'react-hot-toast';

const quickActions = [
  {
    id: 'text-to-image',
    title: '画像生成',
    description: 'プロンプトから画像を生成',
    icon: Sparkles,
    href: '/generate',
    color: 'from-primary-500 to-accent-500'
  },
  {
    id: 'canvas',
    title: 'キャンバスエディター',
    description: 'フリーキャンバスで編集',
    icon: Layout,
    href: '/canvas',
    color: 'from-blue-500 to-purple-500'
  },
  {
    id: 'gallery',
    title: 'ギャラリー',
    description: '生成した画像を管理',
    icon: Image,
    href: '/gallery',
    color: 'from-accent-500 to-primary-500'
  }
];

const tips = [
  {
    icon: Lightbulb,
    title: '日本語でOK',
    description: 'プロンプトは日本語で入力できます。AIが自動で最適化します。'
  },
  {
    icon: Zap,
    title: 'デザインガチャ',
    description: '1つのブリーフから複数スタイルを一括生成できます。'
  },
  {
    icon: BookOpen,
    title: 'チャット編集',
    description: '「もっと明るく」など対話形式で画像を編集できます。'
  }
];

export function DashboardPage() {
  const navigate = useNavigate();
  const { user, profile, currentBrand, setCurrentBrand } = useAuthStore();
  const { showOnboarding, completeOnboarding, resetOnboarding } = useOnboarding();
  const [recentImages, setRecentImages] = useState<GeneratedImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [brandForm, setBrandForm] = useState({
    name: '',
    toneDescription: '',
    targetAudience: ''
  });
  const [isCreatingBrand, setIsCreatingBrand] = useState(false);

  useEffect(() => {
    if (!currentBrand && user) {
      checkBrands();
    } else if (currentBrand) {
      fetchRecentImages();
    }
  }, [currentBrand, user]);

  const checkBrands = async () => {
    try {
      const { data: brands } = await supabase
        .from('brands')
        .select('*')
        .eq('owner_id', user!.id)
        .limit(1);

      if (!brands || brands.length === 0) {
        setShowBrandModal(true);
      } else {
        setCurrentBrand(brands[0]);
      }
    } catch (error) {
      console.error('Failed to check brands:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchRecentImages = async () => {
    if (!currentBrand) return;
    
    try {
      const { data, error } = await supabase
        .from('generated_images')
        .select('*')
        .eq('brand_id', currentBrand.id)
        .order('created_at', { ascending: false })
        .limit(6);

      if (error) throw error;
      setRecentImages(data || []);
    } catch (error) {
      console.error('Failed to fetch images:', error);
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

  const getImageUrl = (path: string) => {
    const { data } = supabase.storage.from('generated-images').getPublicUrl(path);
    return data.publicUrl;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <>
      {/* Onboarding */}
      {showOnboarding && <Onboarding onComplete={completeOnboarding} />}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-display font-semibold text-neutral-900 mb-2">
              こんにちは、{profile?.name || 'ユーザー'}さん
            </h1>
            <p className="text-neutral-600">
              今日も素敵な画像を生成しましょう。
            </p>
          </div>
          <button
            onClick={resetOnboarding}
            className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors"
            title="チュートリアルを再表示"
          >
            <HelpCircle className="w-4 h-4" />
            <span className="hidden sm:inline">ヘルプ</span>
          </button>
        </div>

        {/* Quick Actions */}
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-6 mb-12">
          {quickActions.map((action) => (
            <Link
              key={action.id}
              to={action.href}
              className="group relative overflow-hidden bg-white rounded-2xl p-6 shadow-soft hover:shadow-elegant transition-all duration-300"
            >
              <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${action.color} opacity-10 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-500`} />
              
              <div className="relative">
                <div className={`w-12 h-12 bg-gradient-to-br ${action.color} rounded-xl flex items-center justify-center mb-4 shadow-lg`}>
                  <action.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-neutral-800 mb-1 group-hover:text-primary-700 transition-colors">
                  {action.title}
                </h3>
                <p className="text-neutral-500">{action.description}</p>
                <ArrowRight className="absolute bottom-0 right-0 w-5 h-5 text-neutral-300 group-hover:text-primary-500 group-hover:translate-x-1 transition-all" />
              </div>
            </Link>
          ))}
        </div>

        {/* Recent Images */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-neutral-400" />
              <h2 className="text-xl font-semibold text-neutral-800">最近の生成画像</h2>
            </div>
            <Link
              to="/gallery"
              className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
            >
              すべて見る
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {recentImages.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
              {recentImages.map((image) => (
                <div
                  key={image.id}
                  className="aspect-square rounded-xl overflow-hidden bg-neutral-100 hover:ring-2 hover:ring-primary-500 transition-all cursor-pointer"
                  onClick={() => navigate(`/gallery?image=${image.id}`)}
                >
                  <img
                    src={getImageUrl(image.storage_path)}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-gradient-to-br from-neutral-50 to-neutral-100 rounded-2xl p-12 text-center border border-neutral-200">
              <div className="w-20 h-20 bg-gradient-to-br from-primary-100 to-accent-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Image className="w-10 h-10 text-primary-500" />
              </div>
              <h3 className="text-xl font-semibold text-neutral-800 mb-2">
                まだ画像がありません
              </h3>
              <p className="text-neutral-500 mb-6 max-w-md mx-auto">
                最初の画像を生成してみましょう。日本語でプロンプトを入力するだけで、AIがプロ品質の画像を作成します。
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link to="/generate">
                  <Button size="lg" leftIcon={<Sparkles className="w-5 h-5" />}>
                    画像を生成
                  </Button>
                </Link>
                <Link to="/canvas">
                  <Button size="lg" variant="secondary" leftIcon={<Layout className="w-5 h-5" />}>
                    キャンバスを開く
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Tips for new users */}
        {recentImages.length === 0 && (
          <div className="mb-12">
            <h2 className="text-lg font-semibold text-neutral-800 mb-4">💡 使い方のヒント</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              {tips.map((tip, i) => (
                <div key={i} className="bg-white rounded-xl p-5 shadow-soft">
                  <div className="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center mb-3">
                    <tip.icon className="w-5 h-5 text-primary-600" />
                  </div>
                  <h3 className="font-medium text-neutral-800 mb-1">{tip.title}</h3>
                  <p className="text-sm text-neutral-500">{tip.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid sm:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl p-6 shadow-soft">
            <div className="flex items-center gap-3 mb-2">
              <TrendingUp className="w-5 h-5 text-primary-500" />
              <span className="text-sm font-medium text-neutral-500">今月の生成数</span>
            </div>
            <p className="text-3xl font-semibold text-neutral-800">
              {recentImages.length}
            </p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-soft">
            <div className="flex items-center gap-3 mb-2">
              <Image className="w-5 h-5 text-accent-500" />
              <span className="text-sm font-medium text-neutral-500">保存済み画像</span>
            </div>
            <p className="text-3xl font-semibold text-neutral-800">
              {recentImages.length}
            </p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-soft">
            <div className="flex items-center gap-3 mb-2">
              <Sparkles className="w-5 h-5 text-yellow-500" />
              <span className="text-sm font-medium text-neutral-500">お気に入り</span>
            </div>
            <p className="text-3xl font-semibold text-neutral-800">
              {recentImages.filter(img => img.is_favorite).length}
            </p>
          </div>
        </div>
      </div>

      {/* Brand Creation Modal */}
      <Modal
        isOpen={showBrandModal}
        onClose={() => {}}
        title="ブランドを作成"
        size="md"
      >
        <form onSubmit={handleCreateBrand} className="space-y-4">
          <div className="bg-primary-50 rounded-xl p-4 mb-4">
            <p className="text-sm text-primary-800">
              🎉 ようこそ！まずはブランドを作成しましょう。ブランドごとに画像やスタイルを管理できます。
            </p>
          </div>
          
          <Input
            label="ブランド名"
            placeholder="例: URBAN STYLE"
            value={brandForm.name}
            onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })}
            required
          />
          
          <Textarea
            label="世界観・トーン（任意）"
            placeholder="例: シンプルで洗練された大人のカジュアルスタイル"
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

          <Button
            type="submit"
            isLoading={isCreatingBrand}
            className="w-full"
            size="lg"
          >
            ブランドを作成してはじめる
          </Button>
        </form>
      </Modal>
    </>
  );
}
