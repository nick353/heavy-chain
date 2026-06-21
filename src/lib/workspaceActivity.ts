import { supabase } from './supabase';
import type { Database, GeneratedImage, Json } from '../types/database';

type GenerationJob = Database['public']['Tables']['generation_jobs']['Row'];

export type WorkspaceJobStatus = GenerationJob['status'];

export interface CreditSummary {
  planName: string;
  monthlyQuota: number;
  usedUnits: number;
  reservedUnits: number;
  remainingUnits: number;
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
}

export interface RecentOutput {
  id: string;
  jobId: string | null;
  imageUrl: string | null;
  storagePath: string;
  prompt: string | null;
  featureType: string | null;
  createdAt: string;
}

export interface TimelineItem {
  id: string;
  title: string;
  description: string;
  prompt: string | null;
  status: WorkspaceJobStatus | 'output';
  href: string;
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
}

const FREE_PLAN_QUOTA = 25;

export const emptyWorkspaceActivity: WorkspaceActivity = {
  creditSummary: {
    planName: 'Free',
    monthlyQuota: FREE_PLAN_QUOTA,
    usedUnits: 0,
    reservedUnits: 0,
    remainingUnits: FREE_PLAN_QUOTA,
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
  'multilingual-banner': '多言語バナー',
  'design-gacha': 'デザインガチャ',
};

const getFeatureLabel = (featureType: string | null | undefined) => {
  if (!featureType) return '生成ジョブ';
  return featureLabels[featureType] ?? featureType.replaceAll('-', ' ');
};

const inputValueToString = (inputParams: Json | null, key: string) => {
  if (!inputParams || typeof inputParams !== 'object' || Array.isArray(inputParams)) return null;
  const value = inputParams[key];
  return typeof value === 'string' && value.trim() ? value : null;
};

const getJobPrompt = (job: GenerationJob) => {
  return job.optimized_prompt || inputValueToString(job.input_params, 'prompt') || inputValueToString(job.input_params, 'description');
};

const buildResumeHref = (job: GenerationJob) => {
  const params = new URLSearchParams({ resumeJob: job.id });
  const prompt = getJobPrompt(job);
  if (job.feature_type) params.set('feature', job.feature_type);
  if (prompt) params.set('prompt', prompt);
  return `/generate?${params.toString()}`;
};

const mapJob = (job: GenerationJob, outputCount: number): WorkspaceJob => ({
  id: job.id,
  title: getFeatureLabel(job.feature_type),
  featureType: job.feature_type,
  status: job.status,
  prompt: getJobPrompt(job),
  errorMessage: job.error_message,
  createdAt: job.created_at,
  completedAt: job.completed_at,
  outputCount,
  resumeHref: buildResumeHref(job),
});

const mapOutput = (image: GeneratedImage): RecentOutput => ({
  id: image.id,
  jobId: image.job_id,
  imageUrl: image.image_url,
  storagePath: image.storage_path,
  prompt: image.prompt,
  featureType: image.feature_type,
  createdAt: image.created_at,
});

const buildOutputCounts = (images: GeneratedImage[]) => {
  return images.reduce<Record<string, number>>((counts, image) => {
    if (!image.job_id) return counts;
    counts[image.job_id] = (counts[image.job_id] ?? 0) + 1;
    return counts;
  }, {});
};

const buildTimelineItems = (jobs: WorkspaceJob[], outputs: RecentOutput[]): TimelineItem[] => {
  const jobItems: TimelineItem[] = jobs.map((job) => ({
    id: `job-${job.id}`,
    title: job.title,
    description: job.status === 'failed' ? job.errorMessage || '生成に失敗しました' : `${job.outputCount} outputs`,
    prompt: job.prompt,
    status: job.status,
    href: job.status === 'failed' ? job.resumeHref : '/gallery',
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    outputCount: job.outputCount,
  }));

  const outputItems: TimelineItem[] = outputs
    .filter((output) => !output.jobId)
    .map((output) => ({
      id: `output-${output.id}`,
      title: getFeatureLabel(output.featureType),
      description: 'ギャラリーに保存済み',
      prompt: output.prompt,
      status: 'output',
      href: `/gallery?image=${output.id}`,
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
    };
  } catch (error) {
    console.warn('Failed to fetch workspace credit summary:', error);
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
    console.warn('Failed to fetch workspace jobs:', error);
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

    return data ?? [];
  } catch (error) {
    console.warn('Failed to fetch workspace outputs:', error);
    throw error;
  }
};

export async function fetchWorkspaceActivity(brandId: string): Promise<WorkspaceActivity> {
  if (!brandId) return emptyWorkspaceActivity;

  const [creditSummary, jobs, outputs] = await Promise.all([
    fetchCreditSummary(brandId),
    fetchJobs(brandId),
    fetchOutputs(brandId),
  ]);

  const outputCounts = buildOutputCounts(outputs);
  const mappedJobs = jobs.map((job) => mapJob(job, outputCounts[job.id] ?? 0));
  const activeJobs = mappedJobs.filter((job) => job.status === 'pending' || job.status === 'processing').slice(0, 8);
  const failedJobs = mappedJobs.filter((job) => job.status === 'failed').slice(0, 8);
  const completedJobs = mappedJobs.filter((job) => job.status === 'completed').slice(0, 8);
  const recentOutputs = outputs.map(mapOutput).slice(0, 12);

  return {
    creditSummary,
    activeJobs,
    failedJobs,
    completedJobs,
    recentOutputs,
    timelineItems: buildTimelineItems(mappedJobs, recentOutputs),
  };
}
