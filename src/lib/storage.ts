import { supabase } from './supabase';
import type { GeneratedImage } from '../types/database';

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const SIGNED_URL_BATCH_SIZE = 50;

const isDirectImageUrl = (path: string) => /^(https?:|data:)/i.test(path);

export async function withSignedImageUrls<T extends Pick<GeneratedImage, 'storage_path' | 'image_url'>>(images: T[]) {
  const signedUrlByPath = new Map<string, string>();
  const paths = Array.from(new Set(
    images
      .map((image) => image.storage_path)
      .filter((path): path is string => Boolean(path && !isDirectImageUrl(path))),
  ));

  for (let index = 0; index < paths.length; index += SIGNED_URL_BATCH_SIZE) {
    const chunk = paths.slice(index, index + SIGNED_URL_BATCH_SIZE);
    const { data, error } = await supabase.storage
      .from('generated-images')
      .createSignedUrls(chunk, SIGNED_URL_TTL_SECONDS)
      .catch(() => ({ data: null, error: true }));

    if (error || !data) continue;

    data.forEach((item, itemIndex) => {
      if (item.error || !item.signedUrl) return;
      signedUrlByPath.set(chunk[itemIndex], item.signedUrl);
    });
  }

  return images.map((image) => {
    if (!image.storage_path) return image;
    if (isDirectImageUrl(image.storage_path)) {
      return { ...image, image_url: image.storage_path };
    }

    const signedUrl = signedUrlByPath.get(image.storage_path);
    return signedUrl ? { ...image, image_url: signedUrl } : image;
  });
}
