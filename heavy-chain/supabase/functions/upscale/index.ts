import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const REPLICATE_API_KEY = Deno.env.get('REPLICATE_API_KEY');
    
    if (!REPLICATE_API_KEY) {
      throw new Error('Replicate API key not configured');
    }

    // Use Real-ESRGAN model for upscaling
    const prediction = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${REPLICATE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Real-ESRGAN model
        version: '42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b',
        input: {
          image: imageUrl,
          scale: scale,
          face_enhance: false,
        },
      }),
    });

    if (!prediction.ok) {
      throw new Error('Failed to start upscaling');
    }

    const predictionData = await prediction.json();
    
    // Poll for completion
    let result = predictionData;
    let attempts = 0;
    const maxAttempts = 60; // Max 60 seconds

    while (result.status !== 'succeeded' && result.status !== 'failed' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const pollResponse = await fetch(
        `https://api.replicate.com/v1/predictions/${result.id}`,
        {
          headers: {
            'Authorization': `Token ${REPLICATE_API_KEY}`,
          },
        }
      );
      result = await pollResponse.json();
      attempts++;
    }

    if (result.status === 'failed') {
      throw new Error('Upscaling failed');
    }

    if (result.status !== 'succeeded') {
      throw new Error('Upscaling timed out');
    }

    const outputUrl = result.output;

    // Download and upload to Supabase
    const imageResponse = await fetch(outputUrl);
    const imageBuffer = await imageResponse.arrayBuffer();

    const fileName = `${user.id}/${brandId}/${Date.now()}_upscaled_${scale}x.png`;
    const { error: uploadError } = await supabaseClient.storage
      .from('generated-images')
      .upload(fileName, new Uint8Array(imageBuffer), {
        contentType: 'image/png',
      });

    if (uploadError) {
      throw new Error(`Failed to upload: ${uploadError.message}`);
    }

    const { data: urlData } = supabaseClient.storage
      .from('generated-images')
      .getPublicUrl(fileName);

    // Log API usage
    await supabaseClient.from('api_usage_logs').insert({
      user_id: user.id,
      brand_id: brandId,
      provider: 'replicate',
      tokens_used: 1,
      cost_usd: scale === 4 ? 0.02 : 0.01,
    });

    return new Response(
      JSON.stringify({
        success: true,
        resultUrl: urlData.publicUrl,
        imageUrl: urlData.publicUrl,
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






