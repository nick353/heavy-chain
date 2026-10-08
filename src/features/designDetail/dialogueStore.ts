import type { CloudflareDesignAssistantReceipt, CloudflareDesignAssistantRequestInput } from '../../lib/cloudflareApi';
import { validateEntryDraft } from './entryDraftStore';
import type { DesignScope } from './types';
import type { DesignTurnRunKind } from './turnRunner';

export const DESIGN_DIALOGUE_DB = 'heavy-design-dialogue-attempts-v1';
export type DialogueAttempt = {
  version: 1;
  scope: DesignScope;
  input: CloudflareDesignAssistantRequestInput;
  imageClientRequestKey: string;
  assistant: CloudflareDesignAssistantReceipt;
  imageAttempted: boolean;
  imageResult?: DesignTurnRunKind;
};
type Conversation = { scope: DesignScope; projectId: string; conversationId: string; initialRequestId?: string; attempts: DialogueAttempt[] };
const key = (scope: DesignScope, projectId: string, conversationId: string): IDBValidKey => [scope.userId, scope.brandId, projectId, conversationId];
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const assertConversation = (value: Conversation, scope: DesignScope, projectId: string, conversationId: string) => {
  if (!value || value.scope?.userId !== scope.userId || value.scope?.brandId !== scope.brandId
    || value.projectId !== projectId || value.conversationId !== conversationId || !Array.isArray(value.attempts)) throw new Error('design_dialogue_scope_mismatch');
  for (const attempt of value.attempts) {
    const input = attempt.input;
    if (attempt.version !== 1 || attempt.scope?.userId !== scope.userId || attempt.scope?.brandId !== scope.brandId
      || !input || input.brandId !== scope.brandId || input.projectId !== projectId || input.conversationId !== conversationId
      || !uuid(input.requestId) || !uuid(attempt.imageClientRequestKey) || typeof attempt.imageAttempted !== 'boolean'
      || attempt.assistant?.requestId !== input.requestId) throw new Error('design_dialogue_record_invalid');
    validateEntryDraft({ version: 1, scope, projectId, conversationId, prompt: input.prompt, references: input.references,
      ready: true, createAttempted: true }, scope);
  }
  if (new Set(value.attempts.map((attempt) => attempt.input.requestId)).size !== value.attempts.length
    || new Set(value.attempts.map((attempt) => attempt.imageClientRequestKey)).size !== value.attempts.length
    || (value.initialRequestId && value.attempts[0]?.input.requestId !== value.initialRequestId)) throw new Error('design_dialogue_record_invalid');
  return value;
};

/** One small conversation record gives IDB a single atomic winner across tabs and mounts. */
export function createDialogueStore(options: { idb: IDBFactory; dbName?: string; newId?: () => string }) {
  let dbPromise: Promise<IDBDatabase> | undefined;
  const database = () => dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = options.idb.open(options.dbName ?? DESIGN_DIALOGUE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('conversations');
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => reject(new Error('design_dialogue_storage_unavailable'));
  });
  async function access<T>(scope: DesignScope, projectId: string, conversationId: string, mode: IDBTransactionMode,
    work: (value: Conversation) => T, assertCurrent = () => {}) {
    assertCurrent();
    const db = await database(); assertCurrent();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('conversations', mode);
      const store = tx.objectStore('conversations');
      let result: T;
      let failure: unknown;
      tx.oncomplete = () => resolve(structuredClone(result));
      tx.onabort = tx.onerror = () => reject(failure ?? new Error('design_dialogue_persist_failed'));
      const read = store.get(key(scope, projectId, conversationId));
      read.onsuccess = () => {
        try {
          assertCurrent();
          const value = assertConversation(read.result ?? { scope: { ...scope }, projectId, conversationId, attempts: [] }, scope, projectId, conversationId);
          result = work(value);
          if (mode === 'readwrite') store.put(value, key(scope, projectId, conversationId));
        } catch (error) { failure = error; tx.abort(); }
      };
    });
  }
  return {
    list: (scope: DesignScope, projectId: string, conversationId: string, assertCurrent = () => {}) =>
      access(scope, projectId, conversationId, 'readonly', (value) => value.attempts, assertCurrent),
    admit(scope: DesignScope, input: Omit<CloudflareDesignAssistantRequestInput, 'requestId'>, initial: boolean, assertCurrent = () => {}) {
      return access(scope, input.projectId, input.conversationId, 'readwrite', (value) => {
        if (initial && value.initialRequestId) {
          const attempt = value.attempts.find((item) => item.input.requestId === value.initialRequestId);
          if (!attempt || attempt.input.prompt !== input.prompt || JSON.stringify(attempt.input.references) !== JSON.stringify(input.references)) throw new Error('design_dialogue_initial_mismatch');
          return { attempt, created: false };
        }
        const newId = options.newId ?? (() => crypto.randomUUID());
        const requestId = newId();
        const attempt: DialogueAttempt = { version: 1, scope: { ...scope }, input: { ...structuredClone(input), requestId }, imageClientRequestKey: newId(), imageAttempted: false,
          assistant: { requestId, state: 'running', provider: 'workers-ai', model: '@cf/meta/llama-4-scout-17b-16e-instruct' } };
        value.attempts.push(attempt);
        if (initial) value.initialRequestId = requestId;
        assertConversation(value, scope, input.projectId, input.conversationId);
        return { attempt, created: true };
      }, assertCurrent);
    },
    receipt(scope: DesignScope, input: CloudflareDesignAssistantRequestInput, receipt: CloudflareDesignAssistantReceipt, assertCurrent = () => {}) {
      return access(scope, input.projectId, input.conversationId, 'readwrite', (value) => {
        const attempt = value.attempts.find((item) => item.input.requestId === input.requestId);
        if (!attempt || JSON.stringify(attempt.input) !== JSON.stringify(input) || receipt.requestId !== input.requestId
          || (receipt.provider !== 'anthropic' && receipt.provider !== 'workers-ai') || typeof receipt.model !== 'string' || !receipt.model
          || !['running', 'completed', 'failed', 'unknown'].includes(receipt.state)
          || (receipt.state === 'completed' && (typeof receipt.content !== 'string' || !receipt.content.trim()))) throw new Error('design_assistant_receipt_unverified');
        if (attempt.assistant.state === 'completed' || attempt.assistant.state === 'failed') {
          if (receipt.state !== attempt.assistant.state || receipt.content !== attempt.assistant.content) throw new Error('design_assistant_receipt_changed');
        } else attempt.assistant = structuredClone(receipt);
        return attempt;
      }, assertCurrent);
    },
    image(scope: DesignScope, input: CloudflareDesignAssistantRequestInput, result?: DesignTurnRunKind, assertCurrent = () => {}) {
      return access(scope, input.projectId, input.conversationId, 'readwrite', (value) => {
        const attempt = value.attempts.find((item) => item.input.requestId === input.requestId);
        if (!attempt || JSON.stringify(attempt.input) !== JSON.stringify(input) || attempt.assistant.state !== 'completed') throw new Error('design_image_admission_invalid');
        const created = !attempt.imageAttempted;
        attempt.imageAttempted = true;
        if (result) attempt.imageResult = result;
        return { attempt, created };
      }, assertCurrent);
    },
  };
}
export type DialogueStore = ReturnType<typeof createDialogueStore>;
