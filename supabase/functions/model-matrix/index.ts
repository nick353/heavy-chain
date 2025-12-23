import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BODY_TYPES = [
  { id: 'slim', name: 'スリム', prompt: 'slim fit, lean body type' },
  { id: 'regular', name: 'レギュラー', prompt: 'regular fit, average body type' },
  { id: 'plus', name: 'プラス', prompt: 'plus size, curvy body type' },
];

const AGE_GROUPS = [
  { id: '20s', name: '20代', prompt: 'young adult in their 20s' },
  { id: '30s', name: '30代', prompt: 'adult in their 30s' },
  { id: '40s', name: '40代', prompt: 'mature adult in their 40s' },
  { id: '50s', name: '50代', prompt: 'elegant adult in their 50s' },
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
              text: `Describe this clothing item in detail for fashion model photography. Include:
1. Type of garment (e.g., jacket, dress, shirt)
2. Color and color distribution
3. Material/fabric texture
4. Design features (pockets, zippers, collars, patterns, logos)
5. Style category (casual, formal, streetwear, etc.)

Output ONLY a concise English description suitable for image generation. Be specific about visual details.`
            },
            {
              inlineData: { mimeType, data: base64 }
            }
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
  
  throw new Error('画像の分析に失敗しました');
}

// 参照画像を使って生成
async function generateWithReference(
  originalBase64: string,
  originalMimeType: string,
  description: string,
  bodyType: typeof BODY_TYPES[0],
  ageGroup: typeof AGE_GROUPS[0],
  gender: string,
  apiKey: string
): Promise<string | null> {
  console.log(`🎨 Generating ${bodyType.name} x ${ageGroup.name} with reference...`);

  const prompt = `Generate a professional fashion model photo.

MODEL: ${gender} model, ${bodyType.prompt}, ${ageGroup.prompt}
CLOTHING: The model is wearing EXACTLY this garment: ${description}

CRITICAL REQUIREMENTS:
1. The clothing must be IDENTICAL to the reference image
2. Same colors, same design, same fabric texture
3. Same pockets, zippers, logos, all details
4. Only the MODEL changes, not the clothing

STYLE: Professional fashion photography, full body shot, studio lighting, neutral background`;

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
        console.log(`✅ ${bodyType.name} x ${ageGroup.name} generated with reference`);
        return part.inlineData.data;
      }
    }
  }

  console.log(`⚠️ Reference generation failed, trying text-only...`);
  return null;
}

// テキストのみで生成
async function generateFromText(
  description: string,
  bodyType: typeof BODY_TYPES[0],
  ageGroup: typeof AGE_GROUPS[0],
  gender: string,
  apiKey: string
): Promise<string | null> {
  const prompt = `${gender} model wearing ${description}, ${bodyType.prompt}, ${ageGroup.prompt}, fashion photography, full body shot, professional studio lighting, neutral background, high quality`;

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
    let { 
      productDescription, 
      imageUrl,
      brandId, 
      bodyTypes = ['slim', 'regular', 'plus'],
      ageGroups = ['20s', '30s', '40s'],
      gender = 'female'
    } = body;

    console.log('📥 Request:', { productDescription: !!productDescription, imageUrl: !!imageUrl, brandId });

    if (!productDescription && !imageUrl) {
      throw new Error('商品説明または商品画像を入力してください');
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
    let finalDescription = productDescription;

    if (imageUrl) {
      const imageData = await fetchImageAsBase64(imageUrl);
      if (imageData) {
        originalImageBase64 = imageData.base64;
        originalMimeType = imageData.mimeType;
        
        // 商品説明がない場合は画像から生成
        if (!finalDescription) {
          finalDescription = await analyzeImageWithGemini(originalImageBase64, originalMimeType, GEMINI_API_KEY);
        }
      }
    }

    if (!finalDescription) {
      throw new Error('商品説明を取得できませんでした');
    }

    const selectedBodyTypes = BODY_TYPES.filter(b => bodyTypes.includes(b.id));
    const selectedAgeGroups = AGE_GROUPS.filter(a => ageGroups.includes(a.id));
    const results = [];

    // Generate matrix
    for (const bodyType of selectedBodyTypes) {
      for (const ageGroup of selectedAgeGroups) {
        let imageBase64: string | null = null;

        // 元画像がある場合は参照生成
        if (originalImageBase64) {
          imageBase64 = await generateWithReference(
            originalImageBase64,
            originalMimeType,
            finalDescription,
            bodyType,
            ageGroup,
            gender,
            GEMINI_API_KEY
          );
        }

        // 参照生成が失敗した場合はテキストのみで生成
        if (!imageBase64) {
          imageBase64 = await generateFromText(
            finalDescription,
            bodyType,
            ageGroup,
            gender,
            GEMINI_API_KEY
          );
        }

        if (imageBase64) {
          const imageDataUrl = `data:image/png;base64,${imageBase64}`;
          const fileName = `${user.id}/${brandId}/${Date.now()}_matrix_${bodyType.id}_${ageGroup.id}.png`;

          try {
            const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
            await supabaseClient.storage
              .from('generated-images')
              .upload(fileName, imgBuffer, { contentType: 'image/png' });

            await supabaseClient.from('generated_images').insert({
              brand_id: brandId,
              user_id: user.id,
              storage_path: fileName,
              prompt: finalDescription,
              model_used: 'gemini-2.0-flash-exp-image-generation',
              generation_params: { 
                bodyType: bodyType.id, 
                ageGroup: ageGroup.id,
                gender,
                productDescription: finalDescription 
              },
            });
          } catch (storageError) {
            console.log('⚠️ Storage warning:', storageError.message);
          }

          results.push({
            bodyType: bodyType.id,
            bodyTypeName: bodyType.name,
            ageGroup: ageGroup.id,
            ageGroupName: ageGroup.name,
            imageUrl: imageDataUrl,
            storagePath: fileName,
          });
          
          console.log(`✅ ${bodyType.name} x ${ageGroup.name} generated`);
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
        productDescription: finalDescription,
        matrix: results,
        dimensions: {
          bodyTypes: selectedBodyTypes.map(b => ({ id: b.id, name: b.name })),
          ageGroups: selectedAgeGroups.map(a => ({ id: a.id, name: a.name })),
        },
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


