import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LANGUAGES = [
  { code: 'ja', name: '日本語' },
  { code: 'en', name: 'English' },
  { code: 'zh', name: '中文' },
  { code: 'ko', name: '한국어' },
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
      headline,
      subheadline,
      brandId, 
      languages = ['ja', 'en', 'zh', 'ko'],
      style = 'modern',
      aspectRatio = '1:1'
    } = await req.json();

    if (!headline || !brandId) {
      throw new Error('Missing required parameters');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // First, translate the text
    const translateResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a professional translator for fashion/retail marketing. Translate the given text naturally for each market. Return JSON format.',
          },
          {
            role: 'user',
            content: `Translate this for EC banners:
Headline: ${headline}
Subheadline: ${subheadline || ''}

Languages needed: ${languages.join(', ')}

Return JSON: { "translations": { "ja": { "headline": "", "subheadline": "" }, "en": {...}, ... } }`,
          },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    const translateData = await translateResponse.json();
    const translations = JSON.parse(translateData.choices[0].message.content).translations;

    const selectedLanguages = LANGUAGES.filter(l => languages.includes(l.code));
    const results = [];

    // Determine size based on aspect ratio
    const size = aspectRatio === '16:9' ? '1792x1024' : 
                 aspectRatio === '9:16' ? '1024x1792' : '1024x1024';

    for (const lang of selectedLanguages) {
      const translation = translations[lang.code];
      if (!translation) continue;

      const textContent = translation.subheadline 
        ? `"${translation.headline}" and "${translation.subheadline}"`
        : `"${translation.headline}"`;

      const prompt = `Fashion e-commerce banner with text ${textContent} in ${lang.name}, ${style} design style, clean layout, professional typography, promotional banner, eye-catching, high contrast text`;

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
          size,
          quality: 'standard',
        }),
      });

      if (generateResponse.ok) {
        const data = await generateResponse.json();
        const generatedUrl = data.data[0].url;
        
        const imgResponse = await fetch(generatedUrl);
        const imgBuffer = await imgResponse.arrayBuffer();
        
        const fileName = `${user.id}/${brandId}/${Date.now()}_banner_${lang.code}.png`;
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
            language: lang.code,
            headline: translation.headline,
            subheadline: translation.subheadline,
            style,
            aspectRatio
          },
        });

        results.push({
          language: lang.code,
          languageName: lang.name,
          headline: translation.headline,
          subheadline: translation.subheadline,
          imageUrl: urlData.publicUrl,
          storagePath: fileName,
        });
      }
    }

    await supabaseClient.from('api_usage_logs').insert({
      user_id: user.id,
      brand_id: brandId,
      provider: 'openai',
      tokens_used: 500 + results.length * 1000, // Translation + Images
      cost_usd: 0.01 + results.length * 0.04,
    });

    return new Response(
      JSON.stringify({
        success: true,
        originalHeadline: headline,
        originalSubheadline: subheadline,
        banners: results,
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


