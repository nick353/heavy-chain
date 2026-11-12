/**
 * Fashion Studio の「画像検索」の通信と画像の読み込み（DOM を使う部分）。計算は studioImageSearch.ts。
 * 検索語はサーバーの Claude が画像を見て決める（profile-extract の purpose 'accessory-search'。鍵はサーバーだけが持つ）。
 */
import { cloudflareDataPlane } from './cloudflareApi';
import type { StudioImageSearchCategory } from './studioImageSearch.ts';

export type StudioImagePayload = { data: string; dataUrl: string };

const decode = (src: string, crossOrigin: boolean) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  if (crossOrigin) image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('studio_search_image_unreadable'));
  image.src = src;
});

/** 画像を読み込む。キャンバスの画像（blob: / data: / https）を先に fetch で読み、だめなら画像として直接読む。 */
async function loadStudioImage(url: string): Promise<{ image: HTMLImageElement; release: () => void }> {
  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) throw new Error(`studio_search_image_${response.status}`);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('studio_search_image_type');
    const objectUrl = URL.createObjectURL(blob);
    try { return { image: await decode(objectUrl, false), release: () => URL.revokeObjectURL(objectUrl) }; }
    catch (error) { URL.revokeObjectURL(objectUrl); throw error; }
  } catch {
    return { image: await decode(url, true), release: () => undefined };
  }
}

/** 長い辺を edge 以下にした白地の JPEG（透明の PNG が黒く読まれないように）。base64 と data URL を返す。 */
export async function studioImagePayloads(url: string, edges: readonly number[]): Promise<StudioImagePayload[]> {
  const { image, release } = await loadStudioImage(url);
  try {
    return edges.map((edge) => {
      const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas_unavailable');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', edge > 512 ? 0.9 : 0.85);
      return { dataUrl, data: dataUrl.split(',')[1] ?? '' };
    });
  } finally { release(); }
}

/** data URL（この端末に残した参照画像）から base64 だけを取り出す。 */
export const studioPayloadFromDataUrl = (dataUrl: string): StudioImagePayload => ({ dataUrl, data: dataUrl.split(',')[1] ?? '' });

/** サーバーの Claude に、画像に合うアクセサリーの検索語（英語）を決めてもらう。 */
export async function planStudioAccessories(brandId: string, image: StudioImagePayload, options: {
  category?: StudioImageSearchCategory | null; note?: string; exclude?: readonly string[]; count?: number;
} = {}): Promise<string[]> {
  if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
  const result = await cloudflareDataPlane.invokeProviderAction<{ queries?: unknown }>('profile-extract', {
    brandId, purpose: 'accessory-search',
    files: [{ name: 'reference.jpg', kind: 'image', mediaType: 'image/jpeg', data: image.data }],
    ...(options.category ? { category: options.category, note: options.note ?? '' } : {}),
    ...(options.exclude?.length ? { exclude: options.exclude.slice(-48) } : {}),
    ...(options.count ? { count: options.count } : {}),
  });
  const queries = Array.isArray(result?.queries)
    ? result.queries.flatMap((item) => item && typeof item === 'object' && typeof (item as { query?: unknown }).query === 'string' ? [(item as { query: string }).query.trim()] : []).filter(Boolean)
    : [];
  if (!queries.length) throw new Error('accessory_queries_empty');
  return queries;
}
