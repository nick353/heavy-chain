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

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    // Translate using Gemini
    console.log('🌐 Translating text...');
    const translateResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are a professional translator for fashion/retail marketing. Translate this for EC banners:
Headline: ${headline}
Subheadline: ${subheadline || ''}

Languages needed: ${languages.join(', ')}

Return ONLY valid JSON (no markdown): { "translations": { "ja": { "headline": "", "subheadline": "" }, "en": {...}, "zh": {...}, "ko": {...} } }`
            }]
          }],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: "application/json"
          }
        }),
      }
    );

    const translateData = await translateResponse.json();
    let translations: any = {};
    
    try {
      const responseText = translateData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const parsed = JSON.parse(responseText);
      translations = parsed.translations || {};
    } catch (e) {
      console.log('⚠️ Translation parse error, using original text');
      languages.forEach(lang => {
        translations[lang] = { headline, subheadline };
      });
    }

    const selectedLanguages = LANGUAGES.filter(l => languages.includes(l.code));
    const results = [];

    for (const lang of selectedLanguages) {
      const translation = translations[lang.code] || { headline, subheadline };

      const textContent = translation.subheadline 
        ? `"${translation.headline}" and "${translation.subheadline}"`
        : `"${translation.headline}"`;

      const prompt = `Fashion e-commerce banner with text ${textContent} in ${lang.name}, ${style} design style, clean layout, professional typography, promotional banner, eye-catching, high contrast text, high quality`;

      console.log(`🎨 Generating ${lang.name} banner...`);

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
          const fileName = `${user.id}/${brandId}/${Date.now()}_banner_${lang.code}.png`;

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
                language: lang.code,
                headline: translation.headline,
                subheadline: translation.subheadline,
                style,
                aspectRatio
              },
            });
          } catch (storageError) {
            console.log('⚠️ Storage warning:', storageError.message);
          }

          results.push({
            language: lang.code,
            languageName: lang.name,
            headline: translation.headline,
            subheadline: translation.subheadline,
            imageUrl: imageDataUrl,
            storagePath: fileName,
          });
          
          console.log(`✅ ${lang.name} banner generated`);
        }
      }
    }

    if (results.length === 0) {
      throw new Error('バナーの生成に失敗しました。しばらく待ってからもう一度お試しください。');
    }

    try {
      await supabaseClient.from('api_usage_logs').insert({
        user_id: user.id,
        brand_id: brandId,
        provider: 'gemini',
        tokens_used: 500 + results.length * 500,
        cost_usd: 0,
      });
    } catch (e) {
      console.log('⚠️ Usage log warning:', e.message);
    }

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
