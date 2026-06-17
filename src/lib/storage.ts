import { supabase } from './supabase';
import type { GeneratedImage } from '../types/database';

export async function withSignedImageUrls<T extends Pick<GeneratedImage, 'storage_path' | 'image_url'>>(images: T[]) {
  return Promise.all(
    images.map(async (image) => {
      if (!image.storage_path) return image;
      if (/^(https?:|data:)/i.test(image.storage_path)) {
        return { ...image, image_url: image.storage_path };
      }

      const { data, error } = await supabase.storage
        .from('generated-images')
        .createSignedUrl(image.storage_path, 60 * 60);

      if (error || !data?.signedUrl) return image;
      return { ...image, image_url: data.signedUrl };
    }),
  );
}
