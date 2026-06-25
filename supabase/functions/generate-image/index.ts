import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { clientError, createServiceClient, createUserClient, requireBrandRole, requireUser } from '../_shared/auth.ts'
import { completeBrandUsage, reserveBrandUsage, type UsageReservation } from '../_shared/usage.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';
import { persistLightchainTaskSteps, sanitizeLightchainCompat, withLightchainTaskStepStatus, type LightchainCompatMetadata } from '../_shared/lightchainCompat.ts';
import { sanitizeMaterialGenerationMetadata, sanitizeMetadataWithoutImageUrls } from '../_shared/materialMetadata.ts';
import { generateRunwayImage, runwayImageArtifact } from '../_shared/runway.ts';
import { requireRunwayMcpConnectionApproval } from '../_shared/runwayApproval.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface GenerateRequest {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  brandId: string
  featureType?: string
  sourceReadback?: unknown
  generationIntent?: unknown
  lightchainCompat?: unknown
  materialReferences?: unknown
  layerPlan?: unknown
  maskPlan?: unknown
  compositionPreview?: unknown
  campaignMeta?: unknown
  textOverlay?: unknown
  localRunwayWorker?: unknown
}

const SOURCE_CONFIG = {
  studio: { label: 'Fashion Studio', resumePath: '/studio', versions: ['studio-selection-local-v1'] },
  models: { label: 'モデルライブラリ', resumePath: '/models', versions: ['model-library-local-v1'] },
  patterns: { label: '柄・グラフィック', resumePath: '/patterns', versions: ['pattern-preview-local-v1'] },
  video: { label: 'Video Workstation', resumePath: '/video', versions: ['video-storyboard-local-v1'] },
  lab: { label: 'Lab', resumePath: '/lab', versions: ['lab-evaluation-local-v1'] },
} as const

type SourceWorkspace = keyof typeof SOURCE_CONFIG

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const readString = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const ALLOWED_LOCAL_WORKER_FEATURES = new Set([
  'campaign-image',
  'design-gacha',
  'product-shots',
  'model-matrix',
  'multilingual-banner',
  'scene-coordinate',
  'remove-bg',
  'remove-background',
  'colorize',
  'upscale',
  'variations',
  'generate-variations',
])

const sanitizePositiveInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, Math.round(numeric)))
}

const sanitizeLocalRunwayWorkerRequest = (value: unknown, persistedFeatureType: string) => {
  if (!isRecord(value) || value.enabled !== true) return null
  if (!ALLOWED_LOCAL_WORKER_FEATURES.has(persistedFeatureType)) {
    throw new Error('local_runway_worker_feature_not_allowed')
  }

  const provider = readString(value, 'provider') || 'runway_mcp_local_worker'
  if (provider !== 'runway_mcp_local_worker') {
    throw new Error('local_runway_worker_provider_invalid')
  }

  const workerContractVersion = readString(value, 'workerContractVersion') || 'heavy-chain.local-runway-worker.v1'
  if (workerContractVersion !== 'heavy-chain.local-runway-worker.v1') {
    throw new Error('local_runway_worker_contract_invalid')
  }

  const referenceImage = readString(value, 'referenceImage')
  if (referenceImage) {
    const isDataImage = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(referenceImage)
    const isHttpsImage = /^https:\/\/[^\s]+$/i.test(referenceImage)
    if (!isDataImage && !isHttpsImage) {
      throw new Error('local_runway_worker_reference_image_invalid')
    }
    if (referenceImage.length > 1_500_000) {
      throw new Error('local_runway_worker_reference_image_too_large')
    }
  }

  const metadata = sanitizeMetadataWithoutImageUrls(value.metadata)
  return {
    provider,
    workerContractVersion,
    count: sanitizePositiveInteger(value.count, 1, 1, 4),
    referenceImage: referenceImage ?? null,
    referenceType: readString(value, 'referenceType'),
    metadata,
  }
}

const sanitizeSourceReadback = (value: unknown) => {
  if (!isRecord(value)) return null

  const sourceWorkspace = readString(value, 'sourceWorkspace')
  if (!sourceWorkspace || !(sourceWorkspace in SOURCE_CONFIG)) return null

  const config = SOURCE_CONFIG[sourceWorkspace as SourceWorkspace]
  const workflowVersion = readString(value, 'workflowVersion')
  const sourceLabel = readString(value, 'sourceLabel')
  const sourceResumePath = readString(value, 'sourceResumePath')
  const sourceMode = readString(value, 'sourceMode')

  if (!workflowVersion || !(config.versions as readonly string[]).includes(workflowVersion)) return null
  if (sourceLabel !== config.label) return null
  if (sourceResumePath !== config.resumePath) return null
  if (sourceMode !== 'local-workflow-intake') return null

  return {
    sourceWorkspace: sourceWorkspace as SourceWorkspace,
    workflowVersion,
    sourceLabel,
    sourceResumePath,
    sourceMode: 'local-workflow-intake' as const,
  }
}

const sanitizeGenerationIntent = (value: unknown, source: ReturnType<typeof sanitizeSourceReadback>) => {
  if (!source || !isRecord(value)) return null
  const feature = readString(value, 'feature')
  const prompt = readString(value, 'prompt')
  const href = readString(value, 'href')
  const label = readString(value, 'label')
  if (!feature || !prompt || !href || !label) return null
  if (readString(value, 'sourceWorkspace') !== source.sourceWorkspace) return null
  if (readString(value, 'workflowVersion') !== source.workflowVersion) return null
  if (readString(value, 'sourceLabel') !== source.sourceLabel) return null
  if (readString(value, 'sourceResumePath') !== source.sourceResumePath) return null
  if (readString(value, 'sourceMode') !== source.sourceMode) return null

  return {
    feature,
    prompt,
    href,
    label,
    ...source,
    ...(readString(value, 'aspectRatio') ? { aspectRatio: readString(value, 'aspectRatio') } : {}),
  }
}

const buildSourceMetadata = (sourceReadback: unknown, generationIntent: unknown) => {
  const source = sanitizeSourceReadback(sourceReadback)
  if (!source) return null
  return {
    ...source,
    ...(sanitizeGenerationIntent(generationIntent, source)
      ? { generationIntent: sanitizeGenerationIntent(generationIntent, source) }
      : {}),
  }
}

serve(async (req) => {
  let usageReservation: UsageReservation | null = null;
  let observedBrandId: string | null = null;
  let observedUserId: string | null = null;
  let observedLightchainMetadata: LightchainCompatMetadata | null = null;
  let observedSourceMetadata: Record<string, unknown> | null = null;
  let telemetryClient: any = null;
  let persistenceStatus: 'not_started' | 'processing' | 'completed' | 'failed' = 'not_started';
  let failedStage: string | null = null;
  let cleanupStatus: 'none' | 'attempted' | 'failed' = 'none';
  let jobId: string | null = null;
  let storagePath: string | null = null;
  const uploadedStoragePaths: string[] = [];
  const insertedImageIds: string[] = [];
  const functionName = 'generate-image';
  const requestId = requestIdFrom(req);
  const startedAt = Date.now();
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAuth = createUserClient(req)
    const user = await requireUser(supabaseAuth)
    console.log('User authenticated:', user.id)

    // Parse request body
    const {
      prompt,
      negativePrompt,
      width = 1024,
      height = 1024,
      brandId,
      featureType,
      sourceReadback,
      generationIntent,
      lightchainCompat,
      materialReferences,
      layerPlan,
      maskPlan,
      compositionPreview,
      campaignMeta,
      textOverlay,
      localRunwayWorker,
    }: GenerateRequest = await req.json()

    if (!prompt || prompt.length > 8000) {
      throw new Error('Prompt is required')
    }

    if (!brandId) {
      throw new Error('Brand ID is required')
    }

    await requireBrandRole(supabaseAuth, brandId, user.id, 'editor')

    const supabaseClient = createServiceClient()
    telemetryClient = supabaseClient
    await requireRunwayMcpConnectionApproval(supabaseClient, brandId);
    const persistedFeatureType = typeof featureType === 'string' && featureType.trim()
      ? featureType.trim()
      : 'text-to-image'
    const localWorkerRequest = sanitizeLocalRunwayWorkerRequest(localRunwayWorker, persistedFeatureType)
    const sourceMetadata = buildSourceMetadata(sourceReadback, generationIntent)
    const materialMetadata = sanitizeMaterialGenerationMetadata({
      materialReferences,
      layerPlan,
      maskPlan,
      compositionPreview,
    })
    const lightchainMetadata = sanitizeLightchainCompat(lightchainCompat)
    const completedLightchainMetadata = withLightchainTaskStepStatus(lightchainMetadata, 'completed')
    observedSourceMetadata = sourceMetadata
    observedLightchainMetadata = lightchainMetadata
    observedBrandId = brandId;
    observedUserId = user.id;
    usageReservation = await reserveBrandUsage(telemetryClient, {
      brandId,
      userId: user.id,
      functionName,
      units: 1,
      requestId,
      idempotencyKey: req.headers.get('idempotency-key'),
      metadata: localWorkerRequest ? { provider: localWorkerRequest.provider, queued: true } : {},
    });
    const inputParams = {
      prompt,
      negativePrompt,
      width,
      height,
      featureType: persistedFeatureType,
      requestId,
      ...(isRecord(campaignMeta) ? { campaignMeta } : {}),
      ...(isRecord(textOverlay) ? { textOverlay } : {}),
      ...(sourceMetadata ?? {}),
      ...(materialMetadata ?? {}),
      ...(lightchainMetadata ? { lightchainCompat: lightchainMetadata } : {}),
      ...(localWorkerRequest ? {
        provider: localWorkerRequest.provider,
        workerContractVersion: localWorkerRequest.workerContractVersion,
        count: localWorkerRequest.count,
        referenceImage: localWorkerRequest.referenceImage,
        referenceType: localWorkerRequest.referenceType,
        usageEventId: usageReservation?.usageEventId ?? null,
        requestedAt: new Date().toISOString(),
        ...localWorkerRequest.metadata,
      } : {}),
    }

    await recordEdgeFunctionRun(telemetryClient, {
      reservation: usageReservation,
      brandId,
      userId: user.id,
      functionName,
      status: 'started',
      requestId,
    });

    let optimizedPrompt = prompt

    // Create generation job
    failedStage = 'job'
    const { data: job, error: jobError } = await supabaseClient
      .from('generation_jobs')
      .insert({
        brand_id: brandId,
        user_id: user.id,
        feature_type: persistedFeatureType,
        input_params: inputParams as any,
        optimized_prompt: optimizedPrompt,
        status: 'processing'
      })
      .select()
      .single()

    if (jobError) {
      console.error('Job creation error:', jobError)
      throw new Error('Failed to create generation job')
    }
    jobId = job.id
    persistenceStatus = 'processing'
    await persistLightchainTaskSteps({
      supabaseClient,
      lightchainMetadata,
      jobId,
      brandId,
      userId: user.id,
      status: 'processing',
      sourceMetadata,
      requestId,
    })
    console.log('Job created:', job.id)

    if (localWorkerRequest) {
      failedStage = 'queued'
      await recordEdgeFunctionRun(telemetryClient, {
        reservation: usageReservation,
        brandId: observedBrandId,
        userId: observedUserId,
        functionName,
        status: 'succeeded',
        requestId,
        durationMs: durationSince(startedAt),
      });
      failedStage = null
      persistenceStatus = 'processing'
      const { data: queuedJob, error: queueError } = await supabaseClient
        .from('generation_jobs')
        .update({ status: 'pending', error_message: null })
        .eq('id', job.id)
        .select('*')
        .single()
      if (queueError || !queuedJob) {
        throw queueError ?? new Error('local_runway_worker_queue_update_failed')
      }
      return new Response(
        JSON.stringify({
          success: true,
          queued: true,
          provider: localWorkerRequest.provider,
          workerContractVersion: localWorkerRequest.workerContractVersion,
          job: queuedJob,
          jobId: job.id,
          persistenceStatus: 'pending',
          cleanupStatus: 'none',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 202,
        },
      )
    }

    failedStage = 'generation'
    const runwayResult = await generateRunwayImage({
      brandId,
      prompt: `Generate a high-quality professional fashion/apparel image: ${optimizedPrompt}. Style: Professional fashion photography, studio lighting, high resolution, commercial quality.`,
      negativePrompt,
      width,
      height,
    })
    const imageBase64 = runwayResult.base64
    const usedModel = runwayResult.model
    const imageAsset = runwayImageArtifact(runwayResult)
    console.log(`Image generated with model: ${usedModel}`)

    // Base64 Data URLを作成（ブラウザで直接表示可能）
    const imageDataUrl = imageAsset.dataUrl

    // Convert base64 to Uint8Array for storage
    const imageBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0))

    const fileName = `${user.id}/${brandId}/${job.id}.${imageAsset.extension}`
    storagePath = fileName
    failedStage = 'storage'
    const { error: uploadError } = await supabaseClient
      .storage
        .from('generated-images')
        .upload(fileName, imageBuffer, {
        contentType: imageAsset.contentType,
        upsert: false
      })

    if (uploadError) {
      throw new Error('Storage upload failed')
    }
    uploadedStoragePaths.push(fileName)

    // Calculate expiry (30 days)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)
    let imageId: string | null = null

    try {
      failedStage = 'image'
      const { data: image, error: imageInsertError } = await supabaseClient
        .from('generated_images')
        .insert({
          job_id: job.id,
          brand_id: brandId,
          user_id: user.id,
          storage_path: fileName,
          image_url: null,
          prompt: optimizedPrompt,
          negative_prompt: negativePrompt || null,
          feature_type: persistedFeatureType,
          model_used: usedModel,
          generation_params: { width, height },
          metadata: {
            remoteSaveStatus: 'succeeded',
            source: 'generate-image',
            requestId,
            ...(sourceMetadata ?? {}),
            ...(materialMetadata ?? {}),
            ...(completedLightchainMetadata ? { lightchainCompat: completedLightchainMetadata } : {}),
          } as any,
          expires_at: expiresAt.toISOString()
        })
        .select('id')
        .single()
      if (imageInsertError || !image?.id) {
        throw imageInsertError ?? new Error('Generated image insert did not return an id')
      }
      imageId = image?.id ?? null
      if (imageId) {
        insertedImageIds.push(imageId)
        await persistLightchainTaskSteps({
          supabaseClient,
          lightchainMetadata: completedLightchainMetadata,
          jobId,
          imageId,
          brandId,
          userId: user.id,
          status: 'completed',
          sourceMetadata,
          requestId,
          artifactUri: fileName,
        })
      }
      console.log('✅ Image record saved to database')

      // Update job status to completed
      failedStage = 'job_complete'
      const { error: completeJobError } = await supabaseClient
        .from('generation_jobs')
        .update({ status: 'completed', error_message: null, completed_at: new Date().toISOString() })
        .eq('id', job.id)
      if (completeJobError) {
        throw completeJobError
      }
      persistenceStatus = 'completed'
      failedStage = null
    } catch (dbError) {
      console.error('Database save failed:', dbError)
      throw new Error('Failed to save generated image')
    }

    // Base64 Data URLを返す（確実に表示可能）
    if (telemetryClient) {
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
    }


    return new Response(
      JSON.stringify({
        success: true,
        jobId: job.id,
        imageId,
        storagePath: fileName,
        persistenceStatus: 'completed',
        cleanupStatus: 'none',
        images: [{
          id: imageId ?? job.id,
          imageUrl: imageDataUrl,
          prompt: optimizedPrompt,
          jobId: job.id,
          imageId,
          storagePath: fileName,
          persistenceStatus: 'completed'
        }]
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    const cleanupErrors: string[] = [];
    persistenceStatus = jobId ? 'failed' : persistenceStatus;
    if (!failedStage) failedStage = 'unknown';

    if (telemetryClient && jobId) {
      cleanupStatus = 'attempted';
      if (insertedImageIds.length > 0) {
        try {
          const { error: deleteImagesError } = await telemetryClient
            .from('generated_images')
            .delete()
            .in('id', insertedImageIds);
          if (deleteImagesError) throw deleteImagesError;
        } catch (cleanupError) {
          cleanupErrors.push(clientError(cleanupError));
        }
      }

      if (uploadedStoragePaths.length > 0) {
        try {
          const { error: removeStorageError } = await telemetryClient
            .storage
            .from('generated-images')
            .remove(uploadedStoragePaths);
          if (removeStorageError) throw removeStorageError;
        } catch (cleanupError) {
          cleanupErrors.push(clientError(cleanupError));
        }
      }

      try {
        const { error: failJobError } = await telemetryClient
          .from('generation_jobs')
          .update({
            status: 'failed',
            error_message: sanitizeError(error),
            completed_at: new Date().toISOString(),
          })
          .eq('id', jobId);
        if (failJobError) throw failJobError;
        await persistLightchainTaskSteps({
          supabaseClient: telemetryClient,
          lightchainMetadata: observedLightchainMetadata,
          jobId,
          brandId: observedBrandId ?? '',
          userId: observedUserId ?? '',
          status: 'retryable',
          sourceMetadata: observedSourceMetadata,
          requestId,
          errorMessage: sanitizeError(error),
        });
      } catch (cleanupError) {
        cleanupErrors.push(clientError(cleanupError));
      }

      cleanupStatus = cleanupErrors.length ? 'failed' : 'attempted';
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

    console.error('Error:', error)
    return new Response(
      JSON.stringify({ 
        success: false,
        error: clientError(error),
        jobId,
        storagePath,
        persistenceStatus,
        failedStage,
        cleanupStatus,
        cleanupErrors,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
