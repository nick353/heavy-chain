import { cloudflareDataPlane } from './cloudflareApi';
import type { Json } from '../types/database';
export { assertCompletedImageEditResult, assertCompletedModelMatrixResult } from './providerResultReadback';

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

export async function edgeFunctionErrorMessage(error: any, response?: Response | null) {
  const context = response ?? error?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.clone?.().json?.() ?? await context.json();
      const messageFields = ['error', 'message', 'details', 'hint'] as const;
      for (const field of messageFields) {
        if (typeof body?.[field] === 'string' && body[field].trim()) {
          return body[field].trim();
        }
      }
    } catch {
      try {
        const text = await context.clone?.().text?.() ?? await context.text?.();
        if (typeof text === 'string' && text.trim()) {
          return text.trim();
        }
      } catch {
        // Fall through to the SDK message below.
      }
    }
  }
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim();
  return 'Edge Function call failed';
}

export interface ImageEditResult {
  success: boolean;
  requestId?: string;
  clientRecoveryKey?: string;
  createdAt?: string;
  batchId?: string;
  providerJobId?: string;
  providerImageId?: string;
  providerStoragePath?: string;
  protectedRegionComposited?: boolean;
  maskTreatment?: string;
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
    persistenceStatus?: 'completed' | 'partial' | 'failed' | 'processing' | 'pending';
    candidateIndex?: number;
    batchId?: string | null;
  }>;
  provider?: string;
  backendProvider?: string;
  status?: string;
  persistenceStatus?: 'not_started' | 'processing' | 'completed' | 'partial' | 'failed' | 'pending';
  cleanupStatus?: 'none' | 'attempted' | 'completed' | 'failed';
  requestedCandidateCount?: number;
  inputImageCount?: number;
  persistedCandidateCount?: number;
  failedCandidates?: Array<{ candidateIndex: number; error: string }>;
  cleanupErrors?: string[];
  parentObjectId?: string | null;
  generation?: number | null;
  maskApplied?: boolean;
  maskCoveragePercent?: number;
  maskWidth?: number;
  maskHeight?: number;
  providerModel?: string | null;
  inputFidelity?: 'low' | 'high' | null;
  quality?: 'low' | 'medium' | 'high' | 'auto' | null;
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

async function invokeImageAction<T>(
  action: string,
  body: Record<string, unknown>,
  options: { idempotencyKey?: string; assertContext?: ()=>void } = {},
): Promise<T> {
  if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
  return cloudflareDataPlane.invokeProviderAction<T>(action, body, options);
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
    return await invokeImageAction<ImageEditResult>('remove-background', {
      imageUrl,
      brandId,
      lightchainCompat,
      legalSafety: { rightsConfirmed: legalSafety?.rightsConfirmed === true },
    });
  } catch (error: any) {
    console.error('Remove background error:', error);
    return { success: false, error: await edgeFunctionErrorMessage(error, (error as any)?.response) };
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
    return await invokeImageAction<ColorVariationResult>('colorize', {
      imageUrl,
      brandId,
      colors,
      count,
      lightchainCompat,
      legalSafety: { rightsConfirmed: legalSafety?.rightsConfirmed === true },
    });
  } catch (error: any) {
    console.error('Colorize error:', error);
    return { success: false, error: await edgeFunctionErrorMessage(error, (error as any)?.response) };
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
    return await invokeImageAction<ImageEditResult>('upscale', {
      imageUrl,
      brandId,
      scale,
      lightchainCompat,
      legalSafety: { rightsConfirmed: legalSafety?.rightsConfirmed === true },
    });
  } catch (error: any) {
    console.error('Upscale error:', error);
    return { success: false, error: await edgeFunctionErrorMessage(error, (error as any)?.response) };
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
    return await invokeImageAction<VariationsResult>('generate-variations', {
      imageUrl,
      brandId,
      prompt,
      count,
      ...options,
      legalSafety: { rightsConfirmed: options?.rightsConfirmed === true },
    });
  } catch (error: any) {
    console.error('Generate variations error:', error);
    return { success: false, error: await edgeFunctionErrorMessage(error, (error as any)?.response) };
  }
}

/**
 * Generate image from text prompt
 */
export async function generateImage(
  prompt: string,
  brandId: string,
  options?: {
    generationProvider?: 'gemini' | 'gemini_image' | 'openai' | 'openai_image' | 'mock' | 'mock_image' | 'workers_ai';
    imageUrls?: string[];
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
    const result = await invokeImageAction<ImageEditResult>('generate-image', {
      prompt,
      brandId,
      ...options,
      legalSafety: {
        rightsConfirmed: options?.rightsConfirmed === true,
      },
    });
    return {
      ...result,
      imageUrl: result.imageUrl ?? result.images?.[0]?.imageUrl,
      jobId: result.jobId ?? result.images?.[0]?.jobId ?? null,
      imageId: result.imageId ?? result.images?.[0]?.imageId ?? null,
      storagePath: result.storagePath ?? result.images?.[0]?.storagePath ?? undefined,
    };
  } catch (error: any) {
    console.error('Generate image error:', error);
    return { success: false, error: await edgeFunctionErrorMessage(error, (error as any)?.response) };
  }
}

/**
 * Edit image with text prompt (Image + Text)
 */
async function imageBlobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('image_edit_input_data_url_failed'));
    reader.onerror = () => reject(new Error('image_edit_input_data_url_failed'));
    reader.readAsDataURL(blob);
  });
}

async function rasterSourceToPngDataUrl(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('image_edit_png_canvas_unavailable');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('image_edit_png_encode_failed')), 'image/png');
  });
  return await imageBlobToDataUrl(png);
}

async function imageElementBlobToPngDataUrl(blob: Blob): Promise<string> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('image_edit_svg_rasterize_failed'));
      element.src = objectUrl;
    });
    return await rasterSourceToPngDataUrl(
      image,
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function imageBlobToPngDataUrl(blob: Blob): Promise<string> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      try {
        return await rasterSourceToPngDataUrl(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    } catch {
      // Chromium may display an SVG but still reject its Blob in
      // createImageBitmap. Retry through an object URL and HTMLImageElement
      // so product-owned SVG assets reach the provider as PNG data.
    }
  }
  return await imageElementBlobToPngDataUrl(blob);
}

export async function editImageWithPrompt(
  imageUrl: string,
  prompt: string,
  brandId: string,
  options?: LegalSafetyOptions & {
    outputBackground?: 'auto' | 'transparent';
    maskDataUrl?: string;
    parentObjectId?: string | null;
    canvasProjectId?: string | null;
    generation?: number;
    count?: number;
    featureType?: string;
    assertContext?: ()=>void;
    maskApplied?: boolean;
    maskCoveragePercent?: number;
    maskWidth?: number;
    maskHeight?: number;
    providerModel?: string;
    inputFidelity?: 'low' | 'high';
    quality?: 'low' | 'medium' | 'high' | 'auto';
    lightchainCompat?: LightchainCompatPayload;
    idempotencyKey?: string;
    referenceImageUrls?: string[];
    generationIntent?: unknown;
    materialReferences?: unknown;
    layerPlan?: unknown;
    maskPlan?: unknown;
    compositionPreview?: unknown;
  },
): Promise<ImageEditResult> {
  try {
    options?.assertContext?.();
    if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
    const inputImageUrls = [imageUrl, ...(options?.referenceImageUrls ?? [])];
    if (!inputImageUrls.length) throw new Error('image_edit_input_missing');
    if (inputImageUrls.some(value=>typeof value !== 'string' || !value.trim())) throw new Error('image_edit_input_missing');
    const inputImages = await Promise.all(inputImageUrls.map(async (inputImageUrl, index) => {
      const response = await fetch(inputImageUrl);
      if (!response.ok) throw new Error(`image_edit_input_fetch_failed:${index}:${response.status}`);
      const imageBlob = await response.blob();
      if (!imageBlob.type.startsWith('image/')) throw new Error(`image_edit_input_not_image:${index}`);
      const responseMimeType = response.headers.get('content-type') || '';
      const isSvgOrXml = /svg|xml/i.test(`${responseMimeType} ${imageBlob.type}`);
      const requiresPngNormalization = Boolean(
        (index === 0 && options?.maskDataUrl) || isSvgOrXml,
      );
      const dataUrl = requiresPngNormalization
        ? await imageBlobToPngDataUrl(imageBlob)
        : await imageBlobToDataUrl(imageBlob);
      return dataUrl;
    }));
    const imageInput = inputImages[0];
    options?.assertContext?.();
    const result = await invokeImageAction<ImageEditResult>('edit-image', {
      imageUrl: imageInput,
      imageUrls: inputImages,
      prompt,
      brandId,
      maskDataUrl: options?.maskDataUrl,
      outputBackground: options?.outputBackground === 'transparent' ? 'transparent' : 'auto',
      parentObjectId: options?.parentObjectId ?? null,
      canvasProjectId: options?.canvasProjectId ?? null,
      generation: options?.generation,
      count: options?.count,
      featureType: options?.featureType,
      maskApplied: options?.maskApplied === true,
      maskCoveragePercent: options?.maskCoveragePercent,
      maskWidth: options?.maskWidth,
      maskHeight: options?.maskHeight,
      providerModel: options?.providerModel,
      inputFidelity: options?.inputFidelity,
      quality: options?.quality,
      lightchainCompat: options?.lightchainCompat,
      generationIntent: options?.generationIntent,
      materialReferences: options?.materialReferences,
      layerPlan: options?.layerPlan,
      maskPlan: options?.maskPlan,
      compositionPreview: options?.compositionPreview,
      legalSafety: { rightsConfirmed: options?.rightsConfirmed === true },
    }, {
      idempotencyKey: options?.idempotencyKey,
      assertContext: options?.assertContext,
    });
    options?.assertContext?.();
    return {
      ...result,
      imageUrl: result.imageUrl ?? result.images?.[0]?.imageUrl,
      jobId: result.jobId ?? result.images?.[0]?.jobId ?? null,
      imageId: result.imageId ?? result.images?.[0]?.imageId ?? null,
      storagePath: result.storagePath ?? result.images?.[0]?.storagePath ?? undefined,
    };
  } catch (error: any) {
    console.error('Edit image error:', error);
    return { success: false, error: await edgeFunctionErrorMessage(error, (error as any)?.response) };
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
    return await invokeImageAction('optimize-prompt', { prompt, brandId, style, targetPlatform });
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
    return await invokeImageAction('design-gacha', {
      brief,
      brandId,
      directions,
      ...options,
      legalSafety: { rightsConfirmed: options?.rightsConfirmed === true },
    });
  } catch (error: any) {
    console.error('Design gacha error:', error);
    return { success: false, error: await edgeFunctionErrorMessage(error, (error as any)?.response) };
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
    return await invokeImageAction('product-shots', {
      productDescription,
      brandId,
      shots,
      ...options,
      legalSafety: { rightsConfirmed: options?.rightsConfirmed === true },
    });
  } catch (error: any) {
    console.error('Product shots error:', error);
    return { success: false, error: await edgeFunctionErrorMessage(error, (error as any)?.response) };
  }
}

export interface ModelMatrixResult {
  success: boolean;
  backendProvider?: string;
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
    provider?: string;
    modelUsed?: string | null;
    providerTaskId?: string | null;
  }>;
  error?: string;
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
    modelReferenceImageUrl?: string;
    generationModel?: string;
    modelReferenceFileName?: string;
    modelReferenceSourceImageId?: string | null;
    modelReferenceSourceStoragePath?: string | null;
    sourceReadback?: unknown;
    materialReference?: unknown;
    materialReferences?: unknown;
    layerPlan?: unknown;
    maskPlan?: unknown;
    compositionPreview?: unknown;
    lightchainCompat?: LightchainCompatPayload;
    textOverlay?: TextOverlayPayload;
    rightsConfirmed?: boolean;
  }
): Promise<ModelMatrixResult> {
  try {
    return await invokeImageAction<ModelMatrixResult>('model-matrix', {
      productDescription,
      brandId,
      ...options,
      legalSafety: { rightsConfirmed: options?.rightsConfirmed === true },
    });
  } catch (error: any) {
    return { success: false, error: await edgeFunctionErrorMessage(error, (error as any)?.response) };
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
    return await invokeImageAction('multilingual-banner', {
      headline,
      brandId,
      ...options,
      legalSafety: { rightsConfirmed: options?.rightsConfirmed === true },
    });
  } catch (error: any) {
    console.error('Multilingual banner error:', error);
    return { success: false, error: await edgeFunctionErrorMessage(error, (error as any)?.response) };
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
    return await invokeImageAction('bulk-download', { brandId, ...options });
  } catch (error: any) {
    console.error('Bulk download error:', error);
    return { success: false, error: await edgeFunctionErrorMessage(error, (error as any)?.response) };
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
    if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
    return await cloudflareDataPlane.createShareLink(imageId, expiresInDays);
  } catch (error: any) {
    console.error('Create share link error:', error);
    return { success: false, error: await edgeFunctionErrorMessage(error, (error as any)?.response) };
  }
}

/**
 * Read a public shared image by token.
 */
export async function getSharedImage(token: string): Promise<SharedImagePayload> {
  try {
    if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
    return await cloudflareDataPlane.getSharedImage(token);
  } catch (error: any) {
    console.error('Get shared image error:', error);
    return { success: false, error: error.message };
  }
}
