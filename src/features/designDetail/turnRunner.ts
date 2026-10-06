import type { DesignDialogueManifestReference } from '../../lib/designDialogueReferences.ts';
import type { ImageEditResult } from '../../lib/imageApi.ts';
import type { DesignSessionStore } from './sessionStore.ts';
import type {
  DesignScope,
  DesignTurn,
  DesignTurnOutput,
  DesignTurnStatus,
} from './types.ts';

type TurnStore = Pick<DesignSessionStore, 'admitTurn' | 'updateTurn' | 'ackTurn' | 'getSession'>;

export type DesignTurnRunInput = Readonly<{
  conversationId: string;
  clientRequestKey: string;
  prompt: string;
  references: readonly DesignDialogueManifestReference[];
}>;

export type DesignTurnGenerateInput = Readonly<{
  prompt: string;
  brandId: string;
  references: readonly DesignDialogueManifestReference[];
  idempotencyKey: string;
  assertContext: () => void;
  retainUntilAcknowledged: true;
}>;

export type DesignTurnRunnerDependencies = Readonly<{
  store: TurnStore;
  generate: (input: DesignTurnGenerateInput) => Promise<ImageEditResult>;
  readRequest: (requestId: string) => Promise<Record<string, unknown>>;
  acknowledge: (input: { requestId: string; clientRecoveryKey: string }) => Promise<void>;
  adoptOutputs: (
    scope: DesignScope,
    turn: DesignTurn,
    outputs: readonly DesignTurnOutput[],
  ) => Promise<void>;
  assertContext: () => void;
}>;

export type DesignTurnRunKind =
  | 'completed'
  | 'in-flight'
  | 'unknown'
  | 'failed'
  | 'adoption-pending'
  | 'ack-deferred'
  | 'stale';

export type DesignTurnRunResult = Readonly<{
  kind: DesignTurnRunKind;
  turn?: DesignTurn;
  outputs?: readonly DesignTurnOutput[];
}>;

type CompletedReceipt = Readonly<{
  outputs: readonly DesignTurnOutput[];
  jobId: string;
  clientRecoveryKey?: string;
}>;

type ReceiptRead =
  | Readonly<{ kind: 'completed'; receipt: CompletedReceipt }>
  | Readonly<{ kind: 'in-flight' }>
  | Readonly<{ kind: 'failed' }>
  | Readonly<{ kind: 'unknown' }>
  | Readonly<{ kind: 'not-found' }>;

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/;
const PROVIDER_FAILURE_CODE = 'provider_failed';
const REQUEST_NOT_FOUND = 'cloudflare_api_404_image_request_not_found';

class StaleContextError extends Error {
  constructor() {
    super('design_turn_context_stale');
    this.name = 'StaleContextError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const safeIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && SAFE_IDENTIFIER.test(value);

const sameOutputs = (
  left: readonly DesignTurnOutput[],
  right: readonly DesignTurnOutput[],
): boolean => left.length === right.length && left.every((output, index) => {
  const other = right[index];
  return other !== undefined
    && output.imageId === other.imageId
    && output.storagePath === other.storagePath
    && output.jobId === other.jobId
    && output.candidateIndex === other.candidateIndex;
});

const completedReceipt = (value: unknown, requestId: string): CompletedReceipt | null => {
  if (!isRecord(value)
    || value.success !== true
    || value.requestId !== requestId
    || value.state !== 'completed'
    || value.status !== 'completed'
    || value.persistenceStatus !== 'completed'
    || !Number.isSafeInteger(value.requestedCandidateCount)
    || !Number.isSafeInteger(value.persistedCandidateCount)
    || !Array.isArray(value.images)) return null;

  const requestedCount = value.requestedCandidateCount as number;
  const persistedCount = value.persistedCandidateCount as number;
  const images = value.images;
  if (requestedCount < 1 || requestedCount !== persistedCount || persistedCount !== images.length) return null;
  if (!safeIdentifier(value.jobId)) return null;

  const imageIds = new Set<string>();
  const storagePaths = new Set<string>();
  const candidateIndexes = new Set<number>();
  const outputs: DesignTurnOutput[] = [];
  for (const [index, imageValue] of images.entries()) {
    if (!isRecord(imageValue)
      || !safeIdentifier(imageValue.imageId)
      || imageValue.id !== imageValue.imageId
      || imageValue.jobId !== value.jobId
      || imageValue.storagePath !== `generated-images/${imageValue.imageId}`
      || imageValue.persistenceStatus !== 'completed'
      || typeof imageValue.imageUrl !== 'string'
      || imageValue.imageUrl.length === 0
      || /[\u0000-\u001f\u007f]/u.test(imageValue.imageUrl)
      || !Number.isSafeInteger(imageValue.candidateIndex)
      || imageValue.candidateIndex !== index
      || imageIds.has(imageValue.imageId)
      || storagePaths.has(imageValue.storagePath)
      || candidateIndexes.has(imageValue.candidateIndex as number)) return null;

    imageIds.add(imageValue.imageId);
    storagePaths.add(imageValue.storagePath as string);
    candidateIndexes.add(imageValue.candidateIndex as number);
    outputs.push(Object.freeze({
      imageId: imageValue.imageId,
      storagePath: imageValue.storagePath as string,
      jobId: value.jobId,
      candidateIndex: imageValue.candidateIndex as number,
    }));
  }

  const firstOutput = outputs[0];
  if (!firstOutput
    || value.imageId !== firstOutput.imageId
    || value.storagePath !== firstOutput.storagePath
    || typeof value.imageUrl !== 'string'
    || value.imageUrl.length === 0) return null;

  return Object.freeze({
    outputs: Object.freeze(outputs),
    jobId: value.jobId,
    ...(typeof value.clientRecoveryKey === 'string' && value.clientRecoveryKey.length > 0
      ? { clientRecoveryKey: value.clientRecoveryKey }
      : {}),
  });
};

const readReceipt = (value: unknown, requestId: string): ReceiptRead => {
  const completed = completedReceipt(value, requestId);
  if (completed) return { kind: 'completed', receipt: completed };
  if (!isRecord(value) || value.requestId !== requestId) return { kind: 'unknown' };
  if (value.state === 'running' && value.status === 'running') return { kind: 'in-flight' };
  if (value.state === 'failed' && value.status === 'failed' && value.success === false) {
    return { kind: 'failed' };
  }
  return { kind: 'unknown' };
};

const sameStoredOutputs = (turn: DesignTurn, outputs: readonly DesignTurnOutput[]): boolean =>
  sameOutputs(turn.outputs, outputs);

const flightIdentity = (scope: DesignScope, conversationId: string, turn: DesignTurn): string => JSON.stringify([
  scope.userId,
  scope.brandId,
  conversationId,
  turn.clientRequestKey,
  turn.turnId,
]);

const isDefiniteNotFound = (error: unknown): boolean =>
  error instanceof Error && error.message === REQUEST_NOT_FOUND;

export function createTurnRunner(dependencies: DesignTurnRunnerDependencies) {
  const inFlight = new Map<string, Promise<DesignTurnRunResult>>();
  // The recovery key exists only in the live invocation. A server GET does not
  // return it, so reload recovery must stop at ack-deferred when it is absent.
  const recoveryKeys = new Map<string, string>();

  const assertContext = (): void => {
    try {
      dependencies.assertContext();
    } catch {
      throw new StaleContextError();
    }
  };

  const inContext = async <T>(
    operation: () => Promise<T>,
    onResolved?: (value: T) => void,
  ): Promise<T> => {
    assertContext();
    let value: T;
    try {
      value = await operation();
    } catch (error) {
      assertContext();
      throw error;
    }
    onResolved?.(value);
    assertContext();
    return value;
  };

  return Object.freeze({
    async runTurn(scope: DesignScope, input: DesignTurnRunInput): Promise<DesignTurnRunResult> {
      let currentTurn: DesignTurn | undefined;
      try {
        const admission = await inContext(
          () => dependencies.store.admitTurn(scope, input),
          (value) => { currentTurn = value.turn; },
        );
        currentTurn = admission.turn;
        const key = flightIdentity(scope, input.conversationId, admission.turn);
        const shared = inFlight.get(key);
        if (shared) {
          const result = await inContext(
            () => shared,
            (value) => { currentTurn = value.turn ?? currentTurn; },
          );
          return result;
        }

        const operation = Promise.resolve().then(() => processTurn(
          scope,
          admission.turn,
          admission.created,
          key,
          (turn) => { currentTurn = turn; },
        ));
        inFlight.set(key, operation);
        try {
          return await inContext(
            () => operation,
            (value) => { currentTurn = value.turn ?? currentTurn; },
          );
        } finally {
          if (inFlight.get(key) === operation) inFlight.delete(key);
        }
      } catch (error) {
        if (error instanceof StaleContextError) return { kind: 'stale', ...(currentTurn ? { turn: currentTurn } : {}) };
        throw error;
      }
    },
  });

  async function processTurn(
    scope: DesignScope,
    admittedTurn: DesignTurn,
    created: boolean,
    identity: string,
    setCurrentTurn: (turn: DesignTurn) => void,
  ): Promise<DesignTurnRunResult> {
    let turn = admittedTurn;
    const result = (kind: DesignTurnRunKind, outputs?: readonly DesignTurnOutput[]): DesignTurnRunResult =>
      Object.freeze({ kind, turn, ...(outputs ? { outputs } : {}) });
    const storeUpdate = async (patch: {
      status?: DesignTurnStatus;
      jobId?: string;
      outputs?: readonly DesignTurnOutput[];
      failureCode?: string;
    }): Promise<DesignTurn | null> => {
      try {
        const updated = await inContext(
          () => dependencies.store.updateTurn(scope, turn.turnId, patch),
          (value) => { turn = value; setCurrentTurn(value); },
        );
        turn = updated;
        setCurrentTurn(updated);
        return updated;
      } catch (error) {
        if (error instanceof StaleContextError) throw error;
        return null;
      }
    };
    const setUnknown = async (): Promise<DesignTurnRunResult> => {
      if (turn.status === 'pending' || turn.status === 'submitted') {
        if (!await storeUpdate({ status: 'unknown' })) return result('unknown');
      }
      return result('unknown');
    };
    const markSubmitted = async (): Promise<boolean> => {
      if (turn.status !== 'pending') return true;
      return (await storeUpdate({ status: 'submitted' })) !== null;
    };
    const persistFailure = async (): Promise<DesignTurnRunResult> => {
      if (turn.status === 'failed') return result('failed');
      if (turn.status === 'succeeded') return result('unknown');
      if (!await storeUpdate({ status: 'failed', failureCode: PROVIDER_FAILURE_CODE })) return result('unknown');
      return result('failed');
    };
    const persistOutputs = async (
      receipt: CompletedReceipt,
    ): Promise<DesignTurnRunResult> => {
      if (turn.status === 'succeeded') {
        if (!sameStoredOutputs(turn, receipt.outputs) || turn.jobId !== receipt.jobId) return result('unknown');
      } else {
        const updated = await storeUpdate({
          status: 'succeeded',
          jobId: receipt.jobId,
          outputs: receipt.outputs,
        });
        if (!updated) return result('unknown');
      }
      if (receipt.clientRecoveryKey) recoveryKeys.set(identity, receipt.clientRecoveryKey);
      return await adoptThenAcknowledge(receipt.outputs);
    };
    const adoptThenAcknowledge = async (
      outputs: readonly DesignTurnOutput[],
    ): Promise<DesignTurnRunResult> => {
      try {
        await inContext(() => dependencies.adoptOutputs(scope, turn, outputs));
      } catch (error) {
        if (error instanceof StaleContextError) throw error;
        return result('adoption-pending', outputs);
      }
      const recoveryKey = recoveryKeys.get(identity);
      if (!recoveryKey) return result('ack-deferred', outputs);
      try {
        await inContext(() => dependencies.acknowledge({
          requestId: turn.requestId,
          clientRecoveryKey: recoveryKey,
        }));
      } catch (error) {
        if (error instanceof StaleContextError) throw error;
        return result('ack-deferred', outputs);
      }
      try {
        const ackedAt = new Date().toISOString();
        const updated = await inContext(
          () => dependencies.store.ackTurn(scope, turn.turnId, ackedAt),
          (value) => { turn = value; setCurrentTurn(value); },
        );
        turn = updated;
        setCurrentTurn(updated);
      } catch (error) {
        if (error instanceof StaleContextError) throw error;
        return result('ack-deferred', outputs);
      }
      recoveryKeys.delete(identity);
      return result('completed', outputs);
    };
    const readProvider = async (): Promise<ReceiptRead> => {
      try {
        const value = await inContext(() => dependencies.readRequest(turn.requestId));
        return readReceipt(value, turn.requestId);
      } catch (error) {
        if (error instanceof StaleContextError) throw error;
        return isDefiniteNotFound(error) ? { kind: 'not-found' } : { kind: 'unknown' };
      }
    };
    const handleRead = async (receipt: ReceiptRead): Promise<DesignTurnRunResult> => {
      if (receipt.kind === 'completed') return await persistOutputs(receipt.receipt);
      if (receipt.kind === 'failed') return await persistFailure();
      if (receipt.kind === 'in-flight') {
        if (turn.status === 'succeeded' || turn.status === 'failed') return result('unknown');
        if (!await markSubmitted()) return result('unknown');
        return result('in-flight');
      }
      return await setUnknown();
    };
    const generateOnce = async (): Promise<DesignTurnRunResult> => {
      if (!created && turn.status === 'pending' && !await markSubmitted()) return result('unknown');
      let generated: ImageEditResult;
      try {
        generated = await inContext(
          () => dependencies.generate({
            prompt: turn.prompt,
            brandId: scope.brandId,
            references: turn.references,
            idempotencyKey: turn.requestId,
            assertContext,
            retainUntilAcknowledged: true,
          }),
        );
      } catch (error) {
        if (error instanceof StaleContextError) throw error;
        return await handleRead(await readProvider());
      }
      const parsed = completedReceipt(generated, turn.requestId);
      if (parsed) return await persistOutputs(parsed);
      // A flattened error is not a terminal provider failure. Only the exact
      // request GET can establish failed, completed, or still-running state.
      return await handleRead(await readProvider());
    };

    if (turn.status === 'failed') return result('failed');
    if (turn.status === 'succeeded' && turn.ackedAt) return result('completed', turn.outputs);
    if (turn.status === 'succeeded') {
      const receipt = await readProvider();
      if (receipt.kind !== 'completed'
        || !sameStoredOutputs(turn, receipt.receipt.outputs)
        || turn.jobId !== receipt.receipt.jobId) return result('unknown');
      return await adoptThenAcknowledge(turn.outputs);
    }
    if (created) {
      if (!await markSubmitted()) return result('unknown');
      return await generateOnce();
    }

    const receipt = await readProvider();
    if (receipt.kind === 'not-found') return await generateOnce();
    return await handleRead(receipt);
  }
}
