import { asGeneratedImageListRow, cloudflareDataPlane } from '../../lib/cloudflareApi';
import type { GeneratedImageListRow } from '../../lib/generatedImageQuery';
import { withSignedImageUrls } from '../../lib/storage';
import { saveWorkspaceArtifactBestEffort } from '../../lib/localWorkspaceArtifacts';
import { boardSnapshot, emptyBoardDocument, newBoardId, readBoardDocument, BOARD_PAGE_HEIGHT, BOARD_PAGE_WIDTH, type BoardItem } from '../board/boardDocuments';
import { candidateGrid } from './graphicResult';

/** Server side of the AIグラフィックデザイン result view: the run's proposals, sending one to another tool, a design document. */
export type GraphicCandidate = GeneratedImageListRow & { image_url: string };

/** Every proposal of one run (the server saves them under the run's job, in drawing order). */
export async function loadRunCandidates(brandId: string, jobId: string): Promise<GraphicCandidate[]> {
  if (!cloudflareDataPlane) return [];
  const rows = (await cloudflareDataPlane.listGeneratedImages(brandId, { jobId, order: 'oldest', limit: 8 })).map(asGeneratedImageListRow);
  return (await withSignedImageUrls(rows)).filter((row): row is GraphicCandidate => Boolean(row.image_url));
}

export async function setCandidateFavorite(id: string, favorite: boolean): Promise<boolean> {
  if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
  const saved = await cloudflareDataPlane.setGeneratedImageFavorite(id, favorite);
  return Boolean(saved.is_favorite);
}

/** Tools the chosen proposal can be sent to (each opens with it as the first image, like the 生成履歴 send menu). */
export const GRAPHIC_SEND_TARGETS = [
  { id: 'printing', label: 'プリントイメージで服に当てる', href: (id: string) => `/tools/printing?libraryArtifactId=${encodeURIComponent(id)}&librarySlot=printing-design` },
  { id: 'canvas', label: 'Canvasで一部を修正', href: (id: string) => `/canvas/new?sourceArtifactId=${encodeURIComponent(id)}` },
  // SVGにする (the tool row) traces the proposal as it is; this one first has AI redraw it flat, then traces that.
  { id: 'vector', label: 'ベクター化（AIで平らに描き直す）', href: (id: string) => `/tools/vector-special?libraryArtifactId=${encodeURIComponent(id)}` },
  { id: 'fabric', label: '生地イメージ', href: (id: string) => `/tools/fabric?libraryArtifactId=${encodeURIComponent(id)}&librarySlot=fabric-design` },
] as const;

/** Registers the proposal in the library (the same record the 生成履歴 panel writes) and returns its artifact id. */
export async function registerCandidate(brandId: string, userId: string | undefined, image: GraphicCandidate, title: string): Promise<string> {
  const persistenceContext = await cloudflareDataPlane?.captureArtifactPersistenceContext();
  const result = await saveWorkspaceArtifactBestEffort({
    brandId, scopeId: userId, featureType: image.feature_type || 'lightchain-print-design-project', title,
    imageUrl: image.image_url, prompt: image.prompt, createdAt: image.created_at,
    metadata: { librarySource: 'generation', libraryGroup: '生成履歴', remoteImageId: image.id, sourceImageId: image.id, sourceStoragePath: image.storage_path },
  }, { persistenceContext });
  if (!result.localPersisted || (cloudflareDataPlane && !result.remote)) throw new Error('library_register_unconfirmed');
  return result.artifact.id;
}

/** デザインドキュメントの作成: a new design document with the run's proposals laid out on its first page. */
export async function createGraphicDocument(brandId: string, title: string, images: ReadonlyArray<{ storagePath: string; width: number; height: number }>): Promise<string> {
  if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
  const data = emptyBoardDocument();
  const items: BoardItem[] = candidateGrid(images.map((image) => ({ width: image.width, height: image.height })), BOARD_PAGE_WIDTH, BOARD_PAGE_HEIGHT)
    .map((cell, index) => ({ id: newBoardId(), type: 'image', x: cell.x, y: cell.y, rotation: 0, storagePath: images[index].storagePath, width: cell.width, height: cell.height }));
  data.pages[0].items = items;
  const id = newBoardId();
  try {
    await cloudflareDataPlane.createCanvasDocument({ id, brand_id: brandId, title, snapshot: boardSnapshot(data) });
  } catch (error) {
    // A lost response is settled by reading the same id, never by making a second document.
    const existing = await cloudflareDataPlane.getCanvasDocument(id).catch(() => null);
    if (!existing || !readBoardDocument(existing.snapshot)) throw error;
  }
  return id;
}
