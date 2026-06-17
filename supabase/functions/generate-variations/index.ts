import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { clientError, createServiceClient, requireBrandRole, type Database } from '../_shared/auth.ts';
import { completeBrandUsage, reserveBrandUsage, type UsageReservation } from '../_shared/usage.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';
import { geminiAnalysisModel, geminiGenerateContentUrl, geminiImageModel } from '../_shared/geminiModels.ts';

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

// 画像を分析して詳細な説明を取得
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
              text: `Describe this fashion product/clothing in EXTREME detail for exact recreation. Include:
1. Exact garment type
2. All colors and their exact distribution
3. Material/fabric texture (e.g., fleece, cotton, denim)
4. EVERY design feature (pockets, zippers, collars, logos, stitching patterns, paneling)
5. Proportions and silhouette

Output ONLY a detailed English description. Be very specific about visual details.`
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

// 参照画像を使ってバリエーションを生成
async function generateVariationWithReference(
  originalBase64: string,
  originalMimeType: string,
  description: string,
  variationPrompt: string,
  apiKey: string,
  imageModel: string
): Promise<string | null> {
  console.log('🎨 Generating variation with reference...');

  const prompt = `Generate a fashion photo variation.

PRODUCT: ${description}

CRITICAL - KEEP THE PRODUCT IDENTICAL:
1. The product/clothing must be EXACTLY the same as the reference
2. Same colors, same design, same fabric texture
3. Same all details (pockets, zippers, logos, stitching)
4. Only change: ${variationPrompt}

Style: Professional fashion photography, high quality`;

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
        return part.inlineData.data;
      }
    }
  }

  return null;
}

// シーン別生成
async function generateSceneWithReference(
  originalBase64: string,
  originalMimeType: string,
  description: string,
  scenePrompt: string,
  apiKey: string,
  imageModel: string
): Promise<string | null> {
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
      scenes // シーン別コーディネート用
    } = body;

    console.log('📥 Request:', { imageUrl: !!imageUrl, brandId, count, hasScenes: !!scenes });

    if (!imageUrl) {
      throw new Error('画像をアップロードしてください');
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


    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }
    const analysisModel = geminiAnalysisModel();
    const imageModel = geminiImageModel();

    // Fetch and analyze the image
    console.log('🖼️ Fetching original image...');
    const imageData = await fetchImageAsBase64(imageUrl);
    if (!imageData) {
      throw new Error('画像の取得に失敗しました');
    }
    const { base64: imageBase64, mimeType } = imageData;

    // Analyze the image with Gemini
    const description = await analyzeImageWithGemini(imageBase64, mimeType, GEMINI_API_KEY, analysisModel);
    console.log('📝 Description:', description.substring(0, 100) + '...');

    const results = [];

    // シーン別コーディネートの場合
    if (scenes && Array.isArray(scenes) && scenes.length > 0) {
      for (let i = 0; i < scenes.length; i++) {
        const scenePrompt = scenes[i];
        console.log(`🎬 Generating scene ${i + 1}: ${scenePrompt}...`);

        const genImageBase64 = await generateSceneWithReference(
          imageBase64,
          mimeType,
          description,
          scenePrompt,
          GEMINI_API_KEY,
          imageModel
        );

        if (genImageBase64) {
          const imageDataUrl = `data:image/png;base64,${genImageBase64}`;
          const fileName = `${user.id}/${brandId}/${Date.now()}_scene${i + 1}.png`;
          let storageUrl = '';

          try {
            const imgBuffer = Uint8Array.from(atob(genImageBase64), c => c.charCodeAt(0));
            const { error: uploadError } = await supabaseService.storage
              .from('generated-images')
              .upload(fileName, imgBuffer, { contentType: 'image/png' });
            if (uploadError) throw uploadError;

            const { data: urlData } = await supabaseService.storage
              .from('generated-images')
              .createSignedUrl(fileName, 60 * 60 * 24);
            storageUrl = urlData?.signedUrl || '';

            const { error: imageInsertError } = await supabaseClient.from('generated_images').insert({
              brand_id: brandId,
              user_id: user.id,
              storage_path: fileName,
              image_url: null,
              prompt: scenePrompt,
              model_used: imageModel,
              generation_params: { scene: scenePrompt, originalDescription: description },
            });
            if (imageInsertError) throw imageInsertError;
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

        const genImageBase64 = await generateVariationWithReference(
          imageBase64,
          mimeType,
          description,
          variationPrompt,
          GEMINI_API_KEY,
          imageModel
        );

        if (genImageBase64) {
          const imageDataUrl = `data:image/png;base64,${genImageBase64}`;
          const fileName = `${user.id}/${brandId}/${Date.now()}_var${i + 1}.png`;
          let storageUrl = '';

          try {
            const imgBuffer = Uint8Array.from(atob(genImageBase64), c => c.charCodeAt(0));
            const { error: uploadError } = await supabaseService.storage
              .from('generated-images')
              .upload(fileName, imgBuffer, { contentType: 'image/png' });
            if (uploadError) throw uploadError;

            const { data: urlData } = await supabaseService.storage
              .from('generated-images')
              .createSignedUrl(fileName, 60 * 60 * 24);
            storageUrl = urlData?.signedUrl || '';

            const { error: imageInsertError } = await supabaseClient.from('generated_images').insert({
              brand_id: brandId,
              user_id: user.id,
              storage_path: fileName,
              image_url: null,
              prompt: variationPrompt,
              model_used: imageModel,
              generation_params: { variation: i + 1, originalDescription: description },
            });
            if (imageInsertError) throw imageInsertError;
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
