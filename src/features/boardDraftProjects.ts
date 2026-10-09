import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  listWorkspaceArtifacts,
  saveWorkspaceArtifactPersisted,
  saveWorkspaceArtifactBestEffort,
  type WorkspaceArtifact,
} from '../lib/localWorkspaceArtifacts';
import { cloudflareDataPlane } from '../lib/cloudflareApi';
import { withSignedImageUrls } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';
import type { CanonicalImageWorkspace } from '../hooks/useCanonicalImageWorkspace';
import { projectNameFromFile } from '../lib/projectNames';

const draftFileName = (metadata: unknown) => (metadata && typeof metadata === 'object' && !Array.isArray(metadata) && typeof (metadata as Record<string, unknown>).originalFileName === 'string' ? (metadata as Record<string, string>).originalFileName : null);

/**
 * Light saves a board project as soon as the first image is uploaded (it shows up as "Untitled" on the board before
 * anything is generated). Heavy does the same: the first upload on a new file is saved as a library upload tagged
 * with the board feature, the page URL gets that project's id (`boardProjectCode`), and the canonical workspace keeps
 * the project's inputs under that id. Once a result is saved the job card replaces the draft card.
 */
export const BOARD_DRAFT_KEY = 'boardDraftFeature';

export type BoardDraftCard = { id: string; title: string; updatedAt: string; imageUrl: string; href: string };

const draftStorageKey = (userId: string, brandId: string, toolId: string, pathname: string, project = '') =>
  `heavy:canonical-draft:v1:${userId}:${brandId}:${toolId}:${pathname}${project ? `:${project}` : ''}`;

const readAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('board_draft_read_failed'));
  reader.onerror = () => reject(reader.error ?? new Error('board_draft_read_failed'));
  reader.readAsDataURL(blob);
});

export const isBoardDraft = (artifact: WorkspaceArtifact, featureId: string) => artifact.metadata[BOARD_DRAFT_KEY] === featureId;

/** Saves the first upload of a new file as a board project and keeps the project id in the URL. */
export function useBoardDraftProject(featureId: string, workspace: CanonicalImageWorkspace) {
  const { user, currentBrand } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const projectCode = params.get('boardProjectCode') ?? '';
  const jobId = params.get('resumeJob');
  const fromLibrary = params.has('libraryArtifactId'); // the library already holds that image
  const creating = useRef(false);
  const primary = workspace.slots.primary;

  useEffect(() => {
    const userId = user?.id;
    const brandId = currentBrand?.id;
    if (!userId || !brandId || projectCode || jobId || fromLibrary || creating.current || !primary || workspace.status === 'loading') return;
    creating.current = true;
    void (async () => {
      try {
        const imageUrl = await readAsDataUrl(await (await fetch(primary.imageUrl)).blob());
        const result = await saveWorkspaceArtifactBestEffort({
          brandId, scopeId: userId, featureType: 'lightchain-library-upload', title: primary.name.replace(/\.[^.]+$/u, '') || 'Untitled',
          imageUrl, prompt: null,
          metadata: { librarySource: 'upload', libraryGroup: '履歴アップロード', originalFileName: primary.name, [BOARD_DRAFT_KEY]: featureId },
        });
        // The server copy is the project; a full browser store must not drop it.
        if (!result.localPersisted && !result.remote) return;
        const projectId = result.remote?.imageId ?? result.artifact.id;
        const state = useAuthStore.getState();
        if (state.user?.id !== userId || state.currentBrand?.id !== brandId) return;
        // Carry the new file's draft over to the project's own draft, then clear the new-file draft.
        const fresh = draftStorageKey(userId, brandId, workspace.toolId, location.pathname);
        try {
          const draft = localStorage.getItem(fresh);
          if (draft) localStorage.setItem(draftStorageKey(userId, brandId, workspace.toolId, location.pathname, projectId), draft);
        } catch { /* storage unavailable: the project still exists on the board */ }
        const next = new URLSearchParams(window.location.search);
        next.set('boardProjectCode', projectId);
        next.set('boardProjectType', 'draft');
        navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace: true });
        try { localStorage.removeItem(fresh); } catch { /* storage unavailable */ }
      } catch { /* The upload stays usable on the page; only the early board entry is skipped. */ }
      finally { creating.current = false; }
    })();
  }, [primary, projectCode, jobId, fromLibrary, user?.id, currentBrand?.id, workspace.status, workspace.toolId, featureId, location.pathname, location.hash, navigate]);

  // A saved result replaces the draft card; the upload itself stays in 履歴アップロード.
  useEffect(() => {
    const brandId = currentBrand?.id;
    if (!jobId || !projectCode || workspace.status !== 'saved' || !brandId) return;
    if (user?.id) markDraftDone(user.id, projectCode);
    const artifacts = listWorkspaceArtifacts(brandId, user?.id);
    const draft = artifacts.find((artifact) => artifact.id === projectCode && isBoardDraft(artifact, featureId));
    if (!draft) return;
    saveWorkspaceArtifactPersistedMetadata(draft, brandId, user?.id);
  }, [jobId, projectCode, workspace.status, currentBrand?.id, user?.id, featureId]);

  useBoardDraftServerInputs(featureId, workspace, projectCode, params.get('boardProjectType') === 'draft' && !jobId);

  return { projectCode };
}

/** Server copy of a draft project's not-yet-generated inputs (a canvas document; the browser draft is device-only). */
export const boardDraftInputsDocumentId = (projectId: string) => `bd-${projectId}`.slice(0, 128);
type DraftInputs = { brief: string; referenceNote: string; inputState: Record<string, unknown> };
const readDraftInputs = (snapshot: unknown, featureId: string, projectId: string): DraftInputs | null => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const value = (snapshot as Record<string, unknown>).boardDraftInputs;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  if (draft.feature !== featureId || draft.projectId !== projectId) return null;
  return {
    brief: typeof draft.brief === 'string' ? draft.brief.slice(0, 4000) : '',
    referenceNote: typeof draft.referenceNote === 'string' ? draft.referenceNote.slice(0, 4000) : '',
    inputState: draft.inputState && typeof draft.inputState === 'object' && !Array.isArray(draft.inputState) ? draft.inputState as Record<string, unknown> : {},
  };
};

/**
 * Keeps a draft project's inputs on the server and restores them where this browser has no draft of its own
 * (another device, cleared storage): the uploaded image comes back from the library copy, the brief/settings from
 * the inputs document. Restoring never overwrites what the page already holds.
 */
function useBoardDraftServerInputs(featureId: string, workspace: CanonicalImageWorkspace, projectCode: string, isDraft: boolean) {
  const { user, currentBrand } = useAuthStore();
  const restoredFor = useRef('');
  const revision = useRef<number | null>(null);
  const savedPayload = useRef('');
  const [restoring, setRestoring] = useState(false);
  const userId = user?.id;
  const brandId = currentBrand?.id;
  const ready = workspace.status !== 'loading' && workspace.status !== 'running';

  useEffect(() => {
    if (!isDraft || !projectCode || !userId || !brandId || !ready || !cloudflareDataPlane || restoredFor.current === projectCode) return;
    restoredFor.current = projectCode;
    revision.current = null;
    savedPayload.current = '';
    const local = (() => {
      try { return localStorage.getItem(`heavy:canonical-draft:v1:${userId}:${brandId}:${workspace.toolId}:${window.location.pathname}:${projectCode}`); } catch { return null; }
    })();
    const dataPlane = cloudflareDataPlane;
    let active = true;
    setRestoring(true);
    void (async () => {
      const document = await dataPlane.getCanvasDocument(boardDraftInputsDocumentId(projectCode)).catch(() => null);
      const inputs = document ? readDraftInputs(document.snapshot, featureId, projectCode) : null;
      if (document && inputs) {
        revision.current = document.revision;
        savedPayload.current = JSON.stringify(inputs);
      }
      if (!active || local) return; // this browser's own draft is restored by the workspace
      if (!workspace.slots.primary) {
        const images = await dataPlane.listGeneratedImages(brandId, { featureType: 'lightchain-library-upload', order: 'newest', limit: 100 }).catch(() => []);
        const image = images.find((row) => row.id === projectCode && row.user_id === userId && row.storage_path);
        if (image && active) {
          const [signed] = await withSignedImageUrls([{ storage_path: image.storage_path, image_url: '' }]);
          const blob = signed?.image_url ? await fetch(signed.image_url).then((response) => response.ok ? response.blob() : null).catch(() => null) : null;
          const metadata = image.metadata && typeof image.metadata === 'object' && !Array.isArray(image.metadata) ? image.metadata as Record<string, unknown> : {};
          const name = typeof metadata.originalFileName === 'string' ? metadata.originalFileName : `${projectCode}.png`;
          if (blob && active) await workspace.upload('primary', new File([blob], name, { type: blob.type || 'image/png' }));
        }
      }
      if (inputs && active) {
        if (inputs.brief && !workspace.brief) workspace.setBrief(inputs.brief);
        if (inputs.referenceNote && !workspace.referenceNote) workspace.setReferenceNote(inputs.referenceNote);
        if (Object.keys(inputs.inputState).length > 0) workspace.setInputState(inputs.inputState as Parameters<CanonicalImageWorkspace['setInputState']>[0]);
      }
    })().finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
    // The workspace object changes every render; restore once per project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraft, projectCode, userId, brandId, ready, featureId]);

  useEffect(() => {
    if (!isDraft || !projectCode || !brandId || !ready || restoring || restoredFor.current !== projectCode || !cloudflareDataPlane) return;
    const inputs: DraftInputs = { brief: workspace.brief, referenceNote: workspace.referenceNote, inputState: workspace.inputState as Record<string, unknown> };
    const payload = JSON.stringify(inputs);
    if (payload === savedPayload.current) return;
    const dataPlane = cloudflareDataPlane;
    const timer = window.setTimeout(() => {
      const id = boardDraftInputsDocumentId(projectCode);
      const snapshot = { objects: [], boardDraftInputs: { feature: featureId, projectId: projectCode, ...inputs } };
      const title = `下書き ${projectCode}`;
      void (async () => {
        try {
          if (revision.current === null) {
            // Fixed id: a lost create response is settled by reading the same id, never by a second document.
            const created = await dataPlane.createCanvasDocument({ id, brand_id: brandId, title, snapshot })
              .catch(async () => dataPlane.getCanvasDocument(id));
            revision.current = created.revision;
            if (JSON.stringify(readDraftInputs(created.snapshot, featureId, projectCode)) !== payload) {
              revision.current = (await dataPlane.updateCanvasDocument({ documentId: id, expected_revision: created.revision, title, snapshot })).revision;
            }
          } else {
            revision.current = (await dataPlane.updateCanvasDocument({ documentId: id, expected_revision: revision.current, title, snapshot })).revision;
          }
          savedPayload.current = payload;
        } catch {
          // Another tab moved the revision on: take the stored revision; the next change saves again.
          const stored = await dataPlane.getCanvasDocument(id).catch(() => null);
          if (stored) revision.current = stored.revision;
        }
      })();
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [isDraft, projectCode, brandId, ready, restoring, featureId, workspace.brief, workspace.referenceNote, workspace.inputState]);
}

/** Clears the board tag once the project has a saved result (local record; the upload itself is kept). */
function saveWorkspaceArtifactPersistedMetadata(draft: WorkspaceArtifact, brandId: string, userId?: string) {
  saveWorkspaceArtifactPersisted({ ...draft, brandId, scopeId: userId ?? draft.scopeId, metadata: { ...draft.metadata, [BOARD_DRAFT_KEY]: null } });
}

const doneKey = (userId: string) => `heavy:board-draft-done:v1:${userId}`;
const readDone = (userId: string): string[] => {
  try { const value = JSON.parse(localStorage.getItem(doneKey(userId)) ?? '[]'); return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []; } catch { return []; }
};
function markDraftDone(userId: string, id: string) {
  const done = readDone(userId);
  if (done.includes(id)) return;
  try { localStorage.setItem(doneKey(userId), JSON.stringify([...done, id].slice(-500))); } catch { /* storage unavailable */ }
}

/** Draft projects (uploaded, not generated yet) for one board feature, newest first, read from the server. */
export function useBoardDraftCards(featureId: string, detailPath: string) {
  const { user, currentBrand } = useAuthStore();
  const [cards, setCards] = useState<BoardDraftCard[]>([]);
  useEffect(() => {
    const brandId = currentBrand?.id;
    const userId = user?.id;
    const dataPlane = cloudflareDataPlane;
    if (!brandId || !userId || !dataPlane) { setCards([]); return; }
    let active = true;
    const href = (id: string) => `${detailPath}?boardProjectCode=${encodeURIComponent(id)}&boardProjectType=draft`;
    void dataPlane.listGeneratedImages(brandId, { featureType: 'lightchain-library-upload', order: 'newest', limit: 100 })
      .then(async (images) => {
        const done = new Set(readDone(userId));
        const drafts = images.filter((image) => {
          const metadata = image.metadata && typeof image.metadata === 'object' && !Array.isArray(image.metadata) ? image.metadata as Record<string, unknown> : {};
          return image.user_id === userId && image.storage_path && metadata[BOARD_DRAFT_KEY] === featureId && !done.has(image.id);
        });
        const signed = await withSignedImageUrls(drafts.map((image) => ({ storage_path: image.storage_path, image_url: '' })));
        if (!active) return;
        setCards(drafts.map((image, index) => ({ id: image.id, title: projectNameFromFile(draftFileName(image.metadata)), updatedAt: image.created_at, imageUrl: signed[index]?.image_url ?? '', href: href(image.id) })));
      })
      .catch(() => { if (active) setCards([]); });
    return () => { active = false; };
  }, [currentBrand?.id, user?.id, featureId, detailPath]);
  return cards;
}
