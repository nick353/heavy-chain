import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SHOT_TYPES = [
  { id: 'front', name: '正面', angle: 'front view, facing camera directly' },
  { id: 'side', name: '側面', angle: 'side view, profile, 90 degree angle' },
  { id: 'back', name: '背面', angle: 'back view, rear, showing back details' },
  { id: 'detail', name: 'ディテール', angle: 'close-up detail shot, macro, texture focus' },
  { id: '45deg', name: '斜め45度', angle: '45 degree angle, three-quarter view' },
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

    const body = await req.json();
    console.log('📥 Received request body:', JSON.stringify(body, null, 2));
    
    const { productDescription, brandId, shots = ['front', 'side', 'back', 'detail'], imageUrl, referenceImage } = body;

    // Validate required parameters
    if (!brandId) {
      console.error('❌ Missing brandId');
      throw new Error('ブランドIDが指定されていません');
    }
    
    // Either productDescription or imageUrl/referenceImage is required
    const hasDescription = productDescription && productDescription.trim() !== '';
    const hasImage = imageUrl || referenceImage;
    
    if (!hasDescription && !hasImage) {
      console.error('❌ Missing both productDescription and image');
      throw new Error('商品説明または商品画像を入力してください');
    }
    
    console.log('✅ Parameters validated:', { 
      hasDescription, 
      hasImage, 
      productDescription: hasDescription ? productDescription : 'will analyze from image',
      brandId, 
      shots 
    });

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    // If no description but has image, analyze the image first
    let finalDescription = productDescription;
    if (!hasDescription && hasImage) {
      console.log('🔍 Analyzing product image with Gemini...');
      const imageToAnalyze = imageUrl || referenceImage;
      
      try {
        // First, fetch the image and convert to base64
        const imageResponse = await fetch(imageToAnalyze);
        if (!imageResponse.ok) {
          throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
        }
        
        const imageBuffer = await imageResponse.arrayBuffer();
        const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
        
        // Use Gemini 1.5 Flash to analyze the image
        const analysisResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: 'Describe this fashion product in detail for product photography. Include: item type, color, material, style, key features. Be concise but specific. Focus on visual details that would be important for e-commerce product shots.' },
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: base64Image
                    }
                  }
                ]
              }],
              generationConfig: { 
                temperature: 0.4,
                maxOutputTokens: 200
              }
            }),
          }
        );

        if (!analysisResponse.ok) {
          const errorText = await analysisResponse.text();
          console.error('❌ Gemini API error:', errorText);
          throw new Error(`Gemini API error: ${analysisResponse.status}`);
        }

        const analysisData = await analysisResponse.json();
        console.log('📄 Gemini response:', JSON.stringify(analysisData, null, 2));
        
        if (analysisData.candidates?.[0]?.content?.parts?.[0]?.text) {
          finalDescription = analysisData.candidates[0].content.parts[0].text.trim();
          console.log('✅ Image analysis complete:', finalDescription);
        } else {
          console.error('❌ No text in Gemini response');
          throw new Error('画像の分析結果が取得できませんでした');
        }
      } catch (e) {
        console.error('❌ Image analysis error:', e);
        throw new Error('画像の分析中にエラーが発生しました: ' + e.message + '. 商品説明を入力してお試しください。');
      }
    }
    
    console.log('🎨 Generating product shots with description:', finalDescription);

    const selectedShots = SHOT_TYPES.filter(s => shots.includes(s.id));
    const results = [];

    for (const shot of selectedShots) {
      const prompt = `${finalDescription}, ${shot.angle}, professional product photography, clean white background, studio lighting, e-commerce ready, high resolution, commercial quality`;

      // Generate with Gemini
      const generateResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
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
          
          const fileName = `${user.id}/${brandId}/${Date.now()}_product_${shot.id}.png`;
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
            prompt,
            model_used: 'gemini-2.5-flash-image',
            generation_params: { shotType: shot.id, productDescription: finalDescription },
          });

          results.push({
            shotType: shot.id,
            shotName: shot.name,
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
      tokens_used: results.length * 500,
      cost_usd: 0, // Gemini free tier
    });

    return new Response(
      JSON.stringify({
        success: true,
        productDescription: finalDescription,
        analyzedFromImage: !hasDescription && hasImage,
        shots: results,
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
