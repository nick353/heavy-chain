import type { CanvasSaveRecovery, CanvasSaveScope } from './canvasDocumentSaveRecovery.ts';
import type { CanvasDocumentSnapshot } from './canvasDocumentPersistence.ts';

const MAX_TOTAL_KEYS = 4096;
const MAX_SCOPED_ENTRIES = 64;
const MAX_VALUE_CHARS = 2 * 1024 * 1024;
const MAX_TOTAL_VALUE_BYTES = 8 * 1024 * 1024;
const MAX_OBJECTS_PER_SNAPSHOT = 512;
const PREFIX_PROBE_DOCUMENT_ID = '00000000-0000-4000-8000-000000000000';
const CANONICAL_IMAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CANONICAL_GENERATED_PATH = /^generated-images\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/;
const CANVAS_OBJECT_TYPES = new Set(['image', 'text', 'shape', 'frame']);

export type CanvasSaveScopeMatch = 'none' | 'not_present' | 'full' | 'partial' | 'ambiguous' | 'not_checked';

export type CanvasSaveScopeDiagnosticEntry = {
  documentId: string | null;
  valid: boolean;
  pending: boolean | null;
  revision: number | null;
  workingMatch: CanvasSaveScopeMatch;
  workingObjectIdsEqual: boolean | null;
  pendingMatch: CanvasSaveScopeMatch;
  pendingObjectIdsEqual: boolean | null;
};

export type CanvasSaveScopeDiagnosticResult = {
  readiness: 'disabled' | 'not_ready' | 'ready' | 'stale';
  complete: boolean;
  reason: string;
  entries: CanvasSaveScopeDiagnosticEntry[];
};

export type CanvasSaveScopeDiagnosticStorage = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
};

export type CanvasSaveScopeDiagnosticOptions = {
  enabled: boolean;
  scopeReady: boolean;
  scope: CanvasSaveScope | null;
  workingSnapshot: CanvasDocumentSnapshot | null;
  generation: string | number;
  isCurrent(generation: string | number): boolean;
  keyForDocument(scope: CanvasSaveScope, documentId: string): string;
  readEntry(scope: CanvasSaveScope, documentId: string): CanvasSaveRecovery | null;
  getStorage?: () => CanvasSaveScopeDiagnosticStorage;
};

type SnapshotObject = Record<string, unknown> & { id: string; type: string };
type AnalyzedObject = { id: string; type: string; identity: string | null };
type SnapshotAnalysis = {
  objects: AnalyzedObject[];
  ambiguous: boolean;
};
type SnapshotMatch = {
  classification: CanvasSaveScopeMatch;
  objectIdsEqual: boolean | null;
  candidate: boolean;
  ambiguous: boolean;
};

class StopScan extends Error {
  readonly reason: string;
  readonly entry?: CanvasSaveScopeDiagnosticEntry;

  constructor(reason: string, entry?: CanvasSaveScopeDiagnosticEntry) {
    super(reason);
    this.reason = reason;
    this.entry = entry;
  }
}

const result = (
  readiness: CanvasSaveScopeDiagnosticResult['readiness'],
  complete: boolean,
  reason: string,
  entries: CanvasSaveScopeDiagnosticEntry[] = [],
): CanvasSaveScopeDiagnosticResult => ({ readiness, complete, reason, entries });

const defaultStorage = (): CanvasSaveScopeDiagnosticStorage => {
  if (typeof window === 'undefined') throw new Error('canvas_save_storage_unavailable');
  return window.localStorage;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const validObjectId = (value: unknown): value is string => (
  typeof value === 'string' && value.length > 0 && value.length <= 256 && !hasControlCharacters(value)
);

const hasControlCharacters = (value: string) => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

const canonicalImageIdentity = (value: string): string | null => {
  const normalized = value.trim();
  if (!normalized || normalized.length > 2048 || hasControlCharacters(normalized) || /[?#]/.test(normalized)) return null;
  if (/^(?:https?:)?\/\//i.test(normalized) || /^(?:data|blob|local-canvas-asset):/i.test(normalized)) return null;
  const generatedPath = CANONICAL_GENERATED_PATH.exec(normalized);
  if (generatedPath) return `image:${generatedPath[1]}`;
  return `storage:${normalized}`;
};

const readStringAlias = (record: Record<string, unknown>, key: string): string | null | undefined => {
  const value = record[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || null;
};

const objectIdentity = (object: SnapshotObject): { identity: string | null; ambiguous: boolean } => {
  if (object.type !== 'image') return { identity: null, ambiguous: false };

  const metadataValue = object.metadata;
  if (metadataValue !== undefined && metadataValue !== null && !isRecord(metadataValue)) {
    return { identity: null, ambiguous: true };
  }
  const metadata = isRecord(metadataValue) ? metadataValue : {};
  const parametersValue = metadata.parameters;
  if (parametersValue !== undefined && parametersValue !== null && !isRecord(parametersValue)) {
    return { identity: null, ambiguous: true };
  }
  const parameters = isRecord(parametersValue) ? parametersValue : {};
  const identities = new Set<string>();

  const addImageId = (record: Record<string, unknown>, key: string) => {
    const value = readStringAlias(record, key);
    if (value === undefined) return false;
    if (value === null) return true;
    if (!CANONICAL_IMAGE_ID.test(value)) return false;
    identities.add(`image:${value}`);
    return true;
  };
  const addStoragePath = (record: Record<string, unknown>, key: string) => {
    const value = readStringAlias(record, key);
    if (value === undefined) return false;
    if (value === null) return true;
    const identity = canonicalImageIdentity(value);
    if (!identity) return false;
    identities.add(identity);
    return true;
  };

  for (const [record, key] of [
    [metadata, 'galleryImageId'], [metadata, 'imageId'],
    [parameters, 'galleryImageId'], [parameters, 'imageId'],
  ] as const) {
    if (!addImageId(record, key)) return { identity: null, ambiguous: true };
  }
  for (const [record, key] of [
    [metadata, 'galleryStoragePath'], [metadata, 'storagePath'],
    [parameters, 'galleryStoragePath'], [parameters, 'storagePath'],
    [parameters, 'remoteStoragePath'], [parameters, 'sourceStoragePath'],
    [parameters, 'backendStoragePath'],
  ] as const) {
    if (!addStoragePath(record, key)) return { identity: null, ambiguous: true };
  }

  const srcValue = object.src;
  if (srcValue !== undefined && srcValue !== null && srcValue !== '') {
    if (typeof srcValue !== 'string') return { identity: null, ambiguous: true };
    const srcIdentity = canonicalImageIdentity(srcValue);
    if (!srcIdentity) return { identity: null, ambiguous: true };
    identities.add(srcIdentity);
  }

  if (identities.size > 1) return { identity: null, ambiguous: true };
  const [identity] = identities;
  return { identity: identity ?? null, ambiguous: identity === undefined };
};

const analyzeSnapshot = (snapshot: unknown): SnapshotAnalysis => {
  if (!isRecord(snapshot) || snapshot.version !== 1 || !Array.isArray(snapshot.objects)) {
    throw new StopScan('record_invalid');
  }
  if (snapshot.objects.length > MAX_OBJECTS_PER_SNAPSHOT) throw new StopScan('object_limit');

  const ids = new Set<string>();
  const identities = new Set<string>();
  let ambiguous = false;
  const objects = snapshot.objects.map((value): AnalyzedObject => {
    if (!isRecord(value) || !validObjectId(value.id) || typeof value.type !== 'string' || !CANVAS_OBJECT_TYPES.has(value.type)) {
      throw new StopScan('record_invalid');
    }
    const object = value as SnapshotObject;
    if (ids.has(object.id)) ambiguous = true;
    ids.add(object.id);
    const source = objectIdentity(object);
    if (source.ambiguous) ambiguous = true;
    if (source.identity) {
      if (identities.has(source.identity)) ambiguous = true;
      identities.add(source.identity);
    }
    return { id: object.id, type: object.type, identity: source.identity };
  });
  return { objects, ambiguous };
};

const matchSnapshot = (anchor: SnapshotAnalysis, candidateValue: unknown): SnapshotMatch => {
  const candidate = analyzeSnapshot(candidateValue);
  const anchorImages = anchor.objects.filter((object) => object.type === 'image');
  const candidateImages = candidate.objects.filter((object) => object.type === 'image');
  const possibleMatches = anchorImages.map((anchorObject) => candidateImages.filter((candidateObject) => (
    anchorObject.id === candidateObject.id
      || (anchorObject.identity !== null && anchorObject.identity === candidateObject.identity)
  )));
  const hasOverlap = possibleMatches.some((matches) => matches.length > 0);

  if (candidate.ambiguous || anchor.ambiguous) {
    return { classification: 'ambiguous', objectIdsEqual: null, candidate: true, ambiguous: true };
  }
  if (!hasOverlap) return { classification: 'none', objectIdsEqual: false, candidate: false, ambiguous: false };

  let ambiguous = false;
  const matchedCandidateIndices = new Set<number>();
  const matchedPairs: Array<[AnalyzedObject, AnalyzedObject]> = [];
  possibleMatches.forEach((matches, anchorIndex) => {
    if (matches.length > 1) ambiguous = true;
    for (const matched of matches) {
      const candidateIndex = candidateImages.indexOf(matched);
      if (matchedCandidateIndices.has(candidateIndex)) ambiguous = true;
      matchedCandidateIndices.add(candidateIndex);
      const anchorObject = anchorImages[anchorIndex];
      if (anchorObject.identity !== matched.identity) ambiguous = true;
      matchedPairs.push([anchorObject, matched]);
    }
  });
  if (candidate.objects.length !== anchor.objects.length || candidateImages.length !== candidate.objects.length) ambiguous = true;
  const matchedAnchorCount = possibleMatches.filter((matches) => matches.length === 1).length;
  if (matchedAnchorCount !== anchorImages.length) {
    return {
      classification: 'partial',
      objectIdsEqual: null,
      candidate: true,
      ambiguous: true,
    };
  }
  if (ambiguous || matchedPairs.length !== anchorImages.length) {
    return { classification: 'ambiguous', objectIdsEqual: null, candidate: true, ambiguous: true };
  }
  const objectIdsEqual = matchedPairs.every(([anchorObject, candidateObject]) => anchorObject.id === candidateObject.id);
  return { classification: 'full', objectIdsEqual, candidate: true, ambiguous: false };
};

export type CanvasArtifactSnapshotComparison = {
  classification: 'none' | 'partial' | 'full' | 'ambiguous';
  objectIdsEqual: boolean | null;
  anchorCount: number;
  candidateCount: number;
  reason: 'no_lineage_overlap' | 'partial_lineage' | 'full_lineage' | 'ambiguous_lineage' | 'record_invalid' | 'object_limit';
};

/** Expose the existing identity matcher without changing its matching rules. */
export const compareCanvasArtifactSnapshot = (
  anchorValue: unknown,
  candidateValue: unknown,
): CanvasArtifactSnapshotComparison => {
  const count = (value: unknown) => (
    isRecord(value) && Array.isArray(value.objects) ? value.objects.length : 0
  );
  try {
    const anchor = analyzeSnapshot(anchorValue);
    const matched = matchSnapshot(anchor, candidateValue);
    const reason = matched.classification === 'none' ? 'no_lineage_overlap'
      : matched.classification === 'partial' ? 'partial_lineage'
        : matched.classification === 'full' ? 'full_lineage' : 'ambiguous_lineage';
    return {
      classification: matched.classification as CanvasArtifactSnapshotComparison['classification'],
      objectIdsEqual: matched.objectIdsEqual,
      anchorCount: anchor.objects.length,
      candidateCount: count(candidateValue),
      reason,
    };
  } catch (error) {
    const reason = error instanceof StopScan && error.reason === 'object_limit' ? 'object_limit' : 'record_invalid';
    return {
      classification: 'ambiguous',
      objectIdsEqual: null,
      anchorCount: count(anchorValue),
      candidateCount: count(candidateValue),
      reason,
    };
  }
};

export type SnapshotLineage =
  | { ok: false; code: 'anchor_malformed' | 'candidate_malformed' | 'anchor_object_limit' | 'candidate_object_limit' }
  | {
    ok: true;
    classification: CanvasArtifactSnapshotComparison['classification'];
    counts: { objects: number; images: number; identities: number };
    anchors: Array<{ anchorIndex: number; overlap: 'objectId' | 'canonicalImage' | 'both' | 'none'; matchCount: number }>;
    ambiguity: { anchorAmbiguous: boolean; candidateAmbiguous: boolean; detail: 'unavailable' };
  };

/** Redacted lineage evidence from the unchanged canonical parser and matcher. */
export const describeSnapshotLineage = (anchorValue: unknown, candidateValue: unknown): SnapshotLineage => {
  let anchor: SnapshotAnalysis;
  let candidate: SnapshotAnalysis;
  try {
    anchor = analyzeSnapshot(anchorValue);
  } catch (error) {
    return { ok: false, code: error instanceof StopScan && error.reason === 'object_limit' ? 'anchor_object_limit' : 'anchor_malformed' };
  }
  try {
    candidate = analyzeSnapshot(candidateValue);
  } catch (error) {
    return { ok: false, code: error instanceof StopScan && error.reason === 'object_limit' ? 'candidate_object_limit' : 'candidate_malformed' };
  }
  const candidateImages = candidate.objects.filter((object) => object.type === 'image');
  const anchors: Extract<SnapshotLineage, { ok: true }>['anchors'] = [];
  anchor.objects.forEach((object, anchorIndex) => {
    if (object.type !== 'image') return;
    const matches = candidateImages.filter((other) => object.id === other.id
      || (object.identity !== null && object.identity === other.identity));
    const idMatch = matches.some((other) => object.id === other.id);
    const imageMatch = matches.some((other) => object.identity !== null && object.identity === other.identity);
    anchors.push({ anchorIndex, overlap: idMatch && imageMatch ? 'both' : idMatch ? 'objectId' : imageMatch ? 'canonicalImage' : 'none', matchCount: matches.length });
  });
  return {
    ok: true,
    classification: matchSnapshot(anchor, candidateValue).classification as CanvasArtifactSnapshotComparison['classification'],
    counts: { objects: candidate.objects.length, images: candidateImages.length, identities: new Set(candidateImages.flatMap((object) => object.identity === null ? [] : [object.identity])).size },
    anchors,
    // The private parser retains ambiguity flags, not the cause of each flag.
    ambiguity: { anchorAmbiguous: anchor.ambiguous, candidateAmbiguous: candidate.ambiguous, detail: 'unavailable' },
  };
};

const listKeys = (storage: CanvasSaveScopeDiagnosticStorage): string[] => {
  const count = storage.length;
  if (!Number.isSafeInteger(count) || count < 0) throw new StopScan('storage_inaccessible');
  if (count > MAX_TOTAL_KEYS) throw new StopScan('total_key_limit');
  const keys: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const key = storage.key(index);
    if (typeof key !== 'string') throw new StopScan('storage_inaccessible');
    keys.push(key);
  }
  if (new Set(keys).size !== keys.length) throw new StopScan('storage_changed');
  return keys.sort();
};

const recoveryPrefix = (
  scope: CanvasSaveScope,
  keyForDocument: CanvasSaveScopeDiagnosticOptions['keyForDocument'],
): string => {
  const probeKey = keyForDocument(scope, PREFIX_PROBE_DOCUMENT_ID);
  const separator = probeKey.lastIndexOf(':');
  if (separator < 0) throw new StopScan('scope_invalid');
  return probeKey.slice(0, separator + 1);
};

const decodeDocumentId = (
  key: string,
  prefix: string,
  scope: CanvasSaveScope,
  keyForDocument: CanvasSaveScopeDiagnosticOptions['keyForDocument'],
): string => {
  try {
    const documentId = decodeURIComponent(key.slice(prefix.length));
    if (keyForDocument(scope, documentId) !== key) throw new Error('invalid_key');
    return documentId;
  } catch {
    throw new StopScan('malformed_key');
  }
};

const entryShell = (documentId: string | null, valid: boolean): CanvasSaveScopeDiagnosticEntry => ({
  documentId,
  valid,
  pending: null,
  revision: null,
  workingMatch: 'not_checked',
  workingObjectIdsEqual: null,
  pendingMatch: 'not_checked',
  pendingObjectIdsEqual: null,
});

const staleResult = (): CanvasSaveScopeDiagnosticResult => result('stale', false, 'stale_generation');

export async function inspectCanvasSaveScopeDiagnostics(
  options: CanvasSaveScopeDiagnosticOptions,
): Promise<CanvasSaveScopeDiagnosticResult> {
  if (!options.enabled) return result('disabled', false, 'debug_off');
  if (!options.scopeReady || !options.scope || !options.workingSnapshot) {
    return result('not_ready', false, 'scope_not_ready');
  }

  const isCurrent = () => {
    try {
      return options.isCurrent(options.generation);
    } catch {
      return false;
    }
  };
  if (!isCurrent()) return staleResult();

  let prefix: string;
  let anchor: SnapshotAnalysis;
  try {
    prefix = recoveryPrefix(options.scope, options.keyForDocument);
    anchor = analyzeSnapshot(options.workingSnapshot);
    if (anchor.objects.length !== 2 || anchor.objects.some((object) => object.type !== 'image') || anchor.ambiguous) {
      return result('not_ready', false, 'anchor_invalid');
    }
  } catch (error) {
    return result('not_ready', false, error instanceof StopScan ? error.reason : 'scope_invalid');
  }

  let storage: CanvasSaveScopeDiagnosticStorage;
  try {
    storage = (options.getStorage ?? defaultStorage)();
  } catch {
    return result('ready', false, 'storage_inaccessible');
  }

  const entries: CanvasSaveScopeDiagnosticEntry[] = [];
  const initialRawValues = new Map<string, string>();
  try {
    const keysBefore = listKeys(storage);
    const scopedKeys = keysBefore.filter((key) => key.startsWith(prefix));
    if (scopedKeys.length > MAX_SCOPED_ENTRIES) throw new StopScan('scoped_key_limit');
    const scopedDocumentIds = scopedKeys.map((key) => ({
      key,
      documentId: decodeDocumentId(key, prefix, options.scope!, options.keyForDocument),
    }));
    let cumulativeBytes = 0;
    const candidateDocuments = new Set<string>();
    let ambiguousCandidate = false;

    for (const { key, documentId } of scopedDocumentIds) {
      if (!isCurrent()) return staleResult();
      let raw: string | null;
      try {
        raw = storage.getItem(key);
      } catch {
        throw new StopScan('storage_inaccessible', entryShell(documentId, false));
      }
      if (raw === null) throw new StopScan('storage_changed', entryShell(documentId, false));
      const shell = entryShell(documentId, false);
      if (raw.length > MAX_VALUE_CHARS) throw new StopScan('value_limit', shell);
      cumulativeBytes += raw.length * 2;
      if (cumulativeBytes > MAX_TOTAL_VALUE_BYTES) throw new StopScan('total_value_limit', shell);
      initialRawValues.set(key, raw);

      let cached: CanvasSaveRecovery | null;
      try {
        cached = options.readEntry(options.scope, documentId);
      } catch {
        throw new StopScan('reader_error', shell);
      }
      if (!cached || cached.documentId !== documentId
        || cached.scope.origin !== options.scope.origin
        || cached.scope.userId !== options.scope.userId
        || cached.scope.brandId !== options.scope.brandId) {
        throw new StopScan('record_invalid', shell);
      }

      let workingMatch: SnapshotMatch;
      let pendingMatch: SnapshotMatch = {
        classification: 'not_present', objectIdsEqual: null, candidate: false, ambiguous: false,
      };
      try {
        workingMatch = matchSnapshot(anchor, cached.snapshot);
        if (cached.pending) pendingMatch = matchSnapshot(anchor, cached.pending.snapshot);
      } catch (error) {
        if (error instanceof StopScan) throw new StopScan(error.reason, shell);
        throw new StopScan('record_invalid', shell);
      }
      const inspected: CanvasSaveScopeDiagnosticEntry = {
        documentId,
        valid: true,
        pending: Boolean(cached.pending),
        revision: cached.revision,
        workingMatch: workingMatch.classification,
        workingObjectIdsEqual: workingMatch.objectIdsEqual,
        pendingMatch: pendingMatch.classification,
        pendingObjectIdsEqual: pendingMatch.objectIdsEqual,
      };
      entries.push(inspected);
      if (workingMatch.candidate || pendingMatch.candidate) candidateDocuments.add(documentId);
      if (workingMatch.ambiguous || pendingMatch.ambiguous) ambiguousCandidate = true;
    }

    if (!isCurrent()) return staleResult();
    const keysAfter = listKeys(storage);
    if (keysBefore.length !== keysAfter.length || keysBefore.some((key, index) => key !== keysAfter[index])) {
      throw new StopScan('storage_changed');
    }
    for (const [key, priorRaw] of initialRawValues) {
      if (!isCurrent()) return staleResult();
      let currentRaw: string | null;
      try {
        currentRaw = storage.getItem(key);
      } catch {
        throw new StopScan('storage_inaccessible');
      }
      if (currentRaw === null || currentRaw !== priorRaw) throw new StopScan('storage_changed');
    }
    if (!isCurrent()) return staleResult();

    if (candidateDocuments.size > 1) return result('ready', true, 'multiple_candidates', entries);
    if (ambiguousCandidate) return result('ready', true, 'ambiguous_candidate', entries);
    return result('ready', true, 'complete', entries);
  } catch (error) {
    const stop = error instanceof StopScan ? error : new StopScan('storage_inaccessible');
    return result('ready', false, stop.reason, stop.entry ? [...entries, stop.entry] : entries);
  }
}
