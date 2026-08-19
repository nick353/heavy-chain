import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveUnifiedWorkspaceFlowState,
  unifiedWorkspaceFlowLabels,
} from '../src/lib/unifiedWorkspaceFlow.ts';

test('shared apparel flow state follows draft to ready to generating to completed', () => {
  assert.equal(deriveUnifiedWorkspaceFlowState({ inputReady: false, rightsReady: false, generating: false, completed: false, failed: false }), 'draft');
  assert.equal(deriveUnifiedWorkspaceFlowState({ inputReady: true, rightsReady: true, generating: false, completed: false, failed: false }), 'ready');
  assert.equal(deriveUnifiedWorkspaceFlowState({ inputReady: true, rightsReady: true, generating: true, completed: false, failed: false }), 'generating');
  assert.equal(deriveUnifiedWorkspaceFlowState({ inputReady: true, rightsReady: true, generating: false, completed: true, failed: false }), 'completed');
});

test('failed state takes precedence over stale completion and keeps retry wording', () => {
  assert.equal(deriveUnifiedWorkspaceFlowState({ inputReady: true, rightsReady: true, generating: false, completed: true, failed: true }), 'failed');
  assert.equal(unifiedWorkspaceFlowLabels.failed, '失敗・再試行可能');
});

test('durable persistence can promote a result even when the page has no local matrix', () => {
  assert.equal(deriveUnifiedWorkspaceFlowState({ inputReady: true, rightsReady: true, generating: false, completed: false, failed: false, persisted: true }), 'completed');
});
