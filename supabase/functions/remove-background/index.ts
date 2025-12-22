import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
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

    // Get user
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { imageUrl, brandId } = await req.json();

    if (!imageUrl || !brandId) {
      throw new Error('Missing required parameters: imageUrl, brandId');
    }

    // Use Replicate API for background removal (rembg model)
    const REPLICATE_API_KEY = Deno.env.get('REPLICATE_API_KEY');
    
    if (!REPLICATE_API_KEY) {
      // Fallback: Use remove.bg API
      const REMOVEBG_API_KEY = Deno.env.get('REMOVEBG_API_KEY');
      
      if (REMOVEBG_API_KEY) {
        const response = await fetch('https://api.remove.bg/v1.0/removebg', {
          method: 'POST',
          headers: {
            'X-Api-Key': REMOVEBG_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            image_url: imageUrl,
            size: 'auto',
            format: 'png',
          }),
        });

        if (!response.ok) {
          throw new Error(`Remove.bg API error: ${response.statusText}`);
        }

        const imageBuffer = await response.arrayBuffer();
        const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));

        // Upload to Supabase Storage
        const fileName = `${user.id}/${brandId}/${Date.now()}_nobg.png`;
        const { error: uploadError } = await supabaseClient.storage
          .from('generated-images')
          .upload(fileName, new Uint8Array(imageBuffer), {
            contentType: 'image/png',
          });

        if (uploadError) {
          throw new Error(`Failed to upload: ${uploadError.message}`);
        }

        // Get public URL
        const { data: urlData } = supabaseClient.storage
          .from('generated-images')
          .getPublicUrl(fileName);

        // Log API usage
        await supabaseClient.from('api_usage_logs').insert({
          user_id: user.id,
          brand_id: brandId,
          provider: 'removebg',
          tokens_used: 1,
          cost_usd: 0.01, // Approximate cost
        });

        return new Response(
          JSON.stringify({
            success: true,
            resultUrl: urlData.publicUrl,
            imageUrl: urlData.publicUrl,
            storagePath: fileName,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Use Replicate rembg model
    if (REPLICATE_API_KEY) {
      const prediction = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${REPLICATE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: 'fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003',
          input: {
            image: imageUrl,
          },
        }),
      });

      if (!prediction.ok) {
        throw new Error('Failed to start background removal');
      }

      const predictionData = await prediction.json();
      
      // Poll for completion
      let result = predictionData;
      while (result.status !== 'succeeded' && result.status !== 'failed') {
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
      }

      if (result.status === 'failed') {
        throw new Error('Background removal failed');
      }

      const outputUrl = result.output;

      // Download and upload to Supabase
      const imageResponse = await fetch(outputUrl);
      const imageBuffer = await imageResponse.arrayBuffer();

      const fileName = `${user.id}/${brandId}/${Date.now()}_nobg.png`;
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
        cost_usd: 0.005,
      });

      return new Response(
        JSON.stringify({
          success: true,
          resultUrl: urlData.publicUrl,
          imageUrl: urlData.publicUrl,
          storagePath: fileName,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    throw new Error('No background removal API configured');

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






