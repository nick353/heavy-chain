import { supabase, withSupabaseSessionRecovery } from './supabase';
import { readOptionalWorkspaceValue } from './workspaceReadRecovery';
import {
  listWorkspaceArtifacts,
  listWorkspaceGeneratedImages,
} from './localWorkspaceArtifacts';
import {
  getGeneratedImageSelectionKey,
  mergeGeneratedImagesByCanonicalIdentity,
} from './generatedImageIdentity';
import { withSignedImageUrls } from './storage';
import { buildSourceContextSummaryRows, type SourceContextSummaryRow } from './sourceContextSummary';
import { getFailureRecoveryGuidance, type FailureRecoveryKind } from './errorMessages';
import type { GenerationIntent } from './workspaceHandoff';
import type { Database, GeneratedImage, Json } from '../types/database';

type GenerationJob = Database['public']['Tables']['generation_jobs']['Row'];
type LightchainTaskStep = Database['public']['Tables']['lightchain_task_steps']['Row'];

export type WorkspaceJobStatus = GenerationJob['status'];

export interface CreditSummary {
  planName: string;
  monthlyQuota: number;
  usedUnits: number;
  reservedUnits: number;
  remainingUnits: number;
  billingTestAccountQuotaBypass: boolean;
  appleSandboxTesterNoRealCharge: boolean;
}

export interface WorkspaceJob {
  id: string;
  title: string;
  featureType: string;
  status: WorkspaceJobStatus;
  prompt: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  outputCount: number;
  resumeHref: string;
  generationHref?: string;
  sourceLabel?: string;
  sourceResumePath?: string;
  productLane: string;
  hasMaterialReference: boolean;
  recoveryAction: string;
  recoveryKind: FailureRecoveryKind;
  recoveryTitle: string;
  recoveryMessage: string;
  recoveryNextAction: string;
  retryLabel: string;
  retryHref: string;
  sourceSummaryRows: SourceContextSummaryRow[];
}

export interface RecentOutput {
  id: string;
  jobId: string | null;
  imageUrl: string | null;
  storagePath: string;
  metadata: Json | null;
  prompt: string | null;
  featureType: string | null;
  createdAt: string;
  generationHref?: string;
  sourceLabel?: string;
  sourceResumePath?: string;
  sourceSummaryRows: SourceContextSummaryRow[];
}

export interface TimelineItem {
  id: string;
  title: string;
  description: string;
  prompt: string | null;
  status: WorkspaceJobStatus | 'output';
  href: string;
  generationHref?: string;
  sourceLabel?: string;
  sourceResumePath?: string;
  sourceSummaryRows?: SourceContextSummaryRow[];
  createdAt: string;
  completedAt: string | null;
  outputCount: number;
}

export interface WorkspaceActivity {
  creditSummary: CreditSummary;
  activeJobs: WorkspaceJob[];
  failedJobs: WorkspaceJob[];
  completedJobs: WorkspaceJob[];
  recentOutputs: RecentOutput[];
  timelineItems: TimelineItem[];
}

interface UsageSummaryRow {
  plan_code: string | null;
  monthly_quota: number | null;
  used_units: number | null;
  reserved_units: number | null;
  remaining_units: number | null;
  billing_test_account_quota_bypass?: boolean | null;
  apple_sandbox_tester_no_real_charge?: boolean | null;
}

const FREE_PLAN_QUOTA = 25;

const logWorkspaceActivityFetchError = (message: string, error: unknown) => {
  if (import.meta.env.DEV) {
    console.warn(message, error);
  }
};

export const emptyWorkspaceActivity: WorkspaceActivity = {
  creditSummary: {
    planName: 'Free',
    monthlyQuota: FREE_PLAN_QUOTA,
    usedUnits: 0,
    reservedUnits: 0,
    remainingUnits: FREE_PLAN_QUOTA,
    billingTestAccountQuotaBypass: false,
    appleSandboxTesterNoRealCharge: false,
  },
  activeJobs: [],
  failedJobs: [],
  completedJobs: [],
  recentOutputs: [],
  timelineItems: [],
};

const toNumber = (value: unknown, fallback = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const getPlanCodeLabel = (planCode: string | null | undefined) => {
  switch (planCode) {
    case 'pro':
      return 'Pro';
    case 'business':
      return 'Business';
    case 'free':
    default:
      return 'Free';
  }
};

const featureLabels: Record<string, string> = {
  'campaign-image': 'キャンペーン画像',
  'text-to-image': 'キャンペーン画像',
  'product-shots': '商品撮影',
  'generate-image': '画像生成',
  'generate-variations': 'バリエーション生成',
  'remove-background': '背景削除',
  colorize: 'カラー展開',
  upscale: 'アップスケール',
  'optimize-prompt': 'プロンプト最適化',
  'model-matrix': 'モデルマトリクス',
  'marketing-workflow': 'マーケティングワークフロー',
  'fashion-studio': 'Fashion Studio',
  'model-library-workspace': 'モデルライブラリ',
  'video-workstation': 'Video Workstation',
  'lab-workflow': 'Lab ワークフロー',
  'graphic-pattern-workspace': '柄・グラフィック',
  'multilingual-banner': '多言語バナー',
  'design-gacha': 'デザインガチャ',
};

const getFeatureLabel = (featureType: string | null | undefined) => {
  if (!featureType) return '生成ジョブ';
  return featureLabels[featureType] ?? featureType.replaceAll('-', ' ');
};

const getProductLane = (featureType: string | null | undefined) => {
  switch (featureType) {
    case 'product-shots':
    case 'remove-bg':
    case 'remove-background':
    case 'upscale':
      return 'EC商品素材';
    case 'model-matrix':
    case 'scene-coordinate':
      return '着用画像';
    case 'design-gacha':
    case 'colorize':
    case 'variations':
    case 'generate-variations':
    case 'graphic-pattern-workspace':
      return 'デザイン探索';
    case 'campaign-image':
    case 'text-to-image':
    case 'multilingual-banner':
      return '販促';
    default:
      return '制作';
  }
};

const inputValueToString = (inputParams: Json | null | undefined, key: string) => {
  if (!inputParams || typeof inputParams !== 'object' || Array.isArray(inputParams)) return null;
  const value = inputParams[key];
  return typeof value === 'string' && value.trim() ? value : null;
};

/**
 * Workspace-artifact jobs store their source metadata under input_params.metadata,
 * while provider/generation jobs may store it at the input root. Read both shapes
 * through one boundary so Jobs, History, and Dashboard share the same readback.
 */
const getWorkspaceActivityMetadata = (metadata: Json | null | undefined): Json | null => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata ?? null;
  const root = metadata as Record<string, Json | undefined>;
  const embedded = root.metadata;
  if (!embedded || typeof embedded !== 'object' || Array.isArray(embedded)) return metadata;
  return { ...root, ...(embedded as Record<string, Json | undefined>) } as Json;
};

const getJobPrompt = (job: GenerationJob) => {
  return job.optimized_prompt
    || inputValueToString(job.input_params, 'prompt')
    || inputValueToString(job.input_params, 'description')
    || getMetadataString(job.input_params, 'brief')
    || null;
};

const hasMaterialReference = (inputParams: Json | null | undefined) => {
  const metadata = getWorkspaceActivityMetadata(inputParams);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  if (metadata.hasReferenceImage === true || metadata.referenceImageHandoff) return true;
  if (Array.isArray(metadata.materialReferences) && metadata.materialReferences.length > 0) return true;
  const promptLike = [
    inputValueToString(inputParams, 'prompt'),
    inputValueToString(inputParams, 'description'),
    inputValueToString(inputParams, 'optimizedPrompt'),
    getMetadataString(inputParams, 'brief'),
  ].filter(Boolean).join(' ');
  return /衣服素材|素材:|Material:|reference image|garment/i.test(promptLike);
};

const getRecoveryAction = (job: GenerationJob) => {
  if (job.status !== 'failed') return job.status === 'completed' ? 'Galleryで開く' : '進行状況を見る';
  return getFailureRecoveryGuidance(`${job.error_message ?? ''} ${getJobPrompt(job) ?? ''}`).nextAction;
};

const getJobRecoveryGuidance = (job: GenerationJob) => {
  if (job.status === 'failed') return getFailureRecoveryGuidance(`${job.error_message ?? ''} ${getJobPrompt(job) ?? ''}`);
  return {
    kind: 'unknown' as const,
    title: job.status === 'completed' ? '成果物を確認' : '進行状況を確認',
    userMessage: job.status === 'completed' ? '生成は完了しています。Galleryから成果物を開けます。' : '生成キューで現在の進行状況を確認できます。',
    nextAction: job.status === 'completed' ? 'Galleryで開く' : '進行状況を見る',
    retryLabel: job.status === 'completed' ? '成果物を開く' : '進行状況を見る',
    retryHrefFallback: job.status === 'completed' ? '/gallery' : '/jobs',
  };
};

const buildResumeHref = (job: GenerationJob) => {
  const metadata = getWorkspaceActivityMetadata(job.input_params);
  const generationHref = getGenerationHref(metadata);
  if (generationHref) return generationHref;
  if (!job.feature_type) return '/lightchain';

  const sourceResumePath = getMetadataString(metadata, 'sourceResumePath');
  if (sourceResumePath === '/fitting') {
    const params = new URLSearchParams({ resumeJob: job.id });
    const prompt = getJobPrompt(job);
    const bodyTypes = getMetadataStringList(metadata, 'bodyTypes');
    const ageGroups = getMetadataStringList(metadata, 'ageGroups');
    const gender = getMetadataString(metadata, 'gender');
    if (prompt) params.set('prompt', prompt);
    if (bodyTypes.length) params.set('bodyTypes', bodyTypes.join(','));
    if (ageGroups.length) params.set('ageGroups', ageGroups.join(','));
    if (gender) params.set('gender', gender);
    return `/fitting?${params.toString()}`;
  }

  const persistedLightchainFeatureId = getLightchainCompatFeatureId(metadata);
  const lightchainFeature = job.feature_type.match(/^lightchain-(.+?)(?:-provider-result)?$/);
  const lightchainFeatureId = persistedLightchainFeatureId
    ?? (lightchainFeature && lightchainFeature[1] !== 'material-result' ? lightchainFeature[1] : null);
  if (lightchainFeatureId) {
    const params = new URLSearchParams({ resumeJob: job.id });
    const brief = getMetadataString(metadata, 'brief') ?? getJobPrompt(job);
    const referenceNote = getMetadataString(metadata, 'referenceNote');
    if (brief) params.set('brief', brief);
    if (referenceNote) params.set('referenceNote', referenceNote);
    return `/lightchain/${encodeURIComponent(lightchainFeatureId)}?${params.toString()}`;
  }

  const params = new URLSearchParams({ resumeJob: job.id });
  const prompt = getJobPrompt(job);
  params.set('feature', job.feature_type);
  if (prompt) params.set('prompt', prompt);
  return `/generate?${params.toString()}`;
};

const getRetryHref = (job: GenerationJob, resumeHref: string) => {
  if (job.status !== 'failed') return job.status === 'completed' ? '/gallery' : '/jobs';
  return resumeHref;
};

const mapJob = (job: GenerationJob, outputCount: number, lightchainTaskSteps: LightchainTaskStep[] = []): WorkspaceJob => {
  const recoveryGuidance = getJobRecoveryGuidance(job);
  const resumeHref = buildResumeHref(job);
  return {
    id: job.id,
    title: getFeatureLabel(job.feature_type),
    featureType: job.feature_type,
    status: job.status,
    prompt: getJobPrompt(job),
    errorMessage: job.error_message,
    createdAt: job.created_at,
    completedAt: job.completed_at,
    outputCount,
    resumeHref,
    generationHref: getGenerationHref(job.input_params),
    sourceLabel: getMetadataString(job.input_params, 'sourceLabel'),
    sourceResumePath: getMetadataString(job.input_params, 'sourceResumePath'),
    productLane: getProductLane(job.feature_type),
    hasMaterialReference: hasMaterialReference(job.input_params),
    recoveryAction: getRecoveryAction(job),
    recoveryKind: recoveryGuidance.kind,
    recoveryTitle: recoveryGuidance.title,
    recoveryMessage: recoveryGuidance.userMessage,
    recoveryNextAction: recoveryGuidance.nextAction,
    retryLabel: recoveryGuidance.retryLabel,
    retryHref: getRetryHref(job, resumeHref),
    sourceSummaryRows: buildSourceSummaryRows(job.input_params, job.status, lightchainTaskSteps),
  };
};

const isGenerationIntent = (value: unknown): value is GenerationIntent => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const intent = value as Partial<GenerationIntent>;
  return Boolean(intent.href && typeof intent.href === 'string');
};

const getGenerationHref = (metadata: Json | null | undefined) => {
  const activityMetadata = getWorkspaceActivityMetadata(metadata);
  if (!activityMetadata || typeof activityMetadata !== 'object' || Array.isArray(activityMetadata)) return undefined;
  const generationIntent = activityMetadata.generationIntent;
  return isGenerationIntent(generationIntent) ? generationIntent.href : undefined;
};

/**
 * Provider jobs use a backend-owned generic feature_type (for example
 * `prompt-edit` or `model-matrix`) but retain the source Lightchain feature in
 * lightchainCompat. Keep retry/resume on the same feature surface instead of
 * silently routing the user to the generic Generate page.
 */
const getLightchainCompatFeatureId = (metadata: Json | null | undefined) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const compat = metadata.lightchainCompat;
  return getMetadataString(compat as Json | null | undefined, 'lightchainFeatureId');
};

const getMetadataString = (metadata: Json | null | undefined, key: string) => {
  const activityMetadata = getWorkspaceActivityMetadata(metadata);
  if (!activityMetadata || typeof activityMetadata !== 'object' || Array.isArray(activityMetadata)) return undefined;
  const containers = [
    activityMetadata,
    activityMetadata.generationIntent,
    activityMetadata.sourceReadback,
    activityMetadata.compositionPreview,
  ].filter((value): value is Record<string, Json | undefined> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  ));
  for (const container of containers) {
    const value = container[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
};

const getMetadataStringList = (metadata: Json | null | undefined, key: string) => {
  const activityMetadata = getWorkspaceActivityMetadata(metadata);
  if (!activityMetadata || typeof activityMetadata !== 'object' || Array.isArray(activityMetadata)) return [];
  const containers = [
    activityMetadata,
    activityMetadata.generationIntent,
    activityMetadata.sourceReadback,
    activityMetadata.compositionPreview,
  ].filter((value): value is Record<string, Json | undefined> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  ));
  for (const container of containers) {
    const value = container[key];
    if (Array.isArray(value)) {
      const strings = value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()));
      if (strings.length > 0) return strings;
    }
  }
  return [];
};

const hasLightchainCompat = (metadata: Json | null | undefined) => {
  const activityMetadata = getWorkspaceActivityMetadata(metadata);
  if (!activityMetadata || typeof activityMetadata !== 'object' || Array.isArray(activityMetadata)) return false;
  const lightchainCompat = activityMetadata.lightchainCompat;
  if (lightchainCompat && typeof lightchainCompat === 'object' && !Array.isArray(lightchainCompat)) return true;
  const generationIntent = activityMetadata.generationIntent;
  if (generationIntent && typeof generationIntent === 'object' && !Array.isArray(generationIntent)) {
    const intentCompat = generationIntent.lightchainCompat;
    if (intentCompat && typeof intentCompat === 'object' && !Array.isArray(intentCompat)) return true;
  }
  return false;
};

const lightchainCompatFromMetadata = (metadata: Json | null | undefined) => {
  const activityMetadata = getWorkspaceActivityMetadata(metadata);
  if (!activityMetadata || typeof activityMetadata !== 'object' || Array.isArray(activityMetadata)) return null;
  const lightchainCompat = activityMetadata.lightchainCompat;
  if (lightchainCompat && typeof lightchainCompat === 'object' && !Array.isArray(lightchainCompat)) return lightchainCompat as Record<string, unknown>;
  const generationIntent = activityMetadata.generationIntent;
  if (generationIntent && typeof generationIntent === 'object' && !Array.isArray(generationIntent)) {
    const intentCompat = generationIntent.lightchainCompat;
    if (intentCompat && typeof intentCompat === 'object' && !Array.isArray(intentCompat)) return intentCompat as Record<string, unknown>;
  }
  return null;
};

const getLightchainTaskCodes = (metadata: Json | null | undefined) => {
  const compat = lightchainCompatFromMetadata(metadata);
  const rawTaskCodes = compat?.lightchainTaskCodes;
  if (!Array.isArray(rawTaskCodes)) return [];
  return rawTaskCodes.filter((taskCode): taskCode is string => typeof taskCode === 'string' && taskCode.trim().length > 0);
};

const lightchainStatusLabel: Record<WorkspaceJobStatus | 'output', string> = {
  pending: '待機中',
  processing: '処理中',
  completed: '完了',
  failed: '失敗・再試行可',
  output: '保存済み',
};

const durableLightchainStatusLabel: Record<LightchainTaskStep['status'], string> = {
  queued: '待機中',
  processing: '処理中',
  completed: '完了',
  failed: '失敗',
  retryable: '失敗・再試行可',
};

const buildDurableLightchainStepValue = (steps: LightchainTaskStep[]) => {
  if (!steps.length) return null;
  return [...steps]
    .sort((a, b) => a.step_index - b.step_index)
    .map((step) => `${step.task_code}=${durableLightchainStatusLabel[step.status]}`)
    .join(' / ');
};

const buildSourceSummaryRows = (
  metadata: Json | null | undefined,
  status?: WorkspaceJobStatus | 'output',
  durableLightchainTaskSteps: LightchainTaskStep[] = [],
) => {
  const rows = buildSourceContextSummaryRows(getWorkspaceActivityMetadata(metadata));
  if (!status || !hasLightchainCompat(metadata)) return rows;
  const hasStepRow = rows.some((row) => row.label === 'Lightchain steps' || row.label === 'Heavy Chain steps');
  const taskCodes = getLightchainTaskCodes(metadata);
  const durableStepValue = buildDurableLightchainStepValue(durableLightchainTaskSteps);
  const baseRows = durableStepValue
    ? rows.filter((row) => row.label !== 'Lightchain steps' && row.label !== 'Heavy Chain steps')
    : rows;
  return [
    ...baseRows,
    ...(durableStepValue
      ? [{ label: 'Lightchain steps', value: durableStepValue }]
      : !hasStepRow && taskCodes.length
        ? [{ label: 'Lightchain steps', value: taskCodes.map((taskCode) => `${taskCode}=${lightchainStatusLabel[status]}`).join(' / ') }]
        : []),
    { label: 'Lightchain状態', value: lightchainStatusLabel[status] },
  ];
};

const mapOutput = (image: GeneratedImage, lightchainTaskSteps: LightchainTaskStep[] = []): RecentOutput => ({
  id: image.id,
  jobId: image.job_id,
  imageUrl: image.image_url,
  storagePath: image.storage_path,
  metadata: image.metadata,
  prompt: image.prompt,
  featureType: image.feature_type,
  createdAt: image.created_at,
  generationHref: getGenerationHref(image.metadata),
  sourceLabel: getMetadataString(image.metadata, 'sourceLabel'),
  sourceResumePath: getMetadataString(image.metadata, 'sourceResumePath'),
  sourceSummaryRows: buildSourceSummaryRows(image.metadata, 'output', lightchainTaskSteps),
});

const buildOutputCounts = (images: GeneratedImage[]) => {
  return images.reduce<Record<string, number>>((counts, image) => {
    if (!image.job_id) return counts;
    counts[image.job_id] = (counts[image.job_id] ?? 0) + 1;
    return counts;
  }, {});
};

/**
 * Provider-backed feature pages persist a durable artifact even when the
 * provider does not create a row in Heavy Chain's generation_jobs table.
 * Reconstruct a completed local job from that artifact so Jobs and History
 * share the same cross-route readback contract as Gallery.
 */
const buildLocalWorkspaceJobs = (
  artifacts: ReturnType<typeof listWorkspaceArtifacts>,
  existingJobIds: Set<string>,
): GenerationJob[] => {
  const grouped = new Map<string, typeof artifacts>();

  artifacts.forEach((artifact) => {
    const jobId = artifact.sourceJobId ?? getMetadataString(artifact.metadata, 'remoteJobId');
    if (!jobId || existingJobIds.has(jobId)) return;
    const current = grouped.get(jobId) ?? [];
    current.push(artifact);
    grouped.set(jobId, current);
  });

  return [...grouped.entries()].map(([jobId, entries]) => {
    const ordered = [...entries].sort((a, b) => (
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    ));
    const first = ordered[0];
    const latest = ordered[ordered.length - 1];
    const inputParams = JSON.parse(JSON.stringify({
      ...latest.metadata,
      metadata: latest.metadata,
      sourceLabel: getMetadataString(latest.metadata, 'sourceLabel') ?? 'AIフィッティング',
      sourceResumePath: getMetadataString(latest.metadata, 'sourceResumePath') ?? '/fitting',
    })) as Json;
    return {
      id: jobId,
      brand_id: latest.brandId,
      user_id: latest.scopeId ?? 'local-workspace',
      feature_type: latest.featureType,
      input_params: inputParams,
      optimized_prompt: latest.prompt,
      status: 'completed',
      error_message: null,
      created_at: first.createdAt,
      completed_at: latest.createdAt,
    } satisfies GenerationJob;
  });
};

const buildTimelineItems = (jobs: WorkspaceJob[], outputs: RecentOutput[]): TimelineItem[] => {
  const jobItems: TimelineItem[] = jobs.map((job) => ({
    id: `job-${job.id}`,
    title: job.title,
    description: job.status === 'failed' ? job.errorMessage || '生成に失敗しました' : `${job.outputCount} outputs`,
    prompt: job.prompt,
    status: job.status,
    href: job.status === 'failed' ? job.retryHref : '/gallery',
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    outputCount: job.outputCount,
    generationHref: job.generationHref,
    sourceLabel: job.sourceLabel,
    sourceResumePath: job.sourceResumePath,
    sourceSummaryRows: job.sourceSummaryRows,
  }));

  const outputItems: TimelineItem[] = outputs
    .filter((output) => !output.jobId || output.storagePath.startsWith('local/'))
    .map((output) => ({
      id: `output-${output.id}`,
      title: getFeatureLabel(output.featureType),
      description: output.storagePath.startsWith('local/') ? 'ローカル成果物を保存済み' : 'ギャラリーに保存済み',
      prompt: output.prompt,
      status: 'output',
      href: `/gallery?image=${encodeURIComponent(getGeneratedImageSelectionKey({
        id: output.id,
        storage_path: output.storagePath,
        metadata: output.metadata,
      }))}`,
      generationHref: output.generationHref,
      sourceLabel: output.sourceLabel,
      sourceResumePath: output.sourceResumePath,
      sourceSummaryRows: output.sourceSummaryRows,
      createdAt: output.createdAt,
      completedAt: output.createdAt,
      outputCount: 1,
    }));

  return [...jobItems, ...outputItems]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20);
};

const fetchCreditSummary = async (brandId: string): Promise<CreditSummary> => {
  try {
    const result = await (supabase as any)
      .rpc('get_brand_usage_summary', { p_brand_id: brandId })
      .maybeSingle();

    if (result.error) {
      throw result.error;
    }

    if (!result.data) {
      return emptyWorkspaceActivity.creditSummary;
    }

    const summary = result.data as UsageSummaryRow;
    return {
      planName: getPlanCodeLabel(summary.plan_code),
      monthlyQuota: toNumber(summary.monthly_quota, FREE_PLAN_QUOTA),
      usedUnits: toNumber(summary.used_units),
      reservedUnits: toNumber(summary.reserved_units),
      remainingUnits: toNumber(summary.remaining_units, FREE_PLAN_QUOTA),
      billingTestAccountQuotaBypass: summary.billing_test_account_quota_bypass === true,
      appleSandboxTesterNoRealCharge: summary.apple_sandbox_tester_no_real_charge === true,
    };
  } catch (error) {
    logWorkspaceActivityFetchError('Failed to fetch workspace credit summary:', error);
    throw error;
  }
};

const fetchJobs = async (brandId: string): Promise<GenerationJob[]> => {
  try {
    const { data, error } = await supabase
      .from('generation_jobs')
      .select('*')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      throw error;
    }

    return data ?? [];
  } catch (error) {
    logWorkspaceActivityFetchError('Failed to fetch workspace jobs:', error);
    throw error;
  }
};

const fetchOutputs = async (brandId: string): Promise<GeneratedImage[]> => {
  try {
    const { data, error } = await supabase
      .from('generated_images')
      .select('*')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      throw error;
    }

    return withSignedImageUrls(data ?? []);
  } catch (error) {
    logWorkspaceActivityFetchError('Failed to fetch workspace outputs:', error);
    throw error;
  }
};

const fetchLightchainTaskSteps = async (brandId: string): Promise<LightchainTaskStep[]> => {
  return readOptionalWorkspaceValue(
    async () => {
      const { data, error } = await supabase
        .from('lightchain_task_steps')
        .select('*')
        .eq('brand_id', brandId)
        .order('step_index', { ascending: true })
        .limit(500);

      if (error) {
        throw error;
      }

      return data ?? [];
    },
    [],
    (error) => logWorkspaceActivityFetchError('Failed to fetch Lightchain task steps:', error),
  );
};

const groupLightchainStepsByJob = (steps: LightchainTaskStep[]) => {
  return steps.reduce<Record<string, LightchainTaskStep[]>>((groups, step) => {
    groups[step.job_id] = [...(groups[step.job_id] ?? []), step];
    return groups;
  }, {});
};

const groupLightchainStepsByImage = (steps: LightchainTaskStep[]) => {
  return steps.reduce<Record<string, LightchainTaskStep[]>>((groups, step) => {
    if (!step.image_id) return groups;
    groups[step.image_id] = [...(groups[step.image_id] ?? []), step];
    return groups;
  }, {});
};

const mergeLightchainTaskSteps = (...groups: LightchainTaskStep[][]): LightchainTaskStep[] => {
  const seen = new Set<string>();
  return groups.flat().filter((step) => {
    if (seen.has(step.id)) return false;
    seen.add(step.id);
    return true;
  });
};

const throwWorkspaceActivityFetchError = (failedSources: string[]) => {
  if (!failedSources.length) return;
  throw new Error(`Failed to fetch workspace activity: ${failedSources.join(', ')}`);
};

async function fetchWorkspaceActivityRequest(brandId: string, scopeId?: string): Promise<WorkspaceActivity> {
  if (!brandId) return emptyWorkspaceActivity;

  const [creditResult, jobsResult, outputsResult, lightchainStepsResult] = await Promise.allSettled([
    // Keep auth recovery at the individual request boundary. Promise.allSettled
    // intentionally aggregates failures below, which would otherwise erase the
    // original 401/expired-token signal before the shared recovery wrapper sees it.
    withSupabaseSessionRecovery(() => fetchCreditSummary(brandId)),
    withSupabaseSessionRecovery(() => fetchJobs(brandId)),
    withSupabaseSessionRecovery(() => fetchOutputs(brandId)),
    withSupabaseSessionRecovery(() => fetchLightchainTaskSteps(brandId)),
  ]);

  throwWorkspaceActivityFetchError([
    creditResult.status === 'rejected' ? 'credit summary' : '',
    jobsResult.status === 'rejected' ? 'jobs' : '',
    outputsResult.status === 'rejected' ? 'outputs' : '',
  ].filter(Boolean));

  const creditSummary = creditResult.status === 'fulfilled' ? creditResult.value : emptyWorkspaceActivity.creditSummary;
  const jobs = jobsResult.status === 'fulfilled' ? jobsResult.value : [];
  const remoteOutputs = outputsResult.status === 'fulfilled' ? outputsResult.value : [];
  const lightchainTaskSteps = lightchainStepsResult.status === 'fulfilled' ? lightchainStepsResult.value : [];
  const lightchainStepsByJob = groupLightchainStepsByJob(lightchainTaskSteps);
  const lightchainStepsByImage = groupLightchainStepsByImage(lightchainTaskSteps);
  const localArtifacts = listWorkspaceArtifacts(brandId, scopeId);
  const localOutputs = await withSignedImageUrls(listWorkspaceGeneratedImages(brandId, scopeId));
  const outputs = mergeGeneratedImagesByCanonicalIdentity(remoteOutputs, localOutputs)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const outputCounts = buildOutputCounts(outputs);
  const localJobs = buildLocalWorkspaceJobs(localArtifacts, new Set(jobs.map((job) => job.id)));
  const mappedJobs = [...jobs, ...localJobs].map((job) => mapJob(job, outputCounts[job.id] ?? 0, lightchainStepsByJob[job.id] ?? []));
  const activeJobs = mappedJobs.filter((job) => job.status === 'pending' || job.status === 'processing').slice(0, 20);
  const failedJobs = mappedJobs.filter((job) => job.status === 'failed').slice(0, 20);
  const completedJobs = mappedJobs.filter((job) => job.status === 'completed').slice(0, 20);
  const recentOutputs = outputs.map((output) => {
    const remoteImageId = getMetadataString(output.metadata, 'remoteImageId');
    const outputSteps = mergeLightchainTaskSteps(
      lightchainStepsByImage[output.id] ?? [],
      remoteImageId ? lightchainStepsByImage[remoteImageId] ?? [] : [],
      output.job_id ? lightchainStepsByJob[output.job_id] ?? [] : [],
    );
    return mapOutput(output, outputSteps);
  }).slice(0, 12);

  return {
    creditSummary,
    activeJobs,
    failedJobs,
    completedJobs,
    recentOutputs,
    timelineItems: buildTimelineItems(mappedJobs, recentOutputs),
  };
}

export async function fetchWorkspaceActivity(brandId: string, scopeId?: string): Promise<WorkspaceActivity> {
  return withSupabaseSessionRecovery(() => fetchWorkspaceActivityRequest(brandId, scopeId));
}
