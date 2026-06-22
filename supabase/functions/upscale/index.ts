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

// 画像をBase64に変換
async function fetchImageAsBase64(imageUrl: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await response.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  return { base64, mimeType: contentType };
}

serve(async (req) => {
  let usageReservation: UsageReservation | null = null;
  let observedBrandId: string | null = null;
  let observedUserId: string | null = null;
  let observedJobId: string | null = null;
  let observedLightchainMetadata: LightchainCompatMetadata | null = null;
  let telemetryClient: any = null;
  const functionName = 'upscale';
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

    const { imageUrl, brandId, scale = 2, lightchainCompat } = await req.json();

    if (!imageUrl || !brandId) {
      throw new Error('Missing required parameters');
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

    const lightchainMetadata = sanitizeLightchainCompat(lightchainCompat);
    const completedLightchainMetadata = withLightchainTaskStepStatus(lightchainMetadata, 'completed');
    observedLightchainMetadata = lightchainMetadata;
    const { data: job, error: jobError } = await supabaseClient
      .from('generation_jobs')
      .insert({
        brand_id: brandId,
        user_id: user.id,
        feature_type: 'upscale',
        input_params: {
          imageUrl: '[provided]',
          scale,
          requestId,
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

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }
    const analysisModel = geminiAnalysisModel();
    const imageModel = geminiImageModel();

    // Fetch and analyze the original image
    console.log('🖼️ Fetching original image...');
    const { base64: originalBase64, mimeType } = await fetchImageAsBase64(imageUrl);

    // Analyze the image in extreme detail
    console.log('🔍 Analyzing image for high-resolution regeneration...');
    const analysisResponse = await fetch(
      geminiGenerateContentUrl(analysisModel, GEMINI_API_KEY),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: 'Describe this image in EXTREME detail for high-resolution regeneration. Include every visible element, colors, textures, lighting, shadows, background, composition. Be as detailed as possible. Output only English description.' },
              { inlineData: { mimeType, data: originalBase64 } }
            ]
          }],
          generationConfig: { 
            temperature: 0.2,
            maxOutputTokens: 1000
          }
        }),
      }
    );

    const analysisData = await analysisResponse.json();
    const description = analysisData.candidates?.[0]?.content?.parts?.[0]?.text || 'High quality image';

    console.log('📝 Detailed description obtained');

    // Generate high-resolution version
    console.log('🎨 Generating high-resolution image...');
    const prompt = [
      'Upscale and restore the exact same product shown in the reference image.',
      'Use the reference image as the source of truth and preserve the same product identity.',
      'Do not change the color, shape, collar, pockets, trim, logo, composition, camera angle, background placement, or visible construction details.',
      'Only improve resolution, sharpness, texture clarity, edge definition, and compression artifacts.',
      `Reference description: ${description}`,
      'Ultra high resolution, detailed restoration, sharp focus, pristine product image.'
    ].join(' ');

    const generateResponse = await fetch(
      geminiGenerateContentUrl(imageModel, GEMINI_API_KEY),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: originalBase64 } }
            ]
          }],
          generationConfig: { 
            responseModalities: ["IMAGE", "TEXT"],
            temperature: 0.1
          }
        }),
      }
    );

    const generateData = await generateResponse.json();

    if (!generateResponse.ok || !generateData.candidates?.[0]?.content?.parts) {
      throw new Error('高解像度化に失敗しました。しばらく待ってからもう一度お試しください。');
    }

    let imageBase64 = null;
    for (const part of generateData.candidates[0].content.parts) {
      if (part.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        break;
      }
    }

    if (!imageBase64) {
      throw new Error('画像生成に失敗しました。');
    }

    const imageDataUrl = `data:image/png;base64,${imageBase64}`;
    const fileName = `${user.id}/${brandId}/${Date.now()}_upscaled_${scale}x.png`;
    let storageUrl = '';

    try {
      const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
      const { error: uploadError } = await supabaseService.storage
        .from('generated-images')
        .upload(fileName, imgBuffer, { contentType: 'image/png' });
      if (uploadError) throw uploadError;

      const { data: urlData } = await supabaseService.storage
        .from('generated-images')
        .createSignedUrl(fileName, 60 * 60 * 24);
      storageUrl = urlData?.signedUrl || '';

      const { data: image, error: imageInsertError } = await supabaseClient.from('generated_images').insert({
        job_id: observedJobId,
        brand_id: brandId,
        user_id: user.id,
        storage_path: fileName,
        image_url: null,
        prompt,
        feature_type: 'upscale',
        model_used: imageModel,
        generation_params: { scale },
        metadata: {
          remoteSaveStatus: 'succeeded',
          source: 'upscale',
          requestId,
          ...(completedLightchainMetadata ? { lightchainCompat: completedLightchainMetadata } : {}),
        } as any,
      }).select('id').single();
      if (imageInsertError || !image?.id) throw imageInsertError ?? new Error('Generated image insert did not return an id');
      await persistLightchainTaskSteps({
        supabaseClient,
        lightchainMetadata: completedLightchainMetadata,
        jobId: observedJobId,
        imageId: image.id,
        brandId,
        userId: user.id,
        status: 'completed',
        requestId,
        artifactUri: fileName,
      });
      const { error: completeJobError } = await supabaseClient
        .from('generation_jobs')
        .update({ status: 'completed', error_message: null, completed_at: new Date().toISOString() })
        .eq('id', observedJobId);
      if (completeJobError) throw completeJobError;
    } catch (storageError) {
      await supabaseService.storage.from('generated-images').remove([fileName]);
      console.log('⚠️ Storage persistence error:', clientError(storageError));
      throw new Error('Generated image could not be saved');
    }

    try {
      await supabaseService.from('api_usage_logs').insert({
        user_id: user.id,
        brand_id: brandId,
        provider: 'gemini',
        tokens_used: 500,
        cost_usd: 0,
      });
    } catch (e) {
      console.log('⚠️ Usage log warning:', clientError(e));
    }

    console.log('✅ Upscaling complete');
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
        resultUrl: storageUrl || imageDataUrl,
        imageUrl: storageUrl || imageDataUrl,
        storagePath: fileName,
        scale,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    if (telemetryClient) {
      if (observedJobId) {
        try {
          await telemetryClient
            .from('generation_jobs')
            .update({ status: 'failed', error_message: sanitizeError(error), completed_at: new Date().toISOString() })
            .eq('id', observedJobId);
          await persistLightchainTaskSteps({
            supabaseClient: telemetryClient,
            lightchainMetadata: observedLightchainMetadata,
            jobId: observedJobId,
            brandId: observedBrandId ?? '',
            userId: observedUserId ?? '',
            status: 'retryable',
            requestId,
            errorMessage: sanitizeError(error),
          });
        } catch (cleanupError) {
          console.log('⚠️ Job failure persistence warning:', clientError(cleanupError));
        }
      }
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

    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: clientError(error) }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
