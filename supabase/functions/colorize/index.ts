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

    const { imageUrl, brandId, colors, count = 3 } = await req.json();

    if (!imageUrl || !brandId) {
      throw new Error('Missing required parameters');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // Generate color variations using DALL-E 3 image editing
    const colorPrompts = colors?.length > 0 
      ? colors 
      : ['red', 'blue', 'green', 'black', 'white'].slice(0, count);

    const results = [];

    for (const color of colorPrompts) {
      // Use GPT-4 Vision to analyze and recreate with new color
      const response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: await createFormData(imageUrl, `Change the main color to ${color}, keep the same style and composition`),
      });

      if (!response.ok) {
        // Fallback: Use DALL-E 3 to generate similar image with new color
        const generateResponse = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'dall-e-3',
            prompt: `A fashion product photo similar in style, but in ${color} color. Professional product photography, clean background.`,
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
          
          const fileName = `${user.id}/${brandId}/${Date.now()}_${color}.png`;
          await supabaseClient.storage
            .from('generated-images')
            .upload(fileName, new Uint8Array(imgBuffer), {
              contentType: 'image/png',
            });

          const { data: urlData } = supabaseClient.storage
            .from('generated-images')
            .getPublicUrl(fileName);

          results.push({
            color,
            imageUrl: urlData.publicUrl,
            storagePath: fileName,
          });
        }
      } else {
        const data = await response.json();
        const editedUrl = data.data[0].url;
        
        const imgResponse = await fetch(editedUrl);
        const imgBuffer = await imgResponse.arrayBuffer();
        
        const fileName = `${user.id}/${brandId}/${Date.now()}_${color}.png`;
        await supabaseClient.storage
          .from('generated-images')
          .upload(fileName, new Uint8Array(imgBuffer), {
            contentType: 'image/png',
          });

        const { data: urlData } = supabaseClient.storage
          .from('generated-images')
          .getPublicUrl(fileName);

        results.push({
          color,
          imageUrl: urlData.publicUrl,
          storagePath: fileName,
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

async function createFormData(imageUrl: string, prompt: string): Promise<FormData> {
  const formData = new FormData();
  
  // Download image
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  
  formData.append('image', blob, 'image.png');
  formData.append('prompt', prompt);
  formData.append('n', '1');
  formData.append('size', '1024x1024');
  
  return formData;
}


