import { fetchIncomingImageFile, incomingImageApiOrigins, parseIncomingImageUrl, type IncomingImageFetch } from './incomingImage.ts';

/**
 * スタジオの帯の「お気に入り」（本家「收藏至资源库」= お気に入りに追加）の保存の形。
 * 保存はプリントデザインの collect（PrintDesignDetailPage.tsx）と同じ saveWorkspaceArtifactBestEffort で、
 * metadata.librarySource と metadata.libraryGroup を付ける。libraryGroup はライブラリーのフォルダの id
 * （LightchainLibraryPage.tsx が metadata.libraryGroup === フォルダの id でそのフォルダに並べる）。
 */
export const STUDIO_COLLECT_TEXT = {
  title: 'お気に入りに追加',
  personal: 'パーソナルスペース',
  team: 'チームスペース',
  home: 'ホーム',
  newGroup: '新規グループ作成',
  newGroupPlaceholder: 'グループ名を入力してください',
  create: '作成',
  cancel: 'キャンセル',
  confirm: '決定',
  empty: 'グループがありません。「新規グループ作成」から作ってください',
  teamEmpty: 'チームスペースはまだありません。Heavy の保存先はパーソナルスペースです',
  saved: 'お気に入りに追加しました',
  failed: 'お気に入りに追加できませんでした',
} as const;
export const STUDIO_COLLECT_FEATURE_TYPE = 'fashion-studio-collection';
export const STUDIO_COLLECT_LIBRARY_SOURCE = 'studio-collection';
/** ライブラリー画面と同じグループ名の上限。 */
export const STUDIO_COLLECT_GROUP_NAME_LIMIT = 50;

export type StudioCollectFolder = { id: string; name: string; parentId: string | null };

/** /v1/folders の行（LightchainLibraryPage.tsx と同じ元）を窓のフォルダにする。 */
export function studioCollectFolders(rows: readonly { id: string; name: string; parent_folder_id?: string | null }[]): StudioCollectFolder[] {
  return rows
    .filter(row => typeof row.id === 'string' && row.id && typeof row.name === 'string')
    .map(row => ({ id: row.id, name: row.name, parentId: row.parent_folder_id ?? null }));
}

/** いまの階層（null ならホーム）に並ぶフォルダ。 */
export function studioCollectChildren(folders: readonly StudioCollectFolder[], parentId: string | null): StudioCollectFolder[] {
  const known = new Set(folders.map(folder => folder.id));
  // 親が一覧に無いフォルダ（消された親など）はホームに出す。
  return folders.filter(folder => (parentId === null ? folder.parentId === null || !known.has(folder.parentId) : folder.parentId === parentId));
}

/** ホームから開いている階層までの道しるべ。 */
export function studioCollectTrail(folders: readonly StudioCollectFolder[], parentId: string | null): StudioCollectFolder[] {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const trail: StudioCollectFolder[] = [];
  const seen = new Set<string>();
  for (let id = parentId; id && byId.has(id) && !seen.has(id); id = byId.get(id)!.parentId) {
    seen.add(id);
    trail.unshift(byId.get(id)!);
  }
  return trail;
}

export function studioCollectGroupName(value: string): string | null {
  const name = value.trim();
  return name && name.length <= STUDIO_COLLECT_GROUP_NAME_LIMIT ? name : null;
}

/** 保存の中身（saveWorkspaceArtifactBestEffort へ渡す形）。 */
export function buildStudioCollectArtifact(input: {
  brandId: string;
  userId: string;
  imageUrl: string;
  title?: string;
  folder: Pick<StudioCollectFolder, 'id'>;
  sourceStoragePath?: string;
  createdAt?: string;
}) {
  const title = input.title?.trim() || 'ファッションスタジオ';
  return {
    brandId: input.brandId,
    scopeId: input.userId,
    featureType: STUDIO_COLLECT_FEATURE_TYPE,
    title,
    prompt: title,
    imageUrl: input.imageUrl,
    createdAt: input.createdAt ?? new Date().toISOString(),
    metadata: {
      librarySource: STUDIO_COLLECT_LIBRARY_SOURCE,
      libraryGroup: input.folder.id,
      ...(input.sourceStoragePath ? { sourceStoragePath: input.sourceStoragePath } : {}),
    },
  };
}

const SERVER_DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,/i;

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
};

/**
 * 保存する画像を data: にする（サーバーは data:image/png|jpeg|webp|gif だけを受ける）。
 * 住所なら Heavy が配る画像だけを読む（受け取り口と同じ決まり。外の任意の住所は読まない）。
 */
export async function studioCollectImageDataUrl(imageUrl: string, options: { origin?: string; apiOrigins?: readonly string[]; fetchImpl?: IncomingImageFetch } = {}): Promise<string> {
  if (SERVER_DATA_IMAGE.test(imageUrl)) return imageUrl;
  const origin = options.origin ?? (typeof window === 'undefined' ? '' : window.location.origin);
  const url = parseIncomingImageUrl(imageUrl, { origin, apiOrigins: options.apiOrigins ?? incomingImageApiOrigins() });
  if (!url) throw new Error('studio_collect_image_url_rejected');
  const file = await fetchIncomingImageFile(url, { fetchImpl: options.fetchImpl });
  return `data:${file.type};base64,${bytesToBase64(new Uint8Array(await file.arrayBuffer()))}`;
}
