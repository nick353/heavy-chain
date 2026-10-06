import {
  createTurnRunner,
  type DesignTurnGenerateInput,
  type DesignTurnRunInput,
  type DesignTurnRunnerDependencies,
} from './turnRunner.ts';
import type { DesignScope, DesignTurn, DesignTurnOutput, DesignTurnPatch } from './types.ts';
import type { DesignDialogueManifestReference } from '../../lib/designDialogueReferences.ts';
import type { ImageEditResult } from '../../lib/imageApi.ts';

type TestFunction = (name: string, action: () => void | Promise<void>) => void;
type StrictAssert = {
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  equal(actual: unknown, expected: unknown, message?: string): void;
  ok(value: unknown, message?: string): asserts value;
  rejects(promise: Promise<unknown>, predicate?: (error: unknown) => boolean | void): Promise<void>;
};

const nodeAssertModule: string = 'node:assert/strict';
const nodeTestModule: string = 'node:test';
const [assertModule, testModule] = await Promise.all([
  import(nodeAssertModule) as Promise<StrictAssert>,
  import(nodeTestModule) as Promise<{ default: TestFunction }>,
]);
const assert: StrictAssert = assertModule;
const test = testModule.default;

const scope: DesignScope = { userId: 'turn-user', brandId: 'turn-brand' };
const references: readonly DesignDialogueManifestReference[] = Object.freeze(Array.from({ length: 16 }, (_, order) => Object.freeze({
  order,
  kind: order % 2 === 0 ? 'upload' as const : 'scene-asset' as const,
  imageId: `reference-image-${order}`,
  storagePath: order % 2 === 0 ? `workspace-artifacts/reference-${order}` : `scene-assets/reference-${order}.png`,
  name: `Reference ${order}`,
  ...(order % 2 === 1 ? { sceneAssetKey: `scene/${order}` } : {}),
})));
const input: DesignTurnRunInput = Object.freeze({
  conversationId: 'conversation-one',
  clientRequestKey: 'client-turn-one',
  prompt: '  Keep the collar seam exact.\nAdd the uploaded blue weave. 🧵  ',
  references,
});

const clone = <T>(value: T): T => structuredClone(value);
const admissionKey = (scopeValue: DesignScope, conversationId: string, clientRequestKey: string) =>
  JSON.stringify([scopeValue.userId, scopeValue.brandId, conversationId, clientRequestKey]);

let generatedIds = 0;
const uuid = (): string => `00000000-0000-4000-8000-${(++generatedIds).toString(16).padStart(12, '0')}`;

class MemoryStore {
  readonly turns = new Map<string, DesignTurn>();
  readonly admissions = new Map<string, string>();
  admitCalls = 0;
  updateCalls = 0;
  ackCalls = 0;
  failUpdates = 0;
  failAcks = 0;

  async admitTurn(scopeValue: DesignScope, value: DesignTurnRunInput): Promise<{ turn: DesignTurn; created: boolean }> {
    this.admitCalls += 1;
    const key = admissionKey(scopeValue, value.conversationId, value.clientRequestKey);
    const existingId = this.admissions.get(key);
    if (existingId) {
      const existing = this.turns.get(existingId);
      assert.ok(existing, 'admission points to a stored turn');
      if (existing.prompt !== value.prompt || JSON.stringify(existing.references) !== JSON.stringify(value.references)) {
        throw Object.assign(new Error('turn_input_mismatch'), { code: 'turn_input_mismatch' });
      }
      return { turn: clone(existing), created: false };
    }
    const turn: DesignTurn = {
      turnId: uuid(),
      requestId: uuid(),
      clientRequestKey: value.clientRequestKey,
      prompt: value.prompt,
      references: clone(value.references),
      status: 'pending',
      outputs: [],
    };
    this.admissions.set(key, turn.turnId);
    this.turns.set(turn.turnId, turn);
    return { turn: clone(turn), created: true };
  }

  async updateTurn(_scope: DesignScope, turnId: string, patch: DesignTurnPatch): Promise<DesignTurn> {
    this.updateCalls += 1;
    if (this.failUpdates > 0) {
      this.failUpdates -= 1;
      throw new Error('store_update_failed');
    }
    const current = this.turns.get(turnId);
    if (!current) throw new Error('not_found');
    const next = clone({ ...current, ...patch });
    this.turns.set(turnId, next);
    return clone(next);
  }

  async ackTurn(_scope: DesignScope, turnId: string, ackedAt: string): Promise<DesignTurn> {
    this.ackCalls += 1;
    if (this.failAcks > 0) {
      this.failAcks -= 1;
      throw new Error('store_ack_failed');
    }
    const current = this.turns.get(turnId);
    if (!current) throw new Error('not_found');
    const next = clone({ ...current, ackedAt });
    this.turns.set(turnId, next);
    return clone(next);
  }

  async getSession(scopeValue: DesignScope, conversationId: string) {
    const turnIds = [...this.turns.values()]
      .filter((turn) => this.admissions.get(admissionKey(scopeValue, conversationId, turn.clientRequestKey)) === turn.turnId)
      .map(clone);
    return turnIds.length === 0 ? null : {
      conversationId,
      projectId: 'project-one',
      scope: clone(scopeValue),
      turns: turnIds,
    };
  }

  seed(value: DesignTurnRunInput, turn: DesignTurn): void {
    const key = admissionKey(scope, value.conversationId, value.clientRequestKey);
    this.admissions.set(key, turn.turnId);
    this.turns.set(turn.turnId, clone(turn));
  }

  find(scopeValue: DesignScope, conversationId: string, clientRequestKey: string): DesignTurn | undefined {
    const turnId = this.admissions.get(admissionKey(scopeValue, conversationId, clientRequestKey));
    const value = turnId ? this.turns.get(turnId) : undefined;
    return value ? clone(value) : undefined;
  }
}

type HarnessOptions = Readonly<{
  generate?: (value: DesignTurnGenerateInput) => Promise<ImageEditResult>;
  readRequest?: (requestId: string) => Promise<Record<string, unknown>>;
  acknowledge?: (value: { requestId: string; clientRecoveryKey: string }) => Promise<void>;
  adoptOutputs?: (turn: DesignTurn, outputs: readonly DesignTurnOutput[]) => Promise<void>;
}>;

const receiptFor = (requestId: string, includeRecoveryKey = true): Record<string, unknown> => {
  const jobId = 'job-turn-42';
  const images = [0, 1].map((candidateIndex) => {
    const imageId = `${jobId}-${candidateIndex}`;
    return {
      id: imageId,
      imageId,
      jobId,
      storagePath: `generated-images/${imageId}`,
      imageUrl: `https://media.example/${imageId}`,
      candidateIndex,
      persistenceStatus: 'completed',
    };
  });
  return {
    success: true,
    requestId,
    state: 'completed',
    status: 'completed',
    persistenceStatus: 'completed',
    requestedCandidateCount: images.length,
    persistedCandidateCount: images.length,
    jobId,
    imageId: images[0]?.imageId,
    storagePath: images[0]?.storagePath,
    imageUrl: images[0]?.imageUrl,
    images,
    ...(includeRecoveryKey ? { clientRecoveryKey: 'actual-provider-recovery-key' } : {}),
  };
};

const imageResult = (value: Record<string, unknown>): ImageEditResult => value as unknown as ImageEditResult;
const outputsFor = (requestId: string): readonly DesignTurnOutput[] => {
  const receipt = receiptFor(requestId) as { images: Array<Record<string, unknown>> };
  return receipt.images.map((image) => ({
    imageId: image.imageId as string,
    storagePath: image.storagePath as string,
    jobId: image.jobId as string,
    candidateIndex: image.candidateIndex as number,
  }));
};

const turnFor = (status: DesignTurn['status'], patch: Partial<DesignTurn> = {}): DesignTurn => {
  const turnId = uuid();
  const requestId = uuid();
  const successfulOutputs = status === 'succeeded' ? outputsFor(requestId) : [];
  return {
    turnId,
    requestId,
    clientRequestKey: input.clientRequestKey,
    prompt: input.prompt,
    references: clone(input.references),
    status,
    outputs: successfulOutputs,
    ...(status === 'succeeded' ? { jobId: successfulOutputs[0]?.jobId } : {}),
    ...patch,
  };
};

const createHarness = (options: HarnessOptions = {}) => {
  const store = new MemoryStore();
  const calls = {
    generated: [] as DesignTurnGenerateInput[],
    read: [] as string[],
    acknowledged: [] as Array<{ requestId: string; clientRecoveryKey: string }>,
    adopted: [] as Array<{ turn: DesignTurn; outputs: readonly DesignTurnOutput[] }>,
  };
  let contextActive = true;
  const dependencies: DesignTurnRunnerDependencies = {
    store,
    generate: async (value) => {
      calls.generated.push(value);
      return options.generate ? await options.generate(value) : imageResult(receiptFor(value.idempotencyKey));
    },
    readRequest: async (requestId) => {
      calls.read.push(requestId);
      if (options.readRequest) return await options.readRequest(requestId);
      throw new Error('cloudflare_api_404_image_request_not_found');
    },
    acknowledge: async (value) => {
      calls.acknowledged.push(value);
      if (options.acknowledge) await options.acknowledge(value);
    },
    adoptOutputs: async (_scope, turn, outputs) => {
      calls.adopted.push({ turn: clone(turn), outputs: clone(outputs) });
      if (options.adoptOutputs) await options.adoptOutputs(turn, outputs);
    },
    assertContext: () => {
      if (!contextActive) throw new Error('scope_epoch_changed');
    },
  };
  const runner = createTurnRunner(dependencies);
  return {
    store,
    calls,
    runner,
    setContextActive: (active: boolean) => { contextActive = active; },
  };
};

const tick = async (): Promise<void> => await new Promise((resolve) => setTimeout(resolve, 0));

test('a new turn is persisted before one exact-prompt generation with all 16 ordered references', async () => {
  const harness = createHarness({
    generate: async (value) => {
      const stored = harness.store.find(scope, input.conversationId, input.clientRequestKey);
      assert.ok(stored, 'turn exists before generation starts');
      assert.equal(stored.status, 'submitted');
      assert.equal(value.prompt, input.prompt);
      assert.equal(value.brandId, scope.brandId);
      assert.deepEqual(value.references, input.references);
      assert.equal(value.references.length, 16);
      assert.equal(value.idempotencyKey, stored.requestId);
      assert.equal(value.retainUntilAcknowledged, true);
      value.assertContext();
      return imageResult(receiptFor(value.idempotencyKey));
    },
  });
  const result = await harness.runner.runTurn(scope, input);
  assert.equal(result.kind, 'completed');
  assert.equal(harness.calls.generated.length, 1);
  assert.equal(harness.calls.read.length, 0);
  assert.equal(harness.calls.acknowledged.length, 1);
  assert.equal(harness.store.find(scope, input.conversationId, input.clientRequestKey)?.ackedAt !== undefined, true);
});

test('same-turn double clicks validate both admissions and share one provider invocation', async () => {
  let release: ((value: ImageEditResult) => void) | undefined;
  const held = new Promise<ImageEditResult>((resolve) => { release = resolve; });
  const harness = createHarness({ generate: async () => await held });
  const first = harness.runner.runTurn(scope, input);
  while (harness.calls.generated.length === 0) await tick();
  const second = harness.runner.runTurn(scope, input);
  await tick();
  assert.equal(harness.store.admitCalls, 2);
  assert.equal(harness.calls.generated.length, 1);
  release?.(imageResult(receiptFor(harness.calls.generated[0]!.idempotencyKey)));
  const results = await Promise.all([first, second]);
  assert.equal(results[0]?.kind, 'completed');
  assert.equal(results[1]?.kind, 'completed');
  assert.equal(harness.calls.generated.length, 1);
});

test('a changed same-key prompt rejects before joining the in-flight operation', async () => {
  let release: ((value: ImageEditResult) => void) | undefined;
  const held = new Promise<ImageEditResult>((resolve) => { release = resolve; });
  const harness = createHarness({ generate: async () => await held });
  const first = harness.runner.runTurn(scope, input);
  while (harness.calls.generated.length === 0) await tick();
  await assert.rejects(
    harness.runner.runTurn(scope, { ...input, prompt: `${input.prompt} changed` }),
    (error) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'turn_input_mismatch',
  );
  assert.equal(harness.calls.generated.length, 1);
  release?.(imageResult(receiptFor(harness.calls.generated[0]!.idempotencyKey)));
  assert.equal((await first).kind, 'completed');
});

test('reopened pending turn reads first and after definite 404 reuses the stored request ID', async () => {
  const harness = createHarness({
    readRequest: async () => { throw new Error('cloudflare_api_404_image_request_not_found'); },
  });
  const admission = await harness.store.admitTurn(scope, input);
  harness.store.turns.set(admission.turn.turnId, { ...admission.turn, status: 'unknown' });
  const result = await harness.runner.runTurn(scope, input);
  assert.equal(result.kind, 'completed');
  assert.deepEqual(harness.calls.read, [admission.turn.requestId]);
  assert.equal(harness.calls.generated.length, 1);
  assert.equal(harness.calls.generated[0]?.idempotencyKey, admission.turn.requestId);
  assert.equal(harness.calls.generated[0]?.prompt, admission.turn.prompt);
  assert.deepEqual(harness.calls.generated[0]?.references, admission.turn.references);
});

test('an unknown non-404 read never submits a provider request', async () => {
  const harness = createHarness({
    readRequest: async () => { throw new Error('cloudflare_api_503_request_failed'); },
  });
  const admission = await harness.store.admitTurn(scope, input);
  harness.store.turns.set(admission.turn.turnId, { ...admission.turn, status: 'submitted' });
  const result = await harness.runner.runTurn(scope, input);
  assert.equal(result.kind, 'unknown');
  assert.equal(harness.calls.read.length, 1);
  assert.equal(harness.calls.generated.length, 0);
  assert.equal(harness.store.find(scope, input.conversationId, input.clientRequestKey)?.status, 'unknown');
});

test('a flattened generate failure stays unknown unless the exact GET proves terminal failure', async () => {
  const harness = createHarness({
    generate: async () => ({ success: false, error: 'provider_failed' }),
    readRequest: async () => { throw new Error('cloudflare_api_503_request_failed'); },
  });
  const result = await harness.runner.runTurn(scope, input);
  assert.equal(result.kind, 'unknown');
  const stored = harness.store.find(scope, input.conversationId, input.clientRequestKey);
  assert.equal(stored?.status, 'unknown');
  assert.equal(stored?.failureCode, undefined);
  assert.equal(harness.calls.generated.length, 1);
});

test('only a complete canonical receipt is adopted', async () => {
  const malformed = receiptFor('unused') as Record<string, unknown>;
  malformed.persistedCandidateCount = malformed.requestedCandidateCount;
  delete malformed.persistedCandidateCount;
  const harness = createHarness({
    generate: async (value) => imageResult({ ...malformed, requestId: value.idempotencyKey }),
    readRequest: async (requestId) => ({ ...malformed, requestId }),
  });
  const result = await harness.runner.runTurn(scope, input);
  assert.equal(result.kind, 'unknown');
  assert.equal(harness.calls.adopted.length, 0);
  assert.equal(harness.calls.acknowledged.length, 0);
  assert.equal(harness.store.find(scope, input.conversationId, input.clientRequestKey)?.status, 'unknown');
});

test('a storage update failure prevents adoption and acknowledgement', async () => {
  const harness = createHarness();
  harness.store.failUpdates = 1;
  const result = await harness.runner.runTurn(scope, input);
  assert.equal(result.kind, 'unknown');
  assert.equal(harness.calls.generated.length, 0);
  assert.equal(harness.calls.adopted.length, 0);
  assert.equal(harness.calls.acknowledged.length, 0);
  assert.equal(harness.store.find(scope, input.conversationId, input.clientRequestKey)?.status, 'pending');
});

test('adoption failure leaves canonical outputs stored and does not acknowledge the provider', async () => {
  const harness = createHarness({ adoptOutputs: async () => { throw new Error('adoption_failed'); } });
  const result = await harness.runner.runTurn(scope, input);
  assert.equal(result.kind, 'adoption-pending');
  const stored = harness.store.find(scope, input.conversationId, input.clientRequestKey);
  assert.equal(stored?.status, 'succeeded');
  assert.equal(stored?.outputs.length, 2);
  assert.equal(stored?.ackedAt, undefined);
  assert.equal(harness.calls.acknowledged.length, 0);
});

test('provider acknowledgement failure recovers with GET, adoption, and the same live key only', async () => {
  const harness = createHarness({
    readRequest: async (requestId) => receiptFor(requestId, false),
    acknowledge: async (_value) => {
      if (harness.calls.acknowledged.length === 1) throw new Error('provider_ack_failed');
    },
  });
  const first = await harness.runner.runTurn(scope, input);
  assert.equal(first.kind, 'ack-deferred');
  assert.equal(harness.store.find(scope, input.conversationId, input.clientRequestKey)?.ackedAt, undefined);
  const second = await harness.runner.runTurn(scope, input);
  assert.equal(second.kind, 'completed');
  assert.equal(harness.calls.generated.length, 1);
  assert.equal(harness.calls.read.length, 1);
  assert.equal(harness.calls.acknowledged.length, 2);
  assert.equal(harness.calls.acknowledged[0]?.clientRecoveryKey, harness.calls.acknowledged[1]?.clientRecoveryKey);
});

test('local acknowledgement failure remains deferred and retries only GET/adoption/ack', async () => {
  const harness = createHarness({ readRequest: async (requestId) => receiptFor(requestId, false) });
  harness.store.failAcks = 1;
  const first = await harness.runner.runTurn(scope, input);
  assert.equal(first.kind, 'ack-deferred');
  assert.equal(harness.store.find(scope, input.conversationId, input.clientRequestKey)?.ackedAt, undefined);
  const second = await harness.runner.runTurn(scope, input);
  assert.equal(second.kind, 'completed');
  assert.equal(harness.calls.generated.length, 1);
  assert.equal(harness.calls.read.length, 1);
  assert.equal(harness.calls.acknowledged.length, 2);
});

test('missing recovery key defers acknowledgement across reload without another generation', async () => {
  const firstHarness = createHarness({ generate: async (value) => imageResult(receiptFor(value.idempotencyKey, false)) });
  const first = await firstHarness.runner.runTurn(scope, input);
  assert.equal(first.kind, 'ack-deferred');
  assert.equal(firstHarness.calls.acknowledged.length, 0);

  const secondHarness = createHarness({
    readRequest: async (requestId) => receiptFor(requestId, false),
  });
  for (const turn of firstHarness.store.turns.values()) secondHarness.store.seed(input, turn);
  const reopened = await secondHarness.runner.runTurn(scope, input);
  assert.equal(reopened.kind, 'ack-deferred');
  assert.equal(secondHarness.calls.generated.length, 0);
  assert.equal(secondHarness.calls.read.length, 1);
  assert.equal(secondHarness.calls.acknowledged.length, 0);
});

test('a stale scope after generation preserves the turn and skips adoption and acknowledgement', async () => {
  let release: ((value: ImageEditResult) => void) | undefined;
  const held = new Promise<ImageEditResult>((resolve) => { release = resolve; });
  const harness = createHarness({ generate: async () => await held });
  const running = harness.runner.runTurn(scope, input);
  while (harness.calls.generated.length === 0) await tick();
  harness.setContextActive(false);
  release?.(imageResult(receiptFor(harness.calls.generated[0]!.idempotencyKey)));
  const result = await running;
  assert.equal(result.kind, 'stale');
  assert.equal(harness.store.find(scope, input.conversationId, input.clientRequestKey)?.status, 'submitted');
  assert.equal(harness.calls.adopted.length, 0);
  assert.equal(harness.calls.acknowledged.length, 0);
});

test('only a matching GET terminal failure persists failed with a safe constant code', async () => {
  const harness = createHarness({
    readRequest: async (requestId) => ({
      success: false,
      requestId,
      state: 'failed',
      status: 'failed',
      persistenceStatus: 'failed',
      error: 'provider private detail',
    }),
  });
  const admission = await harness.store.admitTurn(scope, input);
  harness.store.turns.set(admission.turn.turnId, { ...admission.turn, status: 'submitted' });
  const result = await harness.runner.runTurn(scope, input);
  const stored = harness.store.find(scope, input.conversationId, input.clientRequestKey);
  assert.equal(result.kind, 'failed');
  assert.equal(stored?.status, 'failed');
  assert.equal(stored?.failureCode, 'provider_failed');
  assert.equal(harness.calls.generated.length, 0);
});

test('failed and locally acknowledged terminal turns return without changes', async () => {
  const failedHarness = createHarness();
  const failed = turnFor('failed', { failureCode: 'provider_failed' });
  failedHarness.store.seed(input, failed);
  const failedResult = await failedHarness.runner.runTurn(scope, input);
  assert.equal(failedResult.kind, 'failed');
  assert.equal(failedHarness.store.updateCalls, 0);
  assert.equal(failedHarness.calls.read.length, 0);
  assert.equal(failedHarness.calls.generated.length, 0);

  const acknowledgedHarness = createHarness();
  const acknowledged = turnFor('succeeded', { ackedAt: '2026-09-30T00:00:00.000Z' });
  acknowledgedHarness.store.seed(input, acknowledged);
  const completed = await acknowledgedHarness.runner.runTurn(scope, input);
  assert.equal(completed.kind, 'completed');
  assert.equal(acknowledgedHarness.store.updateCalls, 0);
  assert.equal(acknowledgedHarness.store.ackCalls, 0);
  assert.equal(acknowledgedHarness.calls.read.length, 0);
  assert.equal(acknowledgedHarness.calls.generated.length, 0);
  assert.equal(acknowledgedHarness.calls.adopted.length, 0);
});
