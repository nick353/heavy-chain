import { DESIGN_DIALOGUE_REFERENCE_LIMIT, type DesignDialogueManifestReference } from '../../lib/designDialogueReferences';
import type { DesignScope } from './types';

export type DesignEntryDraft = {
  version: 1;
  scope: DesignScope;
  projectId: string;
  conversationId: string;
  prompt: string;
  references: DesignDialogueManifestReference[];
  createAttempted: boolean;
  ready: boolean;
  consumed?: boolean;
  initialRequestId?: string;
};

const key = (scope: DesignScope, projectId: string, conversationId: string): IDBValidKey =>
  [scope.userId, scope.brandId, projectId, conversationId];
// Retain an exact-input pointer until L4 explicitly consumes the initial entry.
const activeKey = (scope: DesignScope, prompt: string, references: readonly DesignDialogueManifestReference[]): IDBValidKey =>
  [scope.userId, scope.brandId, JSON.stringify([prompt, references])];
const text = (value: unknown, max: number): value is string => typeof value === 'string'
  && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const identity = (value: unknown): value is string => text(value, 512) && !/^[a-z][a-z\d+.-]*:/i.test(value);

export function validateEntryDraft(draft: DesignEntryDraft, scope: DesignScope): DesignEntryDraft {
  if (!draft || draft.version !== 1 || !text(scope.userId, 128) || !text(scope.brandId, 128)
    || draft.scope?.userId !== scope.userId || draft.scope?.brandId !== scope.brandId
    || !identity(draft.projectId) || !identity(draft.conversationId)
    || typeof draft.prompt !== 'string' || !draft.prompt.trim() || draft.prompt.length > 4000
    || typeof draft.createAttempted !== 'boolean' || typeof draft.ready !== 'boolean'
    || (draft.consumed !== undefined && typeof draft.consumed !== 'boolean')
    || (draft.initialRequestId !== undefined && !identity(draft.initialRequestId))
    || (draft.consumed && (!draft.ready || !draft.initialRequestId))
    || (draft.ready && !draft.createAttempted) || !Array.isArray(draft.references)
    || draft.references.length > DESIGN_DIALOGUE_REFERENCE_LIMIT) throw new Error('design_entry_draft_invalid');
  for (const [index, reference] of draft.references.entries()) {
    if (!reference || reference.order !== index || !['upload', 'scene-asset'].includes(reference.kind)
      || !identity(reference.imageId) || !text(reference.storagePath, 2048)
      || /[\\?#]/u.test(reference.storagePath) || reference.storagePath.startsWith('/')
      || /^[a-z][a-z\d+.-]*:/i.test(reference.storagePath)
      || reference.storagePath.split('/').some((part) => !part || part === '.' || part === '..')
      || !text(reference.name, 512) || /[\\/?#]/u.test(reference.name)
      || (reference.kind === 'scene-asset' ? !identity(reference.sceneAssetKey) || /[\\/?#]/u.test(reference.sceneAssetKey) : reference.sceneAssetKey !== undefined)) {
      throw new Error('design_entry_reference_invalid');
    }
  }
  return { ...structuredClone(draft), consumed: draft.consumed ?? false };
}

/** Separate from L1/L2 turns: this is an initial entry, never an admitted generation. */
export const createEntryDraftStore = (options: { idb: IDBFactory; dbName: string; newId?: () => string }) => {
  let dbPromise: Promise<IDBDatabase> | undefined;
  const database = () => dbPromise ??= new Promise((resolve, reject) => {
    const request = options.idb.open(options.dbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('drafts');
      request.result.createObjectStore('active');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('design_entry_persist_failed'));
    request.onblocked = () => reject(new Error('design_entry_persist_blocked'));
  });
  const transact = async <T>(mode: IDBTransactionMode, work: (tx: IDBTransaction, finish: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['drafts', 'active'], mode);
      let result: T;
      let failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure ?? new Error('design_entry_persist_failed'));
      const fail = (error: unknown) => { failure = error; tx.abort(); };
      try { work(tx, (value) => { result = value; }, fail); } catch (error) { fail(error); }
    });
  };
  return {
    /** Read only, including consumed entries; the compound key keeps other accounts outside the scan. */
    async list(scope: DesignScope, assertCurrent = () => {}) {
      if (!text(scope.userId, 128) || !text(scope.brandId, 128)) throw new Error('design_entry_scope_invalid');
      assertCurrent();
      return transact<DesignEntryDraft[]>('readonly', (tx, finish, fail) => {
        const drafts: DesignEntryDraft[] = [];
        const range = IDBKeyRange.bound([scope.userId, scope.brandId], [scope.userId, scope.brandId, []]);
        const request = tx.objectStore('drafts').openCursor(range);
        request.onsuccess = () => {
          try {
            assertCurrent();
            const cursor = request.result;
            if (!cursor) { finish(drafts); return; }
            const draft = validateEntryDraft(cursor.value, scope);
            if (JSON.stringify(cursor.key) !== JSON.stringify(key(scope, draft.projectId, draft.conversationId))) throw new Error('design_entry_draft_mismatch');
            if (draft.ready) drafts.push(draft);
            cursor.continue();
          } catch (error) { fail(error); }
        };
      });
    },
    async get(scope: DesignScope, projectId: string, conversationId: string) {
      return transact<DesignEntryDraft | null>('readonly', (tx, finish, fail) => {
        const request = tx.objectStore('drafts').get(key(scope, projectId, conversationId));
        request.onsuccess = () => {
          try {
            const draft = request.result ? validateEntryDraft(request.result, scope) : null;
            if (draft && (draft.projectId !== projectId || draft.conversationId !== conversationId)) throw new Error('design_entry_draft_mismatch');
            finish(draft);
          } catch (error) { fail(error); }
        };
      });
    },
    async reserve(scope: DesignScope, prompt: string, references: readonly DesignDialogueManifestReference[], assertCurrent = () => {}) {
      const newId = options.newId ?? (() => crypto.randomUUID());
      assertCurrent();
      const proposed = validateEntryDraft({ version: 1, scope: { ...scope }, projectId: newId(), conversationId: newId(), prompt,
        references: structuredClone([...references]), createAttempted: false, ready: false }, scope);
      return transact<DesignEntryDraft>('readwrite', (tx, finish, fail) => {
        const drafts = tx.objectStore('drafts');
        const active = tx.objectStore('active');
        const current = active.get(activeKey(scope, prompt, references));
        const add = () => { assertCurrent(); drafts.add(proposed, key(scope, proposed.projectId, proposed.conversationId));
          active.put([proposed.projectId, proposed.conversationId], activeKey(scope, prompt, references)); finish(proposed); };
        current.onsuccess = () => {
          try { assertCurrent(); } catch (error) { return fail(error); }
          if (!current.result) { try { add(); } catch (error) { fail(error); } return; }
          const read = drafts.get(key(scope, current.result[0], current.result[1]));
          read.onsuccess = () => {
            try {
              assertCurrent();
              if (!read.result) throw new Error('design_entry_draft_missing');
              const existing = validateEntryDraft(read.result, scope);
              if (existing.projectId !== current.result[0] || existing.conversationId !== current.result[1]) throw new Error('design_entry_draft_mismatch');
              if (existing.consumed) { add(); return; }
              if (existing.prompt === prompt && JSON.stringify(existing.references) === JSON.stringify(references)) return finish(existing);
              throw new Error('design_entry_draft_mismatch');
            } catch (error) { fail(error); }
          };
        };
      });
    },
    /** Bind the durably admitted first assistant attempt and release the exact-input pointer. */
    async consume(scope: DesignScope, projectId: string, conversationId: string, requestId: string, assertCurrent = () => {}) {
      return transact<DesignEntryDraft>('readwrite', (tx, finish, fail) => {
        const drafts = tx.objectStore('drafts');
        const read = drafts.get(key(scope, projectId, conversationId));
        read.onsuccess = () => {
          try {
            assertCurrent();
            const draft = validateEntryDraft(read.result, scope);
            if (!draft.ready || draft.projectId !== projectId || draft.conversationId !== conversationId
              || !identity(requestId) || (draft.initialRequestId && draft.initialRequestId !== requestId)) throw new Error('design_entry_consumption_mismatch');
            draft.consumed = true;
            draft.initialRequestId = requestId;
            drafts.put(draft, key(scope, projectId, conversationId));
            // Reserve also checks consumed atomically, so older active pointers are harmless.
            finish(draft);
          } catch (error) { fail(error); }
        };
      });
    },
    /** Atomically claim the single remote create before sending it. Reloads only GET it. */
    async mark(scope: DesignScope, projectId: string, conversationId: string, ready: boolean, assertCurrent = () => {}) {
      return transact<{ draft: DesignEntryDraft; sendCreate: boolean }>('readwrite', (tx, finish, fail) => {
        const drafts = tx.objectStore('drafts');
        const read = drafts.get(key(scope, projectId, conversationId));
        read.onsuccess = () => {
          try {
            assertCurrent();
            const draft = validateEntryDraft(read.result, scope);
            if (draft.projectId !== projectId || draft.conversationId !== conversationId) throw new Error('design_entry_draft_mismatch');
            const sendCreate = !draft.createAttempted;
            if (ready && sendCreate) throw new Error('design_entry_draft_invalid');
            draft.createAttempted = true;
            draft.ready = draft.ready || ready;
            drafts.put(draft, key(scope, projectId, conversationId));
            finish({ draft, sendCreate });
          } catch (error) { fail(error); }
        };
      });
    },
  };
};

export type EntryDraftStore = ReturnType<typeof createEntryDraftStore>;
