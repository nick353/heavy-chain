import { fittingBatchScopeKey, type FittingBatchReceipt, type FittingBatchScope, type FittingBatchStorage, type FittingBatchTask } from './fittingBatch.ts';
export type FittingBatchExecution = {
  submit(task: FittingBatchTask): Promise<FittingBatchReceipt>;
  read(requestId: string): Promise<FittingBatchReceipt>;
  persist(task: FittingBatchTask, receipt: FittingBatchReceipt): Promise<void>;
  acknowledge(receipt: FittingBatchReceipt): Promise<void>;
  assertCurrent(): void | Promise<void>;
};
export type FittingBatchLock = <T>(key: string, run: () => Promise<T>) => Promise<T>;
export const browserFittingBatchLock: FittingBatchLock = async (key, run) => {
  if (!navigator.locks) throw new Error('fitting_batch_lock_unavailable');
  return navigator.locks.request(key, run);
};
function checkedReceipt(receipt: FittingBatchReceipt, requestId: string) {
  if (receipt.requestId !== requestId || !['running', 'completed', 'failed', 'unknown'].includes(receipt.state)
    || receipt.success !== (receipt.state === 'completed')) throw new Error('fitting_batch_receipt_mismatch');
  if (receipt.state === 'completed' && (receipt.persistenceStatus !== 'completed' || !receipt.clientRecoveryKey
    || !receipt.images?.length || receipt.images.some(image => !image.imageId || !image.imageUrl
      || image.storagePath !== `generated-images/${image.imageId}`))) throw new Error('fitting_batch_result_not_persisted');
  return receipt;
}
/** Lock spans admission, provider readback, durable handoff and ACK. Unknown recovery is GET-only. */
export async function runFittingBatchTask(storage: FittingBatchStorage, scope: FittingBatchScope, id: string,
  execution: FittingBatchExecution, lock: FittingBatchLock = browserFittingBatchLock) {
  const key = fittingBatchScopeKey(scope);
  if (!storage.update) throw new Error('fitting_batch_atomic_store_required');
  return lock(`heavy:fitting-batch:${key}:${id}`, async () => {
    await execution.assertCurrent();
    let task: FittingBatchTask | undefined;
    let submit = false;
    await storage.update!(key, tasks => tasks.map(item => {
      if (item.id !== id) return item;
      task = structuredClone(item);
      if (item.status === 'completed' || item.status === 'failed' || item.status === 'saved') return item;
      submit = item.status === 'ready';
      return { ...item, status: 'pending' };
    }));
    if (!task) throw new Error('fitting_batch_task_missing');
    if (task.status === 'completed' || task.status === 'failed') return task.status;
    const currentTask = task;
    const update = async (status: FittingBatchTask['status'], receipt?: FittingBatchReceipt) => {
      await storage.update!(key, tasks => tasks.map(item => {
        if (item.id !== id) return item;
        if (item.requestId !== currentTask.requestId) throw new Error('fitting_batch_request_changed');
        return { ...item, status, ...(receipt ? { receipt } : {}) };
      }));
    };
    let saved = task.status === 'saved';
    try {
      await execution.assertCurrent();
      const receipt = checkedReceipt(saved ? task.receipt! : await (submit
        ? execution.submit(currentTask) : execution.read(currentTask.requestId)), currentTask.requestId);
      await execution.assertCurrent();
      if (receipt.state === 'failed') { await update('failed', receipt); return 'failed'; }
      if (receipt.state !== 'completed') { await update('unknown', receipt); return 'unknown'; }
      if (!saved) {
        await execution.persist(currentTask, receipt);
        await execution.assertCurrent();
        await update('saved', receipt); // durable save BEFORE ACK, including its original recovery key
        saved = true;
      }
      await execution.assertCurrent();
      await execution.acknowledge(receipt);
      await update('completed', receipt);
      return 'completed';
    } catch (error) {
      if (!saved) await update('unknown');
      throw error; // retain saved receipt on ACK failure, never infer again
    }
  });
}
