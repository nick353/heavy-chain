import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import JSZip from 'https://esm.sh/jszip@3.10.1';

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

    const { imageIds, folderId, brandId } = await req.json();

    if (!brandId) {
      throw new Error('Missing required parameter: brandId');
    }

    // Get images to download
    let query = supabaseClient
      .from('generated_images')
      .select('id, storage_path, prompt, created_at')
      .eq('brand_id', brandId);

    if (imageIds && imageIds.length > 0) {
      query = query.in('id', imageIds);
    }

    const { data: images, error: fetchError } = await query;

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
      images.filter(img => folderImageIds.has(img.id));
    }

    // Create ZIP file
    const zip = new JSZip();

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      
      try {
        // Get public URL
        const { data: urlData } = supabaseClient.storage
          .from('generated-images')
          .getPublicUrl(image.storage_path);

        // Download image
        const response = await fetch(urlData.publicUrl);
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
    const zipFileName = `${user.id}/downloads/${Date.now()}_images.zip`;
    const { error: uploadError } = await supabaseClient.storage
      .from('generated-images')
      .upload(zipFileName, zipBuffer, {
        contentType: 'application/zip',
      });

    if (uploadError) throw uploadError;

    // Get signed URL (valid for 1 hour)
    const { data: signedUrl } = await supabaseClient.storage
      .from('generated-images')
      .createSignedUrl(zipFileName, 3600);

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






