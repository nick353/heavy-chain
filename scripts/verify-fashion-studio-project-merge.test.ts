import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFashionStudioProjectHref, mergeFashionStudioProjectCards } from '../src/lib/fashionStudioProjects.ts';

test('saved project cards reopen the Light-compatible Fashion Studio detail route', () => {
  assert.equal(
    buildFashionStudioProjectHref({ id: '2099697581958967298' }),
    '/flow/integration/detail?boardProjectCode=2099697581958967298&boardProjectType=integrationCustom',
  );
});

test('local handoff cards reopen through their durable Canvas ID', () => {
  assert.equal(
    buildFashionStudioProjectHref({ id: 'local-1', canvasProjectId: 'canvas-1' }),
    '/flow/integration/detail?boardProjectCode=canvas-1&boardProjectType=integrationCustom',
  );
});

test('remote Canvas project wins over its local handoff duplicate', () => {
  const cards = mergeFashionStudioProjectCards(
    [{ id: 'canvas-1', title: '保存済み', updatedAt: '2026-09-17T01:00:00Z', imageUrl: '' }],
    [{ id: 'local-1', canvasProjectId: 'canvas-1', title: '保存済み', updatedAt: '2026-09-17T01:00:00Z', imageUrl: '' }],
  );

  assert.deepEqual(cards.map(({ id, source }) => ({ id, source })), [{ id: 'canvas-1', source: 'remote' }]);
});

test('preserves a local handoff Canvas ID for reuse routing', () => {
  const cards = mergeFashionStudioProjectCards(
    [],
    [{ id: 'local-1', canvasProjectId: 'canvas-1', title: '保存済み', updatedAt: '2026-09-17T01:00:00Z', imageUrl: '' }],
  );

  assert.equal(cards[0]?.canvasProjectId, 'canvas-1');
});

test('local-only handoffs remain available for reuse', () => {
  const cards = mergeFashionStudioProjectCards(
    [],
    [{ id: 'local-1', title: 'ローカル', updatedAt: '2026-09-17T01:00:00Z', imageUrl: '' }],
  );

  assert.deepEqual(cards.map(({ id, source }) => ({ id, source })), [{ id: 'local-1', source: 'local' }]);
});

test('remote title is the fallback identity for legacy local handoffs', () => {
  const cards = mergeFashionStudioProjectCards(
    [{ id: 'canvas-1', title: '保存済み', updatedAt: '2026-09-17T01:00:00Z', imageUrl: '' }],
    [
      { id: 'legacy-local-1', canvasProjectId: 'old-canvas-1', title: '保存済み', updatedAt: '2026-09-17T01:00:00Z', imageUrl: '' },
      { id: 'legacy-local-2', canvasProjectId: 'old-canvas-2', title: '保存済み', updatedAt: '2026-09-16T01:00:00Z', imageUrl: '' },
      { id: 'local-only', title: '別のローカル', updatedAt: '2026-09-17T01:00:00Z', imageUrl: '' },
    ],
  );

  assert.deepEqual(cards.map(({ id, source }) => ({ id, source })), [
    { id: 'canvas-1', source: 'remote' },
    { id: 'local-only', source: 'local' },
  ]);
});
