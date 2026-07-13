import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { clientError, createServiceClient, requireImageRole, type Database } from '../_shared/auth.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const generatedImagesBucket = 'generated-images';
const publicShareEnabled = () => Deno.env.get('HEAVY_CHAIN_PUBLIC_SHARE_ENABLED') === 'true';

const readToken = (req: Request) => {
  const url = new URL(req.url);
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken.trim();

  const pathToken = url.pathname.split('/').filter(Boolean).pop();
  return pathToken && pathToken !== 'share-link' ? pathToken.trim() : '';
};

const resolvePublicImageUrl = async (
  supabaseService: ReturnType<typeof createServiceClient>,
  image: { storage_path: string | null; image_url: string | null },
) => {
  if (image.image_url && /^(https?:|data:)/i.test(image.image_url)) {
    return image.image_url;
  }

  if (image.storage_path && /^(https?:|data:)/i.test(image.storage_path)) {
    return image.storage_path;
  }

  if (!image.storage_path) {
    throw new Error('Shared image has no storage path');
  }

  const { data, error } = await supabaseService
    .storage
    .from(generatedImagesBucket)
    .createSignedUrl(image.storage_path, 60 * 60);

  if (error || !data?.signedUrl) {
    throw error ?? new Error('Failed to create signed image URL');
  }

  return data.signedUrl;
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
    const supabaseService = createServiceClient();
    telemetryClient = supabaseService;

    if (req.method === 'GET') {
      if (!publicShareEnabled()) {
        return new Response(
          JSON.stringify({ success: false, error: 'external_public_sharing_disabled_pending_h602' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const token = readToken(req);
      if (!token) {
        return new Response(
          JSON.stringify({ success: false, error: 'Missing share token' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const { data: shareLink, error: shareError } = await supabaseService
        .from('share_links')
        .select('image_id, token, expires_at, created_at')
        .eq('token', token)
        .single();

      if (shareError || !shareLink) {
        return new Response(
          JSON.stringify({ success: false, error: 'Share link not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      if (new Date(shareLink.expires_at).getTime() <= Date.now()) {
        return new Response(
          JSON.stringify({ success: false, error: 'Share link expired' }),
          { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const { data: image, error: imageError } = await supabaseService
        .from('generated_images')
        .select('id, brand_id, storage_path, image_url, prompt, negative_prompt, feature_type, style_preset, model_used, generation_params, metadata, created_at')
        .eq('id', shareLink.image_id)
        .single();

      if (imageError || !image) {
        return new Response(
          JSON.stringify({ success: false, error: 'Shared image not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      observedBrandId = image.brand_id;
      await recordEdgeFunctionRun(supabaseService, {
        brandId: image.brand_id,
        userId: null,
        functionName,
        status: 'started',
        requestId,
        metadata: { token, imageId: image.id, publicRead: true },
      });

      const imageUrl = await resolvePublicImageUrl(supabaseService, image);

      await recordEdgeFunctionRun(supabaseService, {
        brandId: image.brand_id,
        userId: null,
        functionName,
        status: 'succeeded',
        requestId,
        durationMs: durationSince(startedAt),
        metadata: { token, imageId: image.id, publicRead: true },
      });

      return new Response(
        JSON.stringify({
          success: true,
          image: {
            id: image.id,
            imageUrl,
            prompt: image.prompt,
            negativePrompt: image.negative_prompt,
            featureType: image.feature_type,
            stylePreset: image.style_preset,
            modelUsed: image.model_used,
            generationParams: image.generation_params,
            metadata: image.metadata,
            createdAt: image.created_at,
          },
          share: {
            token: shareLink.token,
            expiresAt: shareLink.expires_at,
            createdAt: shareLink.created_at,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!publicShareEnabled()) {
      return new Response(
        JSON.stringify({ success: false, error: 'external_public_sharing_disabled_pending_h602' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseClient = createClient<Database>(
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
