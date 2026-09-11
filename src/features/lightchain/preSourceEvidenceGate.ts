export const LIGHTCHAIN_PRE_SOURCE_SNAPSHOT_SCHEMA = 'lightchain-pre-source-snapshot.v1' as const;

export type LightchainSemanticState = 'present' | 'empty' | 'ambiguous';
export type LightchainVisualState = 'present' | 'blank' | 'ambiguous';

export type LightchainPreSourceSnapshot = {
  schema: typeof LIGHTCHAIN_PRE_SOURCE_SNAPSHOT_SCHEMA;
  runId: string;
  capturedAt: string;
  source: {
    route: string;
    title: string;
    normalizedSourceHash: string;
  };
  readback: {
    semanticState: LightchainSemanticState;
    semanticHash: string;
    visualState: LightchainVisualState;
    visualArtifactHash: string;
  };
  selector: {
    backend: string;
    browserSurface: string;
    revision: string;
  };
  externalActionExecuted: false;
};

export type PreSourceSnapshotStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type PreSourceAdmission =
  | { ok: true; decision: 'local_stub_admitted'; snapshot: LightchainPreSourceSnapshot }
  | { ok: false; blocker: string };

export type PreSourceEvidenceContinuity =
  | {
      ok: true;
      snapshot: LightchainPreSourceSnapshot;
      evidenceIdentity: string;
    }
  | { ok: false; blocker: string };

const SHA256_PATTERN = /^(?:sha256:)?[0-9a-f]{64}$/iu;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/iu;

const requiredText = (value: unknown, code: string, maxLength = 240): string => {
  if (typeof value !== 'string') throw new Error(code);
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized.length > maxLength) throw new Error(code);
  return normalized;
};

const requiredIdentifier = (value: unknown, code: string): string => {
  const normalized = requiredText(value, code, 160).toLowerCase();
  if (!IDENTIFIER_PATTERN.test(normalized)) throw new Error(code);
  return normalized;
};

const requiredHash = (value: unknown, code: string): string => {
  const normalized = requiredText(value, code, 80).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) throw new Error(code);
  return normalized.startsWith('sha256:') ? normalized : `sha256:${normalized}`;
};

const requiredDate = (value: unknown): string => {
  const normalized = requiredText(value, 'lightchain_pre_source_captured_at_required', 80);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new Error('lightchain_pre_source_captured_at_invalid');
  return parsed.toISOString();
};

const isSemanticState = (value: unknown): value is LightchainSemanticState => (
  value === 'present' || value === 'empty' || value === 'ambiguous'
);

const isVisualState = (value: unknown): value is LightchainVisualState => (
  value === 'present' || value === 'blank' || value === 'ambiguous'
);

const stableSnapshotJson = (snapshot: LightchainPreSourceSnapshot): string => JSON.stringify({
  schema: snapshot.schema,
  runId: snapshot.runId,
  capturedAt: snapshot.capturedAt,
  source: snapshot.source,
  readback: snapshot.readback,
  selector: snapshot.selector,
  externalActionExecuted: snapshot.externalActionExecuted,
});

/**
 * Stable, non-secret identity for the exact accepted pre-source snapshot.
 * This is an encoded canonical snapshot, not a production readback or a
 * cryptographic digest. It lets local result persistence prove that the same
 * accepted evidence crossed each boundary without inventing live evidence.
 */
export const buildLightchainPreSourceEvidenceIdentity = (
  snapshot: LightchainPreSourceSnapshot,
): string => {
  if (!snapshot || snapshot.schema !== LIGHTCHAIN_PRE_SOURCE_SNAPSHOT_SCHEMA) {
    throw new Error('lightchain_pre_source_snapshot_schema_invalid');
  }
  return `lightchain-pre-source-evidence.v1:${encodeURIComponent(stableSnapshotJson(snapshot))}`;
};

export const createLightchainPreSourceSnapshot = (input: {
  runId: string;
  capturedAt: string;
  route: string;
  title: string;
  normalizedSourceHash: string;
  semanticState: LightchainSemanticState;
  semanticHash: string;
  visualState: LightchainVisualState;
  visualArtifactHash: string;
  backend: string;
  browserSurface: string;
  selectorRevision: string;
  externalActionExecuted?: false;
}): LightchainPreSourceSnapshot => {
  if (input.externalActionExecuted !== undefined && input.externalActionExecuted !== false) {
    throw new Error('lightchain_pre_source_external_effect_present');
  }
  if (!isSemanticState(input.semanticState)) throw new Error('lightchain_pre_source_semantic_state_invalid');
  if (!isVisualState(input.visualState)) throw new Error('lightchain_pre_source_visual_state_invalid');
  return Object.freeze({
    schema: LIGHTCHAIN_PRE_SOURCE_SNAPSHOT_SCHEMA,
    runId: requiredIdentifier(input.runId, 'lightchain_pre_source_run_id_invalid'),
    capturedAt: requiredDate(input.capturedAt),
    source: Object.freeze({
      route: requiredText(input.route, 'lightchain_pre_source_route_required', 240),
      title: requiredText(input.title, 'lightchain_pre_source_title_required', 240),
      normalizedSourceHash: requiredHash(input.normalizedSourceHash, 'lightchain_pre_source_hash_invalid'),
    }),
    readback: Object.freeze({
      semanticState: input.semanticState,
      semanticHash: requiredHash(input.semanticHash, 'lightchain_pre_source_semantic_hash_invalid'),
      visualState: input.visualState,
      visualArtifactHash: requiredHash(input.visualArtifactHash, 'lightchain_pre_source_visual_hash_invalid'),
    }),
    selector: Object.freeze({
      backend: requiredText(input.backend, 'lightchain_pre_source_backend_required', 160),
      browserSurface: requiredText(input.browserSurface, 'lightchain_pre_source_surface_required', 160),
      revision: requiredText(input.selectorRevision, 'lightchain_pre_source_selector_revision_required', 160),
    }),
    externalActionExecuted: false,
  });
};

export const serializeLightchainPreSourceSnapshot = (snapshot: LightchainPreSourceSnapshot): string => {
  if (!snapshot || snapshot.schema !== LIGHTCHAIN_PRE_SOURCE_SNAPSHOT_SCHEMA) {
    throw new Error('lightchain_pre_source_snapshot_schema_invalid');
  }
  return stableSnapshotJson(snapshot);
};

export const readLightchainPreSourceSnapshot = (
  store: PreSourceSnapshotStore,
  key: string,
): unknown => {
  const raw = store.getItem(requiredText(key, 'lightchain_pre_source_storage_key_required', 240));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

export const writeLightchainPreSourceSnapshotOnce = (
  store: PreSourceSnapshotStore,
  key: string,
  snapshot: LightchainPreSourceSnapshot,
): { ok: true; wrote: boolean; serialized: string } | { ok: false; blocker: string } => {
  const normalizedKey = requiredText(key, 'lightchain_pre_source_storage_key_required', 240);
  const serialized = serializeLightchainPreSourceSnapshot(snapshot);
  const existing = store.getItem(normalizedKey);
  if (existing !== null) {
    return existing === serialized
      ? { ok: true, wrote: false, serialized }
      : { ok: false, blocker: 'lightchain_pre_source_snapshot_conflict' };
  }
  try {
    store.setItem(normalizedKey, serialized);
  } catch {
    return { ok: false, blocker: 'lightchain_pre_source_snapshot_write_failed' };
  }
  return store.getItem(normalizedKey) === serialized
    ? { ok: true, wrote: true, serialized }
    : { ok: false, blocker: 'lightchain_pre_source_snapshot_save_readback_failed' };
};

const readSnapshotShape = (value: unknown): LightchainPreSourceSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<LightchainPreSourceSnapshot>;
  if (
    candidate.schema !== LIGHTCHAIN_PRE_SOURCE_SNAPSHOT_SCHEMA
    || typeof candidate.runId !== 'string'
    || typeof candidate.capturedAt !== 'string'
    || !candidate.source || !candidate.readback || !candidate.selector
    || candidate.externalActionExecuted !== false
    || !isSemanticState(candidate.readback.semanticState)
    || !isVisualState(candidate.readback.visualState)
  ) return null;
  return candidate as LightchainPreSourceSnapshot;
};

export const admitLightchainLocalStub = (input: {
  snapshot: unknown;
  expectedRunId: string;
  expectedSourceHash: string;
  expectedVisualArtifactHash: string;
  expectedBackend: string;
  expectedBrowserSurface: string;
  expectedSelectorRevision: string;
}): PreSourceAdmission => {
  const snapshot = readSnapshotShape(input.snapshot);
  if (!snapshot) return { ok: false, blocker: 'lightchain_pre_source_snapshot_missing' };
  if (snapshot.runId !== requiredIdentifier(input.expectedRunId, 'lightchain_pre_source_run_id_invalid')) {
    return { ok: false, blocker: 'lightchain_pre_source_run_mismatch' };
  }
  if (snapshot.source.normalizedSourceHash !== requiredHash(input.expectedSourceHash, 'lightchain_pre_source_hash_invalid')) {
    return { ok: false, blocker: 'lightchain_pre_source_snapshot_hash_mismatch' };
  }
  if (snapshot.readback.visualArtifactHash !== requiredHash(input.expectedVisualArtifactHash, 'lightchain_pre_source_visual_hash_invalid')) {
    return { ok: false, blocker: 'lightchain_pre_source_snapshot_hash_mismatch' };
  }
  if (snapshot.readback.semanticState !== 'present' || snapshot.readback.visualState !== 'present') {
    return { ok: false, blocker: 'lightchain_pre_source_surface_blank' };
  }
  if (
    snapshot.selector.backend !== requiredText(input.expectedBackend, 'lightchain_pre_source_backend_required', 160)
    || snapshot.selector.browserSurface !== requiredText(input.expectedBrowserSurface, 'lightchain_pre_source_surface_required', 160)
    || snapshot.selector.revision !== requiredText(input.expectedSelectorRevision, 'lightchain_pre_source_selector_revision_required', 160)
  ) {
    return { ok: false, blocker: 'lightchain_pre_source_selector_mismatch' };
  }
  return { ok: true, decision: 'local_stub_admitted', snapshot };
};

export const verifyLightchainPreSourceEvidenceContinuity = (input: {
  snapshot: unknown;
  persistedEvidence: unknown;
  expectedRunId: string;
  expectedSourceHash: string;
  expectedVisualArtifactHash: string;
  expectedBackend: string;
  expectedBrowserSurface: string;
  expectedSelectorRevision: string;
}): PreSourceEvidenceContinuity => {
  const admission = admitLightchainLocalStub(input);
  if (!admission.ok) return admission;

  const persistedEvidence = input.persistedEvidence;
  if (!persistedEvidence || typeof persistedEvidence !== 'object' || Array.isArray(persistedEvidence)) {
    return { ok: false, blocker: 'lightchain_pre_source_evidence_missing' };
  }
  const candidate = persistedEvidence as Record<string, unknown>;
  const requiredFields = [
    'evidenceIdentity',
    'runId',
    'sourceHash',
    'visualArtifactHash',
    'selectorRevision',
  ];
  if (requiredFields.some((field) => typeof candidate[field] !== 'string' || !candidate[field])) {
    return { ok: false, blocker: 'lightchain_pre_source_evidence_missing' };
  }

  const snapshot = admission.snapshot;
  const evidenceIdentity = buildLightchainPreSourceEvidenceIdentity(snapshot);
  if (candidate.evidenceIdentity !== evidenceIdentity) {
    return { ok: false, blocker: 'lightchain_pre_source_evidence_identity_mismatch' };
  }
  if (candidate.runId !== snapshot.runId) {
    return { ok: false, blocker: 'lightchain_pre_source_evidence_run_mismatch' };
  }
  if (
    candidate.sourceHash !== snapshot.source.normalizedSourceHash
    || candidate.visualArtifactHash !== snapshot.readback.visualArtifactHash
  ) {
    return { ok: false, blocker: 'lightchain_pre_source_evidence_hash_mismatch' };
  }
  if (candidate.selectorRevision !== snapshot.selector.revision) {
    return { ok: false, blocker: 'lightchain_pre_source_evidence_selector_mismatch' };
  }
  return { ok: true, snapshot, evidenceIdentity };
};
