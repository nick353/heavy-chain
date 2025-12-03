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

