import type { CanvasDocument } from '../types/database';
import type { CanvasProject } from '../stores/canvasStore';

export type DashboardCanvasProject = CanvasProject & {
  source: 'remote' | 'local';
};

export const buildDashboardCanvasProjectHref = (documentId: string) => (
  `/canvas/${encodeURIComponent(documentId)}`
);

export const toDashboardRemoteProject = (document: CanvasDocument): DashboardCanvasProject => ({
  id: document.id,
  name: document.title || '無題のプロジェクト',
  // The Dashboard only needs project metadata. The Canvas route performs the
  // authenticated snapshot read when the user opens this exact document ID.
  objects: [],
  view: { zoom: 1, panX: 0, panY: 0 },
  createdAt: document.created_at,
  updatedAt: document.updated_at,
  brandId: document.brand_id,
  source: 'remote',
});

/**
 * Design documents (/board) and planning-agent tasks (/agent) are canvas documents too, but they open in their own
 * pages; listing them as Canvas projects would open them in the wrong editor.
 */
export const isCanvasProjectDocument = (document: CanvasDocument) => {
  const snapshot = document.snapshot as unknown;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return true;
  const record = snapshot as Record<string, unknown>;
  return !('boardDocument' in record) && !('agentTask' in record) && !('boardDraftInputs' in record);
};

export const mergeDashboardCanvasProjects = (
  localProjects: CanvasProject[],
  remoteDocuments: CanvasDocument[],
): DashboardCanvasProject[] => {
  const seen = new Set<string>();
  const merged: DashboardCanvasProject[] = [];

  for (const project of [
    ...remoteDocuments.filter(isCanvasProjectDocument).map(toDashboardRemoteProject),
    ...localProjects.map((item) => ({ ...item, source: 'local' as const })),
  ]) {
    if (!project.id || seen.has(project.id)) continue;
    seen.add(project.id);
    merged.push(project);
  }

  return merged;
};
