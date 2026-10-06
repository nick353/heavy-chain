import { createSessionStore } from './sessionStore.ts';
import { SessionStoreError } from './types.ts';

type TestFunction = (name: string, action: () => void | Promise<void>) => void;
type StrictAssert = {
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  equal(actual: unknown, expected: unknown, message?: string): void;
  match(actual: string, expected: RegExp, message?: string): void;
  ok(value: unknown, message?: string): asserts value;
  rejects(
    promise: Promise<unknown>,
    predicate?: (error: unknown) => boolean | void,
  ): Promise<void>;
};

const nodeAssertModule: string = 'node:assert/strict';
const nodeTestModule: string = 'node:test';
const [assertModule, testModule] = await Promise.all([
  import(nodeAssertModule) as Promise<StrictAssert>,
  import(nodeTestModule) as Promise<{ default: TestFunction }>,
]);
const assert: StrictAssert = assertModule;
const test = testModule.default;

type FakeKey = string | number | readonly FakeKey[];
type FakeIndexDefinition = { keyPath: string | string[]; unique: boolean };
type FakeStoreDefinition = { keyPath: string | string[]; indexes: Map<string, FakeIndexDefinition> };
type FakeStores = Map<string, Map<string, unknown>>;

const clone = <T>(value: T): T => structuredClone(value);
const token = (key: FakeKey) => JSON.stringify(key);
const equalKey = (left: FakeKey, right: FakeKey) => token(left) === token(right);
const keyAt = (value: unknown, path: string | string[]): FakeKey => {
  if (Array.isArray(path)) return path.map((part) => keyAt(value, part));
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null) throw new Error('fake_key_path_invalid');
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== 'string' && typeof current !== 'number') throw new Error('fake_key_invalid');
  return current;
};

class FakeNameList {
  private readonly names: () => string[];

  constructor(names: () => string[]) { this.names = names; }
  contains(name: string) { return this.names().includes(name); }
  item(index: number) { return this.names()[index] ?? null; }
  get length() { return this.names().length; }
  [Symbol.iterator]() { return this.names()[Symbol.iterator](); }
}

class FakeRequest<T = unknown> {
  result!: T;
  error: unknown = null;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
}

type CommitHold = {
  reached: Promise<void>;
  release(): void;
};

class FakeIndexedDBFactory {
  private readonly databases = new Map<string, FakeDatabase>();
  private pendingHold?: { reach(): void; released: Promise<void>; reached: Promise<void> };
  private abortNext = false;
  private abortCause = 'fake_commit_abort';
  private nextOpenFailure?: string;
  private nextWriteFailure?: string;

  open(name: string, version = 1) {
    const request = new FakeRequest<FakeDatabase>() as FakeRequest<FakeDatabase> & {
      onupgradeneeded: ((event: Event) => void) | null;
      onblocked: ((event: Event) => void) | null;
      transaction: { abort(): void } | null;
    };
    request.onupgradeneeded = null;
    request.onblocked = null;
    request.transaction = null;
    queueMicrotask(() => {
      if (this.nextOpenFailure !== undefined) {
        request.error = new Error(this.nextOpenFailure);
        this.nextOpenFailure = undefined;
        request.onerror?.({ target: request } as unknown as Event);
        return;
      }
      let database = this.databases.get(name);
      if (!database) {
        database = new FakeDatabase(this, name, version);
        this.databases.set(name, database);
        request.result = database;
        request.transaction = { abort() { database?.abortUpgrade(); } };
        request.onupgradeneeded?.({ target: request } as unknown as Event);
        request.transaction = null;
      } else if (version < database.version) {
        request.error = new Error('fake_version_error');
        request.onerror?.({ target: request } as unknown as Event);
        return;
      } else if (version > database.version) {
        database.version = version;
        request.result = database;
        request.transaction = { abort() { database?.abortUpgrade(); } };
        request.onupgradeneeded?.({ target: request } as unknown as Event);
        request.transaction = null;
      }
      request.result = database;
      request.onsuccess?.({ target: request } as unknown as Event);
    });
    return request as unknown as IDBOpenDBRequest;
  }

  holdNextCommit(): CommitHold {
    let reach!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => { reach = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    this.pendingHold = { reach, released, reached };
    return {
      reached,
      release: () => {
        release();
      },
    };
  }

  abortNextCommit(cause = 'fake_commit_abort') {
    this.abortNext = true;
    this.abortCause = cause;
  }

  failNextOpen(cause: string) { this.nextOpenFailure = cause; }
  failNextWrite(cause: string) { this.nextWriteFailure = cause; }
  consumeWriteFailure() {
    const cause = this.nextWriteFailure;
    this.nextWriteFailure = undefined;
    return cause;
  }

  beginCommit(transaction: FakeTransaction): boolean {
    if (this.pendingHold) {
      const hold = this.pendingHold;
      this.pendingHold = undefined;
      transaction.pauseUntil(hold.released);
      hold.reach();
      return true;
    }
    if (this.abortNext) {
      this.abortNext = false;
      transaction.abort(new Error(this.abortCause));
      this.abortCause = 'fake_commit_abort';
      return true;
    }
    return false;
  }

  rawSet(databaseName: string, storeName: string, value: unknown) {
    const database = this.databases.get(databaseName);
    if (!database) throw new Error('fake_database_missing');
    database.rawSet(storeName, value);
  }
}

class FakeDatabase {
  readonly definitions = new Map<string, FakeStoreDefinition>();
  private stores: FakeStores = new Map();
  private queued: FakeTransaction[] = [];
  private active?: FakeTransaction;
  readonly objectStoreNames = new FakeNameList(() => [...this.definitions.keys()]);
  onversionchange: (() => void) | null = null;
  private readonly factory: FakeIndexedDBFactory;
  readonly name: string;
  public version: number;

  constructor(
    factory: FakeIndexedDBFactory,
    name: string,
    version: number,
  ) {
    this.factory = factory;
    this.name = name;
    this.version = version;
  }

  createObjectStore(name: string, options: { keyPath: string | string[] }) {
    if (this.definitions.has(name)) throw new Error('fake_store_exists');
    const definition: FakeStoreDefinition = { keyPath: options.keyPath, indexes: new Map() };
    this.definitions.set(name, definition);
    this.stores.set(name, new Map());
    return {
      createIndex: (indexName: string, keyPath: string | string[], indexOptions?: { unique?: boolean }) => {
        if (definition.indexes.has(indexName)) throw new Error('fake_index_exists');
        definition.indexes.set(indexName, { keyPath, unique: indexOptions?.unique === true });
      },
    } as unknown as IDBObjectStore;
  }

  transaction(names: string | string[], mode: IDBTransactionMode = 'readonly') {
    const selected = Array.isArray(names) ? names : [names];
    if (selected.some((name) => !this.definitions.has(name))) throw new Error('fake_store_missing');
    const transaction = new FakeTransaction(this, selected, mode);
    this.queued.push(transaction);
    this.startNext();
    return transaction as unknown as IDBTransaction;
  }

  close() {}
  abortUpgrade() {}

  beginCommit(transaction: FakeTransaction) {
    return this.factory.beginCommit(transaction);
  }

  rawSet(storeName: string, value: unknown) {
    const definition = this.definitions.get(storeName);
    const store = this.stores.get(storeName);
    if (!definition || !store) throw new Error('fake_store_missing');
    const key = keyAt(value, definition.keyPath);
    store.set(token(key), clone(value));
  }

  snapshot(): FakeStores {
    const output: FakeStores = new Map();
    for (const [name, store] of this.stores) {
      output.set(name, new Map([...store].map(([key, value]) => [key, clone(value)])));
    }
    return output;
  }

  definition(name: string) {
    const definition = this.definitions.get(name);
    if (!definition) throw new Error('fake_store_missing');
    return definition;
  }

  values(stores: FakeStores, name: string) {
    const store = stores.get(name);
    if (!store) throw new Error('fake_store_missing');
    return [...store.values()];
  }

  read(stores: FakeStores, name: string, key: FakeKey) {
    return stores.get(name)?.get(token(key));
  }

  write(stores: FakeStores, name: string, value: unknown, addOnly: boolean) {
    const writeFailure = this.factory.consumeWriteFailure();
    if (writeFailure !== undefined) throw new Error(writeFailure);
    const definition = this.definition(name);
    const store = stores.get(name);
    if (!store) throw new Error('fake_store_missing');
    const key = keyAt(value, definition.keyPath);
    const keyToken = token(key);
    if (addOnly && store.has(keyToken)) throw new Error('fake_constraint_error');
    for (const index of definition.indexes.values()) {
      if (!index.unique) continue;
      const candidate = keyAt(value, index.keyPath);
      for (const [existingToken, existing] of store) {
        if (existingToken !== keyToken && equalKey(keyAt(existing, index.keyPath), candidate)) {
          throw new Error('fake_constraint_error');
        }
      }
    }
    store.set(keyToken, clone(value));
    return key;
  }

  readIndex(stores: FakeStores, storeName: string, indexName: string, key: FakeKey, all: boolean) {
    const definition = this.definition(storeName).indexes.get(indexName);
    if (!definition) throw new Error('fake_index_missing');
    const matches = this.values(stores, storeName).filter((value) => equalKey(keyAt(value, definition.keyPath), key));
    return all ? matches : matches[0];
  }

  commit(stores: FakeStores, mode: IDBTransactionMode) {
    if (mode === 'readwrite') this.stores = stores;
  }

  release(transaction: FakeTransaction) {
    if (this.active === transaction) this.active = undefined;
    this.startNext();
  }

  private startNext() {
    if (this.active || this.queued.length === 0) return;
    this.active = this.queued.shift();
    this.active?.start();
  }
}

class FakeTransaction {
  oncomplete: ((event: Event) => void) | null = null;
  onabort: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  error: unknown = null;
  private readonly queue: Array<() => void> = [];
  private stores: FakeStores = new Map();
  private active = false;
  private finished = false;
  private aborted = false;
  private paused = false;
  private scheduled = false;
  private finishScheduled = false;
  private readonly database: FakeDatabase;
  private readonly names: string[];
  readonly mode: IDBTransactionMode;

  constructor(
    database: FakeDatabase,
    names: string[],
    mode: IDBTransactionMode,
  ) {
    this.database = database;
    this.names = names;
    this.mode = mode;
  }

  start() {
    if (this.aborted) return this.finishAbort();
    this.active = true;
    this.stores = this.database.snapshot();
    this.schedule();
  }

  objectStore(name: string) {
    if (!this.names.includes(name)) throw new Error('fake_transaction_store_unavailable');
    return new FakeObjectStore(this, this.database, name);
  }

  request<T>(operation: () => T) {
    const request = new FakeRequest<T>();
    this.queue.push(() => {
      if (this.finished || this.aborted) return;
      try {
        request.result = operation();
        request.onsuccess?.({ target: request } as unknown as Event);
      } catch {
        request.error = new Error('fake_request_failed');
        request.onerror?.({ target: request } as unknown as Event);
        this.error = new Error('fake_transaction_failed');
        this.onerror?.({ target: this } as unknown as Event);
        this.abort();
      }
    });
    this.schedule();
    return request;
  }

  read(name: string, key: FakeKey) { return this.database.read(this.stores, name, key); }
  values(name: string) { return this.database.values(this.stores, name); }
  write(name: string, value: unknown, addOnly: boolean) {
    return this.database.write(this.stores, name, value, addOnly);
  }
  readIndex(name: string, index: string, key: FakeKey, all: boolean) {
    return this.database.readIndex(this.stores, name, index, key, all);
  }

  pauseUntil(released: Promise<void>) {
    this.paused = true;
    void released.then(() => {
      this.paused = false;
      this.schedule();
    });
  }

  abort(cause?: unknown) {
    if (this.finished || this.aborted) return;
    if (cause !== undefined) this.error = cause;
    this.aborted = true;
    this.queue.length = 0;
    if (this.active) queueMicrotask(() => this.finishAbort());
  }

  private schedule() {
    if (!this.active || this.finished || this.aborted || this.paused || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.runOne());
  }

  private runOne() {
    this.scheduled = false;
    if (this.finished || this.aborted || this.paused) return;
    const job = this.queue.shift();
    if (job) {
      job();
      this.schedule();
      return;
    }
    if (this.finishScheduled) return;
    this.finishScheduled = true;
    queueMicrotask(() => {
      this.finishScheduled = false;
      if (this.finished || this.aborted || this.paused) return;
      if (this.queue.length > 0) return this.schedule();
      if (this.database.beginCommit(this)) return;
      this.database.commit(this.stores, this.mode);
      this.finished = true;
      this.oncomplete?.({ target: this } as unknown as Event);
      this.database.release(this);
    });
  }

  private finishAbort() {
    if (this.finished) return;
    this.finished = true;
    this.onabort?.({ target: this } as unknown as Event);
    this.database.release(this);
  }
}

class FakeObjectStore {
  readonly indexNames: FakeNameList;
  private readonly transaction: FakeTransaction;
  private readonly name: string;

  constructor(
    transaction: FakeTransaction,
    database: FakeDatabase,
    name: string,
  ) {
    this.transaction = transaction;
    this.name = name;
    this.indexNames = new FakeNameList(() => [...database.definition(name).indexes.keys()]);
  }

  get(key: FakeKey) { return this.transaction.request(() => clone(this.transaction.read(this.name, key))); }
  put(value: unknown) { return this.transaction.request(() => this.transaction.write(this.name, value, false)); }
  add(value: unknown) { return this.transaction.request(() => this.transaction.write(this.name, value, true)); }
  index(name: string) { return new FakeIndex(this.transaction, this.name, name); }
}

class FakeIndex {
  private readonly transaction: FakeTransaction;
  private readonly storeName: string;
  private readonly name: string;

  constructor(
    transaction: FakeTransaction,
    storeName: string,
    name: string,
  ) {
    this.transaction = transaction;
    this.storeName = storeName;
    this.name = name;
  }
  get(key: FakeKey) { return this.transaction.request(() => clone(this.transaction.readIndex(this.storeName, this.name, key, false))); }
  getAll(key: FakeKey) { return this.transaction.request(() => clone(this.transaction.readIndex(this.storeName, this.name, key, true))); }
}

const uuid = (number: number) => '00000000-0000-4000-8000-' + number.toString(16).padStart(12, '0');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const scope = { userId: 'user-1', brandId: 'brand-1' } as const;
const foreignScope = { userId: 'user-2', brandId: 'brand-2' } as const;
const project = { projectId: uuid(900), ownerId: scope.userId, brandId: scope.brandId, conversationIds: [] };
const initialPrompt = '  Keep this prompt exactly.\n';

const reference = (order: number) => order % 2 === 0
  ? {
    order,
    kind: 'scene-asset' as const,
    imageId: 'scene-image-' + order,
    storagePath: 'scene-assets/scene-' + order + '.png',
    name: 'Scene ' + order + '.png',
    sceneAssetKey: 'fabric' + (order + 1) + '.jpg',
  }
  : {
    order,
    kind: 'upload' as const,
    imageId: 'upload-image-' + order,
    storagePath: 'generated-images/upload-' + order,
    name: 'Upload ' + order + '.png',
  };

const idSequence = () => {
  let count = 0;
  return {
    next: () => uuid(++count),
    count: () => count,
  };
};

const createFixture = () => {
  const idb = new FakeIndexedDBFactory();
  const ids = idSequence();
  const dbName = 'design-session-test';
  const store = createSessionStore({ idb: idb as unknown as IDBFactory, dbName, newId: ids.next });
  return { idb, ids, dbName, store };
};

const createProjectSession = async (store = createFixture().store) => {
  await store.putProject(scope, project);
  return store.ensureSession(scope, { conversationId: 'conversation-1', projectId: project.projectId });
};

const assertStoreError = async (promise: Promise<unknown>, code: string) => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof SessionStoreError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
};

test('persists pending input exactly and reopens the full ordered 16-reference manifest', async () => {
  const fixture = createFixture();
  await createProjectSession(fixture.store);
  const references = Array.from({ length: 16 }, (_, index) => reference(index));
  const input = {
    conversationId: 'conversation-1',
    clientRequestKey: 'client-key-1',
    prompt: initialPrompt,
    references,
  };
  const admitted = await fixture.store.admitTurn(scope, input);
  references[0].name = 'caller mutation';

  assert.equal(admitted.created, true);
  assert.equal(admitted.turn.prompt, initialPrompt);
  assert.deepEqual(admitted.turn.references, Array.from({ length: 16 }, (_, index) => reference(index)));
  assert.equal(Object.isFrozen(admitted.turn), true);
  assert.equal(Object.isFrozen(admitted.turn.references), true);
  assert.equal(Object.isFrozen(admitted.turn.references[0]), true);
  assert.match(admitted.turn.requestId, UUID_V4);

  const reopenedIds = idSequence();
  const reopened = createSessionStore({
    idb: fixture.idb as unknown as IDBFactory,
    dbName: fixture.dbName,
    newId: reopenedIds.next,
  });
  const replay = await reopened.admitTurn(scope, {
    ...input,
    references: Array.from({ length: 16 }, (_, index) => reference(index)),
  });
  const session = await reopened.getSession(scope, 'conversation-1');
  const ensured = await reopened.ensureSession(scope, {
    conversationId: 'conversation-1',
    projectId: project.projectId,
  });
  assert.equal(replay.created, false);
  assert.equal(replay.turn.turnId, admitted.turn.turnId);
  assert.equal(replay.turn.requestId, admitted.turn.requestId);
  assert.equal(reopenedIds.count(), 0);
  assert.equal(session?.turns[0].turnId, admitted.turn.turnId);
  assert.equal(ensured.turns[0].turnId, admitted.turn.turnId);
  assert.deepEqual(session?.turns[0].references, Array.from({ length: 16 }, (_, index) => reference(index)));
});

test('serializes same-key admissions across store instances and allocates only one pair of IDs', async () => {
  const fixture = createFixture();
  await createProjectSession(fixture.store);
  const secondIds = idSequence();
  const secondStore = createSessionStore({
    idb: fixture.idb as unknown as IDBFactory,
    dbName: fixture.dbName,
    newId: secondIds.next,
  });
  const input = {
    conversationId: 'conversation-1',
    clientRequestKey: 'concurrent-key',
    prompt: initialPrompt,
    references: [reference(0), reference(1)],
  };
  const results = await Promise.all([
    fixture.store.admitTurn(scope, input),
    secondStore.admitTurn(scope, input),
  ]);
  assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
  assert.equal(results[0].turn.turnId, results[1].turn.turnId);
  assert.equal(results[0].turn.requestId, results[1].turn.requestId);
  assert.equal(fixture.ids.count() + secondIds.count(), 2);
  assert.equal((await fixture.store.getSession(scope, 'conversation-1'))?.turns.length, 1);
});

test('does not resolve a successful write until its IndexedDB transaction commits', async () => {
  const fixture = createFixture();
  await fixture.store.putProject(scope, project);
  const hold = fixture.idb.holdNextCommit();
  let resolved = false;
  const write = fixture.store.putProject(scope, { ...project, conversationIds: ['prior-conversation'] })
    .then((value) => { resolved = true; return value; });
  await hold.reached;
  assert.equal(resolved, false);
  hold.release();
  assert.deepEqual((await write).conversationIds, ['prior-conversation']);
  assert.equal(resolved, true);
});

test('aborted admission rolls back all rows and a later admission is safe', async () => {
  const fixture = createFixture();
  await createProjectSession(fixture.store);
  fixture.idb.abortNextCommit();
  const input = {
    conversationId: 'conversation-1',
    clientRequestKey: 'abort-key',
    prompt: initialPrompt,
    references: [reference(0)],
  };
  await assertStoreError(fixture.store.admitTurn(scope, input), 'persist_failed');
  assert.equal((await fixture.store.getSession(scope, 'conversation-1'))?.turns.length, 0);
  const admitted = await fixture.store.admitTurn(scope, input);
  assert.equal(admitted.created, true);
  assert.equal(admitted.turn.turnId, uuid(3));
  assert.equal(admitted.turn.requestId, uuid(4));
});

test('a changed prompt or reference order cannot reuse an admission key', async () => {
  const fixture = createFixture();
  await createProjectSession(fixture.store);
  const first = {
    conversationId: 'conversation-1',
    clientRequestKey: 'mismatch-key',
    prompt: initialPrompt,
    references: [reference(0), reference(1)],
  };
  const admitted = await fixture.store.admitTurn(scope, first);
  await assertStoreError(fixture.store.admitTurn(scope, { ...first, prompt: initialPrompt + 'changed' }), 'turn_input_mismatch');
  const reorderedReferences = [reference(1), reference(0)].map((item, index) => ({ ...item, order: index }));
  await assertStoreError(fixture.store.admitTurn(scope, { ...first, references: reorderedReferences }), 'turn_input_mismatch');
  assert.equal(fixture.ids.count(), 2);
  const session = await fixture.store.getSession(scope, 'conversation-1');
  assert.equal(session?.turns.length, 1);
  assert.equal(session?.turns[0].turnId, admitted.turn.turnId);
  assert.equal(session?.turns[0].prompt, initialPrompt);
});

test('scope isolation hides reads, rejects foreign writes, and preserves pending work', async () => {
  const fixture = createFixture();
  await createProjectSession(fixture.store);
  const admitted = await fixture.store.admitTurn(scope, {
    conversationId: 'conversation-1',
    clientRequestKey: 'scope-key',
    prompt: initialPrompt,
    references: [],
  });
  assert.equal(await fixture.store.getSession(foreignScope, 'conversation-1'), null);
  await assertStoreError(fixture.store.updateTurn(foreignScope, admitted.turn.turnId, { status: 'submitted' }), 'scope_mismatch');
  await assertStoreError(fixture.store.ackTurn(foreignScope, admitted.turn.turnId, '2026-09-30T01:02:03.000Z'), 'scope_mismatch');
  const retained = await fixture.store.getSession(scope, 'conversation-1');
  assert.equal(retained?.turns.length, 1);
  assert.equal(retained?.turns[0].status, 'pending');
});

test('enforces turn transitions, output identity, terminal protection, and idempotent acknowledgement', async () => {
  const fixture = createFixture();
  await createProjectSession(fixture.store);
  const admitted = await fixture.store.admitTurn(scope, {
    conversationId: 'conversation-1',
    clientRequestKey: 'transition-key',
    prompt: initialPrompt,
    references: [],
  });
  const ackedAt = '2026-09-30T01:02:03.000Z';
  await assertStoreError(fixture.store.ackTurn(scope, admitted.turn.turnId, ackedAt), 'invalid_transition');
  const submitted = await fixture.store.updateTurn(scope, admitted.turn.turnId, {
    status: 'submitted',
    jobId: 'job-1',
  });
  assert.equal(submitted.status, 'submitted');
  const unknown = await fixture.store.updateTurn(scope, admitted.turn.turnId, { status: 'unknown' });
  assert.equal(unknown.status, 'unknown');
  const succeeded = await fixture.store.updateTurn(scope, admitted.turn.turnId, {
    status: 'succeeded',
    outputs: [{ imageId: 'image-1', storagePath: 'generated-images/image-1', jobId: 'job-1', candidateIndex: 0 }],
  });
  assert.equal(succeeded.status, 'succeeded');
  const firstAck = await fixture.store.ackTurn(scope, admitted.turn.turnId, ackedAt);
  const secondAck = await fixture.store.ackTurn(scope, admitted.turn.turnId, '2026-09-30T02:03:04.000Z');
  assert.equal(firstAck.ackedAt, ackedAt);
  assert.equal(secondAck.ackedAt, ackedAt);
  await assertStoreError(fixture.store.updateTurn(scope, admitted.turn.turnId, { status: 'failed', failureCode: 'late' }), 'invalid_transition');

  const another = await fixture.store.admitTurn(scope, {
    conversationId: 'conversation-1',
    clientRequestKey: 'invalid-success-key',
    prompt: initialPrompt,
    references: [],
  });
  await assertStoreError(fixture.store.updateTurn(scope, another.turn.turnId, { status: 'succeeded' }), 'invalid_transition');
  await assertStoreError(fixture.store.updateTurn(scope, another.turn.turnId, { status: 'failed' }), 'invalid_transition');
  await assertStoreError(fixture.store.updateTurn(scope, another.turn.turnId, { prompt: 'rewrite' } as never), 'invalid_input');

  const failedTurn = await fixture.store.admitTurn(scope, {
    conversationId: 'conversation-1',
    clientRequestKey: 'valid-failure-key',
    prompt: initialPrompt,
    references: [],
  });
  const failed = await fixture.store.updateTurn(scope, failedTurn.turn.turnId, {
    status: 'failed',
    failureCode: 'provider_timeout',
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failureCode, 'provider_timeout');
  await assertStoreError(fixture.store.updateTurn(scope, failedTurn.turn.turnId, { status: 'unknown' }), 'invalid_transition');
});

test('rejects unknown fields, URL paths, excessive references, duplicate candidates, and corrupt reads safely', async () => {
  const fixture = createFixture();
  await createProjectSession(fixture.store);
  const base = {
    conversationId: 'conversation-1',
    clientRequestKey: 'schema-key',
    prompt: initialPrompt,
    references: [],
  };
  await assertStoreError(fixture.store.admitTurn(scope, {
    ...base,
    references: [{ ...reference(0), secret: 'never expose this' }],
  } as never), 'invalid_input');
  await assertStoreError(fixture.store.admitTurn(scope, {
    ...base,
    references: [
      { order: 0, kind: 'upload', imageId: 'i', storagePath: 'https://secret.invalid/image', name: 'Image.png' },
    ],
  }), 'invalid_input');
  await assertStoreError(fixture.store.admitTurn(scope, {
    ...base,
    references: Array.from({ length: 17 }, (_, index) => reference(index)),
  }), 'invalid_input');

  const admitted = await fixture.store.admitTurn(scope, base);
  await assertStoreError(fixture.store.updateTurn(scope, admitted.turn.turnId, {
    status: 'succeeded',
    outputs: [
      { imageId: 'image-1', storagePath: 'generated-images/image-1', jobId: 'job-1', candidateIndex: 0 },
      { imageId: 'image-2', storagePath: 'generated-images/image-2', jobId: 'job-1', candidateIndex: 0 },
    ],
  }), 'invalid_input');
  await assertStoreError(fixture.store.updateTurn(scope, admitted.turn.turnId, {
    status: 'succeeded',
    outputs: [{ imageId: 'image-1', storagePath: 'data:image/png,secret', jobId: 'job-1', candidateIndex: 0 }],
  }), 'invalid_input');

  const raw = {
    version: 1,
    turnId: admitted.turn.turnId,
    requestId: admitted.turn.requestId,
    clientRequestKey: admitted.turn.clientRequestKey,
    prompt: admitted.turn.prompt,
    references: [],
    status: 'pending',
    outputs: [],
    scope,
    conversationId: 'conversation-1',
    projectId: project.projectId,
    privateSecret: 'corrupt raw secret',
  };
  fixture.idb.rawSet(fixture.dbName, 'turns', raw);
  await assertStoreError(fixture.store.getSession(scope, 'conversation-1'), 'corrupt_record');
});

test('converts abort causes to a safe code and never includes prompt or cause text', async () => {
  const fixture = createFixture();
  await createProjectSession(fixture.store);
  fixture.idb.abortNextCommit('private raw database cause');
  const failed = fixture.store.admitTurn(scope, {
    conversationId: 'conversation-1',
    clientRequestKey: 'private-client-key',
    prompt: 'private prompt contents',
    references: [],
  });
  await assert.rejects(failed, (error: unknown) => {
    assert.ok(error instanceof SessionStoreError);
    assert.equal(error.code, 'persist_failed');
    assert.equal(error.message, 'persist_failed');
    assert.equal(error.message.includes('private'), false);
    return true;
  });
  await fixture.store.admitTurn(scope, {
    conversationId: 'conversation-1',
    clientRequestKey: 'private-client-key',
    prompt: 'private prompt contents',
    references: [],
  });
  await assert.rejects(fixture.store.admitTurn(scope, {
    conversationId: 'conversation-1',
    clientRequestKey: 'private-client-key',
    prompt: 'private prompt contents changed',
    references: [],
  }), (error: unknown) => {
    assert.ok(error instanceof SessionStoreError);
    assert.equal(error.code, 'turn_input_mismatch');
    assert.equal(error.message.includes('private'), false);
    return true;
  });
});

test('converts IndexedDB open and quota failures to safe persistence codes', async () => {
  const openFixture = createFixture();
  openFixture.idb.failNextOpen('private database open detail');
  await assertStoreError(openFixture.store.putProject(scope, project), 'persist_failed');

  const quotaFixture = createFixture();
  quotaFixture.idb.failNextWrite('QuotaExceededError: private storage detail');
  await assert.rejects(quotaFixture.store.putProject(scope, project), (error: unknown) => {
    assert.ok(error instanceof SessionStoreError);
    assert.equal(error.code, 'persist_failed');
    assert.equal(error.message, 'persist_failed');
    assert.equal(error.message.includes('private'), false);
    return true;
  });
});
