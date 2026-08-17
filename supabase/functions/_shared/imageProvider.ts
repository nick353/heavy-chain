import {
  editOpenAiImage,
  generateOpenAiImage,
  type OpenAiImageResult,
} from './openaiImage.ts';

export type ProviderImageResult = OpenAiImageResult & {
  outputUrl: string;
};

export type ProviderReferenceImage = {
  uri: string;
  tag: string;
};

export type ProviderImageArtifact = {
  base64: string;
  dataUrl: string;
  contentType: string;
  extension: string;
};

const normalizeMimeType = (mimeType?: string | null) => {
  const cleanMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return cleanMimeType.startsWith('image/') ? cleanMimeType : 'image/png';
};

const extensionFromMimeType = (mimeType: string) => {
  switch (normalizeMimeType(mimeType)) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'png';
  }
};

export const providerImageDataUri = (base64: string, mimeType?: string | null) => (
  `data:${normalizeMimeType(mimeType)};base64,${base64}`
);

export const providerReferenceImage = (
  base64: string,
  mimeType?: string | null,
  tag = 'reference',
): ProviderReferenceImage => ({
  uri: providerImageDataUri(base64, mimeType),
  tag,
});

export const providerImageArtifact = (
  result: Pick<ProviderImageResult, 'base64' | 'mimeType'>,
): ProviderImageArtifact => {
  const contentType = normalizeMimeType(result.mimeType);
  return {
    base64: result.base64,
    dataUrl: providerImageDataUri(result.base64, contentType),
    contentType,
    extension: extensionFromMimeType(contentType),
  };
};

const resolvedModel = (forEdit = false) => (
  forEdit
    ? Deno.env.get('OPENAI_IMAGE_EDIT_MODEL')?.trim()
      || Deno.env.get('OPENAI_IMAGE_MODEL')?.trim()
      || 'gpt-image-1-mini'
    : Deno.env.get('OPENAI_IMAGE_MODEL')?.trim() || 'gpt-image-2'
);

export async function generateProviderImage(params: {
  brandId?: string;
  prompt: string;
  width?: number;
  height?: number;
  negativePrompt?: string | null;
  referenceImages?: ProviderReferenceImage[];
}): Promise<ProviderImageResult> {
  if (params.referenceImages?.length) {
    const result = await editOpenAiImage({
      prompt: params.prompt,
      images: params.referenceImages.map((image) => ({ imageUrl: image.uri })),
      model: resolvedModel(true),
      background: 'auto',
    });
    return { ...result, outputUrl: '' };
  }

  const result = await generateOpenAiImage({
    prompt: params.prompt,
    negativePrompt: params.negativePrompt,
    width: params.width,
    height: params.height,
    model: resolvedModel(false),
  });
  return { ...result, outputUrl: '' };
}

export async function upscaleProviderImage(params: {
  brandId?: string;
  base64: string;
  mimeType?: string | null;
}): Promise<ProviderImageResult> {
  const result = await editOpenAiImage({
    prompt: 'Upscale and restore this image while preserving the same product identity, composition, and details. Improve resolution, sharpness, texture clarity, and edge definition without changing the original content.',
    images: [{ imageUrl: providerImageDataUri(params.base64, params.mimeType) }],
    model: resolvedModel(true),
    background: 'auto',
  });
  return { ...result, outputUrl: '' };
}

export const providerName = () => 'openai';
