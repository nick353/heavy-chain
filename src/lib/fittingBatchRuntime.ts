import type { FittingBatchScope } from './fittingBatch';
import type { ArtifactPersistenceContext } from './cloudflareApi';
import type { CanvasSaveTransport } from './canvasDocumentSaveRecovery';
import { createFittingBatchExecution } from './fittingBatchExecution';
import { createFittingBatchHandoff } from './fittingBatchHandoff';

type Client = Parameters<typeof createFittingBatchExecution>[0] & {
  captureArtifactPersistenceContext(options: { assertContext: () => void }): Promise<ArtifactPersistenceContext>;
};
/** Bind existing execution and durable handoff only after capturing the current authenticated save context. */
export async function createFittingBatchRuntime(client: Client, scope: FittingBatchScope,
  transport: CanvasSaveTransport, assertCurrent: () => void) {
  assertCurrent();
  const persistenceContext = await client.captureArtifactPersistenceContext({ assertContext: assertCurrent });
  assertCurrent();
  const persist = createFittingBatchHandoff({ origin: client.origin, scope, transport, assertCurrent, persistenceContext });
  return createFittingBatchExecution(client, scope, persist, assertCurrent);
}
