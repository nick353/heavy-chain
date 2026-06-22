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
  const functionName = 'colorize';
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

    const { imageUrl, brandId, colors, count = 3, lightchainCompat } = await req.json();

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
        feature_type: 'colorize',
        input_params: {
          imageUrl: '[provided]',
          colors: Array.isArray(colors) ? colors : null,
          count,
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

    // Analyze the image
    console.log('🔍 Analyzing image...');
    const analysisResponse = await fetch(
      geminiGenerateContentUrl(analysisModel, GEMINI_API_KEY),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: 'Describe this fashion product in detail: item type, style, composition, lighting. Be specific. Output only English description.' },
              { inlineData: { mimeType, data: originalBase64 } }
            ]
          }],
          generationConfig: { temperature: 0.3 }
        }),
      }
    );

    const analysisData = await analysisResponse.json();
    const description = analysisData.candidates?.[0]?.content?.parts?.[0]?.text || 'Fashion product';

    // Generate color variations
    const colorPrompts = colors?.length > 0 
      ? colors 
      : ['red', 'blue', 'green', 'black', 'white'].slice(0, count);

    const results = [];

    for (const color of colorPrompts) {
      console.log(`🎨 Generating ${color} variation...`);

      const prompt = `${description}, but in ${color} color. Same style, composition, and quality. Professional product photography, clean background.`;

      const generateResponse = await fetch(
        geminiGenerateContentUrl(imageModel, GEMINI_API_KEY),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { 
              responseModalities: ["IMAGE", "TEXT"],
              temperature: 0.7
            }
          }),
        }
      );

      const generateData = await generateResponse.json();

      if (generateResponse.ok && generateData.candidates?.[0]?.content?.parts) {
        let imageBase64 = null;
        for (const part of generateData.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            imageBase64 = part.inlineData.data;
            break;
          }
        }

        if (imageBase64) {
          const imageDataUrl = `data:image/png;base64,${imageBase64}`;
          const fileName = `${user.id}/${brandId}/${Date.now()}_${color}.png`;
          let storageUrl = '';

          try {
            const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
            const { error: uploadError } = await supabaseService.storage
              .from('generated-images')
              .upload(fileName, imgBuffer, { contentType: 'image/png' });

            if (!uploadError) {
              const { data: urlData } = await supabaseService.storage.from('generated-images').createSignedUrl(fileName, 60 * 60 * 24);
              storageUrl = urlData?.signedUrl || '';
              console.log('✅ Image uploaded to storage:', storageUrl);
            } else {
              console.log('⚠️ Storage upload error:', uploadError.message);
            }
          } catch (storageError) {
            console.log('⚠️ Storage warning:', clientError(storageError));
          }

          // Always save record with image_url as fallback
          try {
            const { data: image, error: imageInsertError } = await supabaseClient.from('generated_images').insert({
              job_id: observedJobId,
              brand_id: brandId,
              user_id: user.id,
              storage_path: fileName,
              image_url: null,
              prompt: description,
              feature_type: 'colorize',
              model_used: imageModel,
              generation_params: { color, originalDescription: description },
              metadata: {
                remoteSaveStatus: 'succeeded',
                source: 'colorize',
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
            console.log('✅ Image record saved to database');
          } catch (dbError) {
            console.log('⚠️ Database warning:', clientError(dbError));
          }

          results.push({
            color,
            imageUrl: imageDataUrl,
            storagePath: fileName,
          });
          
          console.log(`✅ ${color} variation generated`);
        }
      }
    }

    if (results.length === 0) {
      throw new Error('カラーバリエーションの生成に失敗しました。しばらく待ってからもう一度お試しください。');
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
        provider: 'gemini',
        tokens_used: results.length * 500,
        cost_usd: 0,
      });
    } catch (e) {
      console.log('⚠️ Usage log warning:', clientError(e));
    }
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
