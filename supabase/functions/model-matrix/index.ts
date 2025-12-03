import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BODY_TYPES = [
  { id: 'slim', name: 'スリム', prompt: 'slim fit, lean body type' },
  { id: 'regular', name: 'レギュラー', prompt: 'regular fit, average body type' },
  { id: 'plus', name: 'プラス', prompt: 'plus size, curvy body type' },
];

const AGE_GROUPS = [
  { id: '20s', name: '20代', prompt: 'young adult in their 20s' },
  { id: '30s', name: '30代', prompt: 'adult in their 30s' },
  { id: '40s', name: '40代', prompt: 'mature adult in their 40s' },
  { id: '50s', name: '50代', prompt: 'elegant adult in their 50s' },
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

    const { 
      productDescription, 
      brandId, 
      bodyTypes = ['slim', 'regular', 'plus'],
      ageGroups = ['20s', '30s', '40s'],
      gender = 'female'
    } = await req.json();

    if (!productDescription || !brandId) {
      throw new Error('Missing required parameters');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const selectedBodyTypes = BODY_TYPES.filter(b => bodyTypes.includes(b.id));
    const selectedAgeGroups = AGE_GROUPS.filter(a => ageGroups.includes(a.id));
    const results = [];

    // Generate matrix
    for (const bodyType of selectedBodyTypes) {
      for (const ageGroup of selectedAgeGroups) {
        const prompt = `${gender} model wearing ${productDescription}, ${bodyType.prompt}, ${ageGroup.prompt}, fashion photography, full body shot, professional studio lighting, neutral background`;

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
            quality: 'standard',
          }),
        });

        if (generateResponse.ok) {
          const data = await generateResponse.json();
          const generatedUrl = data.data[0].url;
          
          const imgResponse = await fetch(generatedUrl);
          const imgBuffer = await imgResponse.arrayBuffer();
          
          const fileName = `${user.id}/${brandId}/${Date.now()}_matrix_${bodyType.id}_${ageGroup.id}.png`;
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
            generation_params: { 
              bodyType: bodyType.id, 
              ageGroup: ageGroup.id,
              gender,
              productDescription 
            },
          });

          results.push({
            bodyType: bodyType.id,
            bodyTypeName: bodyType.name,
            ageGroup: ageGroup.id,
            ageGroupName: ageGroup.name,
            imageUrl: urlData.publicUrl,
            storagePath: fileName,
          });
        }
      }
    }

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
        productDescription,
        matrix: results,
        dimensions: {
          bodyTypes: selectedBodyTypes.map(b => ({ id: b.id, name: b.name })),
          ageGroups: selectedAgeGroups.map(a => ({ id: a.id, name: a.name })),
        },
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

