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

    const { imageId, expiresInDays = 7 } = await req.json();

    if (!imageId) {
      throw new Error('Missing required parameter: imageId');
    }

    // Verify image belongs to user's brand
    const { data: image, error: imageError } = await supabaseClient
      .from('generated_images')
      .select('id, storage_path, brand_id')
      .eq('id', imageId)
      .single();

    if (imageError || !image) {
      throw new Error('Image not found');
    }

    // Generate unique token
    const token = crypto.randomUUID().replace(/-/g, '');

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Create share link record
    const { data: shareLink, error: insertError } = await supabaseClient
      .from('share_links')
      .insert({
        image_id: imageId,
        token,
        expires_at: expiresAt.toISOString(),
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Generate the shareable URL
    const baseUrl = Deno.env.get('PUBLIC_URL') || 'https://your-app.com';
    const shareUrl = `${baseUrl}/share/${token}`;

    return new Response(
      JSON.stringify({
        success: true,
        shareUrl,
        token,
        expiresAt: expiresAt.toISOString(),
        expiresInDays,
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

// Also handle GET for retrieving shared image (public access)



