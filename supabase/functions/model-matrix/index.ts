import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { clientError, createServiceClient, requireBrandRole, type Database } from '../_shared/auth.ts';
import { completeBrandUsage, reserveBrandUsage, type UsageReservation } from '../_shared/usage.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';
import { editOpenAiImage, generateOpenAiImage, openAiImageArtifact, openAiImageDataUri, type OpenAiImageResult } from '../_shared/openaiImage.ts';
import { persistLightchainTaskSteps, sanitizeLightchainCompat, withLightchainTaskStepStatus, type LightchainCompatMetadata } from '../_shared/lightchainCompat.ts';
import { sanitizeMaterialGenerationMetadata } from '../_shared/materialMetadata.ts';
import { requireLegalSafetyApproval } from '../_shared/legalSafety.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BODY_TYPES = [
  { id: 'slim', name: 'スリム', prompt: 'slim fit, lean body type' },
  { id: 'regular', name: 'レギュラー', prompt: 'regular fit, average body type' },
  { id: 'plus', name: 'プラス', prompt: 'plus size, curvy body type' },
];

const AGE_GROUPS = [
  { id: '20s', name: '20代', prompt: 'young adult in their 20s' },
  { id: '30s', name: '30代', prompt: 'adult in their 30s' },
  { id: '40s', name: '40代', prompt: 'mature adult in their 40s' },
  { id: '50s', name: '50代', prompt: 'elegant adult in their 50s' },
];

const SKIN_TONES = ['light', 'medium', 'dark'] as const;
const HAIR_STYLES = ['short', 'medium', 'long'] as const;
const MODEL_CANDIDATE_LABELS = ['Clean EC 20s', 'Street LOOK 30s', 'Premium AD 40s'] as const;
const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_REFERENCE_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

const SOURCE_CONFIG = {
  studio: { label: 'Fashion Studio', resumePath: '/studio', versions: ['studio-selection-local-v1'] },
  models: { label: 'モデルライブラリ', resumePath: '/models', versions: ['model-library-local-v1'] },
  patterns: { label: '柄・グラフィック', resumePath: '/patterns', versions: ['pattern-preview-local-v1'] },
  video: { label: 'Video Workstation', resumePath: '/video', versions: ['video-storyboard-local-v1'] },
  lab: { label: 'Lab', resumePath: '/lab', versions: ['lab-evaluation-local-v1'] },
} as const;

type SourceWorkspace = keyof typeof SOURCE_CONFIG;
type SourceMetadata = {
  sourceWorkspace: SourceWorkspace;
  workflowVersion: string;
  sourceLabel: string;
  sourceResumePath: string;
  sourceMode: 'local-workflow-intake';
  bodyTypes: string[];
  ageGroups: string[];
  skinTone?: string;
  hairStyle?: string;
  modelCandidateLabel?: string;
  generationIntent: {
    feature: 'model-matrix';
    prompt: string;
    href: string;
    label: string;
    sourceWorkspace: SourceWorkspace;
    workflowVersion: string;
    sourceLabel: string;
    sourceResumePath: string;
    sourceMode: 'local-workflow-intake';
    bodyTypes: string[];
    ageGroups: string[];
    skinTone?: string;
    hairStyle?: string;
    modelCandidateLabel?: string;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const readString = (record: Record<string, unknown>, key: string) => {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const pickAllowedString = <T extends string>(value: unknown, allowed: readonly T[]) => {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : undefined;
};

const pickAllowedList = (value: unknown, allowed: readonly string[], fallback: string[]) => {
  if (!Array.isArray(value)) return fallback;
  const allowedSet = new Set(allowed);
  const items = value.filter((item): item is string => typeof item === 'string' && allowedSet.has(item));
  return items.length ? items : fallback;
};

const normalizeImageMimeType = (mimeType: string | null | undefined) => {
  const cleanMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return ALLOWED_REFERENCE_IMAGE_MIME_TYPES.has(cleanMimeType) ? cleanMimeType : null;
};

const base64ByteLength = (base64: string) => {
  const cleanBase64 = base64.trim();
  const padding = cleanBase64.endsWith('==') ? 2 : cleanBase64.endsWith('=') ? 1 : 0;
  return Math.floor((cleanBase64.length * 3) / 4) - padding;
};

const isBlockedReferenceHost = (hostname: string) => {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '0.0.0.0' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host.startsWith('127.')) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d{1,3})\./);
  if (private172) {
    const secondOctet = Number(private172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }
  if (/^169\.254\./.test(host)) return true;
  if (/^\[?(fc|fd)[0-9a-f]{2}:/i.test(host)) return true;
  if (/^\[?fe80:/i.test(host)) return true;
  return false;
};

const allowedReferenceUrlHostnames = () => {
  const hostnames = new Set<string>();
  for (const rawUrl of [
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('VITE_SUPABASE_URL'),
  ]) {
    try {
      if (rawUrl) hostnames.add(new URL(rawUrl).hostname.toLowerCase());
    } catch {
      // Ignore malformed optional env URLs.
    }
  }
  return hostnames;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

const readResponseBytesCapped = async (response: Response) => {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = response.body?.getReader();
  if (!reader) return null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REFERENCE_IMAGE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const sanitizeSourceReadback = (value: unknown) => {
  if (!isRecord(value)) return null;

  const sourceWorkspace = readString(value, 'sourceWorkspace');
  if (!sourceWorkspace || !(sourceWorkspace in SOURCE_CONFIG)) return null;

  const config = SOURCE_CONFIG[sourceWorkspace as SourceWorkspace];
  const workflowVersion = readString(value, 'workflowVersion');
  const sourceLabel = readString(value, 'sourceLabel');
  const sourceResumePath = readString(value, 'sourceResumePath');
  const sourceMode = readString(value, 'sourceMode');

  if (!workflowVersion || !(config.versions as readonly string[]).includes(workflowVersion)) return null;
  if (sourceLabel !== config.label) return null;
  if (sourceResumePath !== config.resumePath) return null;
  if (sourceMode !== 'local-workflow-intake') return null;

  return {
    sourceWorkspace: sourceWorkspace as SourceWorkspace,
    workflowVersion,
    sourceLabel,
    sourceResumePath,
    sourceMode: 'local-workflow-intake' as const,
  };
};

const buildGenerationIntentHref = ({
  prompt,
  sourceWorkspace,
  workflowVersion,
  sourceLabel,
  sourceResumePath,
  sourceMode,
  bodyTypes,
  ageGroups,
  skinTone,
  hairStyle,
  modelCandidateLabel,
}: Omit<SourceMetadata['generationIntent'], 'feature' | 'href' | 'label'>) => {
  const params = new URLSearchParams({
    feature: 'model-matrix',
    prompt,
    sourceWorkspace,
    workflowVersion,
    sourceLabel,
    sourceResumePath,
    sourceMode,
  });
  if (bodyTypes.length) params.set('bodyTypes', bodyTypes.join(','));
  if (ageGroups.length) params.set('ageGroups', ageGroups.join(','));
  if (skinTone) params.set('skinTone', skinTone);
  if (hairStyle) params.set('hairStyle', hairStyle);
  if (modelCandidateLabel) params.set('modelCandidateLabel', modelCandidateLabel);
  return `/generate?${params.toString()}`;
};

const buildSourceMetadata = ({
  sourceReadback,
  productDescription,
  bodyTypes,
  ageGroups,
  skinTone,
  hairStyle,
  modelCandidateLabel,
}: {
  sourceReadback: unknown;
  productDescription: string;
  bodyTypes: string[];
  ageGroups: string[];
  skinTone?: string;
  hairStyle?: string;
  modelCandidateLabel?: string;
}): SourceMetadata | null => {
  const source = sanitizeSourceReadback(sourceReadback);
  if (!source) return null;

  const generationIntent = {
    feature: 'model-matrix' as const,
    prompt: productDescription,
    href: buildGenerationIntentHref({
      prompt: productDescription,
      ...source,
      bodyTypes,
      ageGroups,
      skinTone,
      hairStyle,
      modelCandidateLabel,
    }),
    label: 'モデルマトリクスで生成',
    ...source,
    bodyTypes,
    ageGroups,
    ...(skinTone ? { skinTone } : {}),
    ...(hairStyle ? { hairStyle } : {}),
    ...(modelCandidateLabel ? { modelCandidateLabel } : {}),
  };

  return {
    ...source,
    bodyTypes,
    ageGroups,
    ...(skinTone ? { skinTone } : {}),
    ...(hairStyle ? { hairStyle } : {}),
    ...(modelCandidateLabel ? { modelCandidateLabel } : {}),
    generationIntent,
  };
};

// 画像をBase64に変換
async function fetchImageAsBase64(imageUrl: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    if (imageUrl.startsWith('data:')) {
      const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        const mimeType = normalizeImageMimeType(matches[1]);
        const base64 = matches[2].trim();
        if (!mimeType || base64ByteLength(base64) > MAX_REFERENCE_IMAGE_BYTES) return null;
        return { base64, mimeType };
      }
      return null;
    }
    const parsedUrl = new URL(imageUrl);
    if (!['https:', 'http:'].includes(parsedUrl.protocol)) return null;
    if (isBlockedReferenceHost(parsedUrl.hostname)) return null;
    const allowedHostnames = allowedReferenceUrlHostnames();
    if (!allowedHostnames.has(parsedUrl.hostname.toLowerCase())) return null;

    const response = await fetch(imageUrl, { redirect: 'manual' });
    if (!response.ok) return null;
    const contentType = normalizeImageMimeType(response.headers.get('content-type'));
    if (!contentType) return null;
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_REFERENCE_IMAGE_BYTES) return null;

    const bytes = await readResponseBytesCapped(response);
    if (!bytes) return null;
    return { base64: bytesToBase64(bytes), mimeType: contentType };
  } catch (e) {
    console.log('⚠️ Failed to fetch image:', clientError(e));
    return null;
  }
}

// 参照画像を使って生成
async function generateWithReference(
  originalBase64: string,
  originalMimeType: string,
  modelBase64: string | null,
  modelMimeType: string | null,
  description: string,
  bodyType: typeof BODY_TYPES[0],
  ageGroup: typeof AGE_GROUPS[0],
  gender: string,
  imageModel?: string | null
): Promise<OpenAiImageResult | null> {
  console.log(`🎨 Generating ${bodyType.name} x ${ageGroup.name} with reference...`);

  const modelReferenceInstruction = modelBase64
    ? `REFERENCE MODEL: Use the second reference image as the person/model basis. Preserve the person's pose direction, body proportions, face visibility level, hairstyle impression, and overall styling mood unless it conflicts with the garment.`
    : `MODEL: ${gender} model, ${bodyType.prompt}, ${ageGroup.prompt}`;

  const prompt = `Generate a professional fashion model try-on photo.

${modelReferenceInstruction}
CLOTHING: The model is wearing EXACTLY the garment from the first reference image: ${description}

CRITICAL REQUIREMENTS:
1. The clothing must be IDENTICAL to the first reference image
2. Same colors, same design, same fabric texture
3. Same pockets, zippers, logos, all details
4. Put the garment naturally on the model body; do not create a flat product mockup
5. Do not replace the garment with a similar item
6. If a second reference model is provided, keep that model as the person being dressed

STYLE: Professional fashion photography, full body shot, studio lighting, neutral background`;

  const referenceImages = [
    { imageUrl: openAiImageDataUri(originalBase64, originalMimeType) },
    ...(modelBase64 ? [{ imageUrl: openAiImageDataUri(modelBase64, modelMimeType || 'image/png') }] : []),
  ];

  return await editOpenAiImage({
    prompt,
    images: referenceImages,
    model: imageModel,
    background: 'auto',
  });
}

// テキストのみで生成
async function generateFromText(
  description: string,
  bodyType: typeof BODY_TYPES[0],
  ageGroup: typeof AGE_GROUPS[0],
  gender: string,
  imageModel?: string | null
): Promise<OpenAiImageResult | null> {
  const prompt = `${gender} model wearing ${description}, ${bodyType.prompt}, ${ageGroup.prompt}, fashion photography, full body shot, professional studio lighting, neutral background, high quality`;
  return await generateOpenAiImage({ prompt, model: imageModel });
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
  const uploadedStoragePaths: string[] = [];
  const insertedImageIds: string[] = [];
  const functionName = 'model-matrix';
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
      }
    );
    const supabaseService = createServiceClient();
    telemetryClient = supabaseService;

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const body = await req.json();
    let { 
      productDescription, 
      imageUrl,
      modelReferenceImageUrl,
      brandId, 
      bodyTypes = ['slim', 'regular', 'plus'],
      ageGroups = ['20s', '30s', '40s'],
      gender = 'female',
      skinTone,
      hairStyle,
      sourceReadback,
      modelCandidateLabel,
      lightchainCompat,
    } = body;
    bodyTypes = pickAllowedList(bodyTypes, BODY_TYPES.map((bodyType) => bodyType.id), ['slim', 'regular', 'plus']);
    ageGroups = pickAllowedList(ageGroups, AGE_GROUPS.map((ageGroup) => ageGroup.id), ['20s', '30s', '40s']);
    gender = typeof gender === 'string' && gender.trim() ? gender.trim() : 'female';
    skinTone = pickAllowedString(skinTone, SKIN_TONES);
    hairStyle = pickAllowedString(hairStyle, HAIR_STYLES);
    modelCandidateLabel = pickAllowedString(modelCandidateLabel, MODEL_CANDIDATE_LABELS);
    const requestedGenerationUnits = Math.max(1, bodyTypes.length * ageGroups.length);
    const requestSourceMetadata = buildSourceMetadata({
      sourceReadback,
      productDescription: typeof productDescription === 'string' ? productDescription : '',
      bodyTypes,
      ageGroups,
      skinTone,
      hairStyle,
      modelCandidateLabel,
    });
    const materialMetadata = sanitizeMaterialGenerationMetadata(body);
    const lightchainMetadata = sanitizeLightchainCompat(lightchainCompat);
    const completedLightchainMetadata = withLightchainTaskStepStatus(lightchainMetadata, 'completed');
    observedSourceMetadata = requestSourceMetadata;
    observedLightchainMetadata = lightchainMetadata;

    console.log('📥 Request:', { productDescription: !!productDescription, imageUrl: !!imageUrl, modelReferenceImageUrl: !!modelReferenceImageUrl, brandId });

    if (!productDescription && !imageUrl) {
      throw new Error('商品説明または商品画像を入力してください');
    }

    if (!brandId) {
      throw new Error('Brand ID is required');
    }

    requireLegalSafetyApproval(body.legalSafety, [
      productDescription,
      imageUrl,
      bodyTypes,
      ageGroups,
      gender,
      skinTone,
      hairStyle,
      modelCandidateLabel,
      body.materialReferences,
      modelReferenceImageUrl ? '[model_reference_image_provided]' : null,
      body.layerPlan,
      body.maskPlan,
      body.compositionPreview,
    ]);

    await requireBrandRole(supabaseService, brandId, user.id, 'editor');
    observedBrandId = brandId;
    observedUserId = user.id;
    usageReservation = await reserveBrandUsage(telemetryClient, {
      brandId,
      userId: user.id,
      functionName,
      units: requestedGenerationUnits,
      requestId,
      idempotencyKey: req.headers.get('idempotency-key'),
      metadata: { provider: 'openai', imageCount: requestedGenerationUnits },
    });
    await recordEdgeFunctionRun(telemetryClient, {
      reservation: usageReservation,
      brandId,
      userId: user.id,
      functionName,
      status: 'started',
      requestId,
    });

    failedStage = 'job';
    const { data: job, error: jobError } = await supabaseService
      .from('generation_jobs')
      .insert({
        brand_id: brandId,
        user_id: user.id,
        feature_type: 'model-matrix',
        input_params: {
          productDescription: productDescription ?? null,
          imageUrl: imageUrl ? '[provided]' : null,
          modelReferenceImageUrl: modelReferenceImageUrl ? '[provided]' : null,
          bodyTypes,
          ageGroups,
          gender,
          requestId,
          ...(skinTone ? { skinTone } : {}),
          ...(hairStyle ? { hairStyle } : {}),
          ...(requestSourceMetadata ?? {}),
          ...(materialMetadata ?? {}),
          ...(lightchainMetadata ? { lightchainCompat: lightchainMetadata } : {}),
        } as any,
        optimized_prompt: productDescription ?? null,
        status: 'processing',
        error_message: null,
      })
      .select('id')
      .single();

    if (jobError || !job?.id) {
      throw jobError ?? new Error('Failed to create generation job');
    }
    jobId = job.id;
    persistenceStatus = 'processing';
    await persistLightchainTaskSteps({
      supabaseClient: supabaseService,
      lightchainMetadata,
      jobId,
      brandId,
      userId: user.id,
      status: 'processing',
      sourceMetadata: requestSourceMetadata,
      requestId,
    });

    const imageModel = typeof body.generationModel === 'string' && body.generationModel.trim()
      ? body.generationModel.trim()
      : null;

    // 画像がある場合は分析
    let originalImageBase64: string | null = null;
    let originalMimeType = 'image/jpeg';
    let modelImageBase64: string | null = null;
    let modelMimeType: string | null = null;
    let finalDescription = productDescription;

    if (imageUrl) {
      const imageData = await fetchImageAsBase64(imageUrl);
      if (imageData) {
        originalImageBase64 = imageData.base64;
        originalMimeType = imageData.mimeType;
      } else {
        throw new Error('衣服画像を読み込めませんでした。画像を入れ直してからもう一度試してください。');
      }
    }
    if (modelReferenceImageUrl) {
      const modelImageData = await fetchImageAsBase64(modelReferenceImageUrl);
      if (modelImageData) {
        modelImageBase64 = modelImageData.base64;
        modelMimeType = modelImageData.mimeType;
      } else {
        throw new Error('モデル画像を読み込めませんでした。モデル画像を入れ直してからもう一度試してください。');
      }
    }

    if (!finalDescription) {
      finalDescription = 'Fashion product';
    }
    const finalSourceMetadata = buildSourceMetadata({
      sourceReadback,
      productDescription: finalDescription,
      bodyTypes,
      ageGroups,
      skinTone,
      hairStyle,
      modelCandidateLabel,
    });

    const selectedBodyTypes = BODY_TYPES.filter(b => bodyTypes.includes(b.id));
    const selectedAgeGroups = AGE_GROUPS.filter(a => ageGroups.includes(a.id));
    const results = [];

    // Generate matrix
    for (const bodyType of selectedBodyTypes) {
      for (const ageGroup of selectedAgeGroups) {
        let generatedImage: OpenAiImageResult | null = null;

        // 元画像がある場合は参照生成
        if (originalImageBase64) {
          generatedImage = await generateWithReference(
            originalImageBase64,
            originalMimeType,
            modelImageBase64,
            modelMimeType,
            finalDescription,
            bodyType,
            ageGroup,
            gender,
            imageModel
          );
        }

        // 参照生成が失敗した場合はテキストのみで生成
        if (!generatedImage) {
          if (imageUrl || modelReferenceImageUrl) {
            throw new Error('参照画像を使った着用生成に失敗しました。参照なしの別画像は作らず停止しました。');
          }
          generatedImage = await generateFromText(
            finalDescription,
            bodyType,
            ageGroup,
            gender,
            imageModel
          );
        }

        if (generatedImage) {
          const imageAsset = openAiImageArtifact(generatedImage);
          const imageBase64 = imageAsset.base64;
          const imageDataUrl = imageAsset.dataUrl;
          const fileName = `${user.id}/${brandId}/${jobId}_matrix_${bodyType.id}_${ageGroup.id}_${Date.now()}.${imageAsset.extension}`;
          const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));

          failedStage = 'storage';
          const { error: uploadError } = await supabaseService.storage
            .from('generated-images')
            .upload(fileName, imgBuffer, { contentType: imageAsset.contentType, upsert: false });

          if (uploadError) {
            throw uploadError;
          }
          uploadedStoragePaths.push(fileName);
          console.log('✅ Image uploaded to storage:', fileName);

          failedStage = 'image';
          const { data: image, error: imageInsertError } = await supabaseService
            .from('generated_images')
            .insert({
              job_id: jobId,
              brand_id: brandId,
              user_id: user.id,
              storage_path: fileName,
              image_url: null,
              prompt: finalDescription,
              feature_type: 'model-matrix',
              model_used: generatedImage.model,
              generation_params: { 
                bodyType: bodyType.id, 
                ageGroup: ageGroup.id,
                gender,
                productDescription: finalDescription,
                provider: 'openai',
                providerTaskId: generatedImage.taskId,
              },
              metadata: {
                remoteSaveStatus: 'succeeded',
                source: 'model-matrix',
                provider: 'openai',
                providerTaskId: generatedImage.taskId,
                requestId,
                ...(finalSourceMetadata ?? {}),
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
              supabaseClient: supabaseService,
              lightchainMetadata: completedLightchainMetadata,
              jobId,
              imageId: image.id,
              brandId,
              userId: user.id,
              status: 'completed',
              sourceMetadata: finalSourceMetadata,
              requestId,
              artifactUri: fileName,
            });
          insertedImageIds.push(image.id);
          console.log('✅ Image record saved to database');

          results.push({
            bodyType: bodyType.id,
            bodyTypeName: bodyType.name,
            ageGroup: ageGroup.id,
            ageGroupName: ageGroup.name,
            imageUrl: imageDataUrl,
            storagePath: fileName,
            imageId: image.id,
            persistenceStatus: 'completed',
          });
          
          console.log(`✅ ${bodyType.name} x ${ageGroup.name} generated`);
        }
      }
    }

    if (results.length === 0) {
      failedStage = 'generation';
      throw new Error('画像の生成に失敗しました。しばらく待ってからもう一度お試しください。');
    }

    failedStage = 'job_complete';
    const { error: completeJobError } = await supabaseService
      .from('generation_jobs')
      .update({
        status: 'completed',
        error_message: null,
        optimized_prompt: finalDescription,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    if (completeJobError) {
      throw completeJobError;
    }
    persistenceStatus = 'completed';
    failedStage = null;

    console.log(`🎉 Successfully generated ${results.length} images`);
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
        jobId,
        productDescription: finalDescription,
        matrix: results,
        persistenceStatus,
        failedStage: null,
        cleanupStatus,
        dimensions: {
          bodyTypes: selectedBodyTypes.map(b => ({ id: b.id, name: b.name })),
          ageGroups: selectedAgeGroups.map(a => ({ id: a.id, name: a.name })),
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

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

    console.error('❌ Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: clientError(error),
        jobId,
        matrix: [],
        persistenceStatus,
        failedStage,
        cleanupStatus,
        cleanupErrors,
      }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
