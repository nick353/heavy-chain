import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { clientError, createServiceClient, requireBrandRole, type Database } from '../_shared/auth.ts';
import { completeBrandUsage, reserveBrandUsage, type UsageReservation } from '../_shared/usage.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';

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

type MultilingualBannerRequest = {
  headline?: string;
  subheadline?: string;
  brandId?: string;
  languages?: string[];
  style?: string;
  aspectRatio?: string;
};

serve(async (req) => {
  let usageReservation: UsageReservation | null = null;
  let observedBrandId: string | null = null;
  let observedUserId: string | null = null;
  let telemetryClient: any = null;
  const functionName = 'multilingual-banner';
  const requestId = requestIdFrom(req);
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient<Database>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );
    const supabaseService = createServiceClient();
    telemetryClient = supabaseService;

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
    }: MultilingualBannerRequest = await req.json();

    if (!headline || !brandId) {
      throw new Error('Missing required parameters');
    }

    await requireBrandRole(supabaseClient, brandId, user.id, 'editor');
    observedBrandId = brandId;
    observedUserId = user.id;
    usageReservation = await reserveBrandUsage(telemetryClient, {
      brandId,
      userId: user.id,
      functionName,
      units: 1,
      requestId,
      idempotencyKey: req.headers.get('idempotency-key'),
    });
    await recordEdgeFunctionRun(telemetryClient, {
      reservation: usageReservation,
      brandId,
      userId: user.id,
      functionName,
      status: 'started',
      requestId,
    });


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
    } catch {
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
          let storageUrl = '';

          try {
            const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
              const { error: uploadError } = await supabaseService.storage
              .from('generated-images')
              .upload(fileName, imgBuffer, { contentType: 'image/png' });

            if (!uploadError) {
              const { data: urlData } = await supabaseService.storage.from('generated-images').createSignedUrl(fileName, 60 * 60 * 24);
              storageUrl = urlData?.signedUrl || '';
              console.log('✅ Image uploaded to storage:', storageUrl);
            } else {
              console.log('⚠️ Storage upload error:', uploadError.message);
            }
          } catch (storageError) {
            console.log('⚠️ Storage warning:', clientError(storageError));
          }

          // Always save record with image_url as fallback
          try {
            await supabaseClient.from('generated_images').insert({
              brand_id: brandId,
              user_id: user.id,
              storage_path: fileName,
              image_url: null,
              prompt,
              feature_type: 'multilingual-banner',
              model_used: 'gemini-2.0-flash-exp-image-generation',
              generation_params: { 
                language: lang.code,
                headline: translation.headline,
                subheadline: translation.subheadline,
                style,
                aspectRatio
              },
            });
            console.log('✅ Image record saved to database');
          } catch (dbError) {
            console.log('⚠️ Database warning:', clientError(dbError));
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
      await supabaseService.from('api_usage_logs').insert({
        user_id: user.id,
        brand_id: brandId,
        provider: 'gemini',
        tokens_used: 500 + results.length * 500,
        cost_usd: 0,
      });
    } catch (e) {
      console.log('⚠️ Usage log warning:', clientError(e));
    }
    if (telemetryClient) {
      await completeBrandUsage(telemetryClient, usageReservation, 'succeeded');
      await recordEdgeFunctionRun(telemetryClient, {
        reservation: usageReservation,
        brandId: observedBrandId,
        userId: observedUserId,
        functionName,
        status: 'succeeded',
        requestId,
        durationMs: durationSince(startedAt),
      });
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
    if (telemetryClient) {
      await completeBrandUsage(telemetryClient, usageReservation, 'failed', { error: sanitizeError(error) });
      await recordEdgeFunctionRun(telemetryClient, {
        reservation: usageReservation,
        brandId: observedBrandId,
        userId: observedUserId,
        functionName,
        status: 'failed',
        requestId,
        durationMs: durationSince(startedAt),
        errorMessage: sanitizeError(error),
      });
    }

    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: clientError(error) }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
