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

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // Optimize prompt using GPT-4
    const systemPrompt = `You are an expert fashion image prompt engineer. Your task is to optimize Japanese prompts for AI image generation (DALL-E 3, Stable Diffusion).

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
    "quality": "standard or hd"
  }
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Optimize this prompt: ${prompt}` },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to optimize prompt');
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

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



