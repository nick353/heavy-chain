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

    const { imageUrl, brandId, newBackground } = await req.json();

    if (!imageUrl || !brandId) {
      throw new Error('Missing required parameters: imageUrl, brandId');
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    // Fetch and analyze the original image
    console.log('🖼️ Fetching original image...');
    const { base64: originalBase64, mimeType } = await fetchImageAsBase64(imageUrl);

    // Analyze the product in the image
    console.log('🔍 Analyzing image...');
    const analysisResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: 'Describe this product in detail for image regeneration. Include: item type, exact colors, textures, design features. Be very specific. Output only English description.' },
              { inlineData: { mimeType, data: originalBase64 } }
            ]
          }],
          generationConfig: { temperature: 0.2 }
        }),
      }
    );

    const analysisData = await analysisResponse.json();
    const description = analysisData.candidates?.[0]?.content?.parts?.[0]?.text || 'Product';

    console.log('📝 Description:', description);

    // Determine background prompt
    const backgroundPrompt = newBackground || 'pure white background, clean studio lighting, no shadows';
    
    // Generate image with new background
    console.log('🎨 Generating with new background...');
    const prompt = `${description}, isolated product, ${backgroundPrompt}, professional product photography, high quality, e-commerce ready`;

    const generateResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { 
            responseModalities: ["IMAGE", "TEXT"],
            temperature: 0.6
          }
        }),
      }
    );

    const generateData = await generateResponse.json();

    if (!generateResponse.ok || !generateData.candidates?.[0]?.content?.parts) {
      throw new Error('背景変更に失敗しました。しばらく待ってからもう一度お試しください。');
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
    const fileName = `${user.id}/${brandId}/${Date.now()}_nobg.png`;

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

    console.log('✅ Background removed/changed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        resultUrl: imageDataUrl,
        imageUrl: imageDataUrl,
        storagePath: fileName,
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
