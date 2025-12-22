import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SHOT_TYPES = [
  { id: 'front', name: '正面', angle: 'front view, facing the camera directly, showing the front of the product', prompt: 'Show this exact same product from the front view, facing the camera directly. Keep ALL details, colors, textures, logos, and design features exactly the same.' },
  { id: 'side', name: '側面', angle: 'side view, profile, 90 degree angle from the right', prompt: 'Show this exact same product from the side view (right profile, 90 degree angle). Keep ALL details, colors, textures, logos, and design features exactly the same.' },
  { id: 'back', name: '背面', angle: 'back view, rear, showing the back of the product', prompt: 'Show this exact same product from the back view (rear). Keep ALL details, colors, textures, logos, and design features exactly the same.' },
  { id: 'detail', name: 'ディテール', angle: 'close-up detail shot of texture and material', prompt: 'Show a close-up detail shot of this exact same product, focusing on the texture, material, and fine details. Keep ALL colors and design features exactly the same.' },
  { id: '45deg', name: '斜め45度', angle: '45 degree angle, three-quarter view', prompt: 'Show this exact same product from a 45 degree angle (three-quarter view). Keep ALL details, colors, textures, logos, and design features exactly the same.' },
];

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
                  text: 'Describe this fashion product image in extreme detail for AI image regeneration. Include: exact item type, all colors (primary, secondary, accent), material texture, style, ALL design features (buttons, zippers, pockets, logos, labels, stitching), patterns, and overall aesthetic. Be very specific. Output only the English description.'
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
  apiKey: string
): Promise<string | null> {
  console.log(`🎨 Generating ${shot.name} with reference image...`);
  
  // プロンプト: 元画像を参照して同じ商品の別アングルを生成
  const prompt = `${shot.prompt}

Product description for reference: ${description}

IMPORTANT: 
- This must be the EXACT SAME product shown in the reference image
- Maintain identical colors, materials, textures, logos, and all design details
- Only change the viewing angle to: ${shot.angle}
- Use professional product photography style with clean white background and studio lighting
- High resolution, e-commerce quality`;

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
          temperature: 0.4  // Lower temperature for more consistent results
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
  apiKey: string
): Promise<string | null> {
  console.log(`🎨 Generating ${shot.name} from text (fallback)...`);
  
  const prompt = `${description}, ${shot.angle}, professional product photography, clean white background, studio lighting, e-commerce ready, high resolution, commercial quality`;

  const generateResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const body = await req.json();
    console.log('📥 Received request body:', JSON.stringify(body, null, 2));
    
    let { productDescription, brandId, imageUrl, shots = ['front', 'side', 'back', 'detail'] } = body;

    if (!brandId) {
      throw new Error('ブランドIDが指定されていません');
    }

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
        throw new Error(`画像分析エラー: ${e.message}. 商品説明を手動で入力してください。`);
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
          GEMINI_API_KEY
        );
      }
      
      // 参照生成が失敗した場合はテキストのみで生成
      if (!imageBase64) {
        imageBase64 = await generateAngleFromText(shot, finalDescription, GEMINI_API_KEY);
      }

      if (imageBase64) {
        const imageDataUrl = `data:image/png;base64,${imageBase64}`;
        const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
        const fileName = `${user.id}/${brandId}/${Date.now()}_product_${shot.id}.png`;
        
        try {
          await supabaseClient.storage
            .from('generated-images')
            .upload(fileName, imgBuffer, { contentType: 'image/png' });

          await supabaseClient.from('generated_images').insert({
            brand_id: brandId,
            user_id: user.id,
            storage_path: fileName,
            prompt: finalDescription,
            model_used: 'gemini-2.0-flash-exp-image-generation',
            generation_params: { shotType: shot.id, productDescription: finalDescription, hasReferenceImage: !!originalImageBase64 },
          });
        } catch (storageError) {
          console.log('⚠️ Storage warning:', storageError.message);
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
      await supabaseClient.from('api_usage_logs').insert({
        user_id: user.id,
        brand_id: brandId,
        provider: 'gemini',
        tokens_used: results.length * 500,
        cost_usd: 0,
      });
    } catch (e) {
      console.log('⚠️ Usage log warning:', e.message);
    }

    console.log(`🎉 Generated ${results.length}/${selectedShots.length} shots`);

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
    console.error('❌ Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

