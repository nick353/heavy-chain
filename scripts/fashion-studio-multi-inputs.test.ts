import assert from 'node:assert/strict';
import test from 'node:test';
import { extractFashionStudioSavedDetail } from '../src/lib/fashionStudioDetailHydration.ts';
import { buildFashionStudioGeneratedSnapshot, findFashionStudioOperationResult, replaceFashionStudioInput } from '../src/lib/fashionStudioDetailAdapter.ts';

const remote = (n: number) => ({ jobId: `job-${n}`, imageId: `img-${n}`, storagePath: `generated-images/img-${n}` });
const image = (id: string, layerRole: string, extra: Record<string, unknown> = {}) => ({ id, type: 'image', src: `generated-images/${id}`,
  metadata: { storagePath: `generated-images/${id}`, parameters: { layerRole, ...extra } } });
const snapshot = (objects: unknown[]) => ({ version: 1, objects, view: { zoom: 0.3, panX: 0, panY: 0, gridVisible: false, snapToGrid: false, gridSize: 20 } }) as never;

// Light (2026-11-11): テキストで生成 takes up to nine references; slots 1-8 are their own layers so the reference role stays unique.
test('references 2-9 are read in slot order without making the reference role ambiguous', () => {
  const detail = extractFashionStudioSavedDetail(snapshot([
    image('main', 'original-base'), image('ref', 'material-reference'),
    image('extra-3', 'material-reference-extra', { referenceSlot: 3 }), image('extra-1', 'material-reference-extra', { referenceSlot: 1 }),
    image('dup-a', 'material-reference-extra', { referenceSlot: 2 }), image('dup-b', 'material-reference-extra', { referenceSlot: 2 }),
    image('bad', 'material-reference-extra', { referenceSlot: 9 }),
  ]));
  assert.equal(detail.roles.reference.status, 'available');
  assert.equal(detail.roles.reference.objectId, 'ref');
  assert.deepEqual(detail.extraReferences.map(item => [item.slot, item.objectId]), [[1, 'extra-1'], [3, 'extra-3']]);
});

test('an upload to a reference slot replaces only that slot and keeps the reference role', () => {
  const base = snapshot([image('main', 'original-base'), image('ref', 'material-reference')]);
  const added = replaceFashionStudioInput(base, 'reference-2', remote(1), 'op-1');
  const replaced = replaceFashionStudioInput(added, 'reference-2', remote(2), 'op-2');
  const detail = extractFashionStudioSavedDetail(replaced);
  assert.equal(detail.roles.reference.objectId, 'ref');
  assert.equal(detail.extraReferences.length, 1);
  assert.equal(detail.extraReferences[0].slot, 2);
  assert.ok(detail.extraReferences[0].candidates.includes('generated-images/img-2'));
  assert.throws(() => replaceFashionStudioInput(base, 'reference-9' as never, remote(3), 'op-3'), /fashion_studio_reference_slot_invalid/);
});

// Light lists every result beside the sample; a new generation keeps the earlier result as history.
test('a new result keeps the earlier one as history and only the new one answers its operation ID', () => {
  const first = snapshot([image('main', 'original-base'), image('old-result', 'generated-result', { generationOperationId: 'op-old' })]);
  const document = { id: 'doc', snapshot: first } as never;
  const handoff = { baseDocument: { snapshot: first }, input: { main: { objectId: 'main' }, prompt: 'p' }, requestId: 'op-new', persisted: { remote: remote(9) } } as never;
  const next = buildFashionStudioGeneratedSnapshot(document, handoff);
  const detail = extractFashionStudioSavedDetail(next);
  assert.equal(detail.roles.result.status, 'available');
  assert.notEqual(detail.roles.result.objectId, 'old-result');
  assert.deepEqual(detail.history.map(item => item.objectId), ['old-result']);
  assert.equal(findFashionStudioOperationResult(next, 'op-old'), undefined);
  assert.ok(findFashionStudioOperationResult(next, 'op-new'));
});
