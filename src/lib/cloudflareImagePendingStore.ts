/** Small recovery identities only. Image bytes remain in their existing asset DB. */
const DATABASE = 'heavy-chain-image-pending-identities';
const STORE = 'pending';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Identity = { key: string; requestId: string };
type Guard = () => Promise<void>;
export type PendingIdentityState =
  | { state: 'present'; requestId: string }
  | { state: 'absent' }
  | { state: 'unavailable'; requestId?: string; cause: unknown }
  | { state: 'conflict'; requestIds: string[] };
type StoreRead = { ok: true; requestId: string | null } | { ok: false; cause: unknown };

const validKey = (key: string) => key.startsWith('heavy:image-ai:v1:') && /:[0-9a-f]{64}$/.test(key);
const validIdentity = (value: unknown): value is Identity => !!value && typeof value === 'object' &&
  typeof (value as Identity).key === 'string' && validKey((value as Identity).key) &&
  typeof (value as Identity).requestId === 'string' && UUID.test((value as Identity).requestId);
const failure = (code: string, cause?: unknown) => new Error(code, { cause });
const noop: Guard = async () => {};

function readLegacy(key: string): StoreRead {
  try {
    const requestId = localStorage.getItem(key);
    if (requestId !== null && !UUID.test(requestId)) throw failure('image_pending_identity_invalid');
    return { ok: true, requestId };
  } catch (cause) { return { ok: false, cause }; }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(failure('image_pending_indexeddb_unavailable')); return; }
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DATABASE, 1); }
    catch (cause) { reject(cause); return; }
    request.onerror = () => reject(request.error ?? failure('image_pending_indexeddb_open_failed'));
    request.onblocked = () => reject(failure('image_pending_indexeddb_blocked'));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

/** Request success is provisional; only transaction completion is durable. */
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, result: (value: T) => void, failed: (cause: unknown) => void) => void, assertCurrent: Guard = noop): Promise<T> {
  const database = await openDatabase();
  try {
    await assertCurrent();
    return await new Promise<T>((resolve, reject) => {
      let value: T;
      let requestError: unknown;
      const tx = database.transaction(STORE, mode);
      tx.oncomplete = () => requestError ? reject(requestError) : resolve(value);
      tx.onerror = () => reject(tx.error ?? requestError ?? failure('image_pending_transaction_failed'));
      tx.onabort = () => reject(tx.error ?? requestError ?? failure('image_pending_transaction_aborted'));
      try {
        operation(tx.objectStore(STORE), result => { value = result; }, cause => {
          requestError = cause;
          tx.abort();
        });
      } catch (cause) { requestError = cause; tx.abort(); }
    });
  } finally { database.close(); }
}

async function readIndexed(key: string): Promise<StoreRead> {
  try {
    const value = await transaction<unknown>('readonly', (store, done, failed) => {
      const request = store.get(key);
      request.onsuccess = () => done(request.result);
      request.onerror = () => failed(request.error ?? failure('image_pending_read_failed'));
    });
    if (value === undefined) return { ok: true, requestId: null };
    if (!validIdentity(value) || value.key !== key) throw failure('image_pending_identity_invalid');
    return { ok: true, requestId: value.requestId };
  } catch (cause) { return { ok: false, cause }; }
}

function combine(legacy: StoreRead, indexed: StoreRead): PendingIdentityState {
  const ids = [...new Set([legacy.ok ? legacy.requestId : null, indexed.ok ? indexed.requestId : null].filter((id): id is string => id !== null))];
  if (ids.length > 1) return { state: 'conflict', requestIds: ids };
  if (!legacy.ok || !indexed.ok) return { state: 'unavailable', ...(ids[0] ? { requestId: ids[0] } : {}), cause: !legacy.ok ? legacy.cause : !indexed.ok ? indexed.cause : undefined };
  return ids[0] ? { state: 'present', requestId: ids[0] } : { state: 'absent' };
}

export async function readPendingIdentity(key: string): Promise<PendingIdentityState> {
  if (!validKey(key)) throw failure('image_pending_key_invalid');
  const indexed = await readIndexed(key);
  // Read legacy after the asynchronous transaction, not from an earlier snapshot.
  return combine(readLegacy(key), indexed);
}

export async function listPendingIdentities(prefix: string): Promise<{ state: 'complete'; identities: Identity[] } | { state: 'unavailable' | 'conflict'; cause: unknown }> {
  if (!prefix.startsWith('heavy:image-ai:v1:') || !prefix.endsWith(':')) throw failure('image_pending_prefix_invalid');
  try {
    const indexed = await transaction<unknown[]>('readonly', (store, done, failed) => {
      const request = store.getAll();
      request.onsuccess = () => done(request.result);
      request.onerror = () => failed(request.error ?? failure('image_pending_list_failed'));
    });
    const keys = new Set<string>();
    for (const item of indexed) {
      if (!validIdentity(item)) throw failure('image_pending_identity_invalid');
      if (item.key.startsWith(prefix)) keys.add(item.key);
    }
    const count = localStorage.length;
    for (let index = 0; index < count; index++) {
      const key = localStorage.key(index);
      if (key === null) throw failure('image_pending_listing_changed');
      if (key.startsWith(prefix)) keys.add(key);
    }
    if (localStorage.length !== count) throw failure('image_pending_listing_changed');
    const identities: Identity[] = [];
    for (const key of keys) {
      const current = await readPendingIdentity(key);
      if (current.state === 'conflict') return { state: 'conflict', cause: failure('image_pending_identity_conflict') };
      if (current.state === 'unavailable' || current.state === 'absent') throw failure('image_pending_listing_incomplete');
      identities.push({ key, requestId: current.requestId });
    }
    return { state: 'complete', identities };
  } catch (cause) { return { state: 'unavailable', cause }; }
}

function requireExpected(current: PendingIdentityState, requestId: string): void {
  if (current.state === 'conflict') throw failure('image_pending_identity_conflict');
  if (current.state === 'unavailable') throw failure('image_pending_identity_unavailable', current.cause);
  if (current.state === 'present' && current.requestId !== requestId) throw failure('image_pending_identity_conflict');
}

async function mutateIndexed(key: string, requestId: string, remove: boolean, assertCurrent: Guard): Promise<void> {
  await transaction<void>('readwrite', (store, done, failed) => {
    const read = store.get(key);
    read.onerror = () => failed(read.error ?? failure('image_pending_read_failed'));
    read.onsuccess = () => {
      try {
        const existing: unknown = read.result;
        if (existing !== undefined && (!validIdentity(existing) || existing.key !== key || existing.requestId !== requestId)) {
          failed(failure('image_pending_identity_conflict')); return;
        }
        const write = remove ? store.delete(key) : store.put({ key, requestId } satisfies Identity);
        write.onerror = () => failed(write.error ?? failure('image_pending_write_failed'));
        write.onsuccess = () => done();
      } catch (cause) {
        failed(cause);
      }
    };
  }, assertCurrent);
  await assertCurrent();
  const readback = await readIndexed(key);
  await assertCurrent();
  if (!readback.ok || readback.requestId !== (remove ? null : requestId)) throw failure('image_pending_indexeddb_readback_failed', readback.ok ? undefined : readback.cause);
}

/** Commit the same UUID through IDB when legacy quota/readback fails. */
export async function rememberPendingIdentity(key: string, requestId: string, assertCurrent: Guard = noop): Promise<void> {
  if (!UUID.test(requestId)) throw failure('image_request_id_invalid');
  const previous = await readPendingIdentity(key); await assertCurrent(); requireExpected(previous, requestId);
  let legacySaved = false;
  try { localStorage.setItem(key, requestId); legacySaved = localStorage.getItem(key) === requestId; }
  catch { /* fall back to the dedicated identity DB; never evict user data */ }
  await assertCurrent();
  if (!legacySaved) {
    const legacy = readLegacy(key);
    if (legacy.ok && legacy.requestId !== null && legacy.requestId !== requestId) throw failure('image_pending_identity_conflict');
    await assertCurrent(); await mutateIndexed(key, requestId, false, assertCurrent); await assertCurrent();
  }
  const verified = await readPendingIdentity(key); await assertCurrent(); requireExpected(verified, requestId);
  if (verified.state !== 'present') throw failure('image_pending_identity_readback_failed');
}

/** Exact legacy removal/readback precedes exact IDB removal/readback. */
export async function forgetPendingIdentity(key: string, requestId: string, assertCurrent: Guard = noop): Promise<void> {
  if (!UUID.test(requestId)) throw failure('image_request_id_invalid');
  const previous = await readPendingIdentity(key); await assertCurrent(); requireExpected(previous, requestId);
  const legacy = readLegacy(key);
  if (!legacy.ok) throw failure('image_pending_legacy_read_failed', legacy.cause);
  if (legacy.requestId !== null && legacy.requestId !== requestId) throw failure('image_pending_identity_conflict');
  await assertCurrent();
  if (legacy.requestId === requestId) localStorage.removeItem(key);
  const legacyReadback = readLegacy(key); await assertCurrent();
  if (!legacyReadback.ok || legacyReadback.requestId !== null) throw failure('image_pending_legacy_remove_readback_failed');
  await assertCurrent(); await mutateIndexed(key, requestId, true, assertCurrent); await assertCurrent();
  const verified = await readPendingIdentity(key); await assertCurrent(); requireExpected(verified, requestId);
  if (verified.state !== 'absent') throw failure('image_pending_remove_readback_failed');
}
