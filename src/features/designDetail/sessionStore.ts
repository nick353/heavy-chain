import {
  DESIGN_DIALOGUE_REFERENCE_LIMIT,
  type DesignDialogueManifestReference,
} from '../../lib/designDialogueReferences.ts';
import {
  SessionStoreError,
  type AdmitDesignTurnInput,
  type DesignProject,
  type DesignScope,
  type DesignSession,
  type DesignTurn,
  type DesignTurnOutput,
  type DesignTurnPatch,
  type DesignTurnStatus,
  type EnsureDesignSessionInput,
} from './types.ts';

const DATABASE_VERSION = 1;
const PROJECTS_STORE = 'projects';
const SESSIONS_STORE = 'sessions';
const TURNS_STORE = 'turns';
const ADMISSION_INDEX = 'by-admission-key';
const SESSION_INDEX = 'by-session';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;
const TERMINAL_STATUSES = new Set<DesignTurnStatus>(['succeeded', 'failed']);
const TURN_STATUSES = new Set<DesignTurnStatus>([
  'pending', 'submitted', 'unknown', 'succeeded', 'failed',
]);

type StoredProject = {
  version: 1;
  projectId: string;
  ownerId: string;
  brandId: string;
  conversationIds: string[];
};

type StoredSession = {
  version: 1;
  conversationId: string;
  projectId: string;
  scope: { userId: string; brandId: string };
  turnIds: string[];
};

type StoredTurn = {
  version: 1;
  turnId: string;
  requestId: string;
  clientRequestKey: string;
  prompt: string;
  references: DesignDialogueManifestReference[];
  status: DesignTurnStatus;
  jobId?: string;
  outputs: DesignTurnOutput[];
  failureCode?: string;
  ackedAt?: string;
  scope: { userId: string; brandId: string };
  conversationId: string;
  projectId: string;
};

type ReadWriteContext<T> = {
  transaction: IDBTransaction;
  complete(value: T): void;
  abort(code: ConstructorParameters<typeof SessionStoreError>[0]): void;
};

export type DesignSessionStore = Readonly<{
  putProject(scope: DesignScope, project: DesignProject): Promise<DesignProject>;
  ensureSession(scope: DesignScope, input: EnsureDesignSessionInput): Promise<DesignSession>;
  admitTurn(scope: DesignScope, input: AdmitDesignTurnInput): Promise<Readonly<{
    turn: DesignTurn;
    created: boolean;
  }>>;
  updateTurn(scope: DesignScope, turnId: string, patch: DesignTurnPatch): Promise<DesignTurn>;
  ackTurn(scope: DesignScope, turnId: string, ackedAt: string): Promise<DesignTurn>;
  getSession(scope: DesignScope, conversationId: string): Promise<DesignSession | null>;
}>;

const fail = (code: ConstructorParameters<typeof SessionStoreError>[0]): never => {
  throw new SessionStoreError(code);
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const hasExactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
};

const boundedString = (
  value: unknown,
  maximum: number,
  options: { rejectControls?: boolean; rejectSurroundingSpace?: boolean } = {},
): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= maximum
  && value.trim().length > 0
  && (!options.rejectControls || !CONTROL_CHARS.test(value))
  && (!options.rejectSurroundingSpace || value.trim() === value)
);

const normalizeScope = (value: unknown, code: 'invalid_input' | 'corrupt_record' = 'invalid_input') => {
  if (!isRecord(value) || !hasExactKeys(value, ['userId', 'brandId'])
    || !boundedString(value.userId, 128, { rejectControls: true })
    || !boundedString(value.brandId, 128, { rejectControls: true })) {
    return fail(code);
  }
  return { userId: value.userId, brandId: value.brandId };
};

const sameScope = (
  left: { userId: string; brandId: string },
  right: { userId: string; brandId: string },
) => left.userId === right.userId && left.brandId === right.brandId;

const normalizeIdentifier = (value: unknown, code: 'invalid_input' | 'corrupt_record' = 'invalid_input') => {
  if (!boundedString(value, 256, { rejectControls: true })) return fail(code);
  return value;
};

const projectKey = (scope: DesignScope, projectId: string): IDBValidKey => [
  scope.userId, scope.brandId, projectId,
];

const sessionKey = (scope: DesignScope, conversationId: string): IDBValidKey => [
  scope.userId, scope.brandId, conversationId,
];

const admissionKey = (
  scope: DesignScope,
  conversationId: string,
  clientRequestKey: string,
): IDBValidKey => [scope.userId, scope.brandId, conversationId, clientRequestKey];

const sessionIndexKey = (scope: DesignScope, conversationId: string): IDBValidKey => [
  scope.userId, scope.brandId, conversationId,
];

const validateStoragePath = (
  value: unknown,
  code: 'invalid_input' | 'corrupt_record',
): string => {
  if (!boundedString(value, 2048, { rejectControls: true })
    || URL_SCHEME.test(value)
    || value.startsWith('/')
    || value.includes('\\')
    || value.includes('?')
    || value.includes('#')
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    return fail(code);
  }
  return value;
};

const validateDisplayName = (
  value: unknown,
  code: 'invalid_input' | 'corrupt_record',
): string => {
  if (!boundedString(value, 512, { rejectControls: true, rejectSurroundingSpace: true })
    || /[\\/?#]/u.test(value)
    || URL_SCHEME.test(value)
    || value === '.'
    || value === '..') {
    return fail(code);
  }
  return value;
};

const normalizeReference = (
  value: unknown,
  index: number,
  code: 'invalid_input' | 'corrupt_record',
): DesignDialogueManifestReference => {
  if (!isRecord(value)
    || !hasExactKeys(value, ['order', 'kind', 'imageId', 'storagePath', 'name'], ['sceneAssetKey'])
    || !Number.isSafeInteger(value.order)
    || value.order !== index
    || (value.kind !== 'upload' && value.kind !== 'scene-asset')
    || !boundedString(value.imageId, 512, { rejectControls: true })
    || URL_SCHEME.test(value.imageId)
    || !Object.hasOwn(value, 'storagePath')
    || !Object.hasOwn(value, 'name')) {
    return fail(code);
  }

  const storagePath = validateStoragePath(value.storagePath, code);
  const name = validateDisplayName(value.name, code);
  const hasSceneAssetKey = Object.hasOwn(value, 'sceneAssetKey');
  if (value.kind === 'scene-asset') {
    if (!hasSceneAssetKey || !boundedString(value.sceneAssetKey, 256, {
      rejectControls: true,
      rejectSurroundingSpace: true,
    }) || /[\\/?#]/u.test(value.sceneAssetKey) || URL_SCHEME.test(value.sceneAssetKey)) {
      return fail(code);
    }
  } else if (hasSceneAssetKey) {
    return fail(code);
  }

  return {
    order: value.order,
    kind: value.kind,
    imageId: value.imageId,
    storagePath,
    name,
    ...(hasSceneAssetKey ? { sceneAssetKey: value.sceneAssetKey as string } : {}),
  };
};

const normalizeReferences = (
  value: unknown,
  code: 'invalid_input' | 'corrupt_record',
): DesignDialogueManifestReference[] => {
  if (!Array.isArray(value) || value.length > DESIGN_DIALOGUE_REFERENCE_LIMIT) return fail(code);
  return value.map((reference, index) => normalizeReference(reference, index, code));
};

const normalizeProject = (value: unknown, scope: DesignScope): StoredProject => {
  if (!isRecord(value)
    || !hasExactKeys(value, ['projectId', 'ownerId', 'brandId', 'conversationIds'])
    || !Array.isArray(value.conversationIds)) {
    return fail('invalid_input');
  }
  const projectId = normalizeIdentifier(value.projectId);
  const ownerId = normalizeIdentifier(value.ownerId);
  const brandId = normalizeIdentifier(value.brandId);
  if (ownerId !== scope.userId || brandId !== scope.brandId) return fail('scope_mismatch');
  const conversationIds = value.conversationIds.map((id) => normalizeIdentifier(id));
  if (new Set(conversationIds).size !== conversationIds.length) return fail('invalid_input');
  return { version: 1, projectId, ownerId, brandId, conversationIds };
};

const parseStoredProject = (value: unknown, scope: DesignScope, projectId: string): StoredProject => {
  if (!isRecord(value)
    || !hasExactKeys(value, ['version', 'projectId', 'ownerId', 'brandId', 'conversationIds'])
    || value.version !== 1
    || !Array.isArray(value.conversationIds)) {
    return fail('corrupt_record');
  }
  const parsedId = normalizeIdentifier(value.projectId, 'corrupt_record');
  const ownerId = normalizeIdentifier(value.ownerId, 'corrupt_record');
  const brandId = normalizeIdentifier(value.brandId, 'corrupt_record');
  const conversationIds = value.conversationIds.map((id) => normalizeIdentifier(id, 'corrupt_record'));
  if (parsedId !== projectId || ownerId !== scope.userId || brandId !== scope.brandId
    || new Set(conversationIds).size !== conversationIds.length) {
    return fail('corrupt_record');
  }
  return { version: 1, projectId: parsedId, ownerId, brandId, conversationIds };
};

const normalizeSessionInput = (value: unknown): EnsureDesignSessionInput => {
  if (!isRecord(value) || !hasExactKeys(value, ['conversationId', 'projectId'])) return fail('invalid_input');
  return {
    conversationId: normalizeIdentifier(value.conversationId),
    projectId: normalizeIdentifier(value.projectId),
  };
};

const parseStoredSession = (value: unknown): StoredSession => {
  if (!isRecord(value)
    || !hasExactKeys(value, ['version', 'conversationId', 'projectId', 'scope', 'turnIds'])
    || value.version !== 1
    || !Array.isArray(value.turnIds)) {
    return fail('corrupt_record');
  }
  const scope = normalizeScope(value.scope, 'corrupt_record');
  const conversationId = normalizeIdentifier(value.conversationId, 'corrupt_record');
  const projectId = normalizeIdentifier(value.projectId, 'corrupt_record');
  const turnIds = value.turnIds.map((id) => normalizeIdentifier(id, 'corrupt_record'));
  if (new Set(turnIds).size !== turnIds.length) return fail('corrupt_record');
  return { version: 1, conversationId, projectId, scope, turnIds };
};

const validFailureCode = (value: unknown): value is string => (
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)
);

const validIsoTimestamp = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length <= 40
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value
);

const normalizeOutput = (
  value: unknown,
  code: 'invalid_input' | 'corrupt_record',
): DesignTurnOutput => {
  if (!isRecord(value)
    || !hasExactKeys(value, ['imageId', 'storagePath', 'jobId', 'candidateIndex'])
    || !boundedString(value.imageId, 512, { rejectControls: true })
    || URL_SCHEME.test(value.imageId)
    || !Number.isSafeInteger(value.candidateIndex)
    || (value.candidateIndex as number) < 0) {
    return fail(code);
  }
  return {
    imageId: value.imageId,
    storagePath: validateStoragePath(value.storagePath, code),
    jobId: normalizeIdentifier(value.jobId, code),
    candidateIndex: value.candidateIndex as number,
  };
};

const normalizeOutputs = (
  value: unknown,
  code: 'invalid_input' | 'corrupt_record',
): DesignTurnOutput[] => {
  if (!Array.isArray(value)) return fail(code);
  const outputs = value.map((item) => normalizeOutput(item, code));
  const candidateIndexes = outputs.map((output) => output.candidateIndex);
  if (new Set(candidateIndexes).size !== candidateIndexes.length) return fail(code);
  return outputs;
};

const parseStoredTurn = (value: unknown): StoredTurn => {
  const required = [
    'version', 'turnId', 'requestId', 'clientRequestKey', 'prompt', 'references',
    'status', 'outputs', 'scope', 'conversationId', 'projectId',
  ];
  if (!isRecord(value)
    || !hasExactKeys(value, required, ['jobId', 'failureCode', 'ackedAt'])
    || value.version !== 1
    || typeof value.status !== 'string'
    || !TURN_STATUSES.has(value.status as DesignTurnStatus)
    || !boundedString(value.prompt, 4000)
    || !Object.hasOwn(value, 'references')
    || !Object.hasOwn(value, 'outputs')) {
    return fail('corrupt_record');
  }
  const turnId = normalizeIdentifier(value.turnId, 'corrupt_record');
  const requestId = normalizeIdentifier(value.requestId, 'corrupt_record');
  const clientRequestKey = normalizeIdentifier(value.clientRequestKey, 'corrupt_record');
  const conversationId = normalizeIdentifier(value.conversationId, 'corrupt_record');
  const projectId = normalizeIdentifier(value.projectId, 'corrupt_record');
  const scope = normalizeScope(value.scope, 'corrupt_record');
  if (!UUID_V4.test(turnId) || !UUID_V4.test(requestId) || turnId === requestId) return fail('corrupt_record');

  const references = normalizeReferences(value.references, 'corrupt_record');
  const outputs = normalizeOutputs(value.outputs, 'corrupt_record');
  const status = value.status as DesignTurnStatus;
  let jobId: string | undefined;
  if (Object.hasOwn(value, 'jobId')) jobId = normalizeIdentifier(value.jobId, 'corrupt_record');
  let failureCode: string | undefined;
  if (Object.hasOwn(value, 'failureCode')) {
    if (!validFailureCode(value.failureCode)) return fail('corrupt_record');
    failureCode = value.failureCode;
  }
  let ackedAt: string | undefined;
  if (Object.hasOwn(value, 'ackedAt')) {
    if (!validIsoTimestamp(value.ackedAt)) return fail('corrupt_record');
    ackedAt = value.ackedAt;
  }

  if ((status === 'succeeded' && outputs.length === 0)
    || (status !== 'succeeded' && outputs.length > 0)
    || (status === 'failed' ? failureCode === undefined : failureCode !== undefined)
    || (ackedAt !== undefined && (status !== 'succeeded' || outputs.length === 0))) {
    return fail('corrupt_record');
  }

  return {
    version: 1,
    turnId,
    requestId,
    clientRequestKey,
    prompt: value.prompt,
    references,
    status,
    ...(jobId === undefined ? {} : { jobId }),
    outputs,
    ...(failureCode === undefined ? {} : { failureCode }),
    ...(ackedAt === undefined ? {} : { ackedAt }),
    scope,
    conversationId,
    projectId,
  };
};

const toPublicProject = (project: StoredProject): DesignProject => Object.freeze({
  projectId: project.projectId,
  ownerId: project.ownerId,
  brandId: project.brandId,
  conversationIds: Object.freeze([...project.conversationIds]),
});

const toPublicTurn = (turn: StoredTurn): DesignTurn => Object.freeze({
  turnId: turn.turnId,
  requestId: turn.requestId,
  clientRequestKey: turn.clientRequestKey,
  prompt: turn.prompt,
  references: Object.freeze(turn.references.map((reference) => Object.freeze({ ...reference }))),
  status: turn.status,
  ...(turn.jobId === undefined ? {} : { jobId: turn.jobId }),
  outputs: Object.freeze(turn.outputs.map((output) => Object.freeze({ ...output }))),
  ...(turn.failureCode === undefined ? {} : { failureCode: turn.failureCode }),
  ...(turn.ackedAt === undefined ? {} : { ackedAt: turn.ackedAt }),
});

const toPublicSession = (session: StoredSession, turns: readonly StoredTurn[]): DesignSession => Object.freeze({
  conversationId: session.conversationId,
  projectId: session.projectId,
  scope: Object.freeze({ ...session.scope }),
  turns: Object.freeze(turns.map(toPublicTurn)),
});

const orderSessionTurns = (
  session: StoredSession,
  scope: DesignScope,
  storedTurns: readonly StoredTurn[],
): StoredTurn[] => {
  const byId = new Map<string, StoredTurn>();
  for (const turn of storedTurns) {
    if (!sameScope(turn.scope, scope)
      || turn.conversationId !== session.conversationId
      || turn.projectId !== session.projectId
      || byId.has(turn.turnId)) return fail('corrupt_record');
    byId.set(turn.turnId, turn);
  }
  if (byId.size !== session.turnIds.length) return fail('corrupt_record');
  return session.turnIds.map((id) => {
    const turn = byId.get(id);
    if (!turn) return fail('corrupt_record');
    return turn;
  });
};

const codeFromError = (
  error: unknown,
  fallback: ConstructorParameters<typeof SessionStoreError>[0],
): ConstructorParameters<typeof SessionStoreError>[0] => (
  error instanceof SessionStoreError ? error.code : fallback
);

const schemaMatches = (database: IDBDatabase): boolean => {
  if (!database.objectStoreNames.contains(PROJECTS_STORE)
    || !database.objectStoreNames.contains(SESSIONS_STORE)
    || !database.objectStoreNames.contains(TURNS_STORE)) return false;
  try {
    const transaction = database.transaction([PROJECTS_STORE, SESSIONS_STORE, TURNS_STORE], 'readonly');
    const turns = transaction.objectStore(TURNS_STORE);
    return turns.indexNames.contains(ADMISSION_INDEX) && turns.indexNames.contains(SESSION_INDEX);
  } catch {
    return false;
  }
};

const openDatabase = (idb: IDBFactory, dbName: string): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  let request: IDBOpenDBRequest;
  try {
    request = idb.open(dbName, DATABASE_VERSION);
  } catch {
    reject(new SessionStoreError('persist_failed'));
    return;
  }

  let settled = false;
  const rejectOnce = () => {
    if (settled) return;
    settled = true;
    reject(new SessionStoreError('persist_failed'));
  };

  request.onupgradeneeded = () => {
    try {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECTS_STORE)) {
        database.createObjectStore(PROJECTS_STORE, { keyPath: ['ownerId', 'brandId', 'projectId'] });
      }
      if (!database.objectStoreNames.contains(SESSIONS_STORE)) {
        database.createObjectStore(SESSIONS_STORE, { keyPath: ['scope.userId', 'scope.brandId', 'conversationId'] });
      }
      if (!database.objectStoreNames.contains(TURNS_STORE)) {
        const turns = database.createObjectStore(TURNS_STORE, { keyPath: 'turnId' });
        turns.createIndex(ADMISSION_INDEX, [
          'scope.userId', 'scope.brandId', 'conversationId', 'clientRequestKey',
        ], { unique: true });
        turns.createIndex(SESSION_INDEX, ['scope.userId', 'scope.brandId', 'conversationId']);
      }
    } catch {
      try { request.transaction?.abort(); } catch { /* opening failure is handled below */ }
      rejectOnce();
    }
  };

  request.onerror = rejectOnce;
  request.onblocked = rejectOnce;
  request.onsuccess = () => {
    const database = request.result;
    if (!schemaMatches(database)) {
      database.close();
      rejectOnce();
      return;
    }
    if (settled) {
      database.close();
      return;
    }
    settled = true;
    database.onversionchange = () => database.close();
    resolve(database);
  };
});

const runTransaction = <T>(
  database: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (context: ReadWriteContext<T>) => void,
): Promise<T> => new Promise((resolve, reject) => {
  let transaction: IDBTransaction;
  try {
    transaction = database.transaction(stores, mode);
  } catch {
    reject(new SessionStoreError('persist_failed'));
    return;
  }

  let result: T;
  let hasResult = false;
  let failureCode: ConstructorParameters<typeof SessionStoreError>[0] | undefined;
  let settled = false;
  const abort = (code: ConstructorParameters<typeof SessionStoreError>[0]) => {
    if (settled) return;
    failureCode = code;
    try {
      transaction.abort();
    } catch {
      if (!settled) {
        settled = true;
        reject(new SessionStoreError(code));
      }
    }
  };

  transaction.oncomplete = () => {
    if (settled) return;
    settled = true;
    if (!hasResult) {
      reject(new SessionStoreError('persist_failed'));
      return;
    }
    resolve(result);
  };
  transaction.onabort = () => {
    if (settled) return;
    settled = true;
    reject(new SessionStoreError(failureCode ?? 'persist_failed'));
  };
  transaction.onerror = () => {
    failureCode ??= 'persist_failed';
  };

  try {
    work({
      transaction,
      complete(value) {
        result = value;
        hasResult = true;
      },
      abort,
    });
  } catch (error) {
    abort(codeFromError(error, 'persist_failed'));
  }
});

const transitionTurn = (current: StoredTurn, patchValue: unknown): StoredTurn => {
  const allowed = ['status', 'jobId', 'outputs', 'failureCode'];
  const immutable = [
    'turnId', 'requestId', 'clientRequestKey', 'prompt', 'references',
    'scope', 'conversationId', 'projectId', 'ackedAt',
  ];
  if (!isRecord(patchValue)
    || Object.keys(patchValue).length === 0
    || immutable.some((key) => Object.hasOwn(patchValue, key))
    || !Object.keys(patchValue).every((key) => allowed.includes(key))) {
    return fail('invalid_input');
  }
  if (TERMINAL_STATUSES.has(current.status)) return fail('invalid_transition');

  let status = current.status;
  if (Object.hasOwn(patchValue, 'status')) {
    if (typeof patchValue.status !== 'string' || !TURN_STATUSES.has(patchValue.status as DesignTurnStatus)) {
      return fail('invalid_input');
    }
    status = patchValue.status as DesignTurnStatus;
    const transitions: Record<DesignTurnStatus, readonly DesignTurnStatus[]> = {
      pending: ['submitted', 'unknown', 'succeeded', 'failed'],
      submitted: ['unknown', 'succeeded', 'failed'],
      unknown: ['succeeded', 'failed'],
      succeeded: [],
      failed: [],
    };
    if (!transitions[current.status].includes(status)) return fail('invalid_transition');
  }

  const jobId = Object.hasOwn(patchValue, 'jobId')
    ? normalizeIdentifier(patchValue.jobId)
    : current.jobId;
  const outputs = Object.hasOwn(patchValue, 'outputs')
    ? normalizeOutputs(patchValue.outputs, 'invalid_input')
    : [...current.outputs];
  const failureCode = Object.hasOwn(patchValue, 'failureCode')
    ? (validFailureCode(patchValue.failureCode) ? patchValue.failureCode : fail('invalid_input'))
    : current.failureCode;

  if ((status === 'succeeded' && outputs.length === 0)
    || (status !== 'succeeded' && outputs.length > 0)
    || (status === 'failed' ? failureCode === undefined : failureCode !== undefined)
    || (Object.hasOwn(patchValue, 'outputs') && status !== 'succeeded')
    || (Object.hasOwn(patchValue, 'failureCode') && status !== 'failed')) {
    return fail('invalid_transition');
  }

  return parseStoredTurn({
    ...current,
    status,
    ...(jobId === undefined ? {} : { jobId }),
    outputs,
    ...(failureCode === undefined ? {} : { failureCode }),
  });
};

const validateTurnAssociation = (
  session: StoredSession,
  turn: StoredTurn,
  scope: DesignScope,
): void => {
  if (!sameScope(session.scope, scope) || !sameScope(turn.scope, scope)) return fail('scope_mismatch');
  if (session.conversationId !== turn.conversationId
    || session.projectId !== turn.projectId
    || !session.turnIds.includes(turn.turnId)) return fail('corrupt_record');
};

export const createSessionStore = (options: Readonly<{
  idb: IDBFactory;
  dbName: string;
  newId?: () => string;
}>): DesignSessionStore => {
  if (!isRecord(options)
    || !hasExactKeys(options, ['idb', 'dbName'], ['newId'])
    || typeof options.idb?.open !== 'function'
    || !boundedString(options.dbName, 128, { rejectControls: true })
    || (options.newId !== undefined && typeof options.newId !== 'function')) {
    return fail('invalid_input');
  }

  const idb = options.idb;
  const dbName = options.dbName;
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  let databasePromise: Promise<IDBDatabase> | undefined;
  const database = () => {
    databasePromise ??= openDatabase(idb, dbName);
    return databasePromise;
  };

  const transact = async <T>(
    stores: string[],
    mode: IDBTransactionMode,
    work: (context: ReadWriteContext<T>) => void,
  ): Promise<T> => {
    let db: IDBDatabase;
    try {
      db = await database();
    } catch {
      throw new SessionStoreError('persist_failed');
    }
    return runTransaction<T>(db, stores, mode, work);
  };

  return Object.freeze({
    async putProject(scopeValue: DesignScope, projectValue: DesignProject): Promise<DesignProject> {
      const scope = normalizeScope(scopeValue);
      const project = normalizeProject(projectValue, scope);
      return transact([PROJECTS_STORE], 'readwrite', ({ transaction, complete }) => {
        transaction.objectStore(PROJECTS_STORE).put(project);
        complete(toPublicProject(project));
      });
    },

    async ensureSession(scopeValue: DesignScope, inputValue: EnsureDesignSessionInput): Promise<DesignSession> {
      const scope = normalizeScope(scopeValue);
      const input = normalizeSessionInput(inputValue);
      return transact([PROJECTS_STORE, SESSIONS_STORE, TURNS_STORE], 'readwrite', ({ transaction, complete, abort }) => {
        const projects = transaction.objectStore(PROJECTS_STORE);
        const sessions = transaction.objectStore(SESSIONS_STORE);
        const turns = transaction.objectStore(TURNS_STORE);
        let projectReady = false;
        let sessionReady = false;
        let turnsReady = false;
        let project: StoredProject | undefined;
        let storedSession: StoredSession | undefined;
        let storedTurns: StoredTurn[] = [];

        const finish = () => {
          if (!projectReady || !sessionReady || !turnsReady) return;
          if (!project) return abort('not_found');
          if (!project.conversationIds.includes(input.conversationId)) {
            project = {
              ...project,
              conversationIds: [...project.conversationIds, input.conversationId],
            };
            projects.put(project);
          }
          if (storedSession) {
            if (!sameScope(storedSession.scope, scope)) return abort('corrupt_record');
            if (storedSession.projectId !== input.projectId) return abort('scope_mismatch');
            complete(toPublicSession(storedSession, orderSessionTurns(storedSession, scope, storedTurns)));
            return;
          }
          if (storedTurns.length > 0) return abort('corrupt_record');
          const created: StoredSession = {
            version: 1,
            conversationId: input.conversationId,
            projectId: input.projectId,
            scope: { ...scope },
            turnIds: [],
          };
          sessions.put(created);
          complete(toPublicSession(created, []));
        };

        const projectRequest = projects.get(projectKey(scope, input.projectId));
        projectRequest.onsuccess = () => {
          try {
            project = projectRequest.result === undefined
              ? undefined
              : parseStoredProject(projectRequest.result, scope, input.projectId);
            projectReady = true;
            finish();
          } catch (error) {
            abort(codeFromError(error, 'corrupt_record'));
          }
        };

        const sessionRequest = sessions.get(sessionKey(scope, input.conversationId));
        sessionRequest.onsuccess = () => {
          try {
            storedSession = sessionRequest.result === undefined
              ? undefined
              : parseStoredSession(sessionRequest.result);
            sessionReady = true;
            finish();
          } catch (error) {
            abort(codeFromError(error, 'corrupt_record'));
          }
        };

        const turnRequest = turns.index(SESSION_INDEX).getAll(sessionIndexKey(scope, input.conversationId));
        turnRequest.onsuccess = () => {
          try {
            if (!Array.isArray(turnRequest.result)) return abort('corrupt_record');
            storedTurns = turnRequest.result.map(parseStoredTurn);
            turnsReady = true;
            finish();
          } catch (error) {
            abort(codeFromError(error, 'corrupt_record'));
          }
        };
      });
    },

    async admitTurn(scopeValue: DesignScope, inputValue: AdmitDesignTurnInput): Promise<Readonly<{
      turn: DesignTurn;
      created: boolean;
    }>> {
      const scope = normalizeScope(scopeValue);
      if (!isRecord(inputValue)
        || !hasExactKeys(inputValue, ['conversationId', 'clientRequestKey', 'prompt', 'references'])
        || !boundedString(inputValue.prompt, 4000)
        || !Object.hasOwn(inputValue, 'references')) {
        return fail('invalid_input');
      }
      const conversationId = normalizeIdentifier(inputValue.conversationId);
      const clientRequestKey = normalizeIdentifier(inputValue.clientRequestKey);
      const prompt = inputValue.prompt;
      const references = normalizeReferences(inputValue.references, 'invalid_input');
      return transact([PROJECTS_STORE, SESSIONS_STORE, TURNS_STORE], 'readwrite', ({ transaction, complete, abort }) => {
        const projects = transaction.objectStore(PROJECTS_STORE);
        const sessions = transaction.objectStore(SESSIONS_STORE);
        const turns = transaction.objectStore(TURNS_STORE);
        const sessionRequest = sessions.get(sessionKey(scope, conversationId));
        sessionRequest.onsuccess = () => {
          try {
            if (sessionRequest.result === undefined) return abort('not_found');
            const session = parseStoredSession(sessionRequest.result);
            if (!sameScope(session.scope, scope)) return abort('corrupt_record');
            const projectRequest = projects.get(projectKey(scope, session.projectId));
            const admissionRequest = turns.index(ADMISSION_INDEX).get(
              admissionKey(scope, conversationId, clientRequestKey),
            );
            let projectReady = false;
            let admissionReady = false;
            let project: StoredProject | undefined;
            let existing: StoredTurn | undefined;

            const finish = () => {
              if (!projectReady || !admissionReady) return;
              if (!project) return abort('corrupt_record');
              if (!project.conversationIds.includes(conversationId)) return abort('corrupt_record');
              if (existing) {
                if (!sameScope(existing.scope, scope)
                  || existing.conversationId !== conversationId
                  || existing.projectId !== session.projectId
                  || !session.turnIds.includes(existing.turnId)) return abort('corrupt_record');
                const sameInput = existing.prompt === prompt
                  && JSON.stringify(existing.references) === JSON.stringify(references);
                if (!sameInput) return abort('turn_input_mismatch');
                complete(Object.freeze({ turn: toPublicTurn(existing), created: false }));
                return;
              }

              let turnId: string;
              let requestId: string;
              try {
                turnId = newId();
                requestId = newId();
              } catch {
                return abort('persist_failed');
              }
              if (!UUID_V4.test(turnId) || !UUID_V4.test(requestId) || turnId === requestId) {
                return abort('invalid_input');
              }
              const created: StoredTurn = {
                version: 1,
                turnId,
                requestId,
                clientRequestKey,
                prompt,
                references,
                status: 'pending',
                outputs: [],
                scope: { ...scope },
                conversationId,
                projectId: session.projectId,
              };
              turns.add(created);
              sessions.put({ ...session, turnIds: [...session.turnIds, turnId] });
              complete(Object.freeze({ turn: toPublicTurn(created), created: true }));
            };

            projectRequest.onsuccess = () => {
              try {
                project = projectRequest.result === undefined
                  ? undefined
                  : parseStoredProject(projectRequest.result, scope, session.projectId);
                projectReady = true;
                finish();
              } catch (error) {
                abort(codeFromError(error, 'corrupt_record'));
              }
            };
            admissionRequest.onsuccess = () => {
              try {
                existing = admissionRequest.result === undefined
                  ? undefined
                  : parseStoredTurn(admissionRequest.result);
                admissionReady = true;
                finish();
              } catch (error) {
                abort(codeFromError(error, 'corrupt_record'));
              }
            };
          } catch (error) {
            abort(codeFromError(error, 'corrupt_record'));
          }
        };
      });
    },

    async updateTurn(scopeValue: DesignScope, turnIdValue: string, patchValue: DesignTurnPatch): Promise<DesignTurn> {
      const scope = normalizeScope(scopeValue);
      const turnId = normalizeIdentifier(turnIdValue);
      return transact([PROJECTS_STORE, SESSIONS_STORE, TURNS_STORE], 'readwrite', ({ transaction, complete, abort }) => {
        const projects = transaction.objectStore(PROJECTS_STORE);
        const sessions = transaction.objectStore(SESSIONS_STORE);
        const turns = transaction.objectStore(TURNS_STORE);
        const turnRequest = turns.get(turnId);
        turnRequest.onsuccess = () => {
          try {
            if (turnRequest.result === undefined) return abort('not_found');
            const current = parseStoredTurn(turnRequest.result);
            if (!sameScope(current.scope, scope)) return abort('scope_mismatch');
            const sessionRequest = sessions.get(sessionKey(scope, current.conversationId));
            const projectRequest = projects.get(projectKey(scope, current.projectId));
            let sessionReady = false;
            let projectReady = false;
            let session: StoredSession | undefined;
            let project: StoredProject | undefined;
            const finish = () => {
              if (!sessionReady || !projectReady) return;
              if (!session || !project) return abort('corrupt_record');
              validateTurnAssociation(session, current, scope);
              if (!project.conversationIds.includes(current.conversationId)) return abort('corrupt_record');
              const updated = transitionTurn(current, patchValue);
              turns.put(updated);
              complete(toPublicTurn(updated));
            };
            sessionRequest.onsuccess = () => {
              try {
                session = sessionRequest.result === undefined
                  ? undefined
                  : parseStoredSession(sessionRequest.result);
                sessionReady = true;
                finish();
              } catch (error) {
                abort(codeFromError(error, 'corrupt_record'));
              }
            };
            projectRequest.onsuccess = () => {
              try {
                project = projectRequest.result === undefined
                  ? undefined
                  : parseStoredProject(projectRequest.result, scope, current.projectId);
                projectReady = true;
                finish();
              } catch (error) {
                abort(codeFromError(error, 'corrupt_record'));
              }
            };
          } catch (error) {
            abort(codeFromError(error, 'corrupt_record'));
          }
        };
      });
    },

    async ackTurn(scopeValue: DesignScope, turnIdValue: string, ackedAtValue: string): Promise<DesignTurn> {
      const scope = normalizeScope(scopeValue);
      const turnId = normalizeIdentifier(turnIdValue);
      if (!validIsoTimestamp(ackedAtValue)) return fail('invalid_input');
      return transact([PROJECTS_STORE, SESSIONS_STORE, TURNS_STORE], 'readwrite', ({ transaction, complete, abort }) => {
        const projects = transaction.objectStore(PROJECTS_STORE);
        const sessions = transaction.objectStore(SESSIONS_STORE);
        const turns = transaction.objectStore(TURNS_STORE);
        const turnRequest = turns.get(turnId);
        turnRequest.onsuccess = () => {
          try {
            if (turnRequest.result === undefined) return abort('not_found');
            const current = parseStoredTurn(turnRequest.result);
            if (!sameScope(current.scope, scope)) return abort('scope_mismatch');
            const sessionRequest = sessions.get(sessionKey(scope, current.conversationId));
            const projectRequest = projects.get(projectKey(scope, current.projectId));
            let sessionReady = false;
            let projectReady = false;
            let session: StoredSession | undefined;
            let project: StoredProject | undefined;
            const finish = () => {
              if (!sessionReady || !projectReady) return;
              if (!session || !project) return abort('corrupt_record');
              validateTurnAssociation(session, current, scope);
              if (!project.conversationIds.includes(current.conversationId)) return abort('corrupt_record');
              if (current.status !== 'succeeded' || current.outputs.length === 0) {
                return abort('invalid_transition');
              }
              if (current.ackedAt !== undefined) {
                complete(toPublicTurn(current));
                return;
              }
              const updated = parseStoredTurn({ ...current, ackedAt: ackedAtValue });
              turns.put(updated);
              complete(toPublicTurn(updated));
            };
            sessionRequest.onsuccess = () => {
              try {
                session = sessionRequest.result === undefined
                  ? undefined
                  : parseStoredSession(sessionRequest.result);
                sessionReady = true;
                finish();
              } catch (error) {
                abort(codeFromError(error, 'corrupt_record'));
              }
            };
            projectRequest.onsuccess = () => {
              try {
                project = projectRequest.result === undefined
                  ? undefined
                  : parseStoredProject(projectRequest.result, scope, current.projectId);
                projectReady = true;
                finish();
              } catch (error) {
                abort(codeFromError(error, 'corrupt_record'));
              }
            };
          } catch (error) {
            abort(codeFromError(error, 'corrupt_record'));
          }
        };
      });
    },

    async getSession(scopeValue: DesignScope, conversationIdValue: string): Promise<DesignSession | null> {
      const scope = normalizeScope(scopeValue);
      const conversationId = normalizeIdentifier(conversationIdValue);
      return transact([PROJECTS_STORE, SESSIONS_STORE, TURNS_STORE], 'readonly', ({ transaction, complete, abort }) => {
        const projects = transaction.objectStore(PROJECTS_STORE);
        const sessions = transaction.objectStore(SESSIONS_STORE);
        const turns = transaction.objectStore(TURNS_STORE);
        const sessionRequest = sessions.get(sessionKey(scope, conversationId));
        sessionRequest.onsuccess = () => {
          try {
            if (sessionRequest.result === undefined) return complete(null);
            const session = parseStoredSession(sessionRequest.result);
            if (!sameScope(session.scope, scope) || session.conversationId !== conversationId) {
              return abort('corrupt_record');
            }
            const projectRequest = projects.get(projectKey(scope, session.projectId));
            const turnRequest = turns.index(SESSION_INDEX).getAll(sessionIndexKey(scope, conversationId));
            let projectReady = false;
            let turnsReady = false;
            let project: StoredProject | undefined;
            let storedTurns: StoredTurn[] = [];
            const finish = () => {
              if (!projectReady || !turnsReady) return;
              if (!project || !project.conversationIds.includes(conversationId)) return abort('corrupt_record');
              complete(toPublicSession(session, orderSessionTurns(session, scope, storedTurns)));
            };
            projectRequest.onsuccess = () => {
              try {
                project = projectRequest.result === undefined
                  ? undefined
                  : parseStoredProject(projectRequest.result, scope, session.projectId);
                projectReady = true;
                finish();
              } catch (error) {
                abort(codeFromError(error, 'corrupt_record'));
              }
            };
            turnRequest.onsuccess = () => {
              try {
                if (!Array.isArray(turnRequest.result)) return abort('corrupt_record');
                storedTurns = turnRequest.result.map(parseStoredTurn);
                turnsReady = true;
                finish();
              } catch (error) {
                abort(codeFromError(error, 'corrupt_record'));
              }
            };
          } catch (error) {
            abort(codeFromError(error, 'corrupt_record'));
          }
        };
      });
    },
  });
};
