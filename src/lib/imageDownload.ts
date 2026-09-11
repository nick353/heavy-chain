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

const renderImageSourceToBlob = async (
  source: CanvasImageSource,
  width: number,
  height: number,
  format: ImageDownloadFormat,
  errorPrefix: string,
): Promise<Blob> => {
  const mimeType = IMAGE_DOWNLOAD_MIME_TYPES[format];
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error(`${errorPrefix}_canvas_unavailable`);

  if (format === 'jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  // Chromium can leave the asynchronous canvas encoding callback pending
  // indefinitely for large remote images in extension-backed sessions.
  // Encode synchronously and rebuild a Blob so a requested JPEG/WebP
  // download cannot report success while no file is actually handed to the
  // browser download pipeline.
  const dataUrl = canvas.toDataURL(mimeType, format === 'jpeg' ? 0.92 : undefined);
  const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match || match[1].toLowerCase() !== mimeType) {
    throw new Error(`${errorPrefix}_format_conversion_failed`);
  }
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const converted = new Blob([bytes], { type: mimeType });
  if (converted.size <= 0 || converted.type !== mimeType) {
    throw new Error(`${errorPrefix}_format_conversion_failed`);
  }
  return converted;
};

const rasterizeWithImageElement = async (
  source: Blob,
  format: ImageDownloadFormat,
  errorPrefix: string,
): Promise<Blob> => {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error(`${errorPrefix}_format_conversion_unavailable`);
  }
  const objectUrl = URL.createObjectURL(source);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`${errorPrefix}_format_conversion_failed`));
      element.src = objectUrl;
    });
    return await renderImageSourceToBlob(
      image,
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
      format,
      errorPrefix,
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const convertImageBlob = async (
  source: Blob,
  format: ImageDownloadFormat,
  errorPrefix: string,
): Promise<Blob> => {
  const mimeType = IMAGE_DOWNLOAD_MIME_TYPES[format];
  if (source.type.toLowerCase() === mimeType) return source;

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(source);
      try {
        return await renderImageSourceToBlob(bitmap, bitmap.width, bitmap.height, format, errorPrefix);
      } finally {
        bitmap.close();
      }
    } catch {
      // Chromium may display an SVG while createImageBitmap rejects it. Fall
      // through to the HTMLImageElement path, which supports that case.
    }
  }

  return await rasterizeWithImageElement(source, format, errorPrefix);
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
    // Keep the object URL alive long enough for Chromium to dispatch the
    // download. Revoking it in the same task can cancel the download event,
    // especially in extension-backed browser sessions.
    window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
  }
};
