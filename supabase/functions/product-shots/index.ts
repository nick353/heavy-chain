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

    const { productDescription, brandId, shots = ['front', 'side', 'back', 'detail'] } = await req.json();

    if (!productDescription || !brandId) {
      throw new Error('Missing required parameters');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const selectedShots = SHOT_TYPES.filter(s => shots.includes(s.id));
    const results = [];

    for (const shot of selectedShots) {
      const prompt = `${productDescription}, ${shot.angle}, professional product photography, clean white background, studio lighting, e-commerce ready, high resolution, commercial quality`;

      const generateResponse = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt,
          n: 1,
          size: '1024x1024',
          quality: 'hd',
        }),
      });

      if (generateResponse.ok) {
        const data = await generateResponse.json();
        const generatedUrl = data.data[0].url;
        
        const imgResponse = await fetch(generatedUrl);
        const imgBuffer = await imgResponse.arrayBuffer();
        
        const fileName = `${user.id}/${brandId}/${Date.now()}_product_${shot.id}.png`;
        await supabaseClient.storage
          .from('generated-images')
          .upload(fileName, new Uint8Array(imgBuffer), {
            contentType: 'image/png',
          });

        const { data: urlData } = supabaseClient.storage
          .from('generated-images')
          .getPublicUrl(fileName);

        await supabaseClient.from('generated_images').insert({
          brand_id: brandId,
          user_id: user.id,
          storage_path: fileName,
          prompt,
          model_used: 'dall-e-3',
          generation_params: { shotType: shot.id, productDescription },
        });

        results.push({
          shotType: shot.id,
          shotName: shot.name,
          imageUrl: urlData.publicUrl,
          storagePath: fileName,
        });
      }
    }

    await supabaseClient.from('api_usage_logs').insert({
      user_id: user.id,
      brand_id: brandId,
      provider: 'openai',
      tokens_used: results.length * 1000,
      cost_usd: results.length * 0.08, // HD quality
    });

    return new Response(
      JSON.stringify({
        success: true,
        productDescription,
        shots: results,
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

