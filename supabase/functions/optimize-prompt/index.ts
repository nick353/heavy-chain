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

    const { prompt, style, targetPlatform } = await req.json();

    if (!prompt) {
      throw new Error('Missing required parameter: prompt');
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    // Optimize prompt using Gemini
    const systemPrompt = `You are an expert fashion image prompt engineer. Your task is to optimize Japanese prompts for AI image generation.

Rules:
1. Translate Japanese to English
2. Add specific fashion photography terms
3. Include lighting, composition, and style details
4. Optimize for the target platform/style if specified
5. Keep the core intent while enhancing quality

Target style: ${style || 'professional fashion photography'}
Target platform: ${targetPlatform || 'general'}

Output format:
{
  "optimized_prompt": "the optimized English prompt",
  "negative_prompt": "things to avoid",
  "style_tags": ["relevant", "style", "tags"],
  "suggested_settings": {
    "aspect_ratio": "1:1 or 16:9 etc",
    "quality": "standard or high"
  }
}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { 
              role: 'user',
              parts: [{ text: `${systemPrompt}\n\nOptimize this prompt: ${prompt}` }] 
            }
          ],
          generationConfig: { 
            temperature: 0.7,
            topP: 0.9,
            topK: 40
          }
        }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to optimize prompt');
    }

    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const result = JSON.parse(resultText.replace(/```json\n?/g, '').replace(/```\n?/g, ''));

    return new Response(
      JSON.stringify({
        success: true,
        original: prompt,
        ...result,
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
