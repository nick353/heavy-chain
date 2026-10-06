export const CANVAS_SAVE_DIAGNOSTIC_TEST_ID = 'canvas-save-diagnostic';
export const CANVAS_SAVE_DIAGNOSTIC_LOG_PREFIX = '[canvas-save-diagnostic]';

export type CanvasSaveDiagnosticStage =
  | 'validate'
  | 'scope'
  | 'id'
  | 'cachedRead'
  | 'retainDraft'
  | 'hydrate'
  | 'navigate'
  | 'save'
  | 'readback'
  | 'finalize';

export type CanvasSaveDiagnosticIdSource = 'knownRemote' | 'derived' | 'random';
export type CanvasProjectIdKind = 'canonical-uuid' | 'legacy' | 'none';

const CANONICAL_CANVAS_PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const classifyCanvasProjectIdKind = (projectId: string | null): CanvasProjectIdKind => {
  if (projectId === null) return 'none';
  return CANONICAL_CANVAS_PROJECT_ID.test(projectId) ? 'canonical-uuid' : 'legacy';
};

export type CanvasSaveContextMismatchFlags = {
  authMismatch: boolean;
  brandMismatch: boolean;
  canvasMismatch: boolean;
  routeMismatch: boolean;
  epochMismatch: boolean;
  renderedBetween: boolean;
  routeRefIsCaptured: boolean;
  storeIsCaptured: boolean;
};

export type CanvasSaveDiagnosticReceipt = {
  stage: CanvasSaveDiagnosticStage;
  errorName: string;
  knownCode: string | null;
  httpStatus: number | null;
  idSource: CanvasSaveDiagnosticIdSource;
  hasLocalId: boolean;
  hasCachedEntry: boolean;
  hasPendingEntry: boolean;
  baseRevisionPresent: boolean;
  contextRejected: boolean;
  contextMismatch: CanvasSaveContextMismatchFlags | null;
};

const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'DOMException',
  'AbortError',
  'CanvasDocumentValidationError',
  'AuthBrandAccessFenceError',
]);

const KNOWN_ERROR_CODES = new Set([
  'canvas_save_scope_invalid',
  'canvas_save_cache_invalid',
  'canvas_save_cache_too_large',
  'canvas_save_cache_readback_failed',
  'canvas_save_content_invalid',
  'canvas_save_recovery_missing',
  'canvas_save_owner_changed',
  'canvas_save_recovery_changed',
  'canvas_save_conflict',
  'canvas_save_readback_missing',
  'canvas_save_remote_missing',
  'canvas_document_readback_mismatch',
  'canvas_image_source_invalid',
  'cloudflare_api_400_invalid_canvas_document',
  'cloudflare_api_404_not_found',
  'auth_brand_access_fence_revoked',
]);
const SAFE_STAGES = new Set<CanvasSaveDiagnosticStage>([
  'validate', 'scope', 'id', 'cachedRead', 'retainDraft', 'hydrate', 'navigate', 'save', 'readback', 'finalize',
]);
const SAFE_ID_SOURCES = new Set<CanvasSaveDiagnosticIdSource>(['knownRemote', 'derived', 'random']);

export type CanvasSaveDiagnosticReceiptScope = { user: object; brand: object };
const receiptsByUser = new WeakMap<object, WeakMap<object, CanvasSaveDiagnosticReceipt>>();

const safeMismatchFlags = (flags: CanvasSaveContextMismatchFlags | null | undefined): CanvasSaveContextMismatchFlags | null => (
  flags ? {
    authMismatch: Boolean(flags.authMismatch),
    brandMismatch: Boolean(flags.brandMismatch),
    canvasMismatch: Boolean(flags.canvasMismatch),
    routeMismatch: Boolean(flags.routeMismatch),
    epochMismatch: Boolean(flags.epochMismatch),
    renderedBetween: Boolean(flags.renderedBetween),
    routeRefIsCaptured: Boolean(flags.routeRefIsCaptured),
    storeIsCaptured: Boolean(flags.storeIsCaptured),
  } : null
);

const sanitizeReceipt = (receipt: CanvasSaveDiagnosticReceipt): CanvasSaveDiagnosticReceipt => ({
  stage: SAFE_STAGES.has(receipt.stage) ? receipt.stage : 'save',
  errorName: SAFE_ERROR_NAMES.has(receipt.errorName) ? receipt.errorName : 'UnknownError',
  knownCode: receipt.knownCode && KNOWN_ERROR_CODES.has(receipt.knownCode) ? receipt.knownCode : null,
  httpStatus: typeof receipt.httpStatus === 'number' && Number.isInteger(receipt.httpStatus)
    && receipt.httpStatus >= 100 && receipt.httpStatus <= 599 ? receipt.httpStatus : null,
  idSource: SAFE_ID_SOURCES.has(receipt.idSource) ? receipt.idSource : 'random',
  hasLocalId: Boolean(receipt.hasLocalId),
  hasCachedEntry: Boolean(receipt.hasCachedEntry),
  hasPendingEntry: Boolean(receipt.hasPendingEntry),
  baseRevisionPresent: Boolean(receipt.baseRevisionPresent),
  contextRejected: Boolean(receipt.contextRejected),
  contextMismatch: safeMismatchFlags(receipt.contextMismatch),
});

const getScopedReceipts = (scope: CanvasSaveDiagnosticReceiptScope, create: boolean) => {
  let byBrand = receiptsByUser.get(scope.user);
  if (!byBrand && create) {
    byBrand = new WeakMap<object, CanvasSaveDiagnosticReceipt>();
    receiptsByUser.set(scope.user, byBrand);
  }
  return byBrand;
};

/** The in-memory sink is bound to opaque auth/brand object identities. Those
 * identities are never copied into the receipt and naturally stop matching
 * after an account or brand switch. It survives Canvas component remounts. */
export const clearCanvasSaveDiagnosticReceipt = (scope: CanvasSaveDiagnosticReceiptScope): void => {
  getScopedReceipts(scope, false)?.delete(scope.brand);
};

export const recordCanvasSaveDiagnosticReceipt = (
  scope: CanvasSaveDiagnosticReceiptScope,
  receipt: CanvasSaveDiagnosticReceipt,
): CanvasSaveDiagnosticReceipt => {
  const safe = sanitizeReceipt(receipt);
  getScopedReceipts(scope, true)!.set(scope.brand, safe);
  return { ...safe, contextMismatch: safeMismatchFlags(safe.contextMismatch) };
};

export const readCanvasSaveDiagnosticReceipt = (
  scope: CanvasSaveDiagnosticReceiptScope | null | undefined,
): CanvasSaveDiagnosticReceipt | null => {
  if (!scope?.user || !scope.brand) return null;
  const receipt = getScopedReceipts(scope, false)?.get(scope.brand);
  return receipt ? { ...receipt, contextMismatch: safeMismatchFlags(receipt.contextMismatch) } : null;
};

const readString = (value: unknown, key: string): string | null => {
  if (!value || typeof value !== 'object') return null;
  try {
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === 'string' ? candidate : null;
  } catch {
    return null;
  }
};

const readStatus = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') return null;
  try {
    const record = error as Record<string, unknown>;
    for (const value of [record.status, record.statusCode]) {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) return value;
    }
  } catch {
    return null;
  }
  const message = readString(error, 'message');
  const match = message?.match(/^cloudflare_api_(\d{3})_[a-z0-9_]+$/);
  if (!match) return null;
  const status = Number(match[1]);
  return status >= 100 && status <= 599 ? status : null;
};

export const buildCanvasSaveDiagnosticReceipt = (input: {
  stage: CanvasSaveDiagnosticStage;
  error: unknown;
  idSource: CanvasSaveDiagnosticIdSource;
  hasLocalId: boolean;
  hasCachedEntry: boolean;
  hasPendingEntry: boolean;
  baseRevisionPresent: boolean;
  contextRejected?: boolean;
  contextMismatch?: CanvasSaveContextMismatchFlags | null;
}): CanvasSaveDiagnosticReceipt => {
  const candidateName = readString(input.error, 'name');
  const candidateCode = readString(input.error, 'code');
  const candidateMessage = readString(input.error, 'message');
  const knownCode = [candidateCode, candidateMessage].find((candidate) => (
    candidate !== null && KNOWN_ERROR_CODES.has(candidate)
  )) ?? null;

  return {
    stage: input.stage,
    errorName: candidateName && SAFE_ERROR_NAMES.has(candidateName) ? candidateName : 'UnknownError',
    knownCode,
    httpStatus: readStatus(input.error),
    idSource: input.idSource,
    hasLocalId: input.hasLocalId,
    hasCachedEntry: input.hasCachedEntry,
    hasPendingEntry: input.hasPendingEntry,
    baseRevisionPresent: input.baseRevisionPresent,
    contextRejected: Boolean(input.contextRejected),
    contextMismatch: safeMismatchFlags(input.contextMismatch),
  };
};
