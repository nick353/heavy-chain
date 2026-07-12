import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeModelMatrixSemanticVerification } from '../src/lib/modelMatrixVerification.ts';

test('normalizes semanticVerification payloads', () => {
  const value = normalizeModelMatrixSemanticVerification({
    semanticVerification: {
      verdict: 'yes',
      reason: '参照画像を分析し、着用条件を組み立てました',
      model: 'gemini-2.5-flash',
      checkedAt: '2026-07-12T00:00:00.000Z',
    },
  });

  assert.deepEqual(value, {
    verdict: 'yes',
    reason: '参照画像を分析し、着用条件を組み立てました',
    model: 'gemini-2.5-flash',
    checkedAt: '2026-07-12T00:00:00.000Z',
  });
});

test('normalizes legacy verifier payloads', () => {
  const value = normalizeModelMatrixSemanticVerification({
    verifier: {
      verdict: 'no',
      reason: '参照画像が読み込めませんでした',
      model: 'gemini-2.5-flash',
      checkedAt: '2026-07-12T00:00:00.000Z',
    },
  });

  assert.deepEqual(value, {
    verdict: 'no',
    reason: '参照画像が読み込めませんでした',
    model: 'gemini-2.5-flash',
    checkedAt: '2026-07-12T00:00:00.000Z',
  });
});

test('returns null for invalid payloads', () => {
  assert.equal(normalizeModelMatrixSemanticVerification({ semanticVerification: { verdict: 'maybe' } }), null);
  assert.equal(normalizeModelMatrixSemanticVerification(null), null);
});
