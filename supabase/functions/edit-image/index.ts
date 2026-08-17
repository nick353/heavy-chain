import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { clientError, createServiceClient, requireBrandRole, type Database } from '../_shared/auth.ts';
import { completeBrandUsage, reserveBrandUsage, type UsageReservation } from '../_shared/usage.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';
import { editOpenAiImage, openAiImageArtifact, resolveImageEditCleanupStatus } from '../_shared/openaiImage.ts';
import { persistLightchainTaskSteps, sanitizeLightchainCompat, withLightchainTaskStepStatus } from '../_shared/lightchainCompat.ts';
import { sanitizeMaterialGenerationMetadata } from '../_shared/materialMetadata.ts';
import { buildSourceMetadata } from '../_shared/sourceReadback.ts';
import { requireLegalSafetyApproval } from '../_shared/legalSafety.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
};

const MAX_INPUT_IMAGE_URL_LENGTH = 32_000_000;
const MAX_INPUT_IMAGE_COUNT = 16;
const MAX_TOTAL_INPUT_IMAGE_URL_LENGTH = 48_000_000;
const LIGHTCHAIN_MATERIAL_FEATURE_IDS = new Set(['fabric-image', 'printing-image']);
const LIGHTCHAIN_MATERIAL_EDIT_MODELS = new Set(['gpt-image-1']);
const IMAGE_EDIT_QUALITIES = new Set(['low', 'medium', 'high', 'auto']);

function resolveLightchainImageEditOptions({
  featureId,
  providerModel,
  inputFidelity,
  quality,
}: {
  featureId: unknown;
  providerModel: unknown;
  inputFidelity: unknown;
  quality: unknown;
}) {
  const isLightchainMaterialRoute = typeof featureId === 'string'
    && LIGHTCHAIN_MATERIAL_FEATURE_IDS.has(featureId);
  const requestedModel = typeof providerModel === 'string' ? providerModel.trim() : '';
  const resolvedModel = isLightchainMaterialRoute
    ? (LIGHTCHAIN_MATERIAL_EDIT_MODELS.has(requestedModel) ? requestedModel : 'gpt-image-1')
    : requestedModel || Deno.env.get('OPENAI_IMAGE_EDIT_MODEL')?.trim()
      || Deno.env.get('OPENAI_IMAGE_MODEL')?.trim()
      || 'gpt-image-1-mini';
  const requestedFidelity = inputFidelity === 'high' || inputFidelity === 'low' ? inputFidelity : null;
  const resolvedFidelity: 'low' | 'high' | null = resolvedModel === 'gpt-image-1'
    ? requestedFidelity ?? 'low'
    : null;
  const resolvedQuality = typeof quality === 'string' && IMAGE_EDIT_QUALITIES.has(quality)
    ? quality as 'low' | 'medium' | 'high' | 'auto'
    : 'auto';
  return {
    isLightchainMaterialRoute,
    providerModel: resolvedModel,
    inputFidelity: resolvedFidelity,
    quality: resolvedQuality,
  };
}

function normalizeEditImageInputs(imageUrl: unknown, imageUrls: unknown) {
  const candidates = Array.isArray(imageUrls) ? imageUrls : [imageUrl];
  const normalized = candidates
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());

  if (!normalized.length || normalized.length > MAX_INPUT_IMAGE_COUNT) {
    throw new Error('Invalid edit input images');
  }
  if (normalized.some((value) => value.length > MAX_INPUT_IMAGE_URL_LENGTH)) {
    throw new Error('Edit input image is too large');
  }
  if (normalized.reduce((total, value) => total + value.length, 0) > MAX_TOTAL_INPUT_IMAGE_URL_LENGTH) {
    throw new Error('Edit input images are too large');
  }
  for (const [index, value] of normalized.entries()) {
    const isDataImage = /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(value);
    const isHttpsImage = /^https:\/\/[^\s]+$/i.test(value);
    if (!isDataImage && !isHttpsImage) {
      throw new Error(`Invalid edit input image:${index}`);
    }
  }
  return normalized;
}

function pngDataUrlInfo(value: string) {
  const prefix = 'data:image/png;base64,';
  if (!value.startsWith(prefix)) throw new Error('Invalid PNG data URL');
  const encoded = value.slice(prefix.length);
  const header = atob(encoded.slice(0, 64));
  if (header.length < 26 || header.slice(0, 8) !== '\x89PNG\r\n\x1a\n' || header.slice(12, 16) !== 'IHDR') {
    throw new Error('Invalid PNG header');
  }
  const uint32 = (offset: number) => (
    ((header.charCodeAt(offset) << 24) >>> 0)
    + (header.charCodeAt(offset + 1) << 16)
    + (header.charCodeAt(offset + 2) << 8)
    + header.charCodeAt(offset + 3)
  );
  return {
    width: uint32(16),
    height: uint32(20),
    colorType: header.charCodeAt(25),
  };
}

serve(async (req) => {
  let usageReservation: UsageReservation | null = null;
  let observedBrandId: string | null = null;
  let observedUserId: string | null = null;
  let observedJobId: string | null = null;
  let observedSourceMetadata: Record<string, unknown> | null = null;
  let telemetryClient: any = null;
  const uploadedStoragePaths: string[] = [];
  const insertedImageIds: string[] = [];
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
    const {
      imageUrl,
      imageUrls,
      prompt,
      brandId,
      lightchainCompat,
      outputBackground,
      maskDataUrl,
      parentObjectId,
      generation,
      maskApplied,
      maskCoveragePercent,
      maskWidth,
      maskHeight,
      providerModel,
      inputFidelity,
      quality,
      sourceReadback,
      generationIntent,
    } = body;

    if (!prompt || !brandId) {
      throw new Error('Missing required parameters');
    }
    const editInputImages = normalizeEditImageInputs(imageUrl, imageUrls);
    const primaryImageUrl = editInputImages[0];
    if (maskDataUrl !== undefined && (
      typeof maskDataUrl !== 'string'
      || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(maskDataUrl)
      || maskDataUrl.length > 24_000_000
    )) {
      throw new Error('Invalid edit mask');
    }
    if (maskDataUrl) {
      if (!primaryImageUrl.startsWith('data:image/png;base64,')) {
        throw new Error('Masked edit input must be PNG');
      }
      const imageInfo = pngDataUrlInfo(primaryImageUrl);
      const maskInfo = pngDataUrlInfo(maskDataUrl);
      if (imageInfo.width !== maskInfo.width || imageInfo.height !== maskInfo.height) {
        throw new Error('Edit mask dimensions must match input image');
      }
      if (maskInfo.colorType !== 4 && maskInfo.colorType !== 6) {
        throw new Error('Edit mask must contain an alpha channel');
      }
    }

    const hasMask = typeof maskDataUrl === 'string' && maskDataUrl.trim().length > 0;
    if (hasMask && (!maskDataUrl.startsWith('data:image/png;base64,') || maskDataUrl.length > 12_000_000)) {
      throw new Error('Invalid partial-edit mask');
    }
    if (maskApplied === true && !hasMask) {
      throw new Error('Partial-edit mask is required');
    }
    const requestedFeatureId = typeof lightchainCompat?.lightchainFeatureId === 'string'
      ? lightchainCompat.lightchainFeatureId
      : null;
    const imageEditOptions = resolveLightchainImageEditOptions({
      featureId: requestedFeatureId,
      providerModel,
      inputFidelity,
      quality,
    });
    const safeParentObjectId = typeof parentObjectId === 'string' && parentObjectId.trim()
      ? parentObjectId.trim().slice(0, 128)
      : null;
    const parsedGeneration = Number(generation);
    const safeGeneration = Number.isInteger(parsedGeneration) && parsedGeneration >= 0 && parsedGeneration <= 100
      ? parsedGeneration
      : null;
    const partialEditProvenance = {
      mode: hasMask ? 'inpaint' : 'prompt-edit',
      inputImageCount: editInputImages.length,
      maskApplied: hasMask,
      parentObjectId: safeParentObjectId,
      generation: safeGeneration,
      maskCoveragePercent: typeof maskCoveragePercent === 'number' ? Math.max(0, Math.min(100, maskCoveragePercent)) : null,
      maskWidth: typeof maskWidth === 'number' ? Math.max(1, Math.min(8192, Math.round(maskWidth))) : null,
      maskHeight: typeof maskHeight === 'number' ? Math.max(1, Math.min(8192, Math.round(maskHeight))) : null,
      providerModel: imageEditOptions.providerModel,
      inputFidelity: imageEditOptions.inputFidelity,
      quality: imageEditOptions.quality,
      backendProvider: 'supabase-edge-function',
      provider: 'openai',
    };

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
    const materialMetadata = sanitizeMaterialGenerationMetadata(body);
    const sourceMetadata = buildSourceMetadata(sourceReadback, generationIntent);
    observedSourceMetadata = sourceMetadata;
    const requestedCandidateCount = hasMask && !imageEditOptions.isLightchainMaterialRoute ? 4 : 1;

    const { data: job, error: jobError } = await supabaseClient
      .from('generation_jobs')
      .insert({
        brand_id: brandId,
        user_id: user.id,
        feature_type: hasMask ? 'inpaint' : 'prompt-edit',
        input_params: {
          imageUrl: '[provided]',
          prompt,
          requestId,
          requestedCandidateCount,
          ...partialEditProvenance,
          ...(materialMetadata ?? {}),
          ...(sourceMetadata ?? {}),
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
      sourceMetadata,
      requestId,
    });

    const result = await editOpenAiImage({
      prompt,
      images: editInputImages.map((inputImageUrl) => ({ imageUrl: inputImageUrl })),
      mask: maskDataUrl ? { imageUrl: maskDataUrl } : undefined,
      model: imageEditOptions.providerModel,
      inputFidelity: imageEditOptions.inputFidelity,
      quality: imageEditOptions.quality,
      background: outputBackground === 'transparent' ? 'transparent' : 'auto',
      count: requestedCandidateCount,
    });
    const generatedCandidates = (result.candidates?.length ? result.candidates : [{
      base64: result.base64,
      mimeType: result.mimeType,
      candidateIndex: 0,
    }])
      .slice(0, requestedCandidateCount);
    const persistedImages: Array<{
      id: string;
      imageUrl: string;
      prompt: string;
      jobId: string;
      imageId: string;
      storagePath: string;
      persistenceStatus: 'completed';
      candidateIndex: number;
      batchId: string;
    }> = [];
    const failedCandidates: Array<{ candidateIndex: number; error: string }> = [];
    const candidateCleanupErrors: string[] = [];
    let candidateCleanupAttempted = false;

    for (const [fallbackIndex, candidate] of generatedCandidates.entries()) {
      const candidateIndex = typeof candidate.candidateIndex === 'number'
        ? candidate.candidateIndex
        : fallbackIndex;
      let candidateStoragePath: string | null = null;
      try {
        const imageAsset = openAiImageArtifact(candidate);
        candidateStoragePath = `${user.id}/${brandId}/${Date.now()}_${job.id}_${candidateIndex}_edited.${imageAsset.extension}`;
        const imageBuffer = Uint8Array.from(atob(imageAsset.base64), (c) => c.charCodeAt(0));
        const { error: uploadError } = await supabaseService.storage
          .from('generated-images')
          .upload(candidateStoragePath, imageBuffer, { contentType: imageAsset.contentType, upsert: false });
        if (uploadError) throw uploadError;
        uploadedStoragePaths.push(candidateStoragePath);

        const { data: signedUrlData, error: signedUrlError } = await supabaseService.storage
          .from('generated-images')
          .createSignedUrl(candidateStoragePath, 60 * 60);
        if (signedUrlError || !signedUrlData?.signedUrl) {
          throw signedUrlError ?? new Error('Storage signed URL failed');
        }

        const { data: image, error: imageInsertError } = await supabaseClient
          .from('generated_images')
          .insert({
            job_id: job.id,
            brand_id: brandId,
            user_id: user.id,
            storage_path: candidateStoragePath,
            image_url: null,
            prompt,
            negative_prompt: null,
            feature_type: hasMask ? 'inpaint' : 'prompt-edit',
            model_used: result.model,
            generation_params: {
              ...partialEditProvenance,
              ...(hasMask ? { maskApplied: true } : {}),
              provider: 'openai',
              taskId: result.taskId,
              providerModel: result.model,
              inputFidelity: result.inputFidelity ?? imageEditOptions.inputFidelity,
              quality: result.quality ?? imageEditOptions.quality,
              batchId: job.id,
              candidateIndex,
              requestedCandidateCount,
              inputImageCount: editInputImages.length,
            },
            metadata: {
              remoteSaveStatus: 'succeeded',
              source: 'edit-image',
              requestId,
              ...partialEditProvenance,
              ...(hasMask ? { maskApplied: true } : {}),
              status: 'completed',
              batchId: job.id,
              candidateIndex,
              requestedCandidateCount,
              inputImageCount: editInputImages.length,
              providerModel: result.model,
              inputFidelity: result.inputFidelity ?? imageEditOptions.inputFidelity,
              quality: result.quality ?? imageEditOptions.quality,
              ...(materialMetadata ?? {}),
              ...(sourceMetadata ?? {}),
              ...(completedLightchainMetadata ? { lightchainCompat: completedLightchainMetadata } : {}),
            } as any,
          })
          .select('id')
          .single();
        if (imageInsertError || !image?.id) {
          throw imageInsertError ?? new Error('Generated image insert did not return an id');
        }
        insertedImageIds.push(image.id);
        persistedImages.push({
          id: image.id,
          imageUrl: signedUrlData.signedUrl,
          prompt,
          jobId: job.id,
          imageId: image.id,
          storagePath: candidateStoragePath,
          persistenceStatus: 'completed',
          candidateIndex,
          batchId: job.id,
        });
      } catch (candidateError) {
        failedCandidates.push({ candidateIndex, error: sanitizeError(candidateError) });
        if (candidateStoragePath && uploadedStoragePaths.includes(candidateStoragePath)) {
          candidateCleanupAttempted = true;
          const { error: removeError } = await supabaseService.storage
            .from('generated-images')
            .remove([candidateStoragePath]);
          if (removeError) candidateCleanupErrors.push(sanitizeError(removeError));
          else uploadedStoragePaths.splice(uploadedStoragePaths.indexOf(candidateStoragePath), 1);
        }
      }
    }

    if (!persistedImages.length) {
      throw new Error(`edit_image_zero_persisted_candidates:${failedCandidates.map((entry) => entry.error).join('|')}`);
    }
    const persistenceStatus = persistedImages.length === requestedCandidateCount
      ? 'completed'
      : 'partial';
    const firstImage = persistedImages[0];

    await persistLightchainTaskSteps({
      supabaseClient,
      lightchainMetadata: completedLightchainMetadata,
      jobId: job.id,
      imageId: firstImage.imageId,
      brandId,
      userId: user.id,
      status: 'completed',
      sourceMetadata,
      requestId,
      artifactUri: firstImage.storagePath,
    });

    const { error: jobCompleteError } = await supabaseClient
      .from('generation_jobs')
      .update({
        status: 'completed',
        error_message: persistenceStatus === 'partial'
          ? `partial:${persistedImages.length}/${requestedCandidateCount}`
          : null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    if (jobCompleteError) throw jobCompleteError;

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
      imageId: firstImage.imageId,
      storagePath: firstImage.storagePath,
      imageUrl: firstImage.imageUrl,
      feature: hasMask ? 'partial-edit' : 'prompt-edit',
      status: 'completed',
      ...partialEditProvenance,
      persistenceStatus,
      cleanupStatus: resolveImageEditCleanupStatus(candidateCleanupAttempted, candidateCleanupErrors),
      requestedCandidateCount,
      persistedCandidateCount: persistedImages.length,
      failedCandidates,
      cleanupErrors: candidateCleanupErrors,
      images: persistedImages,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    const cleanupErrors: string[] = [];
    let cleanupAttempted = false;
    if (telemetryClient && insertedImageIds.length) {
      cleanupAttempted = true;
      try {
        const { error: deleteImagesError } = await telemetryClient
          .from('generated_images')
          .delete()
          .in('id', insertedImageIds);
        if (deleteImagesError) throw deleteImagesError;
      } catch (cleanupError) {
        cleanupErrors.push(sanitizeError(cleanupError));
      }
    }
    if (telemetryClient && uploadedStoragePaths.length) {
      cleanupAttempted = true;
      try {
        const { error: removeStorageError } = await telemetryClient.storage
          .from('generated-images')
          .remove(uploadedStoragePaths);
        if (removeStorageError) throw removeStorageError;
      } catch (cleanupError) {
        cleanupErrors.push(sanitizeError(cleanupError));
      }
    }
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
      cleanupStatus: resolveImageEditCleanupStatus(cleanupAttempted, cleanupErrors),
      cleanupErrors,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
