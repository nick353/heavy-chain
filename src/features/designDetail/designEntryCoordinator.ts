import { createCanvasDocument, getCanvasDocument, type CanvasDocumentRecord } from '../../lib/canvasDocumentPersistence';
import type { DesignDialogueManifestReference } from '../../lib/designDialogueReferences';
import { createEntryDraftStore, type EntryDraftStore } from './entryDraftStore';
import { createSessionStore, type DesignSessionStore } from './sessionStore';
import type { DesignScope } from './types';

export type DesignEntryClient = {
  createDocument: typeof createCanvasDocument;
  getDocument: typeof getCanvasDocument;
};
export const designEntryClient: DesignEntryClient = { createDocument: createCanvasDocument, getDocument: getCanvasDocument };
export const DESIGN_ENTRY_SESSION_DB = 'heavy-design-dialogue-sessions-v1';
export const DESIGN_ENTRY_DRAFT_DB = 'heavy-design-entry-drafts-v1';

export function validateOwnedDesignDocument(document: CanvasDocumentRecord, scope: DesignScope, projectId: string) {
  if (!document || document.id !== projectId || document.ownerId !== scope.userId || document.brandId !== scope.brandId
    || !Number.isSafeInteger(document.revision) || document.revision < 0
    || document.snapshotVersion !== 1 || document.snapshot?.version !== 1 || !Array.isArray(document.snapshot.objects)) {
    throw new Error('design_entry_document_unverified');
  }
  return document;
}

export const designEntryDetailHref = (projectId: string, conversationId: string) =>
  `/designProduction/detail?${new URLSearchParams({ projectId, conversationId })}`;

export const createDesignEntryCoordinator = (options: {
  scope: DesignScope;
  assertScope: () => void;
  client?: DesignEntryClient;
  sessions?: DesignSessionStore;
  drafts?: EntryDraftStore;
}) => {
  const scope = { ...options.scope };
  const client = options.client ?? designEntryClient;
  const sessions = options.sessions ?? createSessionStore({ idb: window.indexedDB, dbName: DESIGN_ENTRY_SESSION_DB });
  const drafts = options.drafts ?? createEntryDraftStore({ idb: window.indexedDB, dbName: DESIGN_ENTRY_DRAFT_DB });
  let active = true;
  let flight: Promise<string> | undefined;
  const assertContext = () => { if (!active) throw new Error('design_entry_scope_stale'); options.assertScope(); };
  const context = { userId: scope.userId, assertContext };
  const prepare = async (prompt: string, references: readonly DesignDialogueManifestReference[]) => {
    assertContext();
    const draft = await drafts.reserve(scope, prompt, references, assertContext); assertContext();
    if (!draft.ready) {
      const claimed = await drafts.mark(scope, draft.projectId, draft.conversationId, false, assertContext); assertContext();
      if (claimed.sendCreate) {
        try {
          await client.createDocument({ documentId: draft.projectId, brandId: scope.brandId, title: 'Untitled',
            snapshot: { version: 1, projectId: draft.projectId, objects: [] } }, context);
        } catch { assertContext(); /* unknown effect: reconcile the same ID below, never create again */ }
      }
    }
    const document = validateOwnedDesignDocument(await client.getDocument(draft.projectId, scope.brandId, context), scope, draft.projectId);
    assertContext();
    if (!draft.ready && (document.snapshot.projectId !== draft.projectId || document.snapshot.objects.length !== 0)) {
      throw new Error('design_entry_snapshot_unverified');
    }
    if (!draft.ready) {
      await sessions.putProject(scope, { projectId: document.id, ownerId: document.ownerId, brandId: document.brandId, conversationIds: [draft.conversationId] }); assertContext();
      await sessions.ensureSession(scope, { projectId: document.id, conversationId: draft.conversationId }); assertContext();
      await drafts.mark(scope, draft.projectId, draft.conversationId, true, assertContext); assertContext();
    }
    const session = await sessions.getSession(scope, draft.conversationId); assertContext();
    if (!session || session.projectId !== document.id) throw new Error('design_entry_session_mismatch');
    return designEntryDetailHref(document.id, session.conversationId);
  };
  return {
    prepare(prompt: string, references: readonly DesignDialogueManifestReference[]) {
      if (flight) return flight;
      flight = prepare(prompt, references);
      const current = flight;
      void current.finally(() => { if (flight === current) flight = undefined; }).catch(() => undefined);
      return current;
    },
    dispose() { active = false; },
  };
};
