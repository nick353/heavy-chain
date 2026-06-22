import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { clientError, createServiceClient, requireBrandRole, type Database } from '../_shared/auth.ts';
import { completeBrandUsage, reserveBrandUsage, type UsageReservation } from '../_shared/usage.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';
import { geminiAnalysisModel, geminiGenerateContentUrl, geminiImageModel } from '../_shared/geminiModels.ts';
import { persistLightchainTaskSteps, sanitizeLightchainCompat, withLightchainTaskStepStatus, type LightchainCompatMetadata } from '../_shared/lightchainCompat.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DESIGN_DIRECTIONS = [
  { id: 'minimal', name: 'ミニマル', prompt: 'minimalist, clean lines, simple composition, white space, soft lighting' },
  { id: 'luxury', name: 'ラグジュアリー', prompt: 'luxury, elegant, sophisticated, high-end, premium quality, gold accents' },
  { id: 'street', name: 'ストリート', prompt: 'street style, urban, edgy, dynamic, youth culture, graffiti background' },
  { id: 'vintage', name: 'ヴィンテージ', prompt: 'vintage aesthetic, retro, film grain, nostalgic, warm tones, old paper texture' },
  { id: 'modern', name: 'モダン', prompt: 'modern contemporary, bold colors, geometric shapes, cutting edge design' },
  { id: 'natural', name: 'ナチュラル', prompt: 'natural, organic, earthy tones, sustainable, eco-friendly, plant elements' },
  { id: 'pop', name: 'ポップ', prompt: 'pop art, colorful, playful, vibrant, eye-catching, comic style' },
  { id: 'cyber', name: 'サイバー', prompt: 'cyberpunk, futuristic, neon lights, tech-inspired, digital glitch effects' },
];

const SOURCE_CONFIG = {
  studio: { label: 'Fashion Studio', resumePath: '/studio', versions: ['studio-selection-local-v1'] },
  models: { label: 'モデルライブラリ', resumePath: '/models', versions: ['model-library-local-v1'] },
  patterns: { label: '柄・グラフィック', resumePath: '/patterns', versions: ['pattern-preview-local-v1'] },
  video: { label: 'Video Workstation', resumePath: '/video', versions: ['video-storyboard-local-v1'] },
  lab: { label: 'Lab', resumePath: '/lab', versions: ['lab-evaluation-local-v1'] },
} as const;

type SourceWorkspace = keyof typeof SOURCE_CONFIG;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const readString = (record: Record<string, unknown>, key: string) => {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

const sanitizePatternContext = (value: unknown) => {
  if (!isRecord(value)) return null;
  const selectedPatternPreview = isRecord(value.selectedPatternPreview) ? value.selectedPatternPreview : null;
  if (!selectedPatternPreview) return null;

  const preview = {
    id: readString(selectedPatternPreview, 'id'),
    label: readString(selectedPatternPreview, 'label'),
    mode: readString(selectedPatternPreview, 'mode'),
    repeatSignature: readString(selectedPatternPreview, 'repeatSignature'),
    vectorSignature: readString(selectedPatternPreview, 'vectorSignature'),
    paletteSignature: readString(selectedPatternPreview, 'paletteSignature'),
  };
  const motifPrompt = readString(value, 'motifPrompt');
  const repeatStyle = readString(value, 'repeatStyle');
  const garmentTarget = readString(value, 'garmentTarget');
  const paletteNotes = readString(value, 'paletteNotes');
  const vectorIntent = readString(value, 'vectorIntent');

  if (
    !preview.id ||
    !preview.label ||
    !preview.mode ||
    !preview.repeatSignature ||
    !preview.vectorSignature ||
    !preview.paletteSignature ||
    !motifPrompt ||
    !repeatStyle ||
    !garmentTarget ||
    !paletteNotes ||
    !vectorIntent
  ) {
    return null;
  }

  return {
    selectedPatternPreview: preview as Record<string, string>,
    motifPrompt,
    repeatStyle,
    garmentTarget,
    paletteNotes,
    vectorIntent,
    referenceAssets: typeof value.referenceAssets === 'string' ? value.referenceAssets : '',
  };
};

const buildGenerationIntentHref = ({
  prompt,
  sourceWorkspace,
  workflowVersion,
  sourceLabel,
  sourceResumePath,
  sourceMode,
  patternContext,
}: {
  prompt: string;
  sourceWorkspace: SourceWorkspace;
  workflowVersion: string;
  sourceLabel: string;
  sourceResumePath: string;
  sourceMode: 'local-workflow-intake';
  patternContext: ReturnType<typeof sanitizePatternContext>;
}) => {
  const params = new URLSearchParams({
    feature: 'design-gacha',
    prompt,
    sourceWorkspace,
    workflowVersion,
    sourceLabel,
    sourceResumePath,
    sourceMode,
  });
  if (patternContext) {
    params.set('patternPreviewId', patternContext.selectedPatternPreview.id);
    params.set('patternPreviewLabel', patternContext.selectedPatternPreview.label);
    params.set('patternPreviewMode', patternContext.selectedPatternPreview.mode);
    params.set('repeatSignature', patternContext.selectedPatternPreview.repeatSignature);
    params.set('vectorSignature', patternContext.selectedPatternPreview.vectorSignature);
    params.set('paletteSignature', patternContext.selectedPatternPreview.paletteSignature);
    params.set('motifPrompt', patternContext.motifPrompt);
    params.set('repeatStyle', patternContext.repeatStyle);
    params.set('garmentTarget', patternContext.garmentTarget);
    params.set('paletteNotes', patternContext.paletteNotes);
    params.set('vectorIntent', patternContext.vectorIntent);
    params.set('referenceAssets', patternContext.referenceAssets);
  }
  return `/generate?${params.toString()}`;
};

const buildSourceMetadata = (sourceReadback: unknown, patternContext: unknown, prompt: string) => {
  const source = sanitizeSourceReadback(sourceReadback);
  if (!source) return null;
  const sanitizedPatternContext = source.sourceWorkspace === 'patterns'
    ? sanitizePatternContext(patternContext)
    : null;

  return {
    ...source,
    ...(sanitizedPatternContext ?? {}),
    generationIntent: {
      feature: 'design-gacha',
      prompt,
      href: buildGenerationIntentHref({
        prompt,
        ...source,
        patternContext: sanitizedPatternContext,
      }),
      label: 'デザインガチャで生成',
      ...source,
      ...(sanitizedPatternContext ?? {}),
    },
  };
};

// 画像をBase64に変換
async function fetchImageAsBase64(imageUrl: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    if (imageUrl.startsWith('data:')) {
      const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        return { base64: matches[2], mimeType: matches[1] };
      }
    }
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    return { base64, mimeType: contentType };
  } catch (e) {
    console.log('⚠️ Failed to fetch image:', clientError(e));
    return null;
  }
}

// 画像を分析して商品説明を取得
async function analyzeImageWithGemini(base64: string, mimeType: string, apiKey: string, analysisModel: string): Promise<string> {
  console.log('🔍 Analyzing image with Gemini...');
  
  const response = await fetch(
    geminiGenerateContentUrl(analysisModel, apiKey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: `Describe this product/clothing in detail for fashion photography. Include:
1. Type of item (garment type, accessory, etc.)
2. Colors and color distribution
3. Material/fabric texture
4. Design features and details
5. Style category

Output ONLY a concise English description.`
            },
            { inlineData: { mimeType, data: base64 } }
          ]
        }],
        generationConfig: { temperature: 0.2 }
      }),
    }
  );

  const data = await response.json();
  const description = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (description) {
    console.log('✅ Image analyzed:', description.substring(0, 100) + '...');
    return description;
  }
  
  return 'Fashion product';
}

// 参照画像を使って生成（商品固定）
async function generateWithReference(
  originalBase64: string,
  originalMimeType: string,
  description: string,
  direction: typeof DESIGN_DIRECTIONS[0],
  apiKey: string,
  imageModel: string
): Promise<string | null> {
  console.log(`🎨 Generating ${direction.name} with product reference...`);

  const prompt = `Create a fashion product photo with ${direction.prompt} style.

PRODUCT: ${description}

CRITICAL - KEEP THE PRODUCT IDENTICAL:
1. The product must be EXACTLY the same as the reference
2. Same colors, design, texture, all details unchanged
3. Only change the STYLE/PRESENTATION, not the product itself
4. Apply ${direction.name} aesthetic to lighting, background, composition

Style: ${direction.prompt}, professional fashion photography`;

  const generateResponse = await fetch(
    geminiGenerateContentUrl(imageModel, apiKey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: originalMimeType, data: originalBase64 } }
          ]
        }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
          temperature: 0.7
        }
      }),
    }
  );

  const generateData = await generateResponse.json();

  if (generateResponse.ok && generateData.candidates?.[0]?.content?.parts) {
    for (const part of generateData.candidates[0].content.parts) {
      if (part.inlineData?.data) {
        console.log(`✅ ${direction.name} generated with reference`);
        return part.inlineData.data;
      }
    }
  }

  return null;
}

// テキストのみで生成
async function generateFromText(
  brief: string,
  direction: typeof DESIGN_DIRECTIONS[0],
  apiKey: string,
  imageModel: string
): Promise<string | null> {
  const fullPrompt = `${brief}, ${direction.prompt}, professional fashion photography, high quality, studio lighting`;

  const generateResponse = await fetch(
    geminiGenerateContentUrl(imageModel, apiKey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { 
          responseModalities: ["IMAGE", "TEXT"],
          temperature: 0.8
        }
      }),
    }
  );

  const generateData = await generateResponse.json();

  if (generateResponse.ok && generateData.candidates?.[0]?.content?.parts) {
    for (const part of generateData.candidates[0].content.parts) {
      if (part.inlineData?.data) {
        return part.inlineData.data;
      }
    }
  }

  return null;
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
  const functionName = 'design-gacha';
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
    const { 
      brief, 
      imageUrl,
      referenceImage,
      brandId, 
      directions = 4,
      fixedElements = [],
      randomizedElements = [],
      sourceReadback,
      patternContext,
      lightchainCompat,
    } = body;

    console.log('📥 Request:', { brief: !!brief, imageUrl: !!imageUrl, referenceImage: !!referenceImage, brandId, fixedElements });

    // imageUrlまたはreferenceImageを使用
    const productImageUrl = imageUrl || referenceImage;
    let productDescription = typeof brief === 'string' ? brief : '';

    if (!brief && !productImageUrl) {
      throw new Error('ブリーフまたは商品画像を入力してください');
    }

    if (!brandId) {
      throw new Error('Brand ID is required');
    }

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

    const requestSourceMetadata = buildSourceMetadata(sourceReadback, patternContext, productDescription);
    const lightchainMetadata = sanitizeLightchainCompat(lightchainCompat);
    const completedLightchainMetadata = withLightchainTaskStepStatus(lightchainMetadata, 'completed');
    observedSourceMetadata = requestSourceMetadata;
    observedLightchainMetadata = lightchainMetadata;
    failedStage = 'job';
    const { data: job, error: jobError } = await supabaseService
      .from('generation_jobs')
      .insert({
        brand_id: brandId,
        user_id: user.id,
        feature_type: 'design-gacha',
          input_params: {
            brief: brief ?? null,
            imageUrl: productImageUrl ? '[provided]' : null,
            directions,
            fixedElements,
            randomizedElements,
            requestId,
            ...(requestSourceMetadata ?? {}),
            ...(lightchainMetadata ? { lightchainCompat: lightchainMetadata } : {}),
          } as any,
        optimized_prompt: productDescription || brief || null,
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

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      failedStage = 'configuration';
      throw new Error('Gemini API key not configured');
    }
    const analysisModel = geminiAnalysisModel();
    const imageModel = geminiImageModel();

    // 画像がある場合は分析
    let originalImageBase64: string | null = null;
    let originalMimeType = 'image/jpeg';

    if (productImageUrl) {
      const imageData = await fetchImageAsBase64(productImageUrl);
      if (imageData) {
        originalImageBase64 = imageData.base64;
        originalMimeType = imageData.mimeType;
        
        // briefがない場合は画像から生成
        if (!productDescription) {
          productDescription = await analyzeImageWithGemini(originalImageBase64, originalMimeType, GEMINI_API_KEY, analysisModel);
        }
      }
    }
    const finalSourceMetadata = buildSourceMetadata(sourceReadback, patternContext, productDescription);

    // 商品固定かどうか（fixedElementsに'product'が含まれるか、画像がある場合）
    const isProductFixed = fixedElements.includes('product') && originalImageBase64;

    // Select random directions
    const selectedDirections = [...DESIGN_DIRECTIONS]
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(directions, DESIGN_DIRECTIONS.length));

    const results = [];

    for (const direction of selectedDirections) {
      let imageBase64: string | null = null;

      // 商品固定の場合は参照画像を使って生成
      if (isProductFixed && originalImageBase64) {
        imageBase64 = await generateWithReference(
          originalImageBase64,
          originalMimeType,
          productDescription,
          direction,
          GEMINI_API_KEY,
          imageModel
        );
      }

      // 参照生成が失敗した場合、または商品固定でない場合はテキストのみで生成
      if (!imageBase64) {
        imageBase64 = await generateFromText(
          productDescription,
          direction,
          GEMINI_API_KEY,
          imageModel
        );
      }

      if (imageBase64) {
        const imageDataUrl = `data:image/png;base64,${imageBase64}`;
        const fileName = `${user.id}/${brandId}/${jobId}_gacha_${direction.id}_${Date.now()}.png`;
        const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));

        failedStage = 'storage';
        const { error: uploadError } = await supabaseService.storage
          .from('generated-images')
          .upload(fileName, imgBuffer, { contentType: 'image/png', upsert: false });

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
            prompt: productDescription,
            feature_type: 'design-gacha',
            model_used: imageModel,
            generation_params: { direction: direction.id, brief: productDescription, isProductFixed },
            metadata: {
              remoteSaveStatus: 'succeeded',
              source: 'design-gacha',
              requestId,
              ...(finalSourceMetadata ?? {}),
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
          direction: direction.id,
          directionName: direction.name,
          imageUrl: imageDataUrl,
          storagePath: fileName,
          imageId: image.id,
          prompt: productDescription,
          persistenceStatus: 'completed',
        });
        
        console.log(`✅ ${direction.name} generated`);
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
        optimized_prompt: productDescription,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    if (completeJobError) {
      throw completeJobError;
    }
    persistenceStatus = 'completed';
    failedStage = null;

    console.log(`🎉 Successfully generated ${results.length} variations`);
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
        brief: productDescription,
        variations: results,
        imageId: results[0]?.imageId ?? null,
        storagePath: results[0]?.storagePath ?? null,
        persistenceStatus,
        cleanupStatus,
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
        variations: [],
        imageId: null,
        storagePath: null,
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
