import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
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

    // Get user
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { imageUrl, brandId } = await req.json();

    if (!imageUrl || !brandId) {
      throw new Error('Missing required parameters: imageUrl, brandId');
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    console.log('🔍 Analyzing image for background removal...');

    // Step 1: Fetch the original image and convert to base64
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));

    // Step 2: Analyze the image with Gemini Pro Vision to identify the subject
    const analysisResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { 
                text: 'Describe the main subject in this image in detail (ignore the background). Focus on: item type, color, material, style, key features, pose/angle. Be specific about the subject only.' 
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
            maxOutputTokens: 300
          }
        }),
      }
    );

    const analysisData = await analysisResponse.json();
    if (!analysisData.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Failed to analyze image');
    }

    const subjectDescription = analysisData.candidates[0].content.parts[0].text.trim();
    console.log('✅ Subject analysis complete:', subjectDescription);

    // Step 3: Generate image with transparent/white background using Gemini
    const noBgPrompt = `${subjectDescription}, isolated on pure white background, clean cutout style, no shadows, professional product photography, studio lighting, centered composition, PNG format ready`;

    console.log('🎨 Generating image with clean background...');

    const generateResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: noBgPrompt }] }],
          generationConfig: { 
            responseModalities: ["IMAGE", "TEXT"],
            temperature: 0.3
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
      throw new Error('Failed to generate image with clean background');
    }

    console.log('✅ Clean background image generated');

    // Step 4: Upload to Supabase Storage
    const imgBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
    const fileName = `${user.id}/${brandId}/${Date.now()}_nobg.png`;

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
      prompt: noBgPrompt,
      model_used: 'gemini-2.5-flash-image',
      generation_params: { 
        original_url: imageUrl,
        method: 'gemini-background-removal',
        subject: subjectDescription.substring(0, 200)
      },
    });

    // Log API usage
    await supabaseClient.from('api_usage_logs').insert({
      user_id: user.id,
      brand_id: brandId,
      provider: 'gemini',
      tokens_used: 600, // Analysis + Generation
      cost_usd: 0, // Gemini free tier
    });

    console.log('✅ Background removal complete');

    return new Response(
      JSON.stringify({
        success: true,
        imageUrl: urlData.publicUrl,
        storagePath: fileName,
        method: 'gemini-background-removal',
        subjectDescription
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
