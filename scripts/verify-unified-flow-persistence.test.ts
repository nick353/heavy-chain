import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,
} from 'node:fs';
import {
  getUnifiedWorkspaceFlowScopeKey,
  readUnifiedWorkspaceFlowState,
  resolveUnifiedWorkspaceFlowStateForScope,
  UNIFIED_WORKSPACE_FLOW_STORAGE_KEY,
  writeUnifiedWorkspaceFlowState,
  type FlowScope,
} from '../src/lib/unifiedWorkspaceFlowPersistence.ts';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  readonly getRequests: string[] = [];
  readonly setRequests: string[] = [];
  readonly removeRequests: string[] = [];
  throwOnGet = false;
  throwOnSet = false;

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) {
    this.getRequests.push(key);
    if (this.throwOnGet) throw new Error('storage read failed');
    return this.values.get(key) ?? null;
  }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) {
    this.removeRequests.push(key);
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.setRequests.push(key);
    if (this.throwOnSet) throw new Error('storage write failed');
    this.values.set(key, value);
  }
}

const scope = (userId: string | null, brandId: string | null, feature: string): FlowScope => ({
  userId,
  brandId,
  feature,
});

test('unified flow state survives same-scope persistence readback', () => {
  const storage = new MemoryStorage();
  const fittingScope = scope(' user-1 ', ' brand-1 ', 'AI-Fitting');
  writeUnifiedWorkspaceFlowState(fittingScope, 'completed', storage, new Date('2026-08-19T00:00:00Z'));

  assert.equal(readUnifiedWorkspaceFlowState(scope('user-1', 'brand-1', 'ai-fitting'), storage), 'completed');
  assert.match(storage.values.get(getUnifiedWorkspaceFlowScopeKey(fittingScope) ?? '') ?? '', /2026-08-19T00:00:00.000Z/);
  assert.equal(UNIFIED_WORKSPACE_FLOW_STORAGE_KEY, 'heavy-chain-unified-workspace-flow.v2');
});

test('user, brand, and feature states are isolated', () => {
  const storage = new MemoryStorage();
  const userOneBrandOne = scope('user-1', 'brand-1', 'fabric-image');
  const userTwoBrandOne = scope('user-2', 'brand-1', 'fabric-image');
  const userOneBrandTwo = scope('user-1', 'brand-2', 'fabric-image');
  const userOneBrandOneOtherFeature = scope('user-1', 'brand-1', 'model-library');

  writeUnifiedWorkspaceFlowState(userOneBrandOne, 'completed', storage);
  writeUnifiedWorkspaceFlowState(userTwoBrandOne, 'ready', storage);
  writeUnifiedWorkspaceFlowState(userOneBrandTwo, 'failed', storage);
  writeUnifiedWorkspaceFlowState(userOneBrandOneOtherFeature, 'generating', storage);

  assert.equal(readUnifiedWorkspaceFlowState(userOneBrandOne, storage), 'completed');
  assert.equal(readUnifiedWorkspaceFlowState(userTwoBrandOne, storage), 'ready');
  assert.equal(readUnifiedWorkspaceFlowState(userOneBrandTwo, storage), 'failed');
  assert.equal(readUnifiedWorkspaceFlowState(userOneBrandOneOtherFeature, storage), 'failed');
  assert.equal(storage.values.size, 4);
});

test('missing user or brand scope returns draft without Storage API access', () => {
  const storage = new MemoryStorage();
  assert.equal(readUnifiedWorkspaceFlowState(undefined, storage), 'draft');
  assert.equal(readUnifiedWorkspaceFlowState(scope('   ', 'brand-1', 'fabric-image'), storage), 'draft');
  assert.equal(readUnifiedWorkspaceFlowState(scope('user-1', null, 'fabric-image'), storage), 'draft');
  writeUnifiedWorkspaceFlowState(undefined, 'completed', storage);
  writeUnifiedWorkspaceFlowState(scope('user-1', '   ', 'fabric-image'), 'completed', storage);
  writeUnifiedWorkspaceFlowState(scope(null, 'brand-1', 'fabric-image'), 'completed', storage);

  assert.equal(storage.getRequests.length, 0);
  assert.equal(storage.setRequests.length, 0);
});

test('v1 data is ignored and never migrated or removed', () => {
  const storage = new MemoryStorage();
  const v1Key = 'heavy-chain-unified-workspace-flow.v1';
  storage.setItem(v1Key, JSON.stringify({ 'fabric-image': { state: 'completed', updatedAt: 'old' } }));
  storage.getRequests.length = 0;
  storage.setRequests.length = 0;
  storage.removeRequests.length = 0;

  const currentScope = scope('user-1', 'brand-1', 'fabric-image');
  assert.equal(readUnifiedWorkspaceFlowState(currentScope, storage), 'draft');
  writeUnifiedWorkspaceFlowState(currentScope, 'completed', storage);

  assert.equal(storage.values.get(v1Key), JSON.stringify({ 'fabric-image': { state: 'completed', updatedAt: 'old' } }));
  assert.equal(storage.getRequests.includes(v1Key), false);
  assert.equal(storage.setRequests.includes(v1Key), false);
  assert.equal(storage.removeRequests.includes(v1Key), false);
});

test('scope identity mismatch resolves to draft during a scope switch', () => {
  const previousScope = scope('user-1', 'brand-1', 'fabric-image');
  const nextScope = scope('user-2', 'brand-1', 'fabric-image');
  const previousScopeKey = getUnifiedWorkspaceFlowScopeKey(previousScope);

  assert.equal(resolveUnifiedWorkspaceFlowStateForScope(previousScope, previousScopeKey, 'completed'), 'completed');
  assert.equal(resolveUnifiedWorkspaceFlowStateForScope(nextScope, previousScopeKey, 'completed'), 'draft');
  assert.equal(resolveUnifiedWorkspaceFlowStateForScope(scope(null, 'brand-1', 'fabric-image'), previousScopeKey, 'completed'), 'draft');
});

test('interrupted generating state reopens as retryable failure without rewriting its scope', () => {
  const storage = new MemoryStorage();
  const generatingScope = scope('user-1', 'brand-1', 'fabric-image');
  const otherScope = scope('user-2', 'brand-1', 'fabric-image');
  writeUnifiedWorkspaceFlowState(generatingScope, 'generating', storage);
  writeUnifiedWorkspaceFlowState(otherScope, 'ready', storage);
  const writesBeforeRead = [...storage.setRequests];

  assert.equal(readUnifiedWorkspaceFlowState(generatingScope, storage), 'failed');
  assert.equal(readUnifiedWorkspaceFlowState(otherScope, storage), 'ready');
  assert.deepEqual(storage.setRequests, writesBeforeRead);
});

test('malformed schema and Storage exceptions fail open to draft/no-op', () => {
  const storage = new MemoryStorage();
  const currentScope = scope('user-1', 'brand-1', 'fabric-image');
  const currentKey = getUnifiedWorkspaceFlowScopeKey(currentScope) ?? '';

  storage.values.set(currentKey, '{not-json');
  assert.equal(readUnifiedWorkspaceFlowState(currentScope, storage), 'draft');
  storage.values.set(currentKey, JSON.stringify({ state: 'completed' }));
  assert.equal(readUnifiedWorkspaceFlowState(currentScope, storage), 'draft');
  storage.values.set(currentKey, JSON.stringify({ state: 'unknown', updatedAt: 'now' }));
  assert.equal(readUnifiedWorkspaceFlowState(currentScope, storage), 'draft');

  storage.throwOnGet = true;
  assert.doesNotThrow(() => readUnifiedWorkspaceFlowState(currentScope, storage));
  storage.throwOnGet = false;
  storage.throwOnSet = true;
  assert.doesNotThrow(() => writeUnifiedWorkspaceFlowState(currentScope, 'completed', storage));
});

test('structured scope encoding resists delimiter collisions', () => {
  const left = scope('user:a', 'brand', 'feature');
  const right = scope('user', 'a:brand', 'feature');

  assert.notEqual(getUnifiedWorkspaceFlowScopeKey(left), getUnifiedWorkspaceFlowScopeKey(right));
});

test('Shell reads the auth and brand scope and gates stale snapshots', () => {
  const source = readFileSync(new URL('../src/components/workspace/LightchainUnifiedWorkspaceShell.tsx', import.meta.url), 'utf8');

  assert.match(source, /const \{ user, currentBrand \} = useAuthStore\(\);/);
  assert.match(source, /resolveUnifiedWorkspaceFlowStateForScope\(/);
  assert.equal(
    source.match(/\[flowScope, flowScopeKey\]/g)?.length,
    2,
  );
});
