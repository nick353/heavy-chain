export type FittingBatchScope = { userId: string; brandId: string; featureId: string };
export type FittingBatchInput = {
  garment: string; garmentName: string; model: string | null;
  mode: string; prompt: string; aspect: string; resolution: string;
  references: Record<string, { name: string; image: string }>;
  settings?: Record<string, string | number | boolean | null>;
};
export type FittingBatchTask = {
  id: string; requestId: string; input: FittingBatchInput;
  status: 'ready' | 'pending' | 'unknown' | 'failed' | 'saved' | 'completed';
  receipt?: FittingBatchReceipt;
};
export const FITTING_BATCH_LIMIT = 8;
/** The 下着 mode changes what the model wears; without this line it would render the garment as ordinary outerwear. */
export const UNDERWEAR_FITTING_INSTRUCTION = '下着モード: 衣服画像は下着・インナーとして扱い、モデルが素肌に直接着用した下着カタログ写真にする。上から他の服を重ね着させない。';
export function fittingModeSummary(summary: string, mode: string) {
  return mode === 'underwear' ? [summary, UNDERWEAR_FITTING_INSTRUCTION].filter(Boolean).join(' / ') : summary;
}
export const fittingBatchScopeKey = (scope: FittingBatchScope) => {
  if (!scope.userId || !scope.brandId || !scope.featureId) throw new Error('fitting_batch_scope_missing');
  return JSON.stringify([scope.userId, scope.brandId, scope.featureId]);
};
export function addFittingBatchTask(tasks: FittingBatchTask[], task: FittingBatchTask) {
  if (tasks.some(item => item.id === task.id || item.requestId === task.requestId)) return tasks;
  if (tasks.length >= FITTING_BATCH_LIMIT) throw new Error('fitting_batch_limit');
  if (!task.input.garment.startsWith('data:image/')) throw new Error('fitting_batch_input_not_durable');
  if (task.status !== 'ready') throw new Error('fitting_batch_new_task_state');
  return [...tasks, structuredClone(task)];
}
export function removeFittingBatchTask(tasks: FittingBatchTask[], id?: string) {
  if (tasks.some(task => (!id || task.id === id) && (task.status === 'pending' || task.status === 'unknown' || task.status === 'saved'))) {
    throw new Error('fitting_batch_reconciliation_required');
  }
  return id ? tasks.filter(task => task.id !== id) : [];
}
/** Pending restores as unknown, never as dispatchable ready. No provider dispatch here. */
export function restoreFittingBatchTasks(value: unknown): FittingBatchTask[] {
  if (!Array.isArray(value) || value.length > FITTING_BATCH_LIMIT) throw new Error('fitting_batch_record_invalid');
  const ids = new Set<string>(); const requests = new Set<string>();
  return value.map((task: FittingBatchTask) => {
    if (!task || !task.id || !task.requestId || ids.has(task.id) || requests.has(task.requestId)
      || !['ready', 'pending', 'unknown', 'failed', 'saved', 'completed'].includes(task.status)
      || !task.input?.garment?.startsWith('data:image/')
      || (task.input.model !== null && !task.input.model?.startsWith('data:image/'))
      || !task.input.references || Object.values(task.input.references).some(ref => !ref.image?.startsWith('data:image/'))) {
      throw new Error('fitting_batch_record_invalid');
    }
    ids.add(task.id); requests.add(task.requestId);
    return { ...structuredClone(task), status: task.status === 'pending' ? 'unknown' : task.status };
  });
}
export type FittingBatchReceipt = {
  requestId: string; state: 'running' | 'completed' | 'failed' | 'unknown'; success: boolean;
  persistenceStatus?: string; clientRecoveryKey?: string; jobId?: string;
  images?: { imageId: string; storagePath: string; imageUrl: string }[];
};
export type FittingBatchStorage = {
  read(key: string): Promise<unknown>;
  write(key: string, tasks: FittingBatchTask[]): Promise<void>;
  /** One IDB readwrite transaction; no asynchronous work inside change. */
  update?(key: string, change: (tasks: FittingBatchTask[]) => FittingBatchTask[]): Promise<FittingBatchTask[]>;
};
export async function readFittingBatch(storage: FittingBatchStorage, scope: FittingBatchScope) {
  return restoreFittingBatchTasks(await storage.read(fittingBatchScopeKey(scope)) ?? []);
}
export async function writeFittingBatch(storage: FittingBatchStorage, scope: FittingBatchScope, tasks: FittingBatchTask[]) {
  fittingBatchScopeKey(scope);
  restoreFittingBatchTasks(tasks); // validate without demoting the persisted pending marker
  await storage.write(fittingBatchScopeKey(scope), structuredClone(tasks));
}
