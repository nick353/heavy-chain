import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { clientError, createServiceClient, requireBrandRole, type Database } from '../_shared/auth.ts';
import { completeBrandUsage, reserveBrandUsage, type UsageReservation } from '../_shared/usage.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';
import { geminiAnalysisModel, geminiGenerateContentUrl, geminiImageModel } from '../_shared/geminiModels.ts';

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

type BannerDimensions = {
  width: number;
  height: number;
};

type FittedText = {
  lines: string[];
  fontSize: number;
};

const TEXT_FIT_WEIGHT_SAFETY = 0.82;

function bannerDimensions(aspectRatio: string): BannerDimensions {
  switch (aspectRatio) {
    case '16:9':
      return { width: 1600, height: 900 };
    case '4:5':
      return { width: 1200, height: 1500 };
    case '9:16':
      return { width: 1080, height: 1920 };
    case '1:1':
    default:
      return { width: 1200, height: 1200 };
  }
}

function normalizeCopy(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeForComparison(value: unknown): string {
  return normalizeCopy(value).toLocaleLowerCase();
}

function dedupeSubheadline(headline: unknown, subheadline: unknown): string {
  const cleanSubheadline = normalizeCopy(subheadline);
  if (!cleanSubheadline) return '';
  return normalizeForComparison(headline) === normalizeForComparison(cleanSubheadline) ? '' : cleanSubheadline;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function textWeight(value: string): number {
  return Array.from(value).reduce((sum, char) => {
    if (/\s/.test(char)) return sum + 0.32;
    if (/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(char)) return sum + 1;
    if (/[A-Z0-9]/.test(char)) return sum + 0.68;
    if (/[.,:;'"!?()[\]{}&/-]/.test(char)) return sum + 0.42;
    return sum + 0.62;
  }, 0);
}

function trimToWeight(value: string, maxWeight: number): string {
  const ellipsisWeight = textWeight('…');
  let trimmed = '';
  for (const char of Array.from(value)) {
    if (textWeight(`${trimmed}${char}`) + ellipsisWeight > maxWeight) break;
    trimmed += char;
  }
  return `${trimmed || Array.from(value)[0] || ''}…`;
}

function splitTokenToWeight(token: string, maxWeight: number): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const char of Array.from(token)) {
    const candidate = `${current}${char}`;
    if (current && textWeight(candidate) > maxWeight) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function wrapText(value: string, maxWeight: number, maxLines: number): string[] {
  const text = normalizeCopy(value);
  if (!text) return [];

  const words = text.includes(' ') ? text.split(' ') : Array.from(text);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const separator = text.includes(' ') && current ? ' ' : '';
    const candidate = `${current}${separator}${word}`;
    if (current && textWeight(candidate) > maxWeight) {
      lines.push(current);
      if (textWeight(word) > maxWeight) {
        const chunks = splitTokenToWeight(word, maxWeight);
        lines.push(...chunks.slice(0, -1));
        current = chunks[chunks.length - 1] || '';
      } else {
        current = word;
      }
    } else {
      if (!current && textWeight(word) > maxWeight) {
        const chunks = splitTokenToWeight(word, maxWeight);
        lines.push(...chunks.slice(0, -1));
        current = chunks[chunks.length - 1] || '';
      } else {
        current = candidate;
      }
    }
  }

  if (current) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    const visibleLines = lines.slice(0, maxLines);
    visibleLines[maxLines - 1] = trimToWeight(visibleLines[maxLines - 1], maxWeight);
    return visibleLines;
  }

  return lines;
}

function fitWrappedText(value: string, maxWidth: number, baseFontSize: number, minFontSize: number, maxLines: number): FittedText {
  for (let fontSize = baseFontSize; fontSize >= minFontSize; fontSize -= 2) {
    const maxWeight = (maxWidth / fontSize) * TEXT_FIT_WEIGHT_SAFETY;
    const lines = wrapText(value, maxWeight, maxLines);
    const didTruncate = lines.some((line) => line.endsWith('…'));
    if (!didTruncate && lines.every((line) => textWeight(line) <= maxWeight)) {
      return { lines, fontSize };
    }
  }

  const fontSize = minFontSize;
  const maxWeight = (maxWidth / fontSize) * TEXT_FIT_WEIGHT_SAFETY;
  return { lines: wrapText(value, maxWeight, maxLines), fontSize };
}

function base64EncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.slice(i, i + 0x8000)));
  }
  return btoa(chunks.join(''));
}

function buildBannerSvg(params: {
  backgroundBase64: string;
  backgroundMimeType: string;
  headline: string;
  subheadline: string;
  aspectRatio: string;
}): string {
  const { width, height } = bannerDimensions(params.aspectRatio);
  const minDimension = Math.min(width, height);
  const textWidth = Math.round(width * (width > height ? 0.76 : 0.72));
  const headlineFit = fitWrappedText(
    params.headline,
    textWidth,
    Math.round(minDimension * (width > height ? 0.078 : 0.074)),
    Math.round(minDimension * 0.052),
    height > width ? 4 : 3,
  );
  const subheadlineFit = fitWrappedText(
    params.subheadline,
    textWidth,
    Math.round(minDimension * 0.036),
    Math.round(minDimension * 0.028),
    2,
  );
  const headlineLines = headlineFit.lines;
  const subheadlineLines = subheadlineFit.lines;
  const headlineFontSize = headlineFit.fontSize;
  const subheadlineFontSize = subheadlineFit.fontSize;
  const lineGap = Math.round(headlineFontSize * 1.12);
  const subLineGap = Math.round(subheadlineFontSize * 1.25);
  const blockHeight =
    Math.max(0, headlineLines.length - 1) * lineGap +
    headlineFontSize +
    (subheadlineLines.length ? Math.round(subheadlineFontSize * 1.35) + Math.max(0, subheadlineLines.length - 1) * subLineGap + subheadlineFontSize : 0);
  const startY = Math.round((height - blockHeight) / 2 + headlineFontSize * 0.72);
  const centerX = Math.round(width / 2);

  const headlineMarkup = headlineLines.map((line, index) =>
    `<tspan x="${centerX}" dy="${index === 0 ? 0 : lineGap}">${escapeXml(line)}</tspan>`
  ).join('');
  const subheadlineStartY = startY + Math.max(0, headlineLines.length - 1) * lineGap + Math.round(subheadlineFontSize * 1.95);
  const subheadlineMarkup = subheadlineLines.map((line, index) =>
    `<tspan x="${centerX}" dy="${index === 0 ? 0 : subLineGap}">${escapeXml(line)}</tspan>`
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(params.headline)}">
  <defs>
    <linearGradient id="textShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0.18"/>
      <stop offset="52%" stop-color="#000" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.18"/>
    </linearGradient>
  </defs>
  <image href="data:${escapeXml(params.backgroundMimeType)};base64,${params.backgroundBase64}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${width}" height="${height}" fill="url(#textShade)"/>
  <rect x="${Math.round((width - textWidth) / 2)}" y="${Math.round(startY - headlineFontSize * 1.28)}" width="${textWidth}" height="${Math.round(blockHeight + headlineFontSize * 0.9)}" rx="${Math.round(Math.min(width, height) * 0.035)}" fill="#000" opacity="0.22"/>
  <text x="${centerX}" y="${startY}" text-anchor="middle" fill="#fff" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Noto Sans JP', 'Noto Sans CJK JP', 'Noto Sans KR', 'Noto Sans SC', sans-serif" font-size="${headlineFontSize}" font-weight="800" letter-spacing="0">${headlineMarkup}</text>
  ${subheadlineMarkup ? `<text x="${centerX}" y="${subheadlineStartY}" text-anchor="middle" fill="#fff" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Noto Sans JP', 'Noto Sans CJK JP', 'Noto Sans KR', 'Noto Sans SC', sans-serif" font-size="${subheadlineFontSize}" font-weight="500" letter-spacing="0">${subheadlineMarkup}</text>` : ''}
</svg>`;
}

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
    const analysisModel = geminiAnalysisModel();
    const imageModel = geminiImageModel();

    // Translate using Gemini
    console.log('🌐 Translating text...');
    const translateResponse = await fetch(
      geminiGenerateContentUrl(analysisModel, GEMINI_API_KEY),
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
      const translatedHeadline = normalizeCopy(translation.headline || headline);
      const translatedSubheadline = dedupeSubheadline(translatedHeadline, translation.subheadline ?? subheadline);
      const prompt = `Fashion e-commerce banner background, ${style} design style, clean commercial layout, apparel retail campaign visual, eye-catching composition, high quality, text-free, no letters, no words, no typography, no logo, no signage`;

      console.log(`🎨 Generating ${lang.name} banner...`);

      const generateResponse = await fetch(
        geminiGenerateContentUrl(imageModel, GEMINI_API_KEY),
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
        let imageMimeType = 'image/png';
        for (const part of generateData.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            imageBase64 = part.inlineData.data;
            imageMimeType = part.inlineData.mimeType || imageMimeType;
            break;
          }
        }

        if (imageBase64) {
          const composedSvg = buildBannerSvg({
            backgroundBase64: imageBase64,
            backgroundMimeType: imageMimeType,
            headline: translatedHeadline,
            subheadline: translatedSubheadline,
            aspectRatio,
          });
          const svgDataUrl = `data:image/svg+xml;base64,${base64EncodeUtf8(composedSvg)}`;
          const fileName = `${user.id}/${brandId}/${Date.now()}_banner_${lang.code}.svg`;
          let storageUrl = '';

          try {
            const svgBuffer = new TextEncoder().encode(composedSvg);
            const { error: uploadError } = await supabaseService.storage
              .from('generated-images')
              .upload(fileName, svgBuffer, { contentType: 'image/svg+xml' });

            if (uploadError) {
              throw uploadError;
            }

            const { data: urlData, error: signedUrlError } = await supabaseService.storage
              .from('generated-images')
              .createSignedUrl(fileName, 60 * 60 * 24);

            if (signedUrlError || !urlData?.signedUrl) {
              console.log('⚠️ Signed URL warning:', signedUrlError?.message || 'signed URL was not returned');
            } else {
              storageUrl = urlData.signedUrl;
            }
            console.log('✅ Image uploaded to storage:', fileName);
          } catch (storageError) {
            console.log('❌ Storage upload error:', clientError(storageError));
            throw new Error(`Generated banner could not be saved to storage: ${clientError(storageError)}`);
          }

          try {
            const { error: imageInsertError } = await supabaseClient.from('generated_images').insert({
              brand_id: brandId,
              user_id: user.id,
              storage_path: fileName,
              image_url: null,
              prompt,
              feature_type: 'multilingual-banner',
              model_used: imageModel,
              generation_params: { 
                language: lang.code,
                headline: translatedHeadline,
                subheadline: translatedSubheadline,
                style,
                aspectRatio,
                backgroundMimeType: imageMimeType,
              },
            });
            if (imageInsertError) {
              throw imageInsertError;
            }
            console.log('✅ Image record saved to database');
          } catch (dbError) {
            console.log('❌ Database insert error:', clientError(dbError));
            throw new Error(`Generated banner record could not be saved: ${clientError(dbError)}`);
          }

          results.push({
            language: lang.code,
            languageName: lang.name,
            headline: translatedHeadline,
            subheadline: translatedSubheadline,
            imageUrl: storageUrl || svgDataUrl,
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
