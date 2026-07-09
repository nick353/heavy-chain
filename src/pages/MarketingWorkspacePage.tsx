import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  BarChart3,
  Bot,
  Brush,
  CheckCircle2,
  ChevronRight,
  Images,
  Layers,
  Megaphone,
  MonitorUp,
  Radio,
  Settings2,
  ShoppingBag,
  Sparkles,
  Store,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useCanvasStore } from '../stores/canvasStore';
import { saveWorkspaceArtifactBestEffort } from '../lib/localWorkspaceArtifacts';
import { MaterialWorkbench } from '../components/workspace/MaterialWorkbench';
import {
  buildMaterialReferenceMetadata,
  type MaterialReferenceState,
} from '../lib/workspaceMaterialReferences';
import { buildGenerationIntentHref, workspaceSourceConfig } from '../lib/workspaceHandoff';

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

const initialMaterialReference: MaterialReferenceState = {
  imageUrl: '',
  fileName: '',
  materialKind: '商品画像',
  maskMode: 'auto',
  activeLayer: '商品',
  placement: 'メインビジュアル',
  scale: 68,
  note: '販促素材の主役にする商品画像と配置を先に決めます。',
};

const marketingReadinessItems = [
  { label: '素材', detail: '商品、ロゴ、背景を販促レイヤーにする' },
  { label: '訴求', detail: 'チャネル、テンプレート、コピーを1つにまとめる' },
  { label: '出力', detail: '生成、Canvas、Galleryへ同じ条件で渡す' },
];

const encodeSvg = (svg: string) => {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const escapeSvgText = (value: string) => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
};

const buildMarketingPreviewSvg = ({
  activeLabel,
  selectedTemplate,
  campaignCopy,
  materialReference,
}: {
  activeLabel: string;
  selectedTemplate: string;
  campaignCopy: string;
  materialReference: MaterialReferenceState;
}) => {
  const safeChannel = escapeSvgText(activeLabel);
  const safeTemplate = escapeSvgText(selectedTemplate);
  const safeCopy = escapeSvgText((campaignCopy.trim() || 'コピー未入力').slice(0, 72));
  const safeLayer = escapeSvgText(materialReference.activeLayer);
  const safePlacement = escapeSvgText(materialReference.placement);
  const safeMaterialKind = escapeSvgText(materialReference.materialKind);
  const safeFileName = escapeSvgText(materialReference.fileName || '素材追加前');
  const accent = '#67e8f9';

  return encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640" data-marketing-preview="marketing-brief-local-v1">
      <metadata>
        <marketing-brief workflowVersion="marketing-brief-local-v1" selectedMarketingChannel="${safeChannel}" selectedTemplate="${safeTemplate}" activeLayer="${safeLayer}" placement="${safePlacement}" />
      </metadata>
      <rect width="960" height="640" rx="36" fill="#050707"/>
      <rect x="54" y="54" width="852" height="532" rx="30" fill="#0a0b0b" stroke="#1f2937"/>
      <rect x="92" y="104" width="372" height="404" rx="30" fill="#101313" stroke="#1f2937"/>
      <rect x="128" y="150" width="300" height="240" rx="26" fill="${accent}" opacity=".12" stroke="${accent}" stroke-width="4"/>
      <circle cx="278" cy="242" r="74" fill="${accent}" opacity=".82"/>
      <path d="M160 426h236M160 464h170" stroke="#e5e7eb" stroke-width="18" stroke-linecap="round" opacity=".82"/>
      <text x="128" y="548" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" fill="#f9fafb">selected-marketing-brief:${safeChannel}/${safeTemplate}</text>
      <text x="128" y="576" font-family="Inter, Arial, sans-serif" font-size="16" fill="#a3a3a3">workflowVersion:marketing-brief-local-v1</text>
      <text x="548" y="138" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="${accent}">Marketing brief</text>
      <text x="548" y="190" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="800" fill="#f9fafb">${safeChannel}</text>
      <text x="548" y="238" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700" fill="#f9fafb">${safeTemplate}</text>
      <text x="548" y="292" font-family="Inter, Arial, sans-serif" font-size="18" fill="#d4d4d4">copy: ${safeCopy}</text>
      <text x="548" y="342" font-family="Inter, Arial, sans-serif" font-size="18" fill="#d4d4d4">material: ${safeMaterialKind} / ${safeFileName}</text>
      <text x="548" y="392" font-family="Inter, Arial, sans-serif" font-size="18" fill="#d4d4d4">layer: ${safeLayer}</text>
      <text x="548" y="442" font-family="Inter, Arial, sans-serif" font-size="18" fill="#d4d4d4">placement: ${safePlacement}</text>
      <text x="548" y="504" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" fill="#f9fafb">Next step</text>
      <text x="548" y="532" font-family="Inter, Arial, sans-serif" font-size="16" fill="#d4d4d4">campaign-image generation or Canvas layout</text>
    </svg>
  `);
};

export function MarketingWorkspacePage() {
  const navigate = useNavigate();
  const { currentBrand } = useAuthStore();
  const [activeChannel, setActiveChannel] = useState<ChannelId>('ec');
  const [selectedTemplate, setSelectedTemplate] = useState<string>(templatesByChannel.ec[0]);
  const [campaignCopy, setCampaignCopy] = useState('軽やかなリネンセットで、静かな夏をはじめる。');
  const [materialReference, setMaterialReference] = useState<MaterialReferenceState>(initialMaterialReference);
  const [uploadError, setUploadError] = useState('');
  const [job, setJob] = useState<MarketingJob>(initialJob);
  const [isHandingOff, setIsHandingOff] = useState(false);

  const { createProject, addObject, saveCurrentProject } = useCanvasStore();
  const productImageUrl = materialReference.imageUrl;
  const productFileName = materialReference.fileName;

  const activeLabel = useMemo(
    () => channels.find((channel) => channel.id === activeChannel)?.label ?? 'EC',
    [activeChannel]
  );
  const templateOptions = templatesByChannel[activeChannel];
  const previewImageUrl = useMemo(() => buildMarketingPreviewSvg({
    activeLabel,
    selectedTemplate,
    campaignCopy,
    materialReference,
  }), [activeLabel, campaignCopy, materialReference, selectedTemplate]);
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

  useEffect(() => {
    if (productImageUrl && uploadError) setUploadError('');
  }, [productImageUrl, uploadError]);

  const handleChannelChange = (channelId: ChannelId) => {
    setActiveChannel(channelId);
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
    const materialReferenceMetadata = buildMaterialReferenceMetadata(materialReference);
    const materialReferenceSummary = materialReferenceMetadata.hasImage
      ? `${materialReferenceMetadata.materialKind}: ${materialReferenceMetadata.fileName ?? 'uploaded'} / ${materialReferenceMetadata.activeLayer} / ${materialReferenceMetadata.placement} / ${materialReferenceMetadata.scale}%`
      : '素材を追加するとここに反映されます';
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
          materialReference: materialReferenceMetadata,
          materialReferences: [materialReferenceMetadata],
          layerPlan: {
            activeLayer: materialReference.activeLayer,
            placement: materialReference.placement,
            scale: materialReference.scale,
          },
          maskPlan: {
            maskMode: materialReference.maskMode,
          },
          compositionPreview: {
            channel: activeChannel,
            template: selectedTemplate,
            previewKind: 'uploaded-marketing-material',
            hasUploadedMaterial: Boolean(productImageUrl),
            placement: materialReference.placement,
          },
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
          materialReference: materialReferenceMetadata,
          materialReferenceSummary,
          layerPlan: {
            activeLayer: materialReference.activeLayer,
            placement: materialReference.placement,
            scale: materialReference.scale,
          },
          maskPlan: {
            maskMode: materialReference.maskMode,
          },
          compositionPreview: {
            channel: activeChannel,
            template: selectedTemplate,
            previewKind: 'uploaded-marketing-material',
            hasUploadedMaterial: Boolean(productImageUrl),
            placement: materialReference.placement,
          },
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
          materialReference: materialReferenceMetadata,
          materialReferenceSummary,
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
      <section className="rounded-[28px] border border-white/10 bg-[#050707] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] sm:p-9">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              マーケティングワークスペース
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-300">
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
                    ? 'border-cyan-300 bg-cyan-300 text-neutral-950 shadow-[0_0_24px_rgba(103,232,249,0.18)] dark:border-cyan-300 dark:bg-cyan-300 dark:text-neutral-950'
                    : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:border-cyan-300/50 hover:bg-white/[0.07]'
                }`}
              >
                <Icon className="h-5 w-5" />
                <p className="mt-3 text-sm font-semibold">{channel.label}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section
        data-testid="marketing-action-panel"
        className="grid gap-4 rounded-[24px] border border-cyan-300/30 bg-cyan-300/[0.08] p-5 lg:grid-cols-[minmax(0,1fr)_auto]"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300 dark:text-cyan-300">
            Marketing flow
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">
            素材とコピーを販促briefにまとめ、生成かCanvasへ進める
          </h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {marketingReadinessItems.map((item) => (
              <div
                key={item.label}
                data-testid="marketing-readiness-item"
                className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm"
              >
                <p className="font-semibold text-white">{item.label}</p>
                <p className="mt-1 leading-5 text-neutral-300">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
        <div
          data-testid="marketing-next-actions"
          className="flex flex-col gap-2 sm:flex-row lg:min-w-64 lg:flex-col lg:justify-center"
        >
          <Link
            to={buildGenerationIntentHref({
              feature: 'campaign-image',
              prompt: `${activeLabel} / ${selectedTemplate}\n${campaignCopy.trim()}`,
              sourceWorkspace: 'marketing',
              workflowVersion: 'marketing-brief-local-v1',
              sourceLabel: workspaceSourceConfig.marketing.label,
              sourceResumePath: workspaceSourceConfig.marketing.resumePath,
              sourceMode: 'local-workflow-intake',
            })}
            className="btn-primary inline-flex items-center justify-center gap-2 text-sm"
          >
            <Sparkles className="h-4 w-4" />
            生成指示へ送る
          </Link>
          <button
            type="button"
            onClick={() => void handoffToCanvas()}
            disabled={!canHandoff || isHandingOff}
            className="btn-secondary inline-flex items-center justify-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Layers className="h-4 w-4" />
            Canvasへ保存
          </button>
          <Link to="/gallery" className="btn-secondary inline-flex items-center justify-center gap-2 text-sm">
            <Images className="h-4 w-4" />
            Galleryで確認
          </Link>
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
                    ? 'bg-cyan-300 text-neutral-950 shadow-[0_0_22px_rgba(103,232,249,0.16)]'
                    : 'border border-white/10 bg-white/[0.04] text-neutral-300 hover:border-cyan-300/50 hover:bg-white/[0.07]'
                }`}
              >
                {template}
                <ChevronRight className="h-4 w-4" />
              </button>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <BarChart3 className="h-4 w-4 text-cyan-300" />
              ローカルジョブ
            </div>
            <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
              状態: <span className="font-semibold text-neutral-200">{statusLabel}</span>
            </p>
            <div className="mt-4 h-2 rounded-full bg-white/10" aria-label="ジョブ進捗">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  job.status === 'failed'
                    ? 'bg-red-500'
                    : job.status === 'stalled'
                      ? 'bg-cyan-300'
                      : 'bg-gradient-to-r from-cyan-300 to-cyan-200'
                }`}
                style={{ width: `${job.progress}%` }}
              />
            </div>
            <p className="mt-2 text-xs font-semibold text-cyan-300">
              {statusLabel} {job.progress}%
            </p>
            {job.status === 'stalled' && (
              <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-cyan-300 dark:text-cyan-300">
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
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
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

            <div className="mt-5 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-3">
                <MaterialWorkbench
                  title="販促素材作業台"
                  description="商品画像、ロゴ、背景、小物を置き、販促物のどのレイヤーへ使うかを先に決めます。"
                  uploadLabel="商品・ロゴ・背景素材をアップロード"
                  emptyLabel="素材を置くと、Canvasへ販促レイヤーとして渡せます"
                  state={materialReference}
                  onChange={setMaterialReference}
                  materialKinds={['商品画像', 'ロゴ', '背景', '小物', 'テキスト下地']}
                  layerOptions={['商品', 'ロゴ', '背景', 'コピー', 'CTA']}
                  placementOptions={['メインビジュアル', '左寄せ', '右寄せ', '背景全面', 'CTA周辺']}
                />
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
                  className="w-full rounded-2xl border border-white/10 bg-[#050707] p-4 text-sm leading-6 text-white shadow-inner outline-none transition placeholder:text-neutral-500 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20"
                />
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-xs font-semibold uppercase text-cyan-300">Preview brief</p>
                  <p className="mt-2 text-sm font-semibold text-white">{activeLabel} / {selectedTemplate}</p>
                  <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                    {campaignCopy.trim() || 'コピーを入力してください。'}
                  </p>
                </div>
                <figure>
                  <img
                    data-testid="marketing-preview-image"
                    src={previewImageUrl}
                    alt="Marketing brief preview"
                    className="aspect-[3/2] w-full rounded-2xl border border-white/10 bg-[#050707] object-cover"
                  />
                  <figcaption className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
                    チャネル、テンプレート、コピー、素材配置を生成前に確認する販促briefプレビューです。
                  </figcaption>
                </figure>
              </div>
            </div>
          </div>
        </main>

        <aside className="space-y-5">
          <section className="glass-panel rounded-2xl p-5">
            <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">マイプロジェクト</h2>
            <div className="mt-4 space-y-3">
              {projects.map((project) => (
                <button key={project.name} type="button" className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-cyan-300/50 hover:bg-white/[0.07]">
                  <p className="text-sm font-semibold text-white">{project.name}</p>
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
                <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <item.icon className="h-4 w-4 text-cyan-300" />
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
