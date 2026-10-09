import { createCanvasDocument, getCanvasDocument, type CanvasDocumentRecord } from '../../lib/canvasDocumentPersistence';
import type { DesignDialogueManifestReference } from '../../lib/designDialogueReferences';
import { createEntryDraftStore, type EntryDraftStore } from './entryDraftStore';
import { createSessionStore, type DesignSessionStore } from './sessionStore';
import type { DesignScope } from './types';
import { projectNameFromPrompt } from '../../lib/projectNames';

export type DesignEntryClient = {
  createDocument: typeof createCanvasDocument;
  getDocument: typeof getCanvasDocument;
};
export const designEntryClient: DesignEntryClient = { createDocument: createCanvasDocument, getDocument: getCanvasDocument };
export const DESIGN_ENTRY_SESSION_DB = 'heavy-design-dialogue-sessions-v1';
export const DESIGN_ENTRY_DRAFT_DB = 'heavy-design-entry-drafts-v1';
export const MARKETING_ENTRY_DRAFT_DB = 'heavy-marketing-entry-drafts-v1';

/** Light runs the same assistant + canvas detail under two workspaces; each keeps its own project list. */
export type DialogueWorkspaceId = 'design' | 'marketing';
export type DialogueWorkspace = Readonly<{
  id: DialogueWorkspaceId;
  label: string;
  homeHref: string;
  detailPath: string;
  draftDb: string;
  selectionId: string;
  featureType: string;
}>;
export const DIALOGUE_WORKSPACES: Readonly<Record<DialogueWorkspaceId, DialogueWorkspace>> = {
  design: { id: 'design', label: 'デザインワークスペース', homeHref: '/designProduction', detailPath: '/designProduction/detail',
    draftDb: DESIGN_ENTRY_DRAFT_DB, selectionId: 'design-detail-dialogue', featureType: 'design-dialogue' },
  marketing: { id: 'marketing', label: 'マーケティングワークスペース', homeHref: '/marketing', detailPath: '/marketing/detail',
    draftDb: MARKETING_ENTRY_DRAFT_DB, selectionId: 'marketing-dialogue', featureType: 'marketing-dialogue' },
};

export function validateOwnedDesignDocument(document: CanvasDocumentRecord, scope: DesignScope, projectId: string) {
  if (!document || document.id !== projectId || document.ownerId !== scope.userId || document.brandId !== scope.brandId
    || !Number.isSafeInteger(document.revision) || document.revision < 0
    || document.snapshotVersion !== 1 || document.snapshot?.version !== 1 || !Array.isArray(document.snapshot.objects)) {
    throw new Error('design_entry_document_unverified');
  }
  return document;
}

export const designEntryDetailHref = (projectId: string, conversationId: string, detailPath = DIALOGUE_WORKSPACES.design.detailPath) =>
  `${detailPath}?${new URLSearchParams({ projectId, conversationId })}`;

export const createDesignEntryCoordinator = (options: {
  scope: DesignScope;
  assertScope: () => void;
  client?: DesignEntryClient;
  sessions?: DesignSessionStore;
  drafts?: EntryDraftStore;
  workspace?: DialogueWorkspace;
}) => {
  const workspace = options.workspace ?? DIALOGUE_WORKSPACES.design;
  const scope = { ...options.scope };
  const client = options.client ?? designEntryClient;
  const sessions = options.sessions ?? createSessionStore({ idb: window.indexedDB, dbName: DESIGN_ENTRY_SESSION_DB });
  const drafts = options.drafts ?? createEntryDraftStore({ idb: window.indexedDB, dbName: workspace.draftDb });
  let active = true;
  let flight: Promise<string> | undefined;
  const assertContext = () => { if (!active) throw new Error('design_entry_scope_stale'); options.assertScope(); };
  const context = { userId: scope.userId, assertContext };
  const prepare = async (prompt: string, references: readonly DesignDialogueManifestReference[], existingProjectId?: string) => {
    assertContext();
    const draft = await drafts.reserve(scope, prompt, references, assertContext, existingProjectId); assertContext();
    if (!draft.ready && existingProjectId === undefined) {
      const claimed = await drafts.mark(scope, draft.projectId, draft.conversationId, false, assertContext); assertContext();
      if (claimed.sendCreate) {
        try {
          await client.createDocument({ documentId: draft.projectId, brandId: scope.brandId, title: projectNameFromPrompt(prompt),
            snapshot: { version: 1, projectId: draft.projectId, objects: [] } }, context);
        } catch { assertContext(); /* unknown effect: reconcile the same ID below, never create again */ }
      }
    }
    const document = validateOwnedDesignDocument(await client.getDocument(draft.projectId, scope.brandId, context), scope, draft.projectId);
    assertContext();
    if (!draft.ready && existingProjectId === undefined && (document.snapshot.projectId !== draft.projectId || document.snapshot.objects.length !== 0)) {
      throw new Error('design_entry_snapshot_unverified');
    }
    if (!draft.ready) {
      const project = { projectId: document.id, ownerId: document.ownerId, brandId: document.brandId, conversationIds: [draft.conversationId] };
      if (existingProjectId === undefined) {
        await sessions.putProject(scope, project); assertContext();
        await sessions.ensureSession(scope, { projectId: document.id, conversationId: draft.conversationId }); assertContext();
      } else {
        // A saved document may already have conversations here; ensureSession appends to that project record.
        try { await sessions.ensureSession(scope, { projectId: document.id, conversationId: draft.conversationId }); }
        catch {
          assertContext();
          await sessions.putProject(scope, project); assertContext();
          await sessions.ensureSession(scope, { projectId: document.id, conversationId: draft.conversationId });
        }
        assertContext();
      }
      await drafts.mark(scope, draft.projectId, draft.conversationId, true, assertContext); assertContext();
    }
    const session = await sessions.getSession(scope, draft.conversationId); assertContext();
    if (!session || session.projectId !== document.id) throw new Error('design_entry_session_mismatch');
    return designEntryDetailHref(document.id, session.conversationId, workspace.detailPath);
  };
  return {
    prepare(prompt: string, references: readonly DesignDialogueManifestReference[], existingProjectId?: string) {
      if (flight) return flight;
      flight = prepare(prompt, references, existingProjectId);
      const current = flight;
      void current.finally(() => { if (flight === current) flight = undefined; }).catch(() => undefined);
      return current;
    },
    dispose() { active = false; },
  };
};
