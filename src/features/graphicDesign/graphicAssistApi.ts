import { cloudflareDataPlane } from '../../lib/cloudflareApi';
import { assistOptionsFromGroups } from './graphicAssist';

/** Long edge sent to Claude: enough to read motifs and colors, small enough for a quick answer. */
const ASSIST_IMAGE_EDGE = 1024;

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('graphic_reference_unreadable'));
  image.src = url;
});

/** A reference as a JPEG on white (a transparent PNG would read as black), base64 without the data: prefix. */
async function referencePayload(url: string, name: string) {
  const image = await loadImage(url);
  const scale = Math.min(1, ASSIST_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas_unavailable');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL('image/jpeg', 0.9).split(',')[1] ?? '';
  return { name: name.slice(0, 120) || 'reference.jpg', kind: 'image' as const, mediaType: 'image/jpeg', data };
}

/** Light's 「デザイン要素解析中…」: Claude reads the references and returns the tags to pick from (stored form). */
export async function analyzeGraphicReferences(brandId: string, references: ReadonlyArray<{ imageUrl: string; name: string }>): Promise<string[]> {
  if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
  const files = await Promise.all(references.slice(0, 2).map((reference) => referencePayload(reference.imageUrl, reference.name)));
  const result = await cloudflareDataPlane.invokeProviderAction<{ groups?: unknown }>('profile-extract', { brandId, purpose: 'graphic-elements', files });
  const options = assistOptionsFromGroups(result?.groups);
  if (options.length === 0) throw new Error('graphic_elements_empty');
  return options;
}
