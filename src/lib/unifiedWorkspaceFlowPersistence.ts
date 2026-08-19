import type { UnifiedWorkspaceFlowState } from './unifiedWorkspaceFlow';

export const UNIFIED_WORKSPACE_FLOW_STORAGE_KEY = 'heavy-chain-unified-workspace-flow.v1';

type PersistedFlowRecord = {
  state: UnifiedWorkspaceFlowState;
  updatedAt: string;
};

type PersistedFlowMap = Record<string, PersistedFlowRecord>;

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

const getStorage = (storage?: Storage): Storage | null => {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const readMap = (storage: Storage): PersistedFlowMap => {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(UNIFIED_WORKSPACE_FLOW_STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const record = value as Record<string, unknown>;
        if (!isFlowState(record.state) || typeof record.updatedAt !== 'string') return [];
        return [[normalizeFeatureKey(key), { state: record.state, updatedAt: record.updatedAt }]];
      }),
    );
  } catch {
    return {};
  }
};

const writeMap = (storage: Storage, map: PersistedFlowMap): void => {
  try {
    storage.setItem(UNIFIED_WORKSPACE_FLOW_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Local persistence is an enhancement; a disabled or full browser store
    // must not prevent the workspace from continuing in memory.
  }
};

/**
 * Read the last state for a feature. A persisted `generating` state is a
 * recovered interruption, not proof that a provider is still running, so it
 * is exposed as retryable failure after a page reload.
 */
export function readUnifiedWorkspaceFlowState(
  featureId: string,
  storage?: Storage,
): UnifiedWorkspaceFlowState {
  const target = getStorage(storage);
  if (!target) return 'draft';
  const record = readMap(target)[normalizeFeatureKey(featureId)];
  if (!record) return 'draft';
  return record.state === 'generating' ? 'failed' : record.state;
}

export function writeUnifiedWorkspaceFlowState(
  featureId: string,
  state: UnifiedWorkspaceFlowState,
  storage?: Storage,
  now = new Date(),
): void {
  const target = getStorage(storage);
  if (!target) return;
  const map = readMap(target);
  map[normalizeFeatureKey(featureId)] = {
    state,
    updatedAt: now.toISOString(),
  };
  writeMap(target, map);
}
