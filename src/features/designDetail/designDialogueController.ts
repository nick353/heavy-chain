import type { CloudflareDesignAssistantReceipt, CloudflareDesignAssistantRequestInput } from '../../lib/cloudflareApi';
import type { DesignDialogueManifestReference } from '../../lib/designDialogueReferences';
import type { ImageEditResult } from '../../lib/imageApi';
import type { CanvasDocumentRecord } from '../../lib/canvasDocumentPersistence';
import { createTurnRunner, type DesignTurnGenerateInput } from './turnRunner';
import type { DesignSessionStore } from './sessionStore';
import type { DesignEntryDraft, EntryDraftStore } from './entryDraftStore';
import type { DialogueAttempt, DialogueStore } from './dialogueStore';
import { createDesignCanvasAdapter, selectedDesignReference, type DesignCanvasClient } from './designCanvasAdapter';
import type { DesignScope, DesignTurn, DesignTurnOutput } from './types';

export type DesignDialogueClient = DesignCanvasClient & {
  sendAssistant: (input: CloudflareDesignAssistantRequestInput, context: { userId: string; assertContext: () => void }) => Promise<CloudflareDesignAssistantReceipt>;
  readAssistant: (input: Pick<CloudflareDesignAssistantRequestInput, 'requestId' | 'brandId' | 'projectId' | 'conversationId'>, context: { userId: string; assertContext: () => void }) => Promise<CloudflareDesignAssistantReceipt>;
  generate: (input: DesignTurnGenerateInput) => Promise<ImageEditResult>;
  readImage: (requestId: string) => Promise<Record<string, unknown>>;
  acknowledgeImage: (input: { requestId: string; clientRecoveryKey: string }) => Promise<void>;
  resolveImage: (storagePath: string) => Promise<{ ok: boolean; url?: string }>;
};
export type DesignDialogueState = { attempts: DialogueAttempt[]; document: CanvasDocumentRecord; outputs: DesignTurnOutput[]; turns: readonly DesignTurn[];
  recoveryErrors: Record<string, 'design_initial_lock_unavailable' | 'design_attempt_reconciliation_failed'> };
// Share only live work, by the complete scoped identity. Durable admission is still the authority.
const flights = new Map<string, Promise<void>>();
export function createDesignDialogueController(options: { scope: DesignScope; projectId: string; conversationId: string;
  drafts: EntryDraftStore; dialogues: DialogueStore; sessions: DesignSessionStore; client: DesignDialogueClient;
  assertContext: () => void; publish: (state: DesignDialogueState) => void }) {
  const { scope, projectId, conversationId, drafts, dialogues, sessions, client, assertContext } = options;
  const context = { userId: scope.userId, assertContext };
  const canvas = createDesignCanvasAdapter({ scope, projectId, conversationId, client, assertContext });
  const runners = new Map<string, ReturnType<typeof createTurnRunner>>();
  const recoveryErrors: DesignDialogueState['recoveryErrors'] = {};
  async function refresh() {
    assertContext();
    const document = await canvas.read(); assertContext();
    const session = await sessions.getSession(scope, conversationId); assertContext();
    if (!session || session.projectId !== projectId) throw new Error('design_dialogue_association_missing');
    const attempts = await dialogues.list(scope, projectId, conversationId, assertContext); assertContext();
    const state = { document, attempts, outputs: session.turns.flatMap((turn) => [...turn.outputs]), turns: session.turns, recoveryErrors: { ...recoveryErrors } };
    options.publish(state);
    return state;
  }
  async function run(attempt: DialogueAttempt, send: boolean, allowNewImage: boolean, initial?: DesignEntryDraft) {
    const flightKey = JSON.stringify([scope.userId, scope.brandId, projectId, conversationId, attempt.input.requestId]);
    const existing = flights.get(flightKey);
    if (existing) { await existing; assertContext(); await refresh(); return; }
    let sendNow = send;
    let allowImage = allowNewImage;
    let current = attempt;
    const process = async () => {
      assertContext();
      let receipt: CloudflareDesignAssistantReceipt;
      try {
        receipt = sendNow ? await client.sendAssistant(current.input, context) : await client.readAssistant(current.input, context);
        assertContext();
      } catch (cause) {
        assertContext();
        // The server has no record of this ID: the page closed before the POST arrived. The POST is idempotent per
        // request ID, so sending the SAME ID once is safe and is the only way the request can ever finish; it then
        // continues to the image like the original send would have.
        const neverReceived = !sendNow && cause instanceof Error && cause.message === 'cloudflare_api_404_not_found';
        if (neverReceived) {
          allowImage = true;
          try { receipt = await client.sendAssistant(current.input, context); assertContext(); }
          catch {
            assertContext();
            try { receipt = await client.readAssistant(current.input, context); assertContext(); }
            catch { assertContext(); receipt = { ...current.assistant, state: 'unknown' }; }
          }
        // POST uncertainty has one read of the SAME ID, never another POST.
        } else if (sendNow) {
          try { receipt = await client.readAssistant(current.input, context); assertContext(); }
          catch { assertContext(); receipt = { ...current.assistant, state: 'unknown' }; }
        } else receipt = { ...current.assistant, state: 'unknown' };
      }
      // Keep a verified terminal receipt even when a subsequent network read is unavailable.
      if ((current.assistant.state === 'completed' || current.assistant.state === 'failed') && receipt.state === 'unknown') receipt = current.assistant;
      current = await dialogues.receipt(scope, attempt.input, receipt, assertContext); assertContext();
      await refresh();
      if (current.assistant.state !== 'completed') return;
      if (!current.imageAttempted && !allowImage) return;
      const claim = await dialogues.image(scope, current.input, undefined, assertContext); assertContext();
      let runner = runners.get(current.input.requestId);
      if (!runner) {
        let imageDispatched = false;
        runner = createTurnRunner({ store: sessions, assertContext, readRequest: client.readImage, acknowledge: client.acknowledgeImage,
        adoptOutputs: canvas.adoptOutputs,
        generate: async (input) => {
          assertContext();
          // L2's definite-404 recovery may create a request. Reload/reconciliation is deliberately read-only here.
          if (!allowImage || !claim.created || imageDispatched) throw new Error('design_image_reconciliation_only');
          imageDispatched = true;
          return client.generate(input);
        } });
        runners.set(current.input.requestId, runner);
      }
      const result = await runner.runTurn(scope, { conversationId, clientRequestKey: current.imageClientRequestKey,
        prompt: current.input.prompt, references: current.input.references }); assertContext();
      await dialogues.image(scope, current.input, result.kind, assertContext); assertContext();
      await refresh();
    };
    const operation = Promise.resolve().then(async () => {
      assertContext();
      if (!initial) return process();
      const locks = globalThis.navigator?.locks;
      if (!locks) throw new Error('design_initial_lock_unavailable');
      // The same lock covers fresh admission AND an admitted pre-consumption crash.
      // Holding it through dispatch uncertainty prevents another tab from consuming a stale draft and posting again.
      await locks.request(`heavy-design-initial:${flightKey}`, async () => {
        assertContext();
        const fresh = await drafts.get(scope, projectId, conversationId); assertContext();
        const attempts = await dialogues.list(scope, projectId, conversationId, assertContext); assertContext();
        const bound = attempts[0];
        if (!fresh?.ready || !bound || bound.input.requestId !== attempt.input.requestId
          || JSON.stringify(bound.input) !== JSON.stringify(attempt.input)
          || fresh.prompt !== bound.input.prompt || JSON.stringify(fresh.references) !== JSON.stringify(bound.input.references)
          || (fresh.initialRequestId && fresh.initialRequestId !== bound.input.requestId)) throw new Error('design_dialogue_initial_attempt_mismatch');
        current = bound;
        // All initial POST paths consume first. A fresh, unconsumed, still-running record with no image claim
        // proves pre-dispatch interruption. Unknown/terminal records never authorize a POST.
        sendNow = !fresh.consumed && bound.assistant.state === 'running' && !bound.imageAttempted;
        allowImage = sendNow;
        if (!fresh.consumed) { await drafts.consume(scope, projectId, conversationId, bound.input.requestId, assertContext); assertContext(); }
        await process();
      });
    });
    flights.set(flightKey, operation);
    try { await operation; } finally { if (flights.get(flightKey) === operation) flights.delete(flightKey); }
  }
  return {
    refresh,
    async initialize(draft: DesignEntryDraft) {
      assertContext();
      if (!draft.ready || draft.projectId !== projectId || draft.conversationId !== conversationId
        || draft.scope.userId !== scope.userId || draft.scope.brandId !== scope.brandId) throw new Error('design_dialogue_draft_mismatch');
      const state = await refresh();
      if (!state.attempts.length) {
        if (draft.consumed) throw new Error('design_dialogue_initial_attempt_missing');
        const admission = await dialogues.admit(scope, { brandId: scope.brandId, projectId, conversationId,
          prompt: draft.prompt, references: [...draft.references], history: [] }, true, assertContext); assertContext();
        await run(admission.attempt, admission.created, admission.created, draft);
      } else {
        if (draft.consumed && draft.initialRequestId !== state.attempts[0].input.requestId) throw new Error('design_dialogue_initial_attempt_mismatch');
        for (const [index, attempt] of state.attempts.entries()) {
          assertContext();
          try {
            await run(attempt, false, false, index === 0 ? draft : undefined);
            delete recoveryErrors[attempt.input.requestId];
          } catch (error) {
            assertContext(); // Auth/scope changes still stop the whole obsolete operation.
            recoveryErrors[attempt.input.requestId] = error instanceof Error && error.message === 'design_initial_lock_unavailable'
              ? 'design_initial_lock_unavailable' : 'design_attempt_reconciliation_failed';
          }
        }
        await refresh();
      }
    },
    async send(prompt: string, references: readonly DesignDialogueManifestReference[], selectedObjectId?: string) {
      assertContext();
      const state = await refresh();
      const selected = selectedObjectId ? selectedDesignReference(state.document, scope, projectId, selectedObjectId, state.outputs) : undefined;
      const canonical = selected ? [selected, ...references.filter((reference) => reference.imageId !== selected.imageId)] : [...references];
      if (canonical.length > 16) throw new Error('design_dialogue_reference_limit');
      const history = state.attempts.flatMap((attempt): CloudflareDesignAssistantRequestInput['history'] => [
        { role: 'user', content: attempt.input.prompt },
        ...(attempt.assistant.state === 'completed' ? [{ role: 'assistant' as const, content: attempt.assistant.content! }] : []),
      ]).slice(-8);
      while (history.reduce((total, message) => total + message.content.length, 0) > 16000) history.shift();
      const admission = await dialogues.admit(scope, { brandId: scope.brandId, projectId, conversationId, prompt,
        history, references: canonical.map((reference, order) => ({ ...reference, order })) }, false, assertContext); assertContext();
      await run(admission.attempt, admission.created, admission.created);
    },
    async reconcile(requestId: string) {
      const attempts = await dialogues.list(scope, projectId, conversationId, assertContext); assertContext();
      const attempt = attempts.find((item) => item.input.requestId === requestId);
      if (!attempt) throw new Error('design_dialogue_attempt_missing');
      await run(attempt, false, false);
    },
    async continueImage(requestId: string) {
      const attempts = await dialogues.list(scope, projectId, conversationId, assertContext); assertContext();
      const attempt = attempts.find((item) => item.input.requestId === requestId);
      if (!attempt || attempt.assistant.state !== 'completed' || attempt.imageAttempted) throw new Error('design_image_reconciliation_only');
      await run(attempt, false, true);
    },
  };
}
