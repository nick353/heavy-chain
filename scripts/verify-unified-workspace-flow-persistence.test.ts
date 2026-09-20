import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getUnifiedWorkspaceFlowScopeKey,
  readUnifiedWorkspaceFlowState,
  resolveUnifiedWorkspaceFlowStateForScope,
  writeUnifiedWorkspaceFlowState,
  type FlowScope,
} from '../src/lib/unifiedWorkspaceFlowPersistence.ts';

class LocalMapStorage implements Storage {
  readonly values = new Map<string, string>();
  readonly calls: Array<'getItem' | 'setItem' | 'removeItem' | 'clear' | 'key'> = [];

  get length() {
    return this.values.size;
  }

  clear() {
    this.calls.push('clear');
    this.values.clear();
  }

  getItem(key: string) {
    this.calls.push('getItem');
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    this.calls.push('key');
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.calls.push('removeItem');
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.calls.push('setItem');
    this.values.set(key, value);
  }
}

const scope = (userId: string | null, brandId: string | null, feature: string): FlowScope => ({
  userId,
  brandId,
  feature,
});

test('local persistence isolates completed state for distinct user and brand scopes', () => {
  const storage = new LocalMapStorage();
  const firstScope = scope('user-1', 'brand-1', 'shared-feature');
  const secondScope = scope('user-2', 'brand-2', 'shared-feature');
  const firstKey = getUnifiedWorkspaceFlowScopeKey(firstScope);
  const secondKey = getUnifiedWorkspaceFlowScopeKey(secondScope);

  assert.notEqual(firstKey, secondKey);
  writeUnifiedWorkspaceFlowState(firstScope, 'completed', storage, new Date('2026-08-27T00:00:00Z'));

  assert.equal(readUnifiedWorkspaceFlowState(firstScope, storage), 'completed');
  assert.equal(readUnifiedWorkspaceFlowState(secondScope, storage), 'draft');
  assert.equal(storage.values.size, 1);
});

test('local persistence round-trip preserves completed state and exact updatedAt', () => {
  const storage = new LocalMapStorage();
  const currentScope = scope('user-1', 'brand-1', 'fixed-date-feature');
  const fixedDate = new Date('2026-08-27T01:02:03.004Z');
  const key = getUnifiedWorkspaceFlowScopeKey(currentScope);

  writeUnifiedWorkspaceFlowState(currentScope, 'completed', storage, fixedDate);

  assert.equal(readUnifiedWorkspaceFlowState(currentScope, storage), 'completed');
  assert.equal(
    storage.values.get(key ?? ''),
    JSON.stringify({ state: 'completed', updatedAt: fixedDate.toISOString() }),
  );
});

test('empty or structurally malformed scopes return null or draft without local storage calls', () => {
  const invalidScopes: Array<FlowScope | null | undefined> = [
    undefined,
    null,
    {},
    scope('', 'brand-1', 'feature'),
    scope('user-1', '', 'feature'),
    { userId: 42 as unknown as string, brandId: 'brand-1', feature: 'feature' },
    { userId: 'user-1', brandId: { id: 'brand-1' } as unknown as string, feature: 'feature' },
  ];

  for (const invalidScope of invalidScopes) {
    const storage = new LocalMapStorage();

    assert.equal(getUnifiedWorkspaceFlowScopeKey(invalidScope), null);
    assert.equal(readUnifiedWorkspaceFlowState(invalidScope, storage), 'draft');
    writeUnifiedWorkspaceFlowState(invalidScope, 'completed', storage, new Date('2026-08-27T00:00:00Z'));
    assert.deepEqual(storage.calls, []);
  }
});

test('malformed JSON and unsupported local persisted state return draft', () => {
  const storage = new LocalMapStorage();
  const currentScope = scope('user-1', 'brand-1', 'fixture-feature');
  const key = getUnifiedWorkspaceFlowScopeKey(currentScope);

  storage.values.set(key ?? '', '{not-json');
  assert.equal(readUnifiedWorkspaceFlowState(currentScope, storage), 'draft');

  storage.values.set(
    key ?? '',
    JSON.stringify({ state: 'unsupported', updatedAt: '2026-08-27T00:00:00.000Z' }),
  );
  assert.equal(readUnifiedWorkspaceFlowState(currentScope, storage), 'draft');
});

test('local persisted generating state reads as failed repeatedly without rewriting', () => {
  const storage = new LocalMapStorage();
  const currentScope = scope('user-1', 'brand-1', 'retryable-feature');

  writeUnifiedWorkspaceFlowState(currentScope, 'generating', storage, new Date('2026-08-27T00:00:00Z'));
  const callsAfterWrite = [...storage.calls];

  assert.equal(readUnifiedWorkspaceFlowState(currentScope, storage), 'failed');
  assert.equal(readUnifiedWorkspaceFlowState(currentScope, storage), 'failed');
  assert.deepEqual(storage.calls, [...callsAfterWrite, 'getItem', 'getItem']);
});

test('local rendered-key resolution preserves matching state and drafts a different valid scope', () => {
  const renderedScope = scope('user-1', 'brand-1', 'rendered-feature');
  const differentScope = scope('user-2', 'brand-1', 'rendered-feature');
  const renderedKey = getUnifiedWorkspaceFlowScopeKey(renderedScope);

  assert.equal(
    resolveUnifiedWorkspaceFlowStateForScope(renderedScope, renderedKey, 'completed'),
    'completed',
  );
  assert.equal(
    resolveUnifiedWorkspaceFlowStateForScope(differentScope, renderedKey, 'completed'),
    'draft',
  );
});
