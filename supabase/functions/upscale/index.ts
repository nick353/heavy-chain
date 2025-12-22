import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    const { imageUrl, brandId, scale = 2 } = await req.json();

    if (!imageUrl || !brandId) {
      throw new Error('Missing required parameters');
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    // Fetch and analyze the original image
    console.log('🖼️ Fetching original image...');
    const { base64: originalBase64, mimeType } = await fetchImageAsBase64(imageUrl);

    // Analyze the image in extreme detail
    console.log('🔍 Analyzing image for high-resolution regeneration...');
    const analysisResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: 'Describe this image in EXTREME detail for high-resolution regeneration. Include every visible element, colors, textures, lighting, shadows, background, composition. Be as detailed as possible. Output only English description.' },
              { inlineData: { mimeType, data: originalBase64 } }
            ]
          }],
          generationConfig: { 
            temperature: 0.2,
            maxOutputTokens: 1000
          }
        }),
      }
    );

    const analysisData = await analysisResponse.json();
    const description = analysisData.candidates?.[0]?.content?.parts?.[0]?.text || 'High quality image';

    console.log('📝 Detailed description obtained');

    // Generate high-resolution version
    console.log('🎨 Generating high-resolution image...');
    const prompt = `${description}. Ultra high resolution, extremely detailed, 4K quality, sharp focus, professional photography, pristine quality`;

    const generateResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { 
            responseModalities: ["IMAGE", "TEXT"],
            temperature: 0.3  // Low temperature for accuracy
          }
        }),
      }
    );

    const generateData = await generateResponse.json();

    if (!generateResponse.ok || !generateData.candidates?.[0]?.content?.parts) {
      throw new Error('高解像度化に失敗しました。しばらく待ってからもう一度お試しください。');
    }

    let imageBase64 = null;
    for (const part of generateData.candidates[0].content.parts) {
      if (part.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        break;
      }
    }

    if (!imageBase64) {
      throw new Error('画像生成に失敗しました。');
    }

    const imageDataUrl = `data:image/png;base64,${imageBase64}`;
    const fileName = `${user.id}/${brandId}/${Date.now()}_upscaled_${scale}x.png`;

    try {
      const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
      await supabaseClient.storage
        .from('generated-images')
        .upload(fileName, imgBuffer, { contentType: 'image/png' });
    } catch (storageError) {
      console.log('⚠️ Storage warning:', storageError.message);
    }

    try {
      await supabaseClient.from('api_usage_logs').insert({
        user_id: user.id,
        brand_id: brandId,
        provider: 'gemini',
        tokens_used: 500,
        cost_usd: 0,
      });
    } catch (e) {
      console.log('⚠️ Usage log warning:', e.message);
    }

    console.log('✅ Upscaling complete');

    return new Response(
      JSON.stringify({
        success: true,
        resultUrl: imageDataUrl,
        imageUrl: imageDataUrl,
        storagePath: fileName,
        scale,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
