import {
  compareCanvasArtifactSnapshot,
  describeSnapshotLineage,
  type CanvasSaveScopeDiagnosticEntry,
} from './canvasSaveScopeDiagnostics.ts';

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_CACHE_CANDIDATES = 8;
const DOCUMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MATCHES = new Set(['none', 'partial', 'full', 'ambiguous']);
const PENDING_MATCHES = new Set(['none', 'not_present', 'not_checked', 'partial', 'full', 'ambiguous']);

export type CanvasServerIdentityMatch = 'none' | 'partial' | 'full' | 'ambiguous';

export const CANVAS_LINEAGE_CANDIDATE_IDS = Object.freeze([
  '77e660ea-f8a8-4af2-9db8-b784483d2122',
  '78bcea8d-aa0a-4e34-b08a-2ab11106d603',
  'e36af9a7-1fe6-4113-92dc-887a54deb2fd',
] as const);

export const isExactCanvasLineageCandidateSet = (ids: unknown): boolean => (
  Array.isArray(ids) && ids.length === CANVAS_LINEAGE_CANDIDATE_IDS.length
  && new Set(ids).size === ids.length
  && CANVAS_LINEAGE_CANDIDATE_IDS.every((id) => ids.includes(id))
);

type CandidateLineageObservation = {
  id: string;
  fetch: 'ok' | 'not_found' | 'request_failed' | 'object_limit';
  revision?: number;
  snapshotVersion?: number;
  createdAt?: string;
  updatedAt?: string;
  lineage?: Extract<ReturnType<typeof describeSnapshotLineage>, { ok: true }>;
  routeMetadata: 'unknown';
  deletedMetadata: 'unknown';
  priorSaveProof: 'unknown';
  adoptable: false;
  saveAllowed: false;
};

export type CanvasCandidateLineageDiagnostic =
  | { status: 'rejected'; code: 'candidate_set_invalid' | 'anchor_malformed' | 'anchor_object_limit' | 'record_invalid' }
  | { status: 'stale'; getCount: number }
  | { status: 'stopped'; code: 'id_mismatch' | 'record_invalid' | 'candidate_malformed' | 'owner_scope_mismatch'; getCount: number }
  | { status: 'complete'; getCount: number; candidates: CandidateLineageObservation[] };

type CanvasCandidateLineageOptions = Pick<CanvasServerIdentityDiagnosticOptions,
  'anchorSnapshot' | 'userId' | 'brandId' | 'assertCurrent' | 'getDocument'> & { candidateIds: unknown };
export type CanvasServerIdentityCode =
  | 'cache_candidate_limit'
  | 'context_changed'
  | 'request_failed'
  | 'get_response_invalid'
  | 'list_response_invalid'
  | 'record_invalid'
  | 'brand_scope_mismatch'
  | 'get_id_mismatch'
  | 'duplicate_id'
  | 'order_violation'
  | 'get_list_disagreement'
  | 'get_candidate_missing_from_list'
  | 'page_cap'
  | 'multiple_full_matches'
  | 'competing_matches'
  | 'no_full_match'
  | 'candidate_not_owned'
  | 'unique_owned_full_match_observed';

export type CanvasServerIdentityObservation = {
  documentId: string;
  revision: number;
  scopeCurrent: true;
  ownedByCurrentUser: boolean;
  match: CanvasServerIdentityMatch;
  objectIdsEqual: boolean | null;
  snapshotEqual: boolean;
  fromCurrentCache: boolean;
};

export type CanvasServerIdentityDiagnostic = {
  status: 'complete' | 'stopped' | 'stale';
  code: CanvasServerIdentityCode;
  complete: boolean;
  consistent: boolean;
  truncated: boolean;
  listExhausted: boolean;
  requests: number;
  getRequests: number;
  listRequests: number;
  confirmationRequests: number;
  pagesRead: number;
  rowsObserved: number;
  cacheCandidatesRead: number;
  counts: Record<CanvasServerIdentityMatch, number>;
  observations: CanvasServerIdentityObservation[];
  uniqueOwnedFullMatchObserved: boolean;
  priorSaveEffectProven: false;
};

export type CanvasServerRequestContext = {
  userId: string;
  assertContext: () => void | Promise<void>;
};

export type CanvasServerIdentityDiagnosticOptions = {
  anchorSnapshot: unknown;
  currentCacheEntries: readonly CanvasSaveScopeDiagnosticEntry[];
  userId: string;
  brandId: string;
  assertCurrent: () => void | Promise<void>;
  getDocument: (documentId: string, context: CanvasServerRequestContext) => Promise<unknown>;
  listDocumentsPage: (
    brandId: string,
    limit: number,
    offset: number,
    context: CanvasServerRequestContext,
  ) => Promise<unknown>;
};

type RawCanvasDocument = {
  id: string;
  owner_id: string;
  brand_id: string;
  title: string;
  snapshot_version: number;
  revision: number;
  created_at: string;
  updated_at: string;
  snapshot: unknown;
};

class DiagnosticStop extends Error {
  readonly code: CanvasServerIdentityCode;

  constructor(code: CanvasServerIdentityCode) {
    super(code);
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const emptyCounts = (): Record<CanvasServerIdentityMatch, number> => ({
  none: 0,
  partial: 0,
  full: 0,
  ambiguous: 0,
});

const emptyResult = (
  status: CanvasServerIdentityDiagnostic['status'],
  code: CanvasServerIdentityCode,
  patch: Partial<CanvasServerIdentityDiagnostic> = {},
): CanvasServerIdentityDiagnostic => ({
  status,
  code,
  complete: false,
  consistent: true,
  truncated: false,
  listExhausted: false,
  requests: 0,
  getRequests: 0,
  listRequests: 0,
  confirmationRequests: 0,
  pagesRead: 0,
  rowsObserved: 0,
  cacheCandidatesRead: 0,
  counts: emptyCounts(),
  observations: [],
  uniqueOwnedFullMatchObserved: false,
  priorSaveEffectProven: false,
  ...patch,
});

const jsonCanonical = (value: unknown, seen = new Set<object>()): string | null => {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : null;
  if (typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);
  let result: string | null;
  if (Array.isArray(value)) {
    const parts = value.map((entry) => jsonCanonical(entry, seen));
    result = parts.every((part) => part !== null) ? `[${parts.join(',')}]` : null;
  } else {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
    const parts = keys.map((key) => {
      const encoded = jsonCanonical(record[key], seen);
      return encoded === null ? null : `${JSON.stringify(key)}:${encoded}`;
    });
    result = parts.every((part) => part !== null) ? `{${parts.join(',')}}` : null;
  }
  seen.delete(value);
  return result;
};

export const canvasSnapshotsStructurallyEqual = (left: unknown, right: unknown): boolean => {
  const leftCanonical = jsonCanonical(left);
  return leftCanonical !== null && leftCanonical === jsonCanonical(right);
};

const isSupportedSnapshot = (value: unknown): boolean => (
  isRecord(value) && value.version === 1 && Array.isArray(value.objects)
);

const readRawDocument = (
  value: unknown,
  expectedBrandId: string,
  expectedDocumentId?: string,
  errorCode: 'record_invalid' | 'get_response_invalid' | 'list_response_invalid' = 'record_invalid',
): RawCanvasDocument => {
  if (!isRecord(value)
    || typeof value.id !== 'string' || !DOCUMENT_ID.test(value.id)
    || typeof value.owner_id !== 'string' || !value.owner_id || value.owner_id.length > 256
    || typeof value.brand_id !== 'string' || !value.brand_id || value.brand_id.length > 256
    || typeof value.title !== 'string'
    || value.snapshot_version !== 1
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || typeof value.created_at !== 'string' || !value.created_at || !Number.isFinite(Date.parse(value.created_at))
    || typeof value.updated_at !== 'string' || !value.updated_at || !Number.isFinite(Date.parse(value.updated_at))
    || !isSupportedSnapshot(value.snapshot)) {
    throw new DiagnosticStop(errorCode);
  }
  if (value.brand_id !== expectedBrandId) throw new DiagnosticStop('brand_scope_mismatch');
  if (expectedDocumentId !== undefined && value.id !== expectedDocumentId) {
    throw new DiagnosticStop('get_id_mismatch');
  }
  return value as unknown as RawCanvasDocument;
};

const sameDocumentRow = (left: RawCanvasDocument, right: RawCanvasDocument): boolean => (
  left.id === right.id
  && left.owner_id === right.owner_id
  && left.brand_id === right.brand_id
  && left.title === right.title
  && left.snapshot_version === right.snapshot_version
  && left.revision === right.revision
  && left.created_at === right.created_at
  && left.updated_at === right.updated_at
  && canvasSnapshotsStructurallyEqual(left.snapshot, right.snapshot)
);

const isDefinitiveNotFound = (error: unknown): boolean => (
  error instanceof Error && error.message === 'cloudflare_api_404_not_found'
);

const safeObservation = (
  row: RawCanvasDocument,
  anchorSnapshot: unknown,
  userId: string,
  fromCurrentCache: boolean,
): CanvasServerIdentityObservation => {
  const comparison = compareCanvasArtifactSnapshot(anchorSnapshot, row.snapshot);
  if (comparison.reason === 'record_invalid' || comparison.reason === 'object_limit') {
    throw new DiagnosticStop('record_invalid');
  }
  return {
    documentId: row.id,
    revision: row.revision,
    scopeCurrent: true,
    ownedByCurrentUser: row.owner_id === userId,
    match: comparison.classification,
    objectIdsEqual: comparison.objectIdsEqual,
    snapshotEqual: canvasSnapshotsStructurallyEqual(anchorSnapshot, row.snapshot),
    fromCurrentCache,
  };
};

/** One sequential GET per approved ID; never lists, retries, adopts, or saves. */
export async function inspectCanvasCandidateLineage(options: CanvasCandidateLineageOptions): Promise<CanvasCandidateLineageDiagnostic> {
  if (!isExactCanvasLineageCandidateSet(options.candidateIds)) return { status: 'rejected', code: 'candidate_set_invalid' };
  const anchorCheck = describeSnapshotLineage(options.anchorSnapshot, options.anchorSnapshot);
  if (!anchorCheck.ok) {
    return { status: 'rejected', code: anchorCheck.code === 'anchor_object_limit' ? 'anchor_object_limit' : 'anchor_malformed' };
  }
  if (!options.userId || !options.brandId || options.userId.length > 256 || options.brandId.length > 256) {
    return { status: 'rejected', code: 'record_invalid' };
  }
  let getCount = 0;
  const candidates: CandidateLineageObservation[] = [];
  const assertCurrent = async () => {
    try { await options.assertCurrent(); } catch { throw new DiagnosticStop('context_changed'); }
  };
  const context = Object.freeze({ userId: options.userId, assertContext: assertCurrent });
  const observation = (id: string, fetch: CandidateLineageObservation['fetch']): CandidateLineageObservation => ({
    id, fetch, routeMetadata: 'unknown', deletedMetadata: 'unknown', priorSaveProof: 'unknown', adoptable: false, saveAllowed: false,
  });
  try {
    for (const id of CANVAS_LINEAGE_CANDIDATE_IDS) {
      await assertCurrent();
      getCount += 1;
      let raw: unknown;
      let requestFailed = false;
      let requestError: unknown;
      try { raw = await options.getDocument(id, context); }
      catch (error) { requestFailed = true; requestError = error; }
      await assertCurrent();
      if (requestError instanceof DiagnosticStop && requestError.code === 'context_changed') throw requestError;
      if (requestFailed) {
        candidates.push(observation(id, isDefinitiveNotFound(requestError) ? 'not_found' : 'request_failed'));
        continue;
      }
      const row = readRawDocument(raw, options.brandId, id);
      if (row.owner_id !== options.userId) return { status: 'stopped', code: 'owner_scope_mismatch', getCount };
      const lineage = describeSnapshotLineage(options.anchorSnapshot, row.snapshot);
      if (!lineage.ok) {
        if (lineage.code !== 'candidate_object_limit') return { status: 'stopped', code: 'candidate_malformed', getCount };
        candidates.push(observation(id, 'object_limit'));
        continue;
      }
      candidates.push({
        ...observation(id, 'ok'), revision: row.revision, snapshotVersion: row.snapshot_version,
        createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), lineage,
      });
    }
    await assertCurrent();
    return { status: 'complete', getCount, candidates };
  } catch (error) {
    if (error instanceof DiagnosticStop && error.code === 'context_changed') return { status: 'stale', getCount };
    const code = error instanceof DiagnosticStop && error.code === 'brand_scope_mismatch' ? 'owner_scope_mismatch'
      : error instanceof DiagnosticStop && error.code === 'get_id_mismatch' ? 'id_mismatch' : 'record_invalid';
    return { status: 'stopped', code, getCount };
  }
}

export async function inspectCanvasServerIdentity(options: CanvasServerIdentityDiagnosticOptions): Promise<CanvasServerIdentityDiagnostic> {
  const result = emptyResult('stopped', 'record_invalid');
  const observations = new Map<string, CanvasServerIdentityObservation>();
  const resultCounts = emptyCounts();
  const publishObservedState = () => {
    result.observations = [...observations.values()].sort((left, right) => left.documentId.localeCompare(right.documentId));
    result.counts = { ...resultCounts };
  };
  const assertCurrent = async () => {
    try {
      await options.assertCurrent();
    } catch {
      throw new DiagnosticStop('context_changed');
    }
  };
  const requestContext = Object.freeze({ userId: options.userId, assertContext: assertCurrent });

  try {
    await assertCurrent();
    if (!options.userId || !options.brandId || options.userId.length > 256 || options.brandId.length > 256) {
      throw new DiagnosticStop('record_invalid');
    }
    const anchorComparison = compareCanvasArtifactSnapshot(options.anchorSnapshot, options.anchorSnapshot);
    if (anchorComparison.classification !== 'full' || anchorComparison.anchorCount !== 2
      || anchorComparison.candidateCount !== 2 || anchorComparison.objectIdsEqual !== true) {
      throw new DiagnosticStop('record_invalid');
    }

    const validCacheEntries = options.currentCacheEntries.filter((entry) => entry.valid);
    if (validCacheEntries.length > MAX_CACHE_CANDIDATES) throw new DiagnosticStop('cache_candidate_limit');
    const cacheIds: string[] = [];
    for (const entry of validCacheEntries) {
      if (entry.documentId === null || !DOCUMENT_ID.test(entry.documentId)
        || !MATCHES.has(entry.workingMatch) || !PENDING_MATCHES.has(entry.pendingMatch)) {
        throw new DiagnosticStop('record_invalid');
      }
      const workingCandidate = entry.workingMatch === 'partial' || entry.workingMatch === 'full' || entry.workingMatch === 'ambiguous';
      const pendingCandidate = entry.pendingMatch === 'partial' || entry.pendingMatch === 'full' || entry.pendingMatch === 'ambiguous';
      if ((workingCandidate || pendingCandidate) && !cacheIds.includes(entry.documentId)) cacheIds.push(entry.documentId);
    }
    if (cacheIds.length > MAX_CACHE_CANDIDATES) throw new DiagnosticStop('cache_candidate_limit');

    const cacheIdSet = new Set(cacheIds);
    const successfulGets = new Map<string, RawCanvasDocument>();
    const notFoundGets = new Set<string>();
    const listedRows = new Map<string, RawCanvasDocument>();
    let previousUpdatedAt = Number.POSITIVE_INFINITY;

  const countRequest = (kind: 'get' | 'list' | 'confirmation') => {
    result.requests += 1;
    if (kind === 'get') {
      result.getRequests += 1;
      result.cacheCandidatesRead += 1;
    }
    if (kind === 'list') result.listRequests += 1;
    if (kind === 'confirmation') result.confirmationRequests += 1;
    };

    const runGet = async (documentId: string, confirmation = false): Promise<RawCanvasDocument | null> => {
      await assertCurrent();
      countRequest(confirmation ? 'confirmation' : 'get');
      try {
        const raw = await options.getDocument(documentId, requestContext);
        await assertCurrent();
        const row = readRawDocument(raw, options.brandId, documentId, 'get_response_invalid');
        return row;
      } catch (error) {
        await assertCurrent();
        if (isDefinitiveNotFound(error)) return null;
        if (error instanceof DiagnosticStop) throw error;
        throw new DiagnosticStop('request_failed');
      }
    };

    for (const documentId of cacheIds) {
      await assertCurrent();
      const row = await runGet(documentId);
      await assertCurrent();
      if (!row) {
        notFoundGets.add(documentId);
        continue;
      }
      successfulGets.set(documentId, row);
      const observation = safeObservation(row, options.anchorSnapshot, options.userId, true);
      observations.set(documentId, observation);
      publishObservedState();
    }

    let exhausted = false;
    let truncated = false;
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
      await assertCurrent();
      const offset = pageIndex * PAGE_SIZE;
      countRequest('list');
      let rawPage: unknown;
      try {
        rawPage = await options.listDocumentsPage(options.brandId, PAGE_SIZE, offset, requestContext);
        await assertCurrent();
      } catch (error) {
        await assertCurrent();
        if (error instanceof DiagnosticStop) throw error;
        throw new DiagnosticStop('request_failed');
      }
      if (!Array.isArray(rawPage) || rawPage.length > PAGE_SIZE) throw new DiagnosticStop('list_response_invalid');
      result.pagesRead += 1;
      if (rawPage.length < PAGE_SIZE) result.listExhausted = true;
      if (pageIndex === MAX_PAGES - 1 && rawPage.length === PAGE_SIZE) result.truncated = true;

      for (const rawRow of rawPage) {
        await assertCurrent();
        const row = readRawDocument(rawRow, options.brandId, undefined, 'list_response_invalid');
        const timestamp = Date.parse(row.updated_at);
        if (timestamp > previousUpdatedAt) throw new DiagnosticStop('order_violation');
        previousUpdatedAt = timestamp;
        if (listedRows.has(row.id)) throw new DiagnosticStop('duplicate_id');
        listedRows.set(row.id, row);
        result.rowsObserved += 1;
        const priorGet = successfulGets.get(row.id);
        if (notFoundGets.has(row.id) || (priorGet && !sameDocumentRow(priorGet, row))) {
          throw new DiagnosticStop('get_list_disagreement');
        }
        const observation = safeObservation(row, options.anchorSnapshot, options.userId, cacheIdSet.has(row.id));
        resultCounts[observation.match] += 1;
        if (observation.match !== 'none' || cacheIdSet.has(row.id)) observations.set(row.id, observation);
        publishObservedState();
      }

      if (rawPage.length < PAGE_SIZE) {
        exhausted = true;
        break;
      }
      if (pageIndex === MAX_PAGES - 1) truncated = true;
    }

    if (exhausted) {
      for (const documentId of successfulGets.keys()) {
        if (!listedRows.has(documentId)) throw new DiagnosticStop('get_candidate_missing_from_list');
      }
    }

    const fullMatches = [...observations.values()].filter((row) => row.match === 'full');
    const competitors = [...observations.values()].filter((row) => row.match === 'partial' || row.match === 'ambiguous');
    if (truncated) {
      result.status = 'stopped';
      result.code = 'page_cap';
    } else if (!exhausted) {
      result.status = 'stopped';
      result.code = 'page_cap';
    } else if (fullMatches.length > 1) {
      result.status = 'complete';
      result.code = 'multiple_full_matches';
    } else if (competitors.length > 0) {
      result.status = 'complete';
      result.code = 'competing_matches';
    } else if (fullMatches.length === 0) {
      result.status = 'complete';
      result.code = 'no_full_match';
    } else if (!fullMatches[0].ownedByCurrentUser) {
      result.status = 'complete';
      result.code = 'candidate_not_owned';
    } else {
      const candidateId = fullMatches[0].documentId;
      const confirmation = await runGet(candidateId, true);
      await assertCurrent();
      if (!confirmation) throw new DiagnosticStop('get_list_disagreement');
      const listed = listedRows.get(candidateId);
      if (!listed || !sameDocumentRow(confirmation, listed)) throw new DiagnosticStop('get_list_disagreement');
      successfulGets.set(candidateId, confirmation);
      observations.set(candidateId, safeObservation(confirmation, options.anchorSnapshot, options.userId, cacheIdSet.has(candidateId)));
      result.status = 'complete';
      result.code = 'unique_owned_full_match_observed';
      result.uniqueOwnedFullMatchObserved = true;
    }

    await assertCurrent();
    result.complete = exhausted;
    result.consistent = true;
    result.truncated = truncated;
    result.listExhausted = exhausted;
    publishObservedState();
    return result;
  } catch (error) {
    const code = error instanceof DiagnosticStop ? error.code : 'request_failed';
    publishObservedState();
    return {
      ...result,
      status: code === 'context_changed' ? 'stale' : 'stopped',
      code,
      complete: false,
      consistent: ![
        'context_changed', 'request_failed', 'get_response_invalid', 'list_response_invalid',
        'record_invalid', 'brand_scope_mismatch', 'get_id_mismatch',
        'get_list_disagreement', 'duplicate_id', 'order_violation',
      ].includes(code),
      truncated: result.truncated || code === 'page_cap',
      uniqueOwnedFullMatchObserved: code === 'context_changed' ? false : result.uniqueOwnedFullMatchObserved,
    };
  }
}
