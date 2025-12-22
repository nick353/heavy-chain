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

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    // Generate color variations using Gemini
    const colorPrompts = colors?.length > 0 
      ? colors 
      : ['red', 'blue', 'green', 'black', 'white'].slice(0, count);

    const results = [];

    for (const color of colorPrompts) {
      const prompt = `A fashion product photo in ${color} color. Professional product photography, clean background, studio lighting, high resolution, commercial quality.`;
      
      const generateResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
          }),
        }
      );

      if (generateResponse.ok) {
        const data = await generateResponse.json();
        let imageBase64 = null;
        
        if (data.candidates?.[0]?.content?.parts) {
          for (const part of data.candidates[0].content.parts) {
            if (part.inlineData?.data) {
              imageBase64 = part.inlineData.data;
              break;
            }
          }
        }

        if (imageBase64) {
          const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
          
          const fileName = `${user.id}/${brandId}/${Date.now()}_${color}.png`;
          await supabaseClient.storage
            .from('generated-images')
            .upload(fileName, imgBuffer, {
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






