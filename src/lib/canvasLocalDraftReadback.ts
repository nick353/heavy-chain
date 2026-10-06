import type { CanvasObject } from '../stores/canvasStore';

export interface CanvasLocalDraftState {
  currentProjectId: string | null;
  name: string;
  objects: CanvasObject[];
  selectedIds: string[];
  view: { zoom: number; panX: number; panY: number; canvasWidth: number; canvasHeight: number };
}

export interface CanvasDraftOwnerImage {
  id: string;
  user_id: string;
  brand_id: string;
  storage_path: string | null;
  job_id: string | null;
}

export interface CanvasLocalDraftExport {
  schema: 'heavy.canvas.local-draft-readonly.v1';
  capturedAt: string;
  scope: { userId: string; brandId: string };
  source: 'current-app-local-draft';
  ownerImages: Array<{ imageId: string; storagePath: string; jobId: string | null }>;
  rawDraft: CanvasLocalDraftState;
}

/** Read only: no hydration, storage write, remote save or request replay. */
export async function readOwnerScopedCanvasLocalDraft(input: {
  enabled: boolean;
  userId: string;
  brandId: string;
  readState: () => CanvasLocalDraftState;
  listOwnerImages: () => Promise<CanvasDraftOwnerImage[]>;
  assertCurrent: () => void;
}): Promise<CanvasLocalDraftExport> {
  if (!input.enabled || !input.userId || !input.brandId) throw new Error('canvas_draft_readback_not_enabled');
  input.assertCurrent();
  const serialized = JSON.stringify(input.readState());
  if (new TextEncoder().encode(serialized).byteLength > 200_000) throw new Error('canvas_draft_readback_too_large');
  const rawDraft = JSON.parse(serialized) as CanvasLocalDraftState;
  if (!rawDraft.objects.length) throw new Error('canvas_draft_readback_empty');
  const identities = rawDraft.objects.filter(object => object.type === 'image').map(object => {
    const path = object.src;
    if (typeof path !== 'string' || !/^generated-images\/ai-[0-9a-f-]+-\d+$/i.test(path)) throw new Error('canvas_draft_source_not_canonical');
    const imageId = path.slice('generated-images/'.length);
    const metadata = object.metadata;
    for (const declared of [metadata?.imageId, metadata?.galleryImageId]) {
      if (declared != null && declared !== imageId) throw new Error('canvas_draft_image_identity_mismatch');
    }
    for (const declared of [metadata?.storagePath, metadata?.galleryStoragePath]) {
      if (declared != null && declared !== path) throw new Error('canvas_draft_storage_identity_mismatch');
    }
    return { imageId, storagePath: path, declaredJob: metadata?.jobId ?? null };
  });
  const rows = identities.length ? await input.listOwnerImages() : [];
  input.assertCurrent();
  if (JSON.stringify(input.readState()) !== serialized) throw new Error('canvas_draft_changed_during_readback');
  const ownerImages = identities.map(identity => {
    const matches = rows.filter(row => row.id === identity.imageId && row.storage_path === identity.storagePath);
    if (matches.length !== 1) throw new Error('canvas_draft_owner_image_unavailable');
    const row = matches[0];
    if (row.user_id !== input.userId || row.brand_id !== input.brandId) throw new Error('canvas_draft_owner_scope_mismatch');
    if (identity.declaredJob && row.job_id !== identity.declaredJob) throw new Error('canvas_draft_job_identity_mismatch');
    return { imageId: row.id, storagePath: identity.storagePath, jobId: row.job_id };
  });
  input.assertCurrent();
  return {
    schema: 'heavy.canvas.local-draft-readonly.v1', capturedAt: new Date().toISOString(),
    scope: { userId: input.userId, brandId: input.brandId }, source: 'current-app-local-draft',
    ownerImages, rawDraft,
  };
}
