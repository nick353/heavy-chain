import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  BarChart3,
  Bot,
  Brush,
  CheckCircle2,
  ChevronRight,
  ImagePlus,
  Layers,
  Megaphone,
  MonitorUp,
  Radio,
  Settings2,
  ShoppingBag,
  Store,
  Upload,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useCanvasStore } from '../stores/canvasStore';
import { saveWorkspaceArtifactBestEffort } from '../lib/localWorkspaceArtifacts';

const channels = [
  { id: 'ec', label: 'EC', icon: ShoppingBag },
  { id: 'sns', label: 'SNS', icon: Megaphone },
  { id: 'brand', label: 'ブランド', icon: Brush },
  { id: 'store', label: '店舗・オフライン', icon: Store },
  { id: 'live', label: 'ライブ配信', icon: Radio },
  { id: 'promo', label: 'プロモーション', icon: MonitorUp },
] as const;

const templatesByChannel = {
  ec: ['メイン画像', '詳細画像', '白背景・背景削除', '商品比較バナー'],
  sns: ['Instagram投稿', 'Threads告知', 'Xキャンペーン', 'ショート動画表紙'],
  brand: ['ブランドキービジュアル', 'ルックブック表紙', 'ムードボード', 'ラインシート'],
  store: ['店舗ポスター', 'POPカード', '棚前サイン', 'イベント告知'],
  live: ['ライブ配信サムネイル', '配信中テロップ', '購入導線バナー', '次回告知'],
  promo: ['クーポンバナー', '期間限定LP', 'リターゲティング広告', '予約販売告知'],
} as const;

const projects = [
  { name: '24SS Linen Launch', format: 'EC / SNS', updated: '今日 14:20' },
  { name: 'Holiday Capsule Poster', format: '店舗ポスター', updated: '昨日' },
  { name: 'Live Commerce Kit', format: 'ライブ配信', updated: '2日前' },
];

type ChannelId = (typeof channels)[number]['id'];
type MarketingJobStatus = 'idle' | 'running' | 'stalled' | 'failed' | 'succeeded';
type MarketingJob = {
  id: string;
  status: MarketingJobStatus;
  progress: number;
  startedAt: number | null;
  errorMessage: string | null;
};

const initialJob: MarketingJob = {
  id: 'local-marketing-draft',
  status: 'idle',
  progress: 0,
  startedAt: null,
  errorMessage: null,
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('画像を読み込めませんでした。'));
    };
    reader.onerror = () => reject(new Error('画像を読み込めませんでした。'));
    reader.readAsDataURL(file);
  });
}

export function MarketingWorkspacePage() {
  const navigate = useNavigate();
  const { currentBrand } = useAuthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeChannel, setActiveChannel] = useState<ChannelId>('ec');
  const [selectedTemplate, setSelectedTemplate] = useState<string>(templatesByChannel.ec[0]);
  const [campaignCopy, setCampaignCopy] = useState('軽やかなリネンセットで、静かな夏をはじめる。');
  const [productImageUrl, setProductImageUrl] = useState('');
  const [productFileName, setProductFileName] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [job, setJob] = useState<MarketingJob>(initialJob);
  const [isHandingOff, setIsHandingOff] = useState(false);

  const { createProject, addObject, saveCurrentProject } = useCanvasStore();

  const activeLabel = useMemo(
    () => channels.find((channel) => channel.id === activeChannel)?.label ?? 'EC',
    [activeChannel]
  );
  const templateOptions = templatesByChannel[activeChannel];
  const canStart = Boolean(productImageUrl && campaignCopy.trim());
  const canHandoff = Boolean(
    currentBrand &&
    productImageUrl &&
    (job.status === 'running' || job.status === 'stalled' || job.status === 'succeeded')
  );

  useEffect(() => {
    setSelectedTemplate((current) => (
      templateOptions.includes(current as never) ? current : templateOptions[0]
    ));
  }, [templateOptions]);

  useEffect(() => {
    if (job.status !== 'running') return;

    const progressTimer = window.setInterval(() => {
      setJob((current) => {
        if (current.status !== 'running') return current;
        const nextProgress = Math.min(current.progress + 9, 100);
        return {
          ...current,
          progress: nextProgress,
          status: nextProgress >= 100 ? 'succeeded' : 'running',
        };
      });
    }, 450);

    const stalledTimer = window.setTimeout(() => {
      setJob((current) => {
        if (current.status !== 'running' || current.progress >= 100) return current;
        return { ...current, status: 'stalled', errorMessage: null };
      });
    }, 6_000);

    return () => {
      window.clearInterval(progressTimer);
      window.clearTimeout(stalledTimer);
    };
  }, [job.status, job.id]);

  const handleChannelChange = (channelId: ChannelId) => {
    setActiveChannel(channelId);
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadError('');
    try {
      setProductImageUrl(await readFileAsDataUrl(file));
      setProductFileName(file.name);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '画像を読み込めませんでした。');
    }
  };

  const startJob = () => {
    if (!canStart) {
      setUploadError('商品画像とキャンペーンコピーを入力してください。');
      return;
    }

    setUploadError('');
    setJob({
      id: `local-marketing-${Date.now()}`,
      status: 'running',
      progress: 12,
      startedAt: Date.now(),
      errorMessage: null,
    });
  };

  const markStalled = () => {
    setJob((current) => ({
      ...current,
      status: 'stalled',
      progress: Math.max(current.progress, 44),
      errorMessage: null,
    }));
  };

  const failJob = () => {
    setJob((current) => ({
      ...current,
      status: 'failed',
      progress: Math.max(current.progress, 32),
      errorMessage: 'ローカル生成ジョブで検証用の失敗を検出しました。',
    }));
  };

  const retryJob = () => {
    startJob();
  };

  const completeJob = () => {
    setJob((current) => ({
      ...current,
      status: 'succeeded',
      progress: 100,
      errorMessage: null,
    }));
  };

  const handoffToCanvas = async () => {
    if (!productImageUrl || !currentBrand || isHandingOff) return;

    setIsHandingOff(true);
    const projectId = createProject(`Marketing: ${activeLabel} / ${selectedTemplate}`, currentBrand.id);
    try {
      const result = await saveWorkspaceArtifactBestEffort({
        brandId: currentBrand.id,
        featureType: 'marketing-workflow',
        title: `Marketing: ${activeLabel} / ${selectedTemplate}`,
        imageUrl: productImageUrl,
        prompt: campaignCopy.trim(),
        canvasProjectId: projectId,
        sourceJobId: job.id,
        metadata: {
          feature: 'marketing-workflow',
          channel: activeChannel,
          channelLabel: activeLabel,
          template: selectedTemplate,
          campaignCopy: campaignCopy.trim(),
          productFileName,
          jobStatus: job.status,
        },
      });
      if (result.remote) {
        toast.success('Canvasへ渡し、生成履歴にも保存しました');
      } else {
        toast.success('Canvasへ渡しました。Gallery/Historyはローカル保存です');
      }
    } finally {
      setIsHandingOff(false);
    }
    addObject({
      type: 'image',
      x: 96,
      y: 96,
      width: 360,
      height: 360,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      locked: false,
      visible: true,
      src: productImageUrl,
      label: productFileName || '商品画像',
      metadata: {
        feature: 'marketing-workflow',
        prompt: campaignCopy.trim(),
        generation: 0,
        parameters: {
          channel: activeChannel,
          channelLabel: activeLabel,
          template: selectedTemplate,
          jobStatus: job.status,
        },
      },
    });
    addObject({
      type: 'text',
      x: 500,
      y: 120,
      width: 320,
      height: 120,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      locked: false,
      visible: true,
      text: campaignCopy.trim(),
      fontSize: 28,
      fontFamily: 'Noto Sans JP',
      fill: '#262626',
      label: 'キャンペーンコピー',
      metadata: {
        feature: 'marketing-workflow',
        prompt: campaignCopy.trim(),
        generation: 0,
        parameters: {
          channel: activeChannel,
          template: selectedTemplate,
          sourceJobId: job.id,
        },
      },
    });
    saveCurrentProject();
    navigate(`/canvas/${projectId}`);
  };

  const statusLabel = {
    idle: '未開始',
    running: '処理中',
    stalled: '停滞中',
    failed: '失敗',
    succeeded: '完了',
  }[job.status];

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold text-neutral-950 dark:text-white">
              マーケティングワークスペース
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              商品画像、販促チャネル、テンプレート、コピーをまとめてローカルジョブ化し、制作中の状態からキャンバスへ渡せます。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handoffToCanvas()}
            disabled={!canHandoff || isHandingOff}
            className="btn-secondary inline-flex items-center justify-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isHandingOff ? '保存中' : 'キャンバスへ渡す'}
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" role="list" aria-label="販促チャネル">
          {channels.map((channel) => {
            const Icon = channel.icon;
            const active = channel.id === activeChannel;
            return (
              <button
                key={channel.id}
                type="button"
                onClick={() => handleChannelChange(channel.id)}
                aria-pressed={active}
                className={`rounded-2xl border p-4 text-left transition ${
                  active
                    ? 'border-primary-300 bg-primary-50/80 text-primary-900 shadow-sm dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-100'
                    : 'border-white/60 bg-white/45 text-neutral-600 hover:bg-white/70 dark:border-white/10 dark:bg-surface-900/40 dark:text-neutral-300'
                }`}
              >
                <Icon className="h-5 w-5" />
                <p className="mt-3 text-sm font-semibold">{channel.label}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.85fr_1.25fr_0.9fr]">
        <aside className="glass-panel rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">テンプレート</h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{activeLabel} 用の制作プリセット</p>
          <div className="mt-4 space-y-2">
            {templateOptions.map((template) => (
              <button
                key={template}
                type="button"
                onClick={() => setSelectedTemplate(template)}
                aria-pressed={selectedTemplate === template}
                className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
                  selectedTemplate === template
                    ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                    : 'bg-white/55 text-neutral-700 hover:bg-white dark:bg-surface-900/50 dark:text-neutral-300'
                }`}
              >
                {template}
                <ChevronRight className="h-4 w-4" />
              </button>
            ))}
          </div>

          <div className="mt-6 rounded-2xl bg-surface-100 p-4 dark:bg-surface-950/70">
            <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-white">
              <BarChart3 className="h-4 w-4 text-primary-600" />
              ローカルジョブ
            </div>
            <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
              状態: <span className="font-semibold text-neutral-800 dark:text-neutral-200">{statusLabel}</span>
            </p>
            <div className="mt-4 h-2 rounded-full bg-white dark:bg-surface-800" aria-label="ジョブ進捗">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  job.status === 'failed'
                    ? 'bg-red-500'
                    : job.status === 'stalled'
                      ? 'bg-amber-500'
                      : 'bg-gradient-to-r from-primary-500 to-gold-DEFAULT'
                }`}
                style={{ width: `${job.progress}%` }}
              />
            </div>
            <p className="mt-2 text-xs font-semibold text-primary-700 dark:text-primary-300">
              {statusLabel} {job.progress}%
            </p>
            {job.status === 'stalled' && (
              <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                応答が遅れています。処理中のままキャンバスへ渡すか、完了/失敗で状態を確認できます。
              </p>
            )}
            {job.status === 'failed' && (
              <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-red-700 dark:text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {job.errorMessage}
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={markStalled} disabled={job.status === 'idle'} className="btn-secondary justify-center text-xs disabled:cursor-not-allowed disabled:opacity-50">
                停滞を表示
              </button>
              <button type="button" onClick={failJob} disabled={job.status === 'idle'} className="btn-secondary justify-center text-xs disabled:cursor-not-allowed disabled:opacity-50">
                失敗を表示
              </button>
              <button type="button" onClick={completeJob} disabled={job.status === 'idle'} className="btn-secondary justify-center text-xs disabled:cursor-not-allowed disabled:opacity-50">
                完了にする
              </button>
              <button type="button" onClick={retryJob} disabled={job.status !== 'failed'} className="btn-secondary justify-center text-xs disabled:cursor-not-allowed disabled:opacity-50">
                再試行
              </button>
            </div>
          </div>
        </aside>

        <main className="glass-panel rounded-2xl p-5">
          <div className="rounded-2xl border border-white/60 bg-white/55 p-4 dark:border-white/10 dark:bg-surface-900/45">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">
                  キャンペーン入力
                </h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">{selectedTemplate} / {activeLabel}</p>
              </div>
              <button
                type="button"
                onClick={startJob}
                disabled={!canStart || job.status === 'running'}
                className="btn-primary inline-flex items-center justify-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Bot className="h-4 w-4" />
                ジョブ開始
              </button>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-4">
                <p className="text-sm font-semibold text-neutral-900 dark:text-white">商品画像</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex min-h-48 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-primary-200 bg-primary-50/40 p-4 text-center transition hover:bg-primary-50 dark:border-primary-800 dark:bg-primary-950/20"
                >
                  {productImageUrl ? (
                    <img src={productImageUrl} alt="アップロードした商品プレビュー" className="max-h-44 rounded-xl object-contain" />
                  ) : (
                    <>
                      <ImagePlus className="h-8 w-8 text-primary-600 dark:text-primary-300" />
                      <span className="mt-3 text-sm font-semibold text-neutral-900 dark:text-white">画像をアップロード</span>
                      <span className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">ローカル data URL でプレビューします</span>
                    </>
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  aria-label="商品画像アップロード"
                  onChange={handleFileChange}
                />
                {productFileName && (
                  <p className="flex items-center gap-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                    <Upload className="h-4 w-4 text-primary-600" />
                    {productFileName}
                  </p>
                )}
                {uploadError && <p className="text-xs font-semibold text-red-600 dark:text-red-300">{uploadError}</p>}
              </div>

              <div className="space-y-4">
                <label htmlFor="campaign-copy" className="block text-sm font-semibold text-neutral-900 dark:text-white">
                  キャンペーンコピー
                </label>
                <textarea
                  id="campaign-copy"
                  value={campaignCopy}
                  onChange={(event) => setCampaignCopy(event.target.value)}
                  rows={6}
                  className="w-full rounded-2xl border border-white/70 bg-white/80 p-4 text-sm leading-6 text-neutral-900 shadow-inner outline-none transition focus:border-primary-300 focus:ring-2 focus:ring-primary-200 dark:border-white/10 dark:bg-surface-950/70 dark:text-white dark:focus:border-primary-700 dark:focus:ring-primary-900/50"
                />
                <div className="rounded-2xl bg-surface-100 p-4 dark:bg-surface-950/70">
                  <p className="text-xs font-semibold uppercase text-primary-600 dark:text-primary-300">Preview brief</p>
                  <p className="mt-2 text-sm font-semibold text-neutral-950 dark:text-white">{activeLabel} / {selectedTemplate}</p>
                  <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                    {campaignCopy.trim() || 'コピーを入力してください。'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </main>

        <aside className="space-y-5">
          <section className="glass-panel rounded-2xl p-5">
            <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">マイプロジェクト</h2>
            <div className="mt-4 space-y-3">
              {projects.map((project) => (
                <button key={project.name} type="button" className="w-full rounded-2xl bg-white/55 p-4 text-left transition hover:bg-white dark:bg-surface-900/45 dark:hover:bg-surface-900/70">
                  <p className="text-sm font-semibold text-neutral-900 dark:text-white">{project.name}</p>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{project.format} / {project.updated}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="glass-panel rounded-2xl p-5">
            <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">制作アシスタント</h2>
            <div className="mt-4 space-y-3">
              {[
                { icon: CheckCircle2, label: '入力チェック', text: productImageUrl ? '商品画像を確認済み' : '商品画像を追加してください' },
                { icon: Layers, label: 'レイヤー設計', text: '画像とコピーをキャンバスの初期レイヤーに変換' },
                { icon: Settings2, label: '出力準備', text: job.status === 'succeeded' ? 'キャンバスへ渡せます' : '処理中でも制作を続行できます' },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/60 bg-white/45 p-4 dark:border-white/10 dark:bg-surface-900/45">
                  <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-white">
                    <item.icon className="h-4 w-4 text-primary-600" />
                    {item.label}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{item.text}</p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}
