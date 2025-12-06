import { supabase } from './supabase';

export interface ImageEditResult {
  success: boolean;
  imageUrl?: string;
  storagePath?: string;
  error?: string;
}

export interface ColorVariationResult {
  success: boolean;
  variations?: Array<{
    color: string;
    imageUrl: string;
    storagePath: string;
  }>;
  error?: string;
}

export interface VariationsResult {
  success: boolean;
  originalDescription?: string;
  variations?: Array<{
    index: number;
    imageUrl: string;
    storagePath: string;
  }>;
  error?: string;
}

/**
 * Remove background from an image
 */
export async function removeBackground(
  imageUrl: string,
  brandId: string
): Promise<ImageEditResult> {
  try {
    const { data, error } = await supabase.functions.invoke('remove-background', {
      body: { imageUrl, brandId },
    });

    if (error) throw error;
    return data as ImageEditResult;
  } catch (error: any) {
    console.error('Remove background error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate color variations of an image
 */
export async function generateColorVariations(
  imageUrl: string,
  brandId: string,
  colors?: string[],
  count?: number
): Promise<ColorVariationResult> {
  try {
    const { data, error } = await supabase.functions.invoke('colorize', {
      body: { imageUrl, brandId, colors, count },
    });

    if (error) throw error;
    return data as ColorVariationResult;
  } catch (error: any) {
    console.error('Colorize error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Upscale an image
 */
export async function upscaleImage(
  imageUrl: string,
  brandId: string,
  scale: 2 | 4 = 2
): Promise<ImageEditResult> {
  try {
    const { data, error } = await supabase.functions.invoke('upscale', {
      body: { imageUrl, brandId, scale },
    });

    if (error) throw error;
    return data as ImageEditResult;
  } catch (error: any) {
    console.error('Upscale error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate variations of an image
 */
export async function generateVariations(
  imageUrl: string,
  brandId: string,
  prompt?: string,
  count?: number
): Promise<VariationsResult> {
  try {
    const { data, error } = await supabase.functions.invoke('generate-variations', {
      body: { imageUrl, brandId, prompt, count },
    });

    if (error) throw error;
    return data as VariationsResult;
  } catch (error: any) {
    console.error('Generate variations error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate image from text prompt
 */
export async function generateImage(
  prompt: string,
  brandId: string,
  options?: {
    style?: string;
    aspectRatio?: string;
    negativePrompt?: string;
  }
): Promise<ImageEditResult> {
  try {
    const { data, error } = await supabase.functions.invoke('generate-image', {
      body: { prompt, brandId, ...options },
    });

    if (error) throw error;
    return data as ImageEditResult;
  } catch (error: any) {
    console.error('Generate image error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Edit image with text prompt (Image + Text)
 */
export async function editImageWithPrompt(
  imageUrl: string,
  prompt: string,
  brandId: string
): Promise<ImageEditResult> {
  try {
    const { data, error } = await supabase.functions.invoke('edit-image', {
      body: { imageUrl, prompt, brandId },
    });

    if (error) throw error;
    return data as ImageEditResult;
  } catch (error: any) {
    console.error('Edit image error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Optimize prompt (Japanese to English with enhancements)
 */
export async function optimizePrompt(
  prompt: string,
  style?: string,
  targetPlatform?: string
): Promise<{
  success: boolean;
  original?: string;
  optimized_prompt?: string;
  negative_prompt?: string;
  style_tags?: string[];
  error?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('optimize-prompt', {
      body: { prompt, style, targetPlatform },
    });

    if (error) throw error;
    return data;
  } catch (error: any) {
    console.error('Optimize prompt error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Design Gacha - Generate multiple design directions
 */
export async function designGacha(
  brief: string,
  brandId: string,
  directions?: number
): Promise<{
  success: boolean;
  variations?: Array<{
    direction: string;
    directionName: string;
    imageUrl: string;
    storagePath: string;
  }>;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('design-gacha', {
      body: { brief, brandId, directions },
    });

    if (error) throw error;
    return data;
  } catch (error: any) {
    console.error('Design gacha error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate product shots (front/side/back/detail)
 */
export async function generateProductShots(
  productDescription: string,
  brandId: string,
  shots?: string[]
): Promise<{
  success: boolean;
  shots?: Array<{
    shotType: string;
    shotName: string;
    imageUrl: string;
    storagePath: string;
  }>;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('product-shots', {
      body: { productDescription, brandId, shots },
    });

    if (error) throw error;
    return data;
  } catch (error: any) {
    console.error('Product shots error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate model matrix (body types x age groups)
 */
export async function generateModelMatrix(
  productDescription: string,
  brandId: string,
  options?: {
    bodyTypes?: string[];
    ageGroups?: string[];
    gender?: 'male' | 'female';
  }
): Promise<{
  success: boolean;
  matrix?: Array<{
    bodyType: string;
    bodyTypeName: string;
    ageGroup: string;
    ageGroupName: string;
    imageUrl: string;
  }>;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('model-matrix', {
      body: { productDescription, brandId, ...options },
    });

    if (error) throw error;
    return data;
  } catch (error: any) {
    console.error('Model matrix error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate multilingual EC banners
 */
export async function generateMultilingualBanners(
  headline: string,
  brandId: string,
  options?: {
    subheadline?: string;
    languages?: string[];
    style?: string;
    aspectRatio?: string;
  }
): Promise<{
  success: boolean;
  banners?: Array<{
    language: string;
    languageName: string;
    headline: string;
    imageUrl: string;
  }>;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('multilingual-banner', {
      body: { headline, brandId, ...options },
    });

    if (error) throw error;
    return data;
  } catch (error: any) {
    console.error('Multilingual banner error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Bulk download images as ZIP
 */
export async function bulkDownload(
  brandId: string,
  options?: {
    imageIds?: string[];
    folderId?: string;
  }
): Promise<{
  success: boolean;
  downloadUrl?: string;
  imageCount?: number;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('bulk-download', {
      body: { brandId, ...options },
    });

    if (error) throw error;
    return data;
  } catch (error: any) {
    console.error('Bulk download error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create share link for an image
 */
export async function createShareLink(
  imageId: string,
  expiresInDays?: number
): Promise<{
  success: boolean;
  shareUrl?: string;
  token?: string;
  expiresAt?: string;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('share-link', {
      body: { imageId, expiresInDays },
    });

    if (error) throw error;
    return data;
  } catch (error: any) {
    console.error('Create share link error:', error);
    return { success: false, error: error.message };
  }
}
