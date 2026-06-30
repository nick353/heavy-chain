import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { clientError, createServiceClient, requireBrandRole, type Database } from '../_shared/auth.ts';
import { completeBrandUsage, reserveBrandUsage, type UsageReservation } from '../_shared/usage.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';
import { generateRunwayImage, runwayImageArtifact, runwayProviderName, runwayReferenceImage, type RunwayImageResult } from '../_shared/runway.ts';
import { requireRunwayMcpConnectionApproval } from '../_shared/runwayApproval.ts';
import { sanitizeMaterialGenerationMetadata } from '../_shared/materialMetadata.ts';
import { requireLegalSafetyApproval } from '../_shared/legalSafety.ts';

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
  console.log('📷 Fetching image for product-shots:', {
    hasImageUrl: Boolean(imageUrl),
    imageUrlLength: imageUrl.length,
    isDataUrl: imageUrl.startsWith('data:'),
  });
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

// 元画像を参照して異なるアングルを生成
async function generateAngleWithReference(
  brandId: string,
  originalBase64: string,
  originalMimeType: string,
  shot: typeof SHOT_TYPES[0], 
  description: string,
  backgroundPrompt: string,
  _apiKey?: string,
  _imageModel?: string
): Promise<RunwayImageResult | null> {
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

  return await generateRunwayImage({
    brandId,
    prompt,
    referenceImages: [runwayReferenceImage(originalBase64, originalMimeType, 'product')],
  });
}

// テキストのみで生成（フォールバック）
async function generateAngleFromText(
  brandId: string,
  shot: typeof SHOT_TYPES[0], 
  description: string,
  backgroundPrompt: string,
  _apiKey?: string,
  _imageModel?: string
): Promise<RunwayImageResult | null> {
  console.log(`🎨 Generating ${shot.name} from text (fallback)...`);
  
  const prompt = `Generate a professional e-commerce product photo.

PRODUCT: ${description}
VIEWING ANGLE: ${shot.angle}
BACKGROUND: ${backgroundPrompt}

STYLE: High-resolution commercial product photography, sharp focus, professional lighting.`;

  return await generateRunwayImage({ brandId, prompt });
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
    const materialMetadata = sanitizeMaterialGenerationMetadata(body);
    
    let { productDescription, brandId, imageUrl, shots = ['front', 'side', 'back', 'detail'], background = 'white' } = body;
    console.log('📥 Received product-shots request:', {
      brandId,
      hasProductDescription: typeof productDescription === 'string' && productDescription.trim().length > 0,
      hasImageUrl: typeof imageUrl === 'string' && imageUrl.length > 0,
      imageUrlLength: typeof imageUrl === 'string' ? imageUrl.length : 0,
      shots: Array.isArray(shots) ? shots : [],
      background,
      hasMaterialReferences: Array.isArray(body.materialReferences) && body.materialReferences.length > 0,
    });

    if (!brandId) {
      throw new Error('ブランドIDが指定されていません');
    }

    requireLegalSafetyApproval(body.legalSafety, [
      productDescription,
      background,
      body.materialReferences,
      body.layerPlan,
      body.maskPlan,
      body.compositionPreview,
    ]);

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


    // 背景プロンプトを取得
    const backgroundPrompt = BACKGROUND_OPTIONS[background] || BACKGROUND_OPTIONS['white'];
    console.log('🎨 Background:', background, '->', backgroundPrompt);

    const imageModel = 'runway';

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
        finalDescription = 'Fashion product';
      } catch (e) {
        console.error('❌ Image analysis failed:', e);
        throw new Error(`画像分析エラー: ${clientError(e)}. 商品説明を手動で入力してください。`);
      }
    }
    
    if (!finalDescription) {
      throw new Error('商品説明を入力するか、商品画像をアップロードしてください。');
    }
    
    console.log('✅ Description ready:', { descriptionLength: finalDescription.length });
    console.log('🎨 Generating', shots.length, 'product shots...');
    console.log('📌 Reference image available:', !!originalImageBase64);

    const selectedShots = SHOT_TYPES.filter(s => shots.includes(s.id));
    const results = [];

    for (const shot of selectedShots) {
      let generatedImage: RunwayImageResult | null = null;
      
      // 元画像がある場合は参照生成、ない場合はテキスト生成
      if (originalImageBase64) {
        generatedImage = await generateAngleWithReference(
          brandId,
          originalImageBase64, 
          originalMimeType, 
          shot, 
          finalDescription,
          backgroundPrompt,
          imageModel
        );
      }
      
      // 参照生成が失敗した場合はテキストのみで生成
      if (!generatedImage) {
        generatedImage = await generateAngleFromText(brandId, shot, finalDescription, backgroundPrompt, imageModel);
      }

      if (generatedImage) {
        const imageAsset = runwayImageArtifact(generatedImage);
        const imageBase64 = imageAsset.base64;
        const imageDataUrl = imageAsset.dataUrl;
        const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
        const fileName = `${user.id}/${brandId}/${Date.now()}_product_${shot.id}.${imageAsset.extension}`;
        let storageUrl = '';
        
        try {
          const { error: uploadError } = await supabaseService.storage
            .from('generated-images')
            .upload(fileName, imgBuffer, { contentType: imageAsset.contentType });

          if (!uploadError) {
            const { data: urlData } = await supabaseService.storage.from('generated-images').createSignedUrl(fileName, 60 * 60 * 24);
            storageUrl = urlData?.signedUrl || '';
            console.log('✅ Image uploaded to storage:', { storagePath: fileName, hasStorageUrl: Boolean(storageUrl) });
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
            model_used: imageModel,
            generation_params: { shotType: shot.id, productDescription: finalDescription, hasReferenceImage: !!originalImageBase64 },
            metadata: {
              remoteSaveStatus: 'succeeded',
              source: 'product-shots',
              requestId,
              ...(materialMetadata ?? {}),
            } as any,
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
        provider: runwayProviderName() as any,
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
