import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { clientError, createServiceClient, requireBrandRole, type Database } from '../_shared/auth.ts';
import { completeBrandUsage, reserveBrandUsage, type UsageReservation } from '../_shared/usage.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SHOT_TYPES = [
  { id: 'front', name: '正面', angle: 'front view, facing camera directly' },
  { id: 'side', name: '側面', angle: 'side view, profile, 90 degree angle' },
  { id: 'back', name: '背面', angle: 'back view, rear side' },
  { id: 'detail', name: 'ディテール', angle: 'close-up detail shot, macro view of texture' },
  { id: '45deg', name: '斜め45度', angle: '45 degree angle, three-quarter view' },
];

// 背景オプション（強化版）
const BACKGROUND_OPTIONS: Record<string, string> = {
  'white': 'PURE WHITE (#FFFFFF) seamless background, professional studio lighting, clean e-commerce style, no shadows on background',
  'transparent': 'completely transparent background, product only, no background visible, PNG transparency style',
  'studio': 'professional photography studio with soft gray gradient background, controlled studio lighting with soft shadows',
  'outdoor': 'outdoor natural setting, soft daylight, blurred nature background',
  'urban': 'urban street background, city architecture, lifestyle photography style',
  'nature': 'natural environment, garden or forest setting, organic background',
};

// 画像をBase64にエンコード
async function fetchImageAsBase64(imageUrl: string): Promise<{ base64: string; mimeType: string }> {
  console.log('📷 Fetching image from URL:', imageUrl);
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await response.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  
  console.log('✅ Image fetched successfully, size:', arrayBuffer.byteLength, 'bytes');
  return { base64, mimeType: contentType };
}

// Gemini 2.0で画像を分析
async function analyzeImageWithGemini(base64: string, mimeType: string, apiKey: string): Promise<string> {
  console.log('🔍 Analyzing image with Gemini 2.0 Flash...');
  
  const models = [
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro-latest'
  ];
  
  let lastError = null;
  
  for (const model of models) {
    console.log(`🔄 Trying model: ${model}`);
    
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                {
                  text: `Describe this garment/product in EXTREME detail for AI image regeneration. Be very specific about:

1. ITEM TYPE: Exact type (jacket, shirt, pants, etc.)
2. MATERIALS: Primary fabric (fleece, cotton, wool, sherpa, etc.) and any secondary materials
3. COLORS: All colors with exact positions (e.g., "cream/beige body, white fleece sleeves")
4. DESIGN FEATURES: 
   - Collar/neckline style
   - Closure type (zipper, buttons, snaps)
   - Pockets (type, position, material)
   - Cuffs and hem style
   - Any panels or color blocking
5. LOGOS/LABELS: Brand labels, their position and text if visible
6. TEXTURE: Describe the texture of each material section
7. STITCHING: Notable stitching patterns or details

Output ONLY the detailed English description, nothing else.`
                },
                {
                  inlineData: {
                    mimeType: mimeType,
                    data: base64
                  }
                }
              ]
            }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 800
            }
          }),
        }
      );
      
      const data = await response.json();
      
      if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
        const description = data.candidates[0].content.parts[0].text;
        console.log('✅ Image analysis successful with', model);
        console.log('📝 Description:', description);
        return description;
      }
      
      lastError = data;
      
    } catch (e) {
      lastError = e;
    }
  }
  
  throw new Error(`画像分析に失敗しました: ${JSON.stringify(lastError)}`);
}

// 元画像を参照して異なるアングルを生成
async function generateAngleWithReference(
  originalBase64: string, 
  originalMimeType: string, 
  shot: typeof SHOT_TYPES[0], 
  description: string,
  backgroundPrompt: string,
  apiKey: string
): Promise<string | null> {
  console.log(`🎨 Generating ${shot.name} with reference image...`);
  
  // 強化されたプロンプト: 質感の一貫性を重視
  const prompt = `Generate a product photo of THIS EXACT SAME garment/item from the reference image.

VIEWING ANGLE: ${shot.angle}

CRITICAL - EXACT MATCH REQUIRED:
1. SAME fabric texture and material (fleece, cotton, wool, etc.)
2. SAME exact colors and color distribution  
3. SAME all design elements (pockets, zippers, buttons, seams, labels, logos)
4. SAME proportions and silhouette
5. SAME stitching patterns and details

PRODUCT DETAILS: ${description}

BACKGROUND REQUIREMENT: ${backgroundPrompt}

STYLE: Professional e-commerce product photography, high resolution, sharp focus on product details.

DO NOT change any aspect of the garment itself - only change the camera angle.`;

  const generateResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: prompt
            },
            {
              inlineData: {
                mimeType: originalMimeType,
                data: originalBase64
              }
            }
          ]
        }],
        generationConfig: { 
          responseModalities: ["IMAGE", "TEXT"],
          temperature: 1.0
        }
      }),
    }
  );

  const generateData = await generateResponse.json();
  console.log(`📊 Generation response for ${shot.id}:`, generateResponse.status);

  if (generateResponse.ok && generateData.candidates?.[0]?.content?.parts) {
    for (const part of generateData.candidates[0].content.parts) {
      if (part.inlineData?.data) {
        console.log(`✅ ${shot.name} generated with reference`);
        return part.inlineData.data;
      }
    }
  }
  
  console.log(`⚠️ Reference-based generation failed for ${shot.id}:`, JSON.stringify(generateData).substring(0, 500));
  return null;
}

// テキストのみで生成（フォールバック）
async function generateAngleFromText(
  shot: typeof SHOT_TYPES[0], 
  description: string,
  backgroundPrompt: string,
  apiKey: string
): Promise<string | null> {
  console.log(`🎨 Generating ${shot.name} from text (fallback)...`);
  
  const prompt = `Generate a professional e-commerce product photo.

PRODUCT: ${description}
VIEWING ANGLE: ${shot.angle}
BACKGROUND: ${backgroundPrompt}

STYLE: High-resolution commercial product photography, sharp focus, professional lighting.`;

  const generateResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          responseModalities: ["IMAGE", "TEXT"],
          temperature: 0.4  // Lower for consistency
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
  const functionName = 'product-shots';
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
    console.log('📥 Received request body:', JSON.stringify(body, null, 2));
    
    let { productDescription, brandId, imageUrl, shots = ['front', 'side', 'back', 'detail'], background = 'white' } = body;

    if (!brandId) {
      throw new Error('ブランドIDが指定されていません');
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


    // 背景プロンプトを取得
    const backgroundPrompt = BACKGROUND_OPTIONS[background] || BACKGROUND_OPTIONS['white'];
    console.log('🎨 Background:', background, '->', backgroundPrompt);

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    // 元画像のBase64を取得（参照画像として使用）
    let originalImageBase64: string | null = null;
    let originalMimeType: string = 'image/jpeg';
    
    if (imageUrl) {
      console.log('🖼️ Fetching original image for reference...');
      try {
        const imageData = await fetchImageAsBase64(imageUrl);
        originalImageBase64 = imageData.base64;
        originalMimeType = imageData.mimeType;
      } catch (e) {
        console.error('❌ Failed to fetch original image:', e);
      }
    }

    // 商品説明を取得または画像から分析
    let finalDescription = productDescription?.trim() || '';
    
    if (!finalDescription && originalImageBase64) {
      console.log('📝 Analyzing image to get description...');
      try {
        finalDescription = await analyzeImageWithGemini(originalImageBase64, originalMimeType, GEMINI_API_KEY);
      } catch (e) {
        console.error('❌ Image analysis failed:', e);
        throw new Error(`画像分析エラー: ${clientError(e)}. 商品説明を手動で入力してください。`);
      }
    }
    
    if (!finalDescription) {
      throw new Error('商品説明を入力するか、商品画像をアップロードしてください。');
    }
    
    console.log('✅ Description:', finalDescription);
    console.log('🎨 Generating', shots.length, 'product shots...');
    console.log('📌 Reference image available:', !!originalImageBase64);

    const selectedShots = SHOT_TYPES.filter(s => shots.includes(s.id));
    const results = [];

    for (const shot of selectedShots) {
      let imageBase64: string | null = null;
      
      // 元画像がある場合は参照生成、ない場合はテキスト生成
      if (originalImageBase64) {
        imageBase64 = await generateAngleWithReference(
          originalImageBase64, 
          originalMimeType, 
          shot, 
          finalDescription,
          backgroundPrompt,
          GEMINI_API_KEY
        );
      }
      
      // 参照生成が失敗した場合はテキストのみで生成
      if (!imageBase64) {
        imageBase64 = await generateAngleFromText(shot, finalDescription, backgroundPrompt, GEMINI_API_KEY);
      }

      if (imageBase64) {
        const imageDataUrl = `data:image/png;base64,${imageBase64}`;
        const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
        const fileName = `${user.id}/${brandId}/${Date.now()}_product_${shot.id}.png`;
        let storageUrl = '';
        
        try {
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
          await supabaseClient.from('generated_images').insert({
            brand_id: brandId,
            user_id: user.id,
            storage_path: fileName,
            image_url: null,
            prompt: finalDescription,
            feature_type: 'product-shots',
            model_used: 'gemini-2.0-flash-exp-image-generation',
            generation_params: { shotType: shot.id, productDescription: finalDescription, hasReferenceImage: !!originalImageBase64 },
          });
          console.log('✅ Image record saved to database');
        } catch (dbError) {
          console.log('⚠️ Database warning:', clientError(dbError));
        }

        results.push({
          shotType: shot.id,
          shotName: shot.name,
          imageUrl: imageDataUrl,
          storagePath: fileName,
        });
        
        console.log(`✅ ${shot.name} complete`);
      } else {
        console.log(`⚠️ Failed to generate ${shot.name}`);
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

    console.log(`🎉 Generated ${results.length}/${selectedShots.length} shots`);
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
        productDescription: finalDescription,
        shots: results,
        analyzedFromImage: !productDescription?.trim() && !!imageUrl,
        usedReferenceImage: !!originalImageBase64,
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
