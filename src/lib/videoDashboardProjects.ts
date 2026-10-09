import type { WorkspaceArtifact } from './localWorkspaceArtifacts';
import { getVideoProjectCodeFromArtifact } from './videoWorkspacePersistence.ts';

export type VideoDashboardProject = {
  id: string;
  title: string;
  age: string;
  imageUrl?: string;
  reference?: boolean;
};

export const MAX_RECENT_VIDEO_PROJECTS = 6;

const relativeAge = (createdAt: string, now = Date.now()): string => {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return '新規';
  const days = Math.max(0, Math.floor((now - timestamp) / 86_400_000));
  if (days < 1) { const d = new Date(timestamp); return `今日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
  if (days < 30) return `${days}日前`;
  const months = Math.max(1, Math.floor(days / 30));
  if (months < 12) return `${months}ヶ月前`;
  return `${Math.max(1, Math.floor(months / 12))}年前`;
};

const readPreviewImage = (artifact: WorkspaceArtifact): string | undefined => {
  // The uploaded garment is the recognisable cover; the storyboard SVG is only a fallback.
  const source = artifact.metadata.videoSourceImageUrl;
  const candidates: unknown[] = [
    typeof source === 'string' && !source.startsWith('blob:') ? source : undefined,
    artifact.imageUrl,
    artifact.metadata.videoReferencePreview,
    (artifact.metadata.preview as Record<string, unknown> | undefined)?.imageUrl,
  ];
  return candidates.find((candidate): candidate is string => (
    typeof candidate === 'string'
      && Boolean(candidate.trim())
      && /^(?:data:|blob:|\/|https?:)/i.test(candidate.trim())
  ));
};

/** Convert durable Heavy video artifacts into the source-compatible dashboard cards. */
export const buildSavedVideoDashboardProjects = (
  artifacts: readonly WorkspaceArtifact[],
  now = Date.now(),
): VideoDashboardProject[] => artifacts
  .filter((artifact) => artifact.featureType === 'video-workstation')
  .map((artifact) => ({
    id: getVideoProjectCodeFromArtifact(artifact) || artifact.id,
    title: artifact.title.trim() || 'Untitled',
    age: relativeAge(artifact.createdAt, now),
    imageUrl: readPreviewImage(artifact),
  }));

/**
 * Merge persisted projects ahead of the source-compatible fallback cards.
 * The first project for a stable project code/id wins, and the dashboard keeps
 * the Lightchain recent-project limit.
 */
export const buildRecentVideoDashboardProjects = (
  savedProjects: readonly VideoDashboardProject[],
  fallbackProjects: readonly VideoDashboardProject[],
  limit = MAX_RECENT_VIDEO_PROJECTS,
): VideoDashboardProject[] => {
  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.floor(limit))
    : MAX_RECENT_VIDEO_PROJECTS;
  if (normalizedLimit === 0) return [];

  const seenProjectIds = new Set<string>();
  const recentProjects: VideoDashboardProject[] = [];

  for (const project of [...savedProjects, ...fallbackProjects]) {
    const projectId = project.id.trim();
    if (!projectId || seenProjectIds.has(projectId)) continue;
    seenProjectIds.add(projectId);
    recentProjects.push(project);
    if (recentProjects.length >= normalizedLimit) break;
  }

  return recentProjects;
};
