import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SHOT_TYPES = [
  { id: 'front', name: '正面', angle: 'front view, facing camera directly' },
  { id: 'side', name: '側面', angle: 'side view, profile, 90 degree angle' },
  { id: 'back', name: '背面', angle: 'back view, rear, showing back details' },
  { id: 'detail', name: 'ディテール', angle: 'close-up detail shot, macro, texture focus' },
  { id: '45deg', name: '斜め45度', angle: '45 degree angle, three-quarter view' },
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
  
  // Try multiple model versions for compatibility
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
                  text: 'Describe this fashion product image in detail for AI image regeneration. Include: exact item type (shirt, dress, pants, etc.), primary and secondary colors, material texture (cotton, silk, leather, etc.), style (casual, formal, vintage, etc.), key design features (buttons, zippers, patterns, prints), and overall aesthetic. Be specific and concise. Output only the English description.'
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
              temperature: 0.4,
              maxOutputTokens: 500
            }
          }),
        }
      );
      
      const data = await response.json();
      console.log(`📊 ${model} response status:`, response.status);
      
      if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
        const description = data.candidates[0].content.parts[0].text;
        console.log('✅ Image analysis successful with', model);
        console.log('📝 Description:', description);
        return description;
      }
      
      // Log error but continue to next model
      console.log(`⚠️ ${model} failed:`, JSON.stringify(data));
      lastError = data;
      
    } catch (e) {
      console.log(`⚠️ ${model} exception:`, e.message);
      lastError = e;
    }
  }
  
  // All models failed
  throw new Error(`画像分析に失敗しました: ${JSON.stringify(lastError)}`);
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

    // Validate required parameters
    if (!brandId) {
      console.error('❌ Missing brandId');
      throw new Error('ブランドIDが指定されていません');
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    // 画像分析: 商品説明がない場合、画像から分析
    let finalDescription = productDescription?.trim() || '';
    
    if (!finalDescription && imageUrl) {
      console.log('🖼️ No product description provided, analyzing uploaded image...');
      try {
        const { base64, mimeType } = await fetchImageAsBase64(imageUrl);
        finalDescription = await analyzeImageWithGemini(base64, mimeType, GEMINI_API_KEY);
      } catch (e) {
        console.error('❌ Image analysis failed:', e);
        throw new Error(`画像分析エラー: ${e.message}. 商品説明を手動で入力してください。`);
      }
    }
    
    if (!finalDescription) {
      console.error('❌ No description available');
      throw new Error('商品説明を入力するか、商品画像をアップロードしてください。');
    }
    
    console.log('✅ Using description:', finalDescription);
    console.log('🎨 Generating', shots.length, 'product shots...');

    const selectedShots = SHOT_TYPES.filter(s => shots.includes(s.id));
    const results = [];

    for (const shot of selectedShots) {
      const prompt = `${finalDescription}, ${shot.angle}, professional product photography, clean white background, studio lighting, e-commerce ready, high resolution, commercial quality`;

      console.log(`📸 Generating ${shot.name} (${shot.id})...`);

      // Generate with Gemini Image Model
      const generateResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${GEMINI_API_KEY}`,
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
      console.log(`📊 Generation response for ${shot.id}:`, generateResponse.status);

      if (generateResponse.ok && generateData.candidates?.[0]?.content?.parts) {
        let imageBase64 = null;
        
        for (const part of generateData.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            imageBase64 = part.inlineData.data;
            break;
          }
        }

        if (imageBase64) {
          const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
          
          const fileName = `${user.id}/${brandId}/${Date.now()}_product_${shot.id}.png`;
          await supabaseClient.storage
            .from('generated-images')
            .upload(fileName, imgBuffer, {
              contentType: 'image/png',
            });

          const { data: urlData } = supabaseClient.storage
            .from('generated-images')
            .getPublicUrl(fileName);

          console.log(`🔗 Generated URL for ${shot.id}:`, urlData.publicUrl);

          await supabaseClient.from('generated_images').insert({
            brand_id: brandId,
            user_id: user.id,
            storage_path: fileName,
            prompt,
            model_used: 'gemini-2.0-flash-exp-image-generation',
            generation_params: { shotType: shot.id, productDescription: finalDescription },
          });

          results.push({
            shotType: shot.id,
            shotName: shot.name,
            imageUrl: urlData.publicUrl,
            storagePath: fileName,
          });
          
          console.log(`✅ ${shot.name} generated successfully, URL:`, urlData.publicUrl);
        } else {
          console.log(`⚠️ No image data in response for ${shot.id}`);
        }
      } else {
        console.log(`⚠️ Generation failed for ${shot.id}:`, JSON.stringify(generateData));
      }
    }

    if (results.length === 0) {
      throw new Error('画像の生成に失敗しました。しばらく待ってからもう一度お試しください。');
    }

    await supabaseClient.from('api_usage_logs').insert({
      user_id: user.id,
      brand_id: brandId,
      provider: 'gemini',
      tokens_used: results.length * 500,
      cost_usd: 0, // Gemini free tier
    });

    console.log(`🎉 Successfully generated ${results.length}/${selectedShots.length} shots`);

    const response = {
      success: true,
      productDescription: finalDescription,
      shots: results,
      analyzedFromImage: !productDescription?.trim() && !!imageUrl,
    };
    
    console.log('📤 Sending response:', JSON.stringify(response, null, 2));

    return new Response(
      JSON.stringify(response),
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
