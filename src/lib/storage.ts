import { supabase } from './supabase';
import type { GeneratedImage } from '../types/database';

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const SIGNED_URL_BATCH_SIZE = 50;

const isDirectImageUrl = (path: string) => /^(https?:|data:)/i.test(path);
const SUPABASE_SIGNED_IMAGE_PATH = /\/storage\/v1\/object\/sign\/generated-images\/([^?]+)/i;

export const extractGeneratedImageStoragePath = (source: string) => {
  const trimmed = source.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(SUPABASE_SIGNED_IMAGE_PATH);
    if (!match?.[1]) return null;
    return decodeURIComponent(match[1]);
  } catch {
    const match = trimmed.match(SUPABASE_SIGNED_IMAGE_PATH);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }
};

export async function resolveGeneratedImageUrl(source: string) {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error('画像URLが空です');
  }

  const storagePath = extractGeneratedImageStoragePath(trimmed);
  if (storagePath) {
    const { data, error } = await supabase.storage
      .from('generated-images')
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
  }

  if (isDirectImageUrl(trimmed) || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  const { data, error } = await supabase.storage
    .from('generated-images')
    .createSignedUrl(trimmed, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    throw new Error('画像URLの解決に失敗しました');
  }

  return data.signedUrl;
}

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
