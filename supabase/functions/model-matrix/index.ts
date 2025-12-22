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

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    const selectedBodyTypes = BODY_TYPES.filter(b => bodyTypes.includes(b.id));
    const selectedAgeGroups = AGE_GROUPS.filter(a => ageGroups.includes(a.id));
    const results = [];

    // Generate matrix
    for (const bodyType of selectedBodyTypes) {
      for (const ageGroup of selectedAgeGroups) {
        const prompt = `${gender} model wearing ${productDescription}, ${bodyType.prompt}, ${ageGroup.prompt}, fashion photography, full body shot, professional studio lighting, neutral background, high quality`;

        console.log(`🎨 Generating ${bodyType.name} x ${ageGroup.name}...`);

        const generateResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
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
            const imageDataUrl = `data:image/png;base64,${imageBase64}`;
            const fileName = `${user.id}/${brandId}/${Date.now()}_matrix_${bodyType.id}_${ageGroup.id}.png`;

            try {
              const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
              await supabaseClient.storage
                .from('generated-images')
                .upload(fileName, imgBuffer, { contentType: 'image/png' });

              await supabaseClient.from('generated_images').insert({
                brand_id: brandId,
                user_id: user.id,
                storage_path: fileName,
                prompt,
                model_used: 'gemini-2.0-flash-exp-image-generation',
                generation_params: { 
                  bodyType: bodyType.id, 
                  ageGroup: ageGroup.id,
                  gender,
                  productDescription 
                },
              });
            } catch (storageError) {
              console.log('⚠️ Storage warning:', storageError.message);
            }

            results.push({
              bodyType: bodyType.id,
              bodyTypeName: bodyType.name,
              ageGroup: ageGroup.id,
              ageGroupName: ageGroup.name,
              imageUrl: imageDataUrl,
              storagePath: fileName,
            });
            
            console.log(`✅ ${bodyType.name} x ${ageGroup.name} generated`);
          }
        }
      }
    }

    if (results.length === 0) {
      throw new Error('画像の生成に失敗しました。しばらく待ってからもう一度お試しください。');
    }

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
