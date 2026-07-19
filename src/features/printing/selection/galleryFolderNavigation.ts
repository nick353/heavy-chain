export interface GalleryFolderNode {
  id: string;
  name: string;
  parent_folder_id: string | null;
}

export interface GalleryFolderMembership {
  image_id: string;
  folder_id: string;
}

export interface GalleryFolderNavigation<T extends GalleryFolderNode> {
  foldersById: ReadonlyMap<string, T>;
  childrenByParentId: ReadonlyMap<string | null, readonly T[]>;
}

const normalizeId = (value: string): string => value.trim();

export const createGalleryFolderNavigation = <T extends GalleryFolderNode>(
  folders: readonly T[],
): GalleryFolderNavigation<T> => {
  const foldersById = new Map<string, T>();

  for (const folder of folders) {
    const id = normalizeId(folder.id);
    const name = folder.name.trim();
    if (!id || !name) throw new Error('gallery_folder_identity_invalid');
    if (foldersById.has(id)) throw new Error(`gallery_folder_duplicate:${id}`);
    foldersById.set(id, folder);
  }

  for (const [id, folder] of foldersById) {
    const parentId = folder.parent_folder_id == null ? null : normalizeId(folder.parent_folder_id);
    if (parentId === id) throw new Error(`gallery_folder_cycle:${id}`);
    if (parentId && !foldersById.has(parentId)) throw new Error(`gallery_folder_parent_missing:${id}`);

    const visited = new Set<string>([id]);
    let cursor = parentId;
    while (cursor) {
      if (visited.has(cursor)) throw new Error(`gallery_folder_cycle:${id}`);
      visited.add(cursor);
      const parent = foldersById.get(cursor);
      cursor = parent?.parent_folder_id == null ? null : normalizeId(parent.parent_folder_id);
    }
  }

  const childrenByParentId = new Map<string | null, T[]>();
  for (const folder of foldersById.values()) {
    const parentId = folder.parent_folder_id == null ? null : normalizeId(folder.parent_folder_id);
    const children = childrenByParentId.get(parentId) ?? [];
    children.push(folder);
    childrenByParentId.set(parentId, children);
  }
  for (const children of childrenByParentId.values()) {
    children.sort((left, right) => left.name.localeCompare(right.name, 'ja'));
  }

  return { foldersById, childrenByParentId };
};

export const getGalleryFolderPath = <T extends GalleryFolderNode>(
  navigation: GalleryFolderNavigation<T>,
  folderId: string | null,
): readonly T[] | null => {
  if (folderId == null) return [];
  const normalizedId = normalizeId(folderId);
  const folder = navigation.foldersById.get(normalizedId);
  if (!folder) return null;

  const path: T[] = [];
  let cursor: T | undefined = folder;
  while (cursor) {
    path.unshift(cursor);
    const parentId: string | null = cursor.parent_folder_id == null ? null : normalizeId(cursor.parent_folder_id);
    cursor = parentId ? navigation.foldersById.get(parentId) : undefined;
  }
  return path;
};

export const getGalleryFolderImageIds = (
  memberships: readonly GalleryFolderMembership[],
  folderId: string | null,
): ReadonlySet<string> | null => {
  if (folderId == null) return null;
  const normalizedFolderId = normalizeId(folderId);
  return new Set(
    memberships
      .filter((membership) => normalizeId(membership.folder_id) === normalizedFolderId)
      .map((membership) => normalizeId(membership.image_id))
      .filter(Boolean),
  );
};
