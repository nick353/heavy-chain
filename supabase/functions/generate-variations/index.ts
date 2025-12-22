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

    const { imageUrl, brandId, prompt, count = 4 } = await req.json();

    if (!imageUrl || !brandId) {
      throw new Error('Missing required parameters');
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    // Fetch and analyze the image
    console.log('🖼️ Fetching original image...');
    const { base64: imageBase64, mimeType } = await fetchImageAsBase64(imageUrl);

    // Analyze the image with Gemini
    console.log('🔍 Analyzing image...');
    const analysisResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: 'Describe this fashion product image in detail for regeneration. Include: item type, color, style, composition, lighting, background. Be specific but concise. Output only the English description.' },
              { inlineData: { mimeType, data: imageBase64 } }
            ]
          }],
          generationConfig: { temperature: 0.3 }
        }),
      }
    );

    const analysisData = await analysisResponse.json();
    const description = analysisData.candidates?.[0]?.content?.parts?.[0]?.text || 'Fashion product';

    console.log('📝 Description:', description);

    // Generate variations
    const results = [];
    const variationPrompts = [
      `${description}. ${prompt || ''} Variation: slightly different angle, professional fashion photography`,
      `${description}. ${prompt || ''} Variation: different lighting setup, dramatic shadows`,
      `${description}. ${prompt || ''} Variation: adjusted composition, closer crop`,
      `${description}. ${prompt || ''} Variation: alternative styling, different mood`,
    ].slice(0, count);

    for (let i = 0; i < variationPrompts.length; i++) {
      console.log(`🎨 Generating variation ${i + 1}...`);

      const generateResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: variationPrompts[i] }] }],
            generationConfig: { 
              responseModalities: ["IMAGE", "TEXT"],
              temperature: 0.8
            }
          }),
        }
      );

      const generateData = await generateResponse.json();

      if (generateResponse.ok && generateData.candidates?.[0]?.content?.parts) {
        let genImageBase64 = null;
        for (const part of generateData.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            genImageBase64 = part.inlineData.data;
            break;
          }
        }

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
              prompt: variationPrompts[i],
              model_used: 'gemini-2.0-flash-exp-image-generation',
              generation_params: { variation: i + 1, originalImage: imageUrl },
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
      throw new Error('バリエーションの生成に失敗しました。しばらく待ってからもう一度お試しください。');
    }

    try {
      await supabaseClient.from('api_usage_logs').insert({
        user_id: user.id,
        brand_id: brandId,
        provider: 'gemini',
        tokens_used: 500 + results.length * 500,
        cost_usd: 0,
      });
    } catch (e) {
      console.log('⚠️ Usage log warning:', e.message);
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
