import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    console.log('⚠️ Failed to fetch image:', e.message);
    return null;
  }
}

// 画像を分析して詳細な説明を取得
async function analyzeImageWithGemini(base64: string, mimeType: string, apiKey: string): Promise<string> {
  console.log('🔍 Analyzing image with Gemini...');
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
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
  apiKey: string
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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`,
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
  apiKey: string
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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`,
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

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    // Fetch and analyze the image
    console.log('🖼️ Fetching original image...');
    const imageData = await fetchImageAsBase64(imageUrl);
    if (!imageData) {
      throw new Error('画像の取得に失敗しました');
    }
    const { base64: imageBase64, mimeType } = imageData;

    // Analyze the image with Gemini
    const description = await analyzeImageWithGemini(imageBase64, mimeType, GEMINI_API_KEY);
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
          GEMINI_API_KEY
        );

        if (genImageBase64) {
          const imageDataUrl = `data:image/png;base64,${genImageBase64}`;
          const fileName = `${user.id}/${brandId}/${Date.now()}_scene${i + 1}.png`;

          try {
            const imgBuffer = Uint8Array.from(atob(genImageBase64), c => c.charCodeAt(0));
            await supabaseClient.storage
              .from('generated-images')
              .upload(fileName, imgBuffer, { contentType: 'image/png' });

            await supabaseClient.from('generated_images').insert({
              brand_id: brandId,
              user_id: user.id,
              storage_path: fileName,
              prompt: scenePrompt,
              model_used: 'gemini-2.0-flash-exp-image-generation',
              generation_params: { scene: scenePrompt, originalDescription: description },
            });
          } catch (storageError) {
            console.log('⚠️ Storage warning:', storageError.message);
          }

          results.push({
            index: i + 1,
            scene: scenePrompt,
            imageUrl: imageDataUrl,
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
          GEMINI_API_KEY
        );

        if (genImageBase64) {
          const imageDataUrl = `data:image/png;base64,${genImageBase64}`;
          const fileName = `${user.id}/${brandId}/${Date.now()}_var${i + 1}.png`;

          try {
            const imgBuffer = Uint8Array.from(atob(genImageBase64), c => c.charCodeAt(0));
            await supabaseClient.storage
              .from('generated-images')
              .upload(fileName, imgBuffer, { contentType: 'image/png' });

            await supabaseClient.from('generated_images').insert({
              brand_id: brandId,
              user_id: user.id,
              storage_path: fileName,
              prompt: variationPrompt,
              model_used: 'gemini-2.0-flash-exp-image-generation',
              generation_params: { variation: i + 1, originalDescription: description },
            });
          } catch (storageError) {
            console.log('⚠️ Storage warning:', storageError.message);
          }

          results.push({
            index: i + 1,
            imageUrl: imageDataUrl,
            storagePath: fileName,
          });
          
          console.log(`✅ Variation ${i + 1} generated`);
        }
      }
    }

    if (results.length === 0) {
      throw new Error('画像の生成に失敗しました。しばらく待ってからもう一度お試しください。');
    }

    console.log(`🎉 Successfully generated ${results.length} images`);

    return new Response(
      JSON.stringify({
        success: true,
        originalDescription: description,
        variations: results,
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
