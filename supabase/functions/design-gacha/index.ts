import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

// 画像を分析して商品説明を取得
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
  apiKey: string
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
  apiKey: string
): Promise<string | null> {
  const fullPrompt = `${brief}, ${direction.prompt}, professional fashion photography, high quality, studio lighting`;

  const generateResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`,
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
      brief, 
      imageUrl,
      referenceImage,
      brandId, 
      directions = 4,
      fixedElements = []
    } = body;

    console.log('📥 Request:', { brief: !!brief, imageUrl: !!imageUrl, referenceImage: !!referenceImage, brandId, fixedElements });

    // imageUrlまたはreferenceImageを使用
    const productImageUrl = imageUrl || referenceImage;

    if (!brief && !productImageUrl) {
      throw new Error('ブリーフまたは商品画像を入力してください');
    }

    if (!brandId) {
      throw new Error('Brand ID is required');
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    // 画像がある場合は分析
    let originalImageBase64: string | null = null;
    let originalMimeType = 'image/jpeg';
    let productDescription = brief || '';

    if (productImageUrl) {
      const imageData = await fetchImageAsBase64(productImageUrl);
      if (imageData) {
        originalImageBase64 = imageData.base64;
        originalMimeType = imageData.mimeType;
        
        // briefがない場合は画像から生成
        if (!productDescription) {
          productDescription = await analyzeImageWithGemini(originalImageBase64, originalMimeType, GEMINI_API_KEY);
        }
      }
    }

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
          GEMINI_API_KEY
        );
      }

      // 参照生成が失敗した場合、または商品固定でない場合はテキストのみで生成
      if (!imageBase64) {
        imageBase64 = await generateFromText(
          productDescription,
          direction,
          GEMINI_API_KEY
        );
      }

      if (imageBase64) {
        const imageDataUrl = `data:image/png;base64,${imageBase64}`;
        const fileName = `${user.id}/${brandId}/${Date.now()}_gacha_${direction.id}.png`;
        let storageUrl = '';

        try {
          const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
          const { error: uploadError } = await supabaseClient.storage
            .from('generated-images')
            .upload(fileName, imgBuffer, { contentType: 'image/png' });

          if (!uploadError) {
            const { data: urlData } = supabaseClient.storage.from('generated-images').getPublicUrl(fileName);
            storageUrl = urlData.publicUrl || '';
            console.log('✅ Image uploaded to storage:', storageUrl);
          } else {
            console.log('⚠️ Storage upload error:', uploadError.message);
          }
        } catch (storageError) {
          console.log('⚠️ Storage warning:', storageError.message);
        }

        // Always save record with image_url as fallback
        try {
          await supabaseClient.from('generated_images').insert({
            brand_id: brandId,
            user_id: user.id,
            storage_path: fileName,
            image_url: storageUrl || imageDataUrl,
            prompt: productDescription,
            feature_type: 'design-gacha',
            model_used: 'gemini-2.0-flash-exp-image-generation',
            generation_params: { direction: direction.id, brief: productDescription, isProductFixed },
          });
          console.log('✅ Image record saved to database');
        } catch (dbError) {
          console.log('⚠️ Database warning:', dbError.message);
        }

        results.push({
          direction: direction.id,
          directionName: direction.name,
          imageUrl: imageDataUrl,
          storagePath: fileName,
          prompt: productDescription,
        });
        
        console.log(`✅ ${direction.name} generated`);
      }
    }

    if (results.length === 0) {
      throw new Error('画像の生成に失敗しました。しばらく待ってからもう一度お試しください。');
    }

    console.log(`🎉 Successfully generated ${results.length} variations`);

    return new Response(
      JSON.stringify({
        success: true,
        brief: productDescription,
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


