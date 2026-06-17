import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { clientError, createServiceClient, requireImageRole, type Database } from '../_shared/auth.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  let telemetryClient: any = null;
  let observedBrandId: string | null = null;
  let observedUserId: string | null = null;
  const functionName = 'share-link';
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

    const { imageId, expiresInDays = 7 } = await req.json();

    if (!imageId) {
      throw new Error('Missing required parameter: imageId');
    }

    const image = await requireImageRole(supabaseClient, imageId, user.id, 'editor');
    observedBrandId = image.brand_id;
    observedUserId = user.id;
    await recordEdgeFunctionRun(supabaseService, {
      brandId: image.brand_id,
      userId: user.id,
      functionName,
      status: 'started',
      requestId,
      metadata: { imageId },
    });

    // Generate unique token
    const token = crypto.randomUUID().replace(/-/g, '');

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Create share link record
    const { error: insertError } = await supabaseClient
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

    await recordEdgeFunctionRun(supabaseService, {
      brandId: image.brand_id,
      userId: user.id,
      functionName,
      status: 'succeeded',
      requestId,
      durationMs: durationSince(startedAt),
      metadata: { imageId },
    });

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
    if (telemetryClient) {
      await recordEdgeFunctionRun(telemetryClient, {
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

// Also handle GET for retrieving shared image (public access)


