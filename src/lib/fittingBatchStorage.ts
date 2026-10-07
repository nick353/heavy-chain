import { restoreFittingBatchTasks, type FittingBatchStorage, type FittingBatchTask } from './fittingBatch';
const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('heavy-chain-fitting-batch', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('queues');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => resolve(request.result);
});
export const fittingBatchStorage: FittingBatchStorage = {
  async update(key, change) {
    const db = await openDatabase();
    try {
      return await new Promise<FittingBatchTask[]>((resolve, reject) => {
        const tx = db.transaction('queues', 'readwrite');
        const request = tx.objectStore('queues').get(key);
        let next: FittingBatchTask[]; let failure: unknown;
        request.onsuccess = () => {
          try {
            const raw = request.result ?? [];
            restoreFittingBatchTasks(raw);
            next = change(structuredClone(raw));
            restoreFittingBatchTasks(next);
            tx.objectStore('queues').put(next, key);
          } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => resolve(next);
        tx.onerror = tx.onabort = () => reject(failure ?? tx.error);
      });
    } finally { db.close(); }
  },
  async read(key) {
    const db = await openDatabase();
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction('queues', 'readonly');
        const request = tx.objectStore('queues').get(key);
        let value: unknown;
        request.onsuccess = () => { value = request.result; };
        tx.oncomplete = () => resolve(value);
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  },
  async write(key: string, tasks: FittingBatchTask[]) {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('queues', 'readwrite');
        tx.objectStore('queues').put(tasks, key);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  },
};
/** Freeze current image bytes rather than persisting an expiring blob/signed URL. */
export async function freezeFittingBatchImage(source: string): Promise<string> {
  if (source.startsWith('data:image/')) return source;
  const response = await fetch(source);
  if (!response.ok) throw new Error('fitting_batch_image_read_failed');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('fitting_batch_image_invalid');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}
