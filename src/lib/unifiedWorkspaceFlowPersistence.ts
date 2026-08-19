import type { UnifiedWorkspaceFlowState } from './unifiedWorkspaceFlow';

export const UNIFIED_WORKSPACE_FLOW_STORAGE_KEY = 'heavy-chain-unified-workspace-flow.v2';

export type FlowScope = {
  userId?: string | null;
  brandId?: string | null;
  feature?: string;
};

type NormalizedFlowScope = {
  userId: string;
  brandId: string;
  feature: string;
};

type PersistedFlowRecord = {
  state: UnifiedWorkspaceFlowState;
  updatedAt: string;
};

const FLOW_STATES: readonly UnifiedWorkspaceFlowState[] = [
  'draft',
  'ready',
  'generating',
  'completed',
  'failed',
];

const isFlowState = (value: unknown): value is UnifiedWorkspaceFlowState => (
  typeof value === 'string' && FLOW_STATES.includes(value as UnifiedWorkspaceFlowState)
);

const normalizeFeatureKey = (featureId: string): string => {
  const normalized = featureId.trim().toLowerCase();
  return normalized ? normalized.slice(0, 120) : 'workspace-hub';
};

const normalizeFlowScope = (scope: FlowScope | null | undefined): NormalizedFlowScope | null => {
  const userId = typeof scope?.userId === 'string' ? scope.userId.trim() : '';
  const brandId = typeof scope?.brandId === 'string' ? scope.brandId.trim() : '';
  if (!userId || !brandId) return null;

  return {
    userId,
    brandId,
    feature: normalizeFeatureKey(typeof scope?.feature === 'string' ? scope.feature : ''),
  };
};

const isPersistedFlowRecord = (value: unknown): value is PersistedFlowRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return isFlowState(record.state) && typeof record.updatedAt === 'string';
};

/**
 * Build an independent v2 storage key for one user, brand, and feature.
 * JSON encoding keeps each scope component structurally separate, including
 * values that contain punctuation used by older delimiter-based schemes.
 */
export function getUnifiedWorkspaceFlowScopeKey(scope: FlowScope | null | undefined): string | null {
  const normalized = normalizeFlowScope(scope);
  if (!normalized) return null;

  return `${UNIFIED_WORKSPACE_FLOW_STORAGE_KEY}${JSON.stringify([
    normalized.userId,
    normalized.brandId,
    normalized.feature,
  ])}`;
}

const getStorage = (storage?: Storage): Storage | null => {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * A state snapshot is valid only while its scope identity still matches the
 * current auth, brand, and feature scope. This prevents a scope transition
 * from rendering the previous scope for one React render.
 */
export function resolveUnifiedWorkspaceFlowStateForScope(
  scope: FlowScope | null | undefined,
  renderedScopeKey: string | null,
  state: UnifiedWorkspaceFlowState,
): UnifiedWorkspaceFlowState {
  const currentScopeKey = getUnifiedWorkspaceFlowScopeKey(scope);
  return currentScopeKey && currentScopeKey === renderedScopeKey ? state : 'draft';
}

/**
 * Read the last state for a scoped feature. A persisted `generating` state is
 * a recovered interruption, not proof that a provider is still running, so it
 * is exposed as retryable failure after a page reload. Invalid scopes return
 * before touching the Storage API.
 */
export function readUnifiedWorkspaceFlowState(
  scope: FlowScope | null | undefined,
  storage?: Storage,
): UnifiedWorkspaceFlowState {
  const scopeKey = getUnifiedWorkspaceFlowScopeKey(scope);
  if (!scopeKey) return 'draft';

  const target = getStorage(storage);
  if (!target) return 'draft';

  try {
    const raw = target.getItem(scopeKey);
    if (!raw) return 'draft';
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedFlowRecord(parsed)) return 'draft';
    return parsed.state === 'generating' ? 'failed' : parsed.state;
  } catch {
    return 'draft';
  }
}

export function writeUnifiedWorkspaceFlowState(
  scope: FlowScope | null | undefined,
  state: UnifiedWorkspaceFlowState,
  storage?: Storage,
  now = new Date(),
): void {
  const scopeKey = getUnifiedWorkspaceFlowScopeKey(scope);
  if (!scopeKey || !isFlowState(state)) return;

  const target = getStorage(storage);
  if (!target) return;

  try {
    target.setItem(scopeKey, JSON.stringify({
      state,
      updatedAt: now.toISOString(),
    } satisfies PersistedFlowRecord));
  } catch {
    // Local persistence is an enhancement; a disabled or full browser store
    // must not prevent the workspace from continuing in memory.
  }
}
