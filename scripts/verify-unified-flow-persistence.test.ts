import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readUnifiedWorkspaceFlowState,
  UNIFIED_WORKSPACE_FLOW_STORAGE_KEY,
  writeUnifiedWorkspaceFlowState,
} from '../src/lib/unifiedWorkspaceFlowPersistence.ts';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test('unified flow state survives same-feature persistence readback', () => {
  const storage = new MemoryStorage();
  writeUnifiedWorkspaceFlowState('AI-Fitting', 'completed', storage, new Date('2026-08-19T00:00:00Z'));

  assert.equal(readUnifiedWorkspaceFlowState('ai-fitting', storage), 'completed');
  assert.match(storage.getItem(UNIFIED_WORKSPACE_FLOW_STORAGE_KEY) ?? '', /2026-08-19T00:00:00.000Z/);
});

test('interrupted generating state reopens as retryable failure', () => {
  const storage = new MemoryStorage();
  writeUnifiedWorkspaceFlowState('fabric-image', 'generating', storage);

  assert.equal(readUnifiedWorkspaceFlowState('fabric-image', storage), 'failed');
});

test('malformed browser storage fails open to draft', () => {
  const storage = new MemoryStorage();
  storage.setItem(UNIFIED_WORKSPACE_FLOW_STORAGE_KEY, '{not-json');

  assert.equal(readUnifiedWorkspaceFlowState('fabric-image', storage), 'draft');
});
