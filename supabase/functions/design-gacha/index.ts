import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DESIGN_DIRECTIONS = [
  { id: 'minimal', name: 'ミニマル', prompt: 'minimalist, clean lines, simple composition, white space' },
  { id: 'luxury', name: 'ラグジュアリー', prompt: 'luxury, elegant, sophisticated, high-end, premium quality' },
  { id: 'street', name: 'ストリート', prompt: 'street style, urban, edgy, dynamic, youth culture' },
  { id: 'vintage', name: 'ヴィンテージ', prompt: 'vintage aesthetic, retro, film grain, nostalgic, warm tones' },
  { id: 'modern', name: 'モダン', prompt: 'modern contemporary, bold colors, geometric, cutting edge' },
  { id: 'natural', name: 'ナチュラル', prompt: 'natural, organic, earthy tones, sustainable, eco-friendly' },
  { id: 'pop', name: 'ポップ', prompt: 'pop art, colorful, playful, vibrant, eye-catching' },
  { id: 'cyber', name: 'サイバー', prompt: 'cyberpunk, futuristic, neon lights, tech-inspired, digital' },
];

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

    const { brief, brandId, directions = 4 } = await req.json();

    if (!brief || !brandId) {
      throw new Error('Missing required parameters: brief, brandId');
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    // Select random directions
    const selectedDirections = [...DESIGN_DIRECTIONS]
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(directions, DESIGN_DIRECTIONS.length));

    const results = [];

    for (const direction of selectedDirections) {
      const fullPrompt = `${brief}, ${direction.prompt}, professional fashion photography, high quality, studio lighting`;

      console.log(`🎨 Generating ${direction.name}...`);

      // Generate image with Gemini
      const generateResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${GEMINI_API_KEY}`,
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
        let imageBase64 = null;
        for (const part of generateData.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            imageBase64 = part.inlineData.data;
            break;
          }
        }

        if (imageBase64) {
          // Base64 Data URLを作成
          const imageDataUrl = `data:image/png;base64,${imageBase64}`;
          
          const fileName = `${user.id}/${brandId}/${Date.now()}_gacha_${direction.id}.png`;

          // Storage保存（非同期、エラー無視）
          try {
            const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
            await supabaseClient.storage
              .from('generated-images')
              .upload(fileName, imgBuffer, { contentType: 'image/png' });

            await supabaseClient.from('generated_images').insert({
              brand_id: brandId,
              user_id: user.id,
              storage_path: fileName,
              prompt: fullPrompt,
              model_used: 'gemini-2.0-flash-exp-image-generation',
              generation_params: { direction: direction.id, brief },
            });
          } catch (storageError) {
            console.log('⚠️ Storage warning:', storageError.message);
          }

          results.push({
            direction: direction.id,
            directionName: direction.name,
            imageUrl: imageDataUrl,
            storagePath: fileName,
            prompt: fullPrompt,
          });
          
          console.log(`✅ ${direction.name} generated`);
        }
      } else {
        console.log(`⚠️ Generation failed for ${direction.name}:`, JSON.stringify(generateData).substring(0, 200));
      }
    }

    if (results.length === 0) {
      throw new Error('画像の生成に失敗しました。しばらく待ってからもう一度お試しください。');
    }

    // Log API usage
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

    return new Response(
      JSON.stringify({
        success: true,
        brief,
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
