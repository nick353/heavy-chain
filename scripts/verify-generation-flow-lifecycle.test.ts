import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveGenerationFlowStage,
  getGenerationPrimaryActionLabel,
} from '../src/lib/generationFlow.ts';

test('generation lifecycle has deterministic ready, blocked, generating, complete, and failed states', () => {
  const base = { isGenerating: false, hasError: false, hasResult: false, isDisabled: false };
  assert.equal(deriveGenerationFlowStage(base), 'ready');
  assert.equal(deriveGenerationFlowStage({ ...base, isDisabled: true }), 'blocked');
  assert.equal(deriveGenerationFlowStage({ ...base, isGenerating: true }), 'generating');
  assert.equal(deriveGenerationFlowStage({ ...base, hasResult: true }), 'complete');
  assert.equal(deriveGenerationFlowStage({ ...base, hasError: true }), 'failed');
});

test('generation lifecycle prioritizes active work and exposes explicit retry', () => {
  assert.equal(
    deriveGenerationFlowStage({ isGenerating: true, hasError: true, hasResult: true, isDisabled: true }),
    'generating',
  );
  assert.equal(
    getGenerationPrimaryActionLabel({ stage: 'failed', isPromptOptimization: false, noImageGenerationMode: false }),
    '再試行',
  );
  assert.equal(
    getGenerationPrimaryActionLabel({ stage: 'generating', isPromptOptimization: false, noImageGenerationMode: false }),
    '生成中...',
  );
  assert.equal(
    getGenerationPrimaryActionLabel({ stage: 'ready', isPromptOptimization: true, noImageGenerationMode: false }),
    '最適化',
  );
});
