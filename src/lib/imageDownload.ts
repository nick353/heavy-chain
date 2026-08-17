export type ImageDownloadFormat = 'png' | 'jpeg' | 'webp';

const IMAGE_DOWNLOAD_MIME_TYPES: Record<ImageDownloadFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export const getImageDownloadFormat = (filename: string): ImageDownloadFormat => {
  const extension = filename.trim().toLowerCase().split('.').pop();
  return extension === 'jpeg' || extension === 'jpg'
    ? 'jpeg'
    : extension === 'webp'
      ? 'webp'
      : 'png';
};

export const fetchValidatedImageBlob = async (
  imageUrl: string,
  errorPrefix = 'image_download',
): Promise<Blob> => {
  const normalizedUrl = imageUrl.trim();
  if (!normalizedUrl) {
    throw new Error(`${errorPrefix}_url_unavailable`);
  }

  const response = await fetch(normalizedUrl);
  if (!response.ok) {
    throw new Error(`${errorPrefix}_failed:${response.status}`);
  }

  const blob = await response.blob();
  if (blob.size <= 0 || !blob.type.trim().toLowerCase().startsWith('image/')) {
    throw new Error(`${errorPrefix}_not_image`);
  }
  return blob;
};

const convertImageBlob = async (
  source: Blob,
  format: ImageDownloadFormat,
  errorPrefix: string,
): Promise<Blob> => {
  const mimeType = IMAGE_DOWNLOAD_MIME_TYPES[format];
  if (source.type.toLowerCase() === mimeType) return source;

  if (typeof createImageBitmap !== 'function') {
    throw new Error(`${errorPrefix}_format_conversion_unavailable`);
  }

  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(`${errorPrefix}_canvas_unavailable`);

    if (format === 'jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0);

    const converted = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, mimeType, format === 'jpeg' ? 0.92 : undefined);
    });
    if (!converted || converted.size <= 0 || converted.type !== mimeType) {
      throw new Error(`${errorPrefix}_format_conversion_failed`);
    }
    return converted;
  } finally {
    bitmap.close();
  }
};

export const downloadValidatedImage = async (
  imageUrl: string,
  filename: string,
  errorPrefix = 'image_download',
  format: ImageDownloadFormat = getImageDownloadFormat(filename),
): Promise<void> => {
  const sourceBlob = await fetchValidatedImageBlob(imageUrl, errorPrefix);
  const blob = await convertImageBlob(sourceBlob, format, errorPrefix);
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(objectUrl);
  }
};
