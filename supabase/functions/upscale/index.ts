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

    const { imageUrl, brandId, scale = 2 } = await req.json();

    if (!imageUrl || !brandId) {
      throw new Error('Missing required parameters: imageUrl, brandId');
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    console.log('🔍 Analyzing image for upscaling...');

    // Step 1: Fetch the original image and convert to base64
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));

    // Step 2: Analyze the image with Gemini Pro Vision
    const analysisResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { 
                text: 'Describe this image in extreme detail for recreation at higher resolution. Include: subject, colors, lighting, composition, textures, style, background, and all visual elements. Be very specific and detailed.' 
              },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: base64Image
                }
              }
            ]
          }],
          generationConfig: { 
            temperature: 0.4,
            maxOutputTokens: 500
          }
        }),
      }
    );

    const analysisData = await analysisResponse.json();
    if (!analysisData.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Failed to analyze image');
    }

    const detailedDescription = analysisData.candidates[0].content.parts[0].text.trim();
    console.log('✅ Image analysis complete');

    // Step 3: Generate high-resolution version with Gemini 2.5 Flash Image
    const upscalePrompt = `${detailedDescription}. Ultra high resolution, ${scale}x upscaled, 4K quality, extremely detailed, sharp focus, professional photography, maximum detail preservation, crystal clear`;

    console.log('🎨 Generating high-resolution image...');

    const generateResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: upscalePrompt }] }],
          generationConfig: { 
            responseModalities: ["IMAGE", "TEXT"],
            temperature: 0.3  // Lower temperature for more faithful recreation
          }
        }),
      }
    );

    const generateData = await generateResponse.json();
    let imageBase64 = null;

    if (generateData.candidates?.[0]?.content?.parts) {
      for (const part of generateData.candidates[0].content.parts) {
        if (part.inlineData?.data) {
          imageBase64 = part.inlineData.data;
          break;
        }
      }
    }

    if (!imageBase64) {
      throw new Error('Failed to generate upscaled image');
    }

    console.log('✅ High-resolution image generated');

    // Step 4: Upload to Supabase Storage
    const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
    const fileName = `${user.id}/${brandId}/${Date.now()}_upscaled_${scale}x.png`;

    const { error: uploadError } = await supabaseClient.storage
      .from('generated-images')
      .upload(fileName, imgBuffer, {
        contentType: 'image/png',
      });

    if (uploadError) {
      throw new Error(`Failed to upload: ${uploadError.message}`);
    }

    // Get public URL
    const { data: urlData } = supabaseClient.storage
      .from('generated-images')
      .getPublicUrl(fileName);

    // Save to database
    await supabaseClient.from('generated_images').insert({
      brand_id: brandId,
      user_id: user.id,
      storage_path: fileName,
      prompt: upscalePrompt,
      model_used: 'gemini-2.5-flash-image',
      generation_params: { 
        original_url: imageUrl, 
        scale,
        method: 'gemini-upscale',
        description: detailedDescription.substring(0, 200)
      },
    });

    // Log API usage
    await supabaseClient.from('api_usage_logs').insert({
      user_id: user.id,
      brand_id: brandId,
      provider: 'gemini',
      tokens_used: 700, // Analysis + Generation
      cost_usd: 0, // Gemini free tier
    });

    console.log('✅ Upscale complete');

    return new Response(
      JSON.stringify({
        success: true,
        imageUrl: urlData.publicUrl,
        storagePath: fileName,
        scale,
        method: 'gemini-upscale',
        originalDescription: detailedDescription
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
