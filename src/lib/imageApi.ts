import { supabase } from './supabase';
import type { Json } from '../types/database';

export interface TextOverlayPayload {
  text: string;
  language?: 'ja' | 'en' | 'zh' | 'ko';
  position?: 'top' | 'center' | 'bottom';
  font?: string;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface LightchainCompatPayload {
  lightchainFeatureId: string;
  lightchainFeatureTitle: string;
  lightchainTaskCodes: string[];
  lightchainTaskSteps?: Array<{
    taskCode: string;
    status: 'queued' | 'processing' | 'completed' | 'failed' | 'retryable';
  }>;
}

type LegalSafetyOptions = {
  rightsConfirmed?: boolean;
};

export interface ImageEditResult {
  success: boolean;
  jobId?: string | null;
  imageId?: string | null;
  imageUrl?: string;
  storagePath?: string;
  images?: Array<{
    id?: string | null;
    imageUrl: string;
    prompt?: string;
    jobId?: string | null;
    imageId?: string | null;
    storagePath?: string | null;
    persistenceStatus?: 'completed' | 'failed' | 'processing' | 'pending';
  }>;
  provider?: string;
  persistenceStatus?: 'not_started' | 'processing' | 'completed' | 'failed' | 'pending';
  cleanupStatus?: 'none' | 'attempted' | 'failed';
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

export interface SharedImagePayload {
  success: boolean;
  image?: {
    id: string;
    imageUrl: string;
    prompt: string | null;
    negativePrompt: string | null;
    featureType: string | null;
    stylePreset: string | null;
    modelUsed: string | null;
    generationParams: Json | null;
    metadata: Json | null;
    createdAt: string;
  };
  share?: {
    token: string;
    expiresAt: string;
    createdAt: string;
  };
  error?: string;
}

/**
 * Remove background from an image
 */
export async function removeBackground(
  imageUrl: string,
  brandId: string,
  lightchainCompat?: LightchainCompatPayload,
  legalSafety?: LegalSafetyOptions,
): Promise<ImageEditResult> {
  try {
    const { data, error } = await supabase.functions.invoke('remove-background', {
      body: { imageUrl, brandId, lightchainCompat, legalSafety: { rightsConfirmed: legalSafety?.rightsConfirmed === true } },
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
  count?: number,
  lightchainCompat?: LightchainCompatPayload,
  legalSafety?: LegalSafetyOptions,
): Promise<ColorVariationResult> {
  try {
    const { data, error } = await supabase.functions.invoke('colorize', {
      body: { imageUrl, brandId, colors, count, lightchainCompat, legalSafety: { rightsConfirmed: legalSafety?.rightsConfirmed === true } },
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
  scale: 2 | 4 = 2,
  lightchainCompat?: LightchainCompatPayload,
  legalSafety?: LegalSafetyOptions,
): Promise<ImageEditResult> {
  try {
    const { data, error } = await supabase.functions.invoke('upscale', {
      body: { imageUrl, brandId, scale, lightchainCompat, legalSafety: { rightsConfirmed: legalSafety?.rightsConfirmed === true } },
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
  count?: number,
  options?: {
    strength?: number;
    textOverlay?: TextOverlayPayload;
    lightchainCompat?: LightchainCompatPayload;
    rightsConfirmed?: boolean;
  }
): Promise<VariationsResult> {
  try {
    const { data, error } = await supabase.functions.invoke('generate-variations', {
      body: {
        imageUrl,
        brandId,
        prompt,
        count,
        ...options,
        legalSafety: { rightsConfirmed: options?.rightsConfirmed === true },
      },
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
    generationProvider?: 'gemini' | 'gemini_image' | 'openai' | 'openai_image' | 'mock' | 'mock_image' | 'runway' | 'runway_mcp';
    generationModel?: string;
    featureType?: string;
    style?: string;
    aspectRatio?: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    count?: number;
    textOverlay?: TextOverlayPayload;
    campaignMeta?: Record<string, any>;
    lightchainCompat?: LightchainCompatPayload;
    sourceReadback?: unknown;
    generationIntent?: unknown;
    materialReferences?: unknown;
    layerPlan?: unknown;
    maskPlan?: unknown;
    compositionPreview?: unknown;
    rightsConfirmed?: boolean;
  }
): Promise<ImageEditResult> {
  try {
    const { data, error } = await supabase.functions.invoke('generate-image', {
      body: {
        prompt,
        brandId,
        ...options,
        legalSafety: {
          rightsConfirmed: options?.rightsConfirmed === true,
        },
      },
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
  brandId: string,
  options?: LegalSafetyOptions,
): Promise<ImageEditResult> {
  try {
    const { data, error } = await supabase.functions.invoke('edit-image', {
      body: { imageUrl, prompt, brandId, legalSafety: { rightsConfirmed: options?.rightsConfirmed === true } },
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
  brandId: string,
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
      body: { prompt, brandId, style, targetPlatform },
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
  directions?: number,
  options?: {
    fixedElements?: string[];
    randomizedElements?: string[];
    textOverlay?: TextOverlayPayload;
    rightsConfirmed?: boolean;
  }
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
      body: { brief, brandId, directions, ...options, legalSafety: { rightsConfirmed: options?.rightsConfirmed === true } },
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
  shots?: string[],
  options?: {
    background?: string;
    textOverlay?: TextOverlayPayload;
    rightsConfirmed?: boolean;
  }
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
      body: { productDescription, brandId, shots, ...options, legalSafety: { rightsConfirmed: options?.rightsConfirmed === true } },
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
    imageUrl?: string;
    textOverlay?: TextOverlayPayload;
    rightsConfirmed?: boolean;
  }
): Promise<{
  success: boolean;
  jobId?: string | null;
  persistenceStatus?: 'not_started' | 'processing' | 'completed' | 'failed';
  failedStage?: string | null;
  cleanupStatus?: 'none' | 'attempted' | 'failed';
  matrix?: Array<{
    bodyType: string;
    bodyTypeName: string;
    ageGroup: string;
    ageGroupName: string;
    imageUrl: string;
    storagePath?: string;
    imageId?: string;
    persistenceStatus?: 'completed' | 'failed';
  }>;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('model-matrix', {
      body: { productDescription, brandId, ...options, legalSafety: { rightsConfirmed: options?.rightsConfirmed === true } },
    });

    if (error) throw error;
    return data;
  } catch (error: any) {
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
    textOverlay?: TextOverlayPayload;
    rightsConfirmed?: boolean;
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
      body: { headline, brandId, ...options, legalSafety: { rightsConfirmed: options?.rightsConfirmed === true } },
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

/**
 * Read a public shared image by token.
 */
export async function getSharedImage(token: string): Promise<SharedImagePayload> {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const response = await fetch(
      `${supabaseUrl}/functions/v1/share-link?token=${encodeURIComponent(token)}`,
      {
        method: 'GET',
        headers: {
          apikey: supabaseAnonKey,
          'Content-Type': 'application/json',
        },
      },
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error ?? 'Shared image not found');
    }

    return data as SharedImagePayload;
  } catch (error: any) {
    console.error('Get shared image error:', error);
    return { success: false, error: error.message };
  }
}
