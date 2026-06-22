import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  type AppSupabaseClient,
  clientError,
  createServiceClient,
  createUserClient,
  requireBrandRole,
  requireUser,
} from '../_shared/auth.ts';
import type { Json } from '../../../src/types/database.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GENERATED_IMAGES_BUCKET = 'generated-images';

interface MarketingWorkspaceArtifactRequest {
  brandId: string;
  featureType: string;
  title: string;
  imageUrl: string;
  prompt?: string | null;
  createdAt?: string;
  metadata?: Record<string, Json | undefined>;
  canvasProjectId?: string;
  sourceJobId?: string;
}

type RemoteSaveStage = 'auth' | 'prepare' | 'storage' | 'job' | 'image' | 'completed';

const jsonResponse = (body: Record<string, unknown>, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
};

const statusForFailure = (stage: RemoteSaveStage, error: unknown) => {
  const message = clientError(error);
  if (message === 'Unauthorized') return 401;
  if (message === 'Brand not found or access denied' || message === 'Insufficient brand permissions') return 403;
  if (message === 'Service role key not configured') return 500;
  return stage === 'prepare' ? 400 : 500;
};

const generateRemotePathId = () => {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const dataUrlToBytes = (dataUrl: string) => {
  const matches = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!matches) {
    throw new Error('Only data URL workspace artifacts can be uploaded remotely.');
  }

  const contentType = matches[1] || 'application/octet-stream';
  const isBase64 = Boolean(matches[2]);
  const payload = matches[3] || '';
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  return {
    contentType,
    bytes: Uint8Array.from(binary, (char) => char.charCodeAt(0)),
  };
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let remoteSaveStage: RemoteSaveStage = 'auth';
  let storagePath: string | null = null;
  let storageUploaded = false;
  let jobId: string | null = null;
  let observedBrandId: string | null = null;
  let observedUserId: string | null = null;
  let supabaseService: AppSupabaseClient | null = null;
  let cleanupError: unknown[] = [];

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ success: false, error: 'Method Not Allowed' }, 405);
    }

    const supabaseAuth = createUserClient(req);
    const user = await requireUser(supabaseAuth);

    remoteSaveStage = 'prepare';
    const body: MarketingWorkspaceArtifactRequest = await req.json();
    const {
      brandId,
      featureType,
      title,
      imageUrl,
      prompt = null,
      createdAt,
      metadata = {},
      canvasProjectId,
      sourceJobId,
    } = body;

    if (!brandId) throw new Error('Brand ID is required');
    if (!featureType) throw new Error('Feature type is required');
    if (!title) throw new Error('Title is required');
    if (!imageUrl) throw new Error('Image URL is required');

    await requireBrandRole(supabaseAuth, brandId, user.id, 'editor');
    observedBrandId = brandId;
    observedUserId = user.id;

    const now = createdAt ?? new Date().toISOString();
    const { bytes, contentType } = dataUrlToBytes(imageUrl);
    storagePath = `${user.id}/${brandId}/workspace/${generateRemotePathId()}`;

    remoteSaveStage = 'storage';
    supabaseService = createServiceClient();
    const { error: uploadError } = await supabaseService.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(storagePath, bytes, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      throw uploadError;
    }
    storageUploaded = true;

    remoteSaveStage = 'job';
    const { data: job, error: jobError } = await supabaseService
      .from('generation_jobs')
      .insert({
        brand_id: brandId,
        user_id: user.id,
        feature_type: featureType,
        input_params: {
          prompt,
          title,
          canvasProjectId: canvasProjectId ?? null,
          sourceJobId: sourceJobId ?? null,
          metadata,
        },
        optimized_prompt: prompt,
        status: 'completed',
        error_message: null,
        created_at: now,
        completed_at: now,
      })
      .select('id')
      .single();

    if (jobError || !job?.id) {
      throw jobError ?? new Error('Remote generation job insert did not return an id.');
    }
    jobId = job.id;

    remoteSaveStage = 'image';
    const { data: image, error: imageError } = await supabaseService
      .from('generated_images')
      .insert({
        job_id: jobId,
        brand_id: brandId,
        user_id: user.id,
        storage_path: storagePath,
        image_url: null,
        prompt,
        feature_type: featureType,
        model_used: 'marketing-workspace-artifact',
        generation_params: {
          canvasProjectId: canvasProjectId ?? null,
          sourceJobId: sourceJobId ?? null,
        },
        metadata: {
          ...metadata,
          title,
          localWorkspaceArtifact: true,
          remoteWorkspaceArtifact: true,
          sourceJobId: sourceJobId ?? null,
        },
        created_at: now,
      })
      .select('id')
      .single();

    if (imageError || !image?.id) {
      throw imageError ?? new Error('Remote generated image insert did not return an id.');
    }

    remoteSaveStage = 'completed';
    return jsonResponse({
      success: true,
      remoteSaveStage,
      remoteCleanupStatus: 'none',
      remote: {
        jobId,
        imageId: image.id,
        storagePath,
      },
    });
  } catch (error) {
    if (storageUploaded && storagePath) {
      const cleanupClient = supabaseService ?? createServiceClient();
      if (observedBrandId && observedUserId) {
        try {
          const { error: deleteImageError } = await cleanupClient
            .from('generated_images')
            .delete()
            .eq('storage_path', storagePath)
            .eq('brand_id', observedBrandId)
            .eq('user_id', observedUserId);
          if (deleteImageError) throw deleteImageError;
        } catch (deleteError) {
          cleanupError.push(deleteError);
        }
      }

      if (jobId) {
        try {
          const { error: deleteJobError } = await cleanupClient
            .from('generation_jobs')
            .delete()
            .eq('id', jobId);
          if (deleteJobError) throw deleteJobError;
        } catch (deleteError) {
          cleanupError.push(deleteError);
        }
      }

      try {
        const { error: removeStorageError } = await cleanupClient
          .storage
          .from(GENERATED_IMAGES_BUCKET)
          .remove([storagePath]);
        if (removeStorageError) throw removeStorageError;
      } catch (removeError) {
        cleanupError.push(removeError);
      }
    }

    console.error('Marketing workspace artifact save failed:', clientError(error));
    return jsonResponse({
      success: false,
      error: clientError(error),
      remoteSaveStage,
      remoteCleanupStatus: cleanupError.length ? 'failed' : storageUploaded ? 'attempted' : 'none',
      cleanupError: cleanupError.length ? cleanupError.map(clientError) : null,
    }, statusForFailure(remoteSaveStage, error));
  }
});
