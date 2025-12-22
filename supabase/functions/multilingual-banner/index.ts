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

    // Use Gemini for translation
    const translatePrompt = `Translate this fashion banner text for EC/retail marketing. Return JSON format.
    
Headline: ${headline}
Subheadline: ${subheadline || ''}

Languages needed: ${languages.join(', ')}

Return JSON: { "translations": { "ja": { "headline": "", "subheadline": "" }, "en": {...}, ... } }`;

    const translateResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: translatePrompt }] }],
          generationConfig: { temperature: 0.3 }
        }),
      }
    );

    const translateData = await translateResponse.json();
    const translationText = translateData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const translations = JSON.parse(translationText.replace(/```json\n?/g, '').replace(/```\n?/g, '')).translations;

    const selectedLanguages = LANGUAGES.filter(l => languages.includes(l.code));
    const results = [];

    for (const lang of selectedLanguages) {
      const translation = translations[lang.code];
      if (!translation) continue;

      const textContent = translation.subheadline 
        ? `"${translation.headline}" and "${translation.subheadline}"`
        : `"${translation.headline}"`;

      const bannerPrompt = `Create a professional fashion/retail banner image with text ${textContent}. ${style} style, aspect ratio ${aspectRatio}, high quality design for e-commerce.`;

      const generateResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: bannerPrompt }] }],
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
          
          const fileName = `${user.id}/${brandId}/${Date.now()}_banner_${lang.code}.png`;
          await supabaseClient.storage
            .from('generated-images')
            .upload(fileName, imgBuffer, {
              contentType: 'image/png',
            });

          const { data: urlData } = supabaseClient.storage
            .from('generated-images')
            .getPublicUrl(fileName);

          await supabaseClient.from('generated_images').insert({
            brand_id: brandId,
            user_id: user.id,
            storage_path: fileName,
            prompt: bannerPrompt,
            model_used: 'gemini-2.5-flash-image',
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
    }

    await supabaseClient.from('api_usage_logs').insert({
      user_id: user.id,
      brand_id: brandId,
      provider: 'gemini',
      tokens_used: results.length * 600,
      cost_usd: 0, // Gemini free tier
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
