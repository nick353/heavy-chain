import { supabase } from './supabase';
import type { Database, Json } from '../types/database';

export const LOCAL_RUNWAY_WORKER_PROVIDER = 'runway_mcp_local_worker';
export const LOCAL_RUNWAY_WORKER_CONTRACT_VERSION = 'heavy-chain.local-runway-worker.v1';

type GenerationJob = Database['public']['Tables']['generation_jobs']['Row'];
type GeneratedImage = Database['public']['Tables']['generated_images']['Row'];

export interface LocalRunwayWorkerRequestInput {
  brandId: string;
  featureType: string;
  prompt: string;
  negativePrompt?: string | null;
  width: number;
  height: number;
  count: number;
  referenceImage?: string | null;
  referenceType?: string | null;
  rightsConfirmed?: boolean;
  metadata?: Record<string, Json | undefined>;
}

export interface LocalRunwayWorkerRequest {
  job: GenerationJob;
}

export interface LocalRunwayWorkerPollResult {
  job: GenerationJob;
  images: GeneratedImage[];
}

export const enqueueLocalRunwayWorkerGeneration = async (
  input: LocalRunwayWorkerRequestInput
): Promise<LocalRunwayWorkerRequest> => {
  const { data, error } = await supabase.functions.invoke('generate-image', {
    body: {
      brandId: input.brandId,
      featureType: input.featureType,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt ?? null,
      width: input.width,
      height: input.height,
      legalSafety: {
        rightsConfirmed: input.rightsConfirmed === true,
      },
      localRunwayWorker: {
        enabled: true,
        provider: LOCAL_RUNWAY_WORKER_PROVIDER,
        workerContractVersion: LOCAL_RUNWAY_WORKER_CONTRACT_VERSION,
        count: Math.max(1, Math.min(4, input.count || 1)),
        referenceImage: input.referenceImage ?? null,
        referenceType: input.referenceType ?? null,
        metadata: input.metadata ?? {},
      },
    },
  });

  if (error || !data?.job) {
    throw error ?? new Error('ローカルRunway worker queueの作成に失敗しました。');
  }

  return { job: data.job as GenerationJob };
};

export const pollLocalRunwayWorkerGeneration = async (
  jobId: string
): Promise<LocalRunwayWorkerPollResult> => {
  const { data: job, error: jobError } = await supabase
    .from('generation_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    throw jobError ?? new Error('ローカルRunway worker jobを確認できません。');
  }

  const { data: images, error: imagesError } = await supabase
    .from('generated_images')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });

  if (imagesError) {
    throw imagesError;
  }

  return {
    job,
    images: images ?? [],
  };
};
