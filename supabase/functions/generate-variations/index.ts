import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { clientError, createServiceClient, requireBrandRole, type Database } from '../_shared/auth.ts';
import { completeBrandUsage, reserveBrandUsage, type UsageReservation } from '../_shared/usage.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';
import { generateRunwayImage, runwayImageArtifact, runwayProviderName, runwayReferenceImage, type RunwayImageResult } from '../_shared/runway.ts';
import { requireRunwayMcpConnectionApproval } from '../_shared/runwayApproval.ts';
import { persistLightchainTaskSteps, sanitizeLightchainCompat, withLightchainTaskStepStatus, type LightchainCompatMetadata } from '../_shared/lightchainCompat.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

// 参照画像を使ってバリエーションを生成
async function generateVariationWithReference(
  originalBase64: string,
  originalMimeType: string,
  description: string,
  variationPrompt: string,
  _apiKey?: string,
  _imageModel?: string
): Promise<RunwayImageResult | null> {
  console.log('🎨 Generating variation with reference...');

  const prompt = `Generate a fashion photo variation.

PRODUCT: ${description}

CRITICAL - KEEP THE PRODUCT IDENTICAL:
1. The product/clothing must be EXACTLY the same as the reference
2. Same colors, same design, same fabric texture
3. Same all details (pockets, zippers, logos, stitching)
4. Only change: ${variationPrompt}

Style: Professional fashion photography, high quality`;

  return await generateRunwayImage({
    prompt,
    referenceImages: [runwayReferenceImage(originalBase64, originalMimeType, 'product')],
  });
}

// シーン別生成
async function generateSceneWithReference(
  originalBase64: string,
  originalMimeType: string,
  description: string,
  scenePrompt: string,
  _apiKey?: string,
  _imageModel?: string
): Promise<RunwayImageResult | null> {
  console.log('🎨 Generating scene variation with reference...');

  const prompt = `Generate a fashion coordinate photo.

PRODUCT/CLOTHING: ${description}

SCENE: ${scenePrompt}

CRITICAL - KEEP THE PRODUCT IDENTICAL:
1. The product/clothing must be EXACTLY the same as the reference
2. Same colors, same design, same fabric texture, same all details
3. Place the SAME product in the new scene/setting
4. A model may be wearing the clothing in the scene

Style: Professional lifestyle fashion photography, natural lighting`;

  return await generateRunwayImage({
    prompt,
    referenceImages: [runwayReferenceImage(originalBase64, originalMimeType, 'product')],
  });
}

serve(async (req) => {
  let usageReservation: UsageReservation | null = null;
  let observedBrandId: string | null = null;
  let observedUserId: string | null = null;
  let observedJobId: string | null = null;
  let observedLightchainMetadata: LightchainCompatMetadata | null = null;
  let telemetryClient: any = null;
  const functionName = 'generate-variations';
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
      imageUrl, 
      brandId, 
      prompt, 
      count = 4,
      scenes, // シーン別コーディネート用
      lightchainCompat,
    } = body;
    const hasScenes = Array.isArray(scenes) && scenes.length > 0;
    const requestedFeatureType = body.featureType;
    const featureType =
      requestedFeatureType === 'scene-coordinate' || requestedFeatureType === 'variations'
        ? requestedFeatureType
        : hasScenes
          ? 'scene-coordinate'
          : 'variations';

    console.log('📥 Request:', { imageUrl: !!imageUrl, brandId, count, hasScenes, featureType });

    if (!imageUrl) {
      throw new Error('画像をアップロードしてください');
    }

    if (!brandId) {
      throw new Error('Brand ID is required');
    }

    await requireBrandRole(supabaseClient, brandId, user.id, 'editor');
    await requireRunwayMcpConnectionApproval(supabaseService, brandId);
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
        feature_type: featureType,
        input_params: {
          imageUrl: '[provided]',
          prompt: prompt ?? null,
          count,
          scenes: hasScenes ? scenes : null,
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

    const imageModel = 'runway';

    // Fetch and analyze the image
    console.log('🖼️ Fetching original image...');
    const imageData = await fetchImageAsBase64(imageUrl);
    if (!imageData) {
      throw new Error('画像の取得に失敗しました');
    }
    const { base64: imageBase64, mimeType } = imageData;
    const description = 'Fashion product';
    console.log('📝 Description:', description.substring(0, 100) + '...');

    const results = [];

    // シーン別コーディネートの場合
    if (hasScenes) {
      for (let i = 0; i < scenes.length; i++) {
        const scenePrompt = scenes[i];
        console.log(`🎬 Generating scene ${i + 1}: ${scenePrompt}...`);

        const generatedImage = await generateSceneWithReference(
          imageBase64,
          mimeType,
          description,
          scenePrompt,
          imageModel
        );

        if (generatedImage) {
          const imageAsset = runwayImageArtifact(generatedImage);
          const genImageBase64 = imageAsset.base64;
          const imageDataUrl = imageAsset.dataUrl;
          const fileName = `${user.id}/${brandId}/${Date.now()}_scene${i + 1}.${imageAsset.extension}`;
          let storageUrl = '';

          try {
            const imgBuffer = Uint8Array.from(atob(genImageBase64), c => c.charCodeAt(0));
            const { error: uploadError } = await supabaseService.storage
              .from('generated-images')
              .upload(fileName, imgBuffer, { contentType: imageAsset.contentType });
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
              prompt: scenePrompt,
              model_used: imageModel,
              feature_type: featureType,
              generation_params: { featureType, scene: scenePrompt, originalDescription: description },
              metadata: {
                remoteSaveStatus: 'succeeded',
                source: 'generate-variations',
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
          } catch (storageError) {
            await supabaseService.storage.from('generated-images').remove([fileName]);
            console.log('⚠️ Storage persistence error:', clientError(storageError));
            throw new Error('Generated image could not be saved');
          }

          results.push({
            index: i + 1,
            scene: scenePrompt,
            imageUrl: storageUrl || imageDataUrl,
            storagePath: fileName,
          });
          
          console.log(`✅ Scene ${i + 1} generated`);
        }
      }
    } else {
      // 通常のバリエーション生成
      const variationPrompts = [
        'slightly different angle',
        'different lighting setup, dramatic shadows',
        'adjusted composition, closer crop',
        'alternative styling, different mood',
      ].slice(0, count);

      for (let i = 0; i < variationPrompts.length; i++) {
        const variationPrompt = `${variationPrompts[i]}${prompt ? `, ${prompt}` : ''}`;
        console.log(`🎨 Generating variation ${i + 1}...`);

        const generatedImage = await generateVariationWithReference(
          imageBase64,
          mimeType,
          description,
          variationPrompt,
          imageModel
        );

        if (generatedImage) {
          const imageAsset = runwayImageArtifact(generatedImage);
          const genImageBase64 = imageAsset.base64;
          const imageDataUrl = imageAsset.dataUrl;
          const fileName = `${user.id}/${brandId}/${Date.now()}_var${i + 1}.${imageAsset.extension}`;
          let storageUrl = '';

          try {
            const imgBuffer = Uint8Array.from(atob(genImageBase64), c => c.charCodeAt(0));
            const { error: uploadError } = await supabaseService.storage
              .from('generated-images')
              .upload(fileName, imgBuffer, { contentType: imageAsset.contentType });
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
              prompt: variationPrompt,
              model_used: imageModel,
              feature_type: featureType,
              generation_params: { featureType, variation: i + 1, originalDescription: description },
              metadata: {
                remoteSaveStatus: 'succeeded',
                source: 'generate-variations',
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
          } catch (storageError) {
            await supabaseService.storage.from('generated-images').remove([fileName]);
            console.log('⚠️ Storage persistence error:', clientError(storageError));
            throw new Error('Generated image could not be saved');
          }

          results.push({
            index: i + 1,
            imageUrl: storageUrl || imageDataUrl,
            storagePath: fileName,
          });
          
          console.log(`✅ Variation ${i + 1} generated`);
        }
      }
    }

    if (results.length === 0) {
      throw new Error('画像の生成に失敗しました。しばらく待ってからもう一度お試しください。');
    }
    if (observedJobId) {
      const { error: completeJobError } = await supabaseClient
        .from('generation_jobs')
        .update({ status: 'completed', error_message: null, completed_at: new Date().toISOString() })
        .eq('id', observedJobId);
      if (completeJobError) throw completeJobError;
    }

    try {
      await supabaseService.from('api_usage_logs').insert({
        user_id: user.id,
        brand_id: brandId,
        provider: runwayProviderName() as any,
        tokens_used: results.length * 500,
        cost_usd: 0,
      });
    } catch (e) {
      console.log('⚠️ Usage log warning:', clientError(e));
    }

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
        originalDescription: description,
        variations: results,
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

    console.error('❌ Error:', error);
    return new Response(
      JSON.stringify({ error: clientError(error) }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
