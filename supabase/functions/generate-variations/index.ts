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

    const { imageUrl, brandId, prompt, count = 4 } = await req.json();

    if (!imageUrl || !brandId) {
      throw new Error('Missing required parameters');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // First, analyze the image with GPT-4 Vision
    const analysisResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Describe this fashion product image in detail for regeneration. Include: item type, color, style, composition, lighting, background. Be specific but concise.',
              },
              {
                type: 'image_url',
                image_url: { url: imageUrl },
              },
            ],
          },
        ],
        max_tokens: 300,
      }),
    });

    if (!analysisResponse.ok) {
      throw new Error('Failed to analyze image');
    }

    const analysisData = await analysisResponse.json();
    const description = analysisData.choices[0].message.content;

    // Generate variations with DALL-E 3
    const results = [];
    const variationPrompts = [
      `${description}. ${prompt || ''} Variation 1: slightly different angle`,
      `${description}. ${prompt || ''} Variation 2: different lighting`,
      `${description}. ${prompt || ''} Variation 3: slightly adjusted composition`,
      `${description}. ${prompt || ''} Variation 4: alternative styling`,
    ].slice(0, count);

    for (let i = 0; i < variationPrompts.length; i++) {
      const generateResponse = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: variationPrompts[i],
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
        
        const fileName = `${user.id}/${brandId}/${Date.now()}_var${i + 1}.png`;
        await supabaseClient.storage
          .from('generated-images')
          .upload(fileName, new Uint8Array(imgBuffer), {
            contentType: 'image/png',
          });

        const { data: urlData } = supabaseClient.storage
          .from('generated-images')
          .getPublicUrl(fileName);

        // Save to generated_images table
        await supabaseClient.from('generated_images').insert({
          brand_id: brandId,
          user_id: user.id,
          storage_path: fileName,
          prompt: variationPrompts[i],
          model_used: 'dall-e-3',
          generation_params: { variation: i + 1, originalImage: imageUrl },
        });

        results.push({
          index: i + 1,
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
      tokens_used: 500 + results.length * 1000, // Vision + DALL-E
      cost_usd: 0.01 + results.length * 0.04,
    });

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




