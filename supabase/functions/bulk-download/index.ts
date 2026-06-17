import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// JSZip's esm.sh typings use CommonJS export syntax under Deno.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import JSZip = require('https://esm.sh/jszip@3.10.1');
import { clientError, createServiceClient, requireBrandRole, requireFolderRole, type Database } from '../_shared/auth.ts';
import { completeBrandUsage, reserveBrandUsage, type UsageReservation } from '../_shared/usage.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  let usageReservation: UsageReservation | null = null;
  let observedBrandId: string | null = null;
  let observedUserId: string | null = null;
  let telemetryClient: any = null;
  const functionName = 'bulk-download';
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

    const { imageIds, folderId, brandId } = await req.json();

    if (!brandId) {
      throw new Error('Missing required parameter: brandId');
    }

    await requireBrandRole(supabaseClient, brandId, user.id, 'viewer');
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

    if (folderId) {
      const folder = await requireFolderRole(supabaseClient, folderId, user.id, 'viewer');
      if (folder.brand_id !== brandId) {
        throw new Error('Folder does not belong to the requested brand');
      }
    }

    // Get images to download
    let query = supabaseClient
      .from('generated_images')
      .select('id, storage_path, image_url, prompt, created_at')
      .eq('brand_id', brandId);

    if (imageIds && imageIds.length > 0) {
      query = query.in('id', imageIds);
    }

    let { data: images, error: fetchError } = await query;

    if (fetchError) throw fetchError;
    if (!images || images.length === 0) {
      throw new Error('No images found');
    }

    // If folder specified, filter by folder
    if (folderId) {
      const { data: folderImages } = await supabaseClient
        .from('image_folders')
        .select('image_id')
        .eq('folder_id', folderId);

      const folderImageIds = new Set(folderImages?.map(fi => fi.image_id));
      images = images.filter(img => folderImageIds.has(img.id));
    }

    // Create ZIP file
    const zip = new JSZip();

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      
      try {
        // Get public URL
        const { data: urlData } = await supabaseClient.storage
          .from('generated-images')
          .createSignedUrl(image.storage_path, 300);

        // Download image
        const response = await fetch(urlData?.signedUrl || image.image_url || '');
        if (!response.ok) continue;

        const arrayBuffer = await response.arrayBuffer();
        
        // Generate filename
        const date = new Date(image.created_at).toISOString().split('T')[0];
        const ext = image.storage_path.split('.').pop() || 'png';
        const filename = `${date}_${i + 1}.${ext}`;

        zip.file(filename, arrayBuffer);
      } catch (err) {
        console.error(`Failed to add image ${image.id}:`, err);
      }
    }

    // Generate ZIP
    const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });

    // Upload ZIP to storage temporarily
    const zipFileName = `${user.id}/${brandId}/${Date.now()}_images.zip`;
    const { error: uploadError } = await supabaseService.storage
      .from('exports')
      .upload(zipFileName, zipBuffer, {
        contentType: 'application/zip',
      });

    if (uploadError) throw uploadError;

    // Get signed URL (valid for 1 hour)
    const { data: signedUrl } = await supabaseService.storage
      .from('exports')
      .createSignedUrl(zipFileName, 3600);
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
        downloadUrl: signedUrl?.signedUrl,
        imageCount: images.length,
        expiresIn: 3600,
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
