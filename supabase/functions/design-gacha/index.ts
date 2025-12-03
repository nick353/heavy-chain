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

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // Select random directions
    const selectedDirections = [...DESIGN_DIRECTIONS]
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(directions, DESIGN_DIRECTIONS.length));

    const results = [];

    for (const direction of selectedDirections) {
      const fullPrompt = `${brief}, ${direction.prompt}, professional fashion photography, high quality`;

      // Generate image with DALL-E 3
      const generateResponse = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: fullPrompt,
          n: 1,
          size: '1024x1024',
          quality: 'standard',
        }),
      });

      if (generateResponse.ok) {
        const data = await generateResponse.json();
        const generatedUrl = data.data[0].url;
        
        // Download and upload
        const imgResponse = await fetch(generatedUrl);
        const imgBuffer = await imgResponse.arrayBuffer();
        
        const fileName = `${user.id}/${brandId}/${Date.now()}_gacha_${direction.id}.png`;
        await supabaseClient.storage
          .from('generated-images')
          .upload(fileName, new Uint8Array(imgBuffer), {
            contentType: 'image/png',
          });

        const { data: urlData } = supabaseClient.storage
          .from('generated-images')
          .getPublicUrl(fileName);

        // Save to database
        await supabaseClient.from('generated_images').insert({
          brand_id: brandId,
          user_id: user.id,
          storage_path: fileName,
          prompt: fullPrompt,
          model_used: 'dall-e-3',
          generation_params: { direction: direction.id, brief },
        });

        results.push({
          direction: direction.id,
          directionName: direction.name,
          imageUrl: urlData.publicUrl,
          storagePath: fileName,
          prompt: fullPrompt,
        });
      }
    }

    // Log API usage
    await supabaseClient.from('api_usage_logs').insert({
      user_id: user.id,
      brand_id: brandId,
      provider: 'openai',
      tokens_used: results.length * 1000,
      cost_usd: results.length * 0.04,
    });

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


