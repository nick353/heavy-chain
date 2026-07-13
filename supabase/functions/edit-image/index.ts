import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { clientError, createServiceClient, requireBrandRole, type Database } from '../_shared/auth.ts';
import { completeBrandUsage, reserveBrandUsage, type UsageReservation } from '../_shared/usage.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';
import { editOpenAiImage, openAiImageArtifact } from '../_shared/openaiImage.ts';
import { persistLightchainTaskSteps, sanitizeLightchainCompat, withLightchainTaskStepStatus, type LightchainCompatMetadata } from '../_shared/lightchainCompat.ts';
import { sanitizeMaterialGenerationMetadata } from '../_shared/materialMetadata.ts';
import { requireLegalSafetyApproval } from '../_shared/legalSafety.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  let usageReservation: UsageReservation | null = null;
  let observedBrandId: string | null = null;
  let observedUserId: string | null = null;
  let observedJobId: string | null = null;
  let observedLightchainMetadata: LightchainCompatMetadata | null = null;
  let telemetryClient: any = null;
  const functionName = 'edit-image';
  const requestId = requestIdFrom(req);
  const startedAt = Date.now();

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient<Database>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      },
    );
    const supabaseService = createServiceClient();
    telemetryClient = supabaseService;

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const body = await req.json();
    const { imageUrl, prompt, brandId, lightchainCompat } = body;

    if (!imageUrl || !prompt || !brandId) {
      throw new Error('Missing required parameters');
    }

    requireLegalSafetyApproval(body.legalSafety, [
      prompt,
      lightchainCompat,
      body.materialReferences,
      body.layerPlan,
      body.maskPlan,
      body.compositionPreview,
    ]);

    await requireBrandRole(supabaseClient, brandId, user.id, 'editor');
    observedBrandId = brandId;
    observedUserId = user.id;
    usageReservation = await reserveBrandUsage(telemetryClient, {
      brandId,
      userId: user.id,
      functionName,
      units: 1,
      requestId,
      idempotencyKey: req.headers.get('idempotency-key'),
    });
    await recordEdgeFunctionRun(telemetryClient, {
      reservation: usageReservation,
      brandId,
      userId: user.id,
      functionName,
      status: 'started',
      requestId,
    });

    const lightchainMetadata = sanitizeLightchainCompat(lightchainCompat);
    const completedLightchainMetadata = withLightchainTaskStepStatus(lightchainMetadata, 'completed');
    observedLightchainMetadata = lightchainMetadata;
    const materialMetadata = sanitizeMaterialGenerationMetadata(body);

    const { data: job, error: jobError } = await supabaseClient
      .from('generation_jobs')
      .insert({
        brand_id: brandId,
        user_id: user.id,
        feature_type: 'prompt-edit',
        input_params: {
          imageUrl: '[provided]',
          prompt,
          requestId,
          ...(materialMetadata ?? {}),
          ...(lightchainMetadata ? { lightchainCompat: lightchainMetadata } : {}),
        } as any,
        status: 'processing',
        error_message: null,
      })
      .select('id')
      .single();
    if (jobError || !job?.id) {
      throw jobError ?? new Error('Failed to create generation job');
    }
    observedJobId = job.id;
    await persistLightchainTaskSteps({
      supabaseClient,
      lightchainMetadata,
      jobId: observedJobId,
      brandId,
      userId: user.id,
      status: 'processing',
      requestId,
    });

    const result = await editOpenAiImage({
      prompt,
      images: [{ imageUrl }],
      model: Deno.env.get('OPENAI_IMAGE_EDIT_MODEL')?.trim() || Deno.env.get('OPENAI_IMAGE_MODEL')?.trim() || 'gpt-image-1-mini',
      background: 'auto',
    });
    const imageAsset = openAiImageArtifact(result);
    const fileName = `${user.id}/${brandId}/${Date.now()}_edited.${imageAsset.extension}`;
    const imageBuffer = Uint8Array.from(atob(imageAsset.base64), (c) => c.charCodeAt(0));

    const { error: uploadError } = await supabaseService.storage
      .from('generated-images')
      .upload(fileName, imageBuffer, { contentType: imageAsset.contentType, upsert: false });
    if (uploadError) {
      throw uploadError;
    }

    const { data: signedUrlData, error: signedUrlError } = await supabaseService.storage
      .from('generated-images')
      .createSignedUrl(fileName, 60 * 60);
    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw signedUrlError ?? new Error('Storage signed URL failed');
    }

    const { data: image, error: imageInsertError } = await supabaseClient
      .from('generated_images')
      .insert({
        job_id: job.id,
        brand_id: brandId,
        user_id: user.id,
        storage_path: fileName,
        image_url: null,
        prompt,
        negative_prompt: null,
        feature_type: 'prompt-edit',
        model_used: result.model,
        generation_params: {
          provider: 'openai',
          taskId: result.taskId,
        },
        metadata: {
          remoteSaveStatus: 'succeeded',
          source: 'edit-image',
          provider: 'openai',
          requestId,
          ...(materialMetadata ?? {}),
          ...(completedLightchainMetadata ? { lightchainCompat: completedLightchainMetadata } : {}),
        } as any,
      })
      .select('id')
      .single();
    if (imageInsertError || !image?.id) {
      throw imageInsertError ?? new Error('Generated image insert did not return an id');
    }

    await persistLightchainTaskSteps({
      supabaseClient,
      lightchainMetadata: completedLightchainMetadata,
      jobId: job.id,
      imageId: image.id,
      brandId,
      userId: user.id,
      status: 'completed',
      requestId,
      artifactUri: fileName,
    });

    await supabaseClient
      .from('generation_jobs')
      .update({ status: 'completed', error_message: null, completed_at: new Date().toISOString() })
      .eq('id', job.id);

    await completeBrandUsage(telemetryClient, usageReservation, 'succeeded');
    await recordEdgeFunctionRun(telemetryClient, {
      reservation: usageReservation,
      brandId: observedBrandId,
      userId: observedUserId,
      functionName,
      status: 'succeeded',
      requestId,
      durationMs: durationSince(startedAt),
    });

    return new Response(JSON.stringify({
      success: true,
      jobId: job.id,
      imageId: image.id,
      storagePath: fileName,
      imageUrl: signedUrlData.signedUrl,
      provider: 'openai',
      persistenceStatus: 'completed',
      cleanupStatus: 'none',
      images: [{
        id: image.id,
        imageUrl: signedUrlData.signedUrl,
        prompt,
        jobId: job.id,
        imageId: image.id,
        storagePath: fileName,
        persistenceStatus: 'completed',
      }],
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    if (telemetryClient) {
      await completeBrandUsage(telemetryClient, usageReservation, 'failed', { error: sanitizeError(error) });
      await recordEdgeFunctionRun(telemetryClient, {
        reservation: usageReservation,
        brandId: observedBrandId,
        userId: observedUserId,
        functionName,
        status: 'failed',
        requestId,
        durationMs: durationSince(startedAt),
        errorMessage: sanitizeError(error),
      });
    }

    if (observedJobId && telemetryClient) {
      try {
        await telemetryClient
          .from('generation_jobs')
          .update({
            status: 'failed',
            error_message: sanitizeError(error),
            completed_at: new Date().toISOString(),
          })
          .eq('id', observedJobId);
      } catch {
        // Ignore cleanup failures.
      }
    }

    return new Response(JSON.stringify({
      success: false,
      error: clientError(error),
      jobId: observedJobId,
      persistenceStatus: observedJobId ? 'failed' : 'not_started',
      failedStage: 'generation',
      cleanupStatus: 'attempted',
      cleanupErrors: [],
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
