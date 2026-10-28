/**
 * Light's 移動 / 新規グループ作成 on the design workspace: named groups with a cover image, each project in at most one
 * group (or the ルートフォルダー). Kept per user, brand and workspace (design or marketing) in this browser, like the card pins.
 */
export type DesignProjectGroup = { id: string; name: string; cover: string; createdAt: string };
export type DesignProjectGroupState = { groups: DesignProjectGroup[]; members: Record<string, string> };

export const DESIGN_GROUP_NAME_LIMIT = 50;
export type ProjectGroupWorkspace = 'design' | 'marketing';
export const designProjectGroupsKey = (userId: string, brandId: string, workspace: ProjectGroupWorkspace = 'design') =>
  `heavy-${workspace}-project-groups:v1:${encodeURIComponent(JSON.stringify([userId, brandId]))}`;

export function readDesignProjectGroups(userId: string, brandId: string, workspace: ProjectGroupWorkspace = 'design'): DesignProjectGroupState {
  try {
    const parsed = JSON.parse(localStorage.getItem(designProjectGroupsKey(userId, brandId, workspace)) ?? '{}');
    const groups = Array.isArray(parsed.groups) ? parsed.groups.filter((group: Partial<DesignProjectGroup>) => typeof group?.id === 'string' && typeof group.name === 'string') : [];
    const ids = new Set(groups.map((group: DesignProjectGroup) => group.id));
    const members: Record<string, string> = {};
    if (parsed.members && typeof parsed.members === 'object') {
      for (const [projectId, groupId] of Object.entries(parsed.members)) if (typeof groupId === 'string' && ids.has(groupId)) members[projectId] = groupId;
    }
    return { groups, members };
  } catch { return { groups: [], members: {} }; }
}

export function writeDesignProjectGroups(userId: string, brandId: string, state: DesignProjectGroupState, workspace: ProjectGroupWorkspace = 'design') {
  try { localStorage.setItem(designProjectGroupsKey(userId, brandId, workspace), JSON.stringify(state)); } catch { /* storage full or unavailable */ }
}

/** The cover is stored small (longest side 320px, JPEG) so many groups fit in browser storage. */
export async function readGroupCover(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
    const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(url); }
}
