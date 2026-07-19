import assert from 'node:assert/strict';
import test from 'node:test';
import {
  armPrintDesignReturnIntent,
  bindPrintDesignReturnIntent,
  canCommitPrintDesignCutoutRequest,
  deferPrintDesignReturnIntent,
  dedupePrintDesignsByIdentity,
  haveSamePrintDesignIdentitySequence,
  isPendingPrintDesignLayerMaterialization,
  planPrintDesignCutoutReconciliation,
  planPrintDesignInputUpdate,
  printDesignIdentity,
  preservePrintDesignLayerOrder,
  prunePrintDesignIdentityMap,
  reorderPrintDesignLayers,
  resolvePrintDesignMaskEditorIndex,
  resolvePrintDesignReturnIntent,
  releasePrintDesignReturnIntent,
  resolvePrintPlacementSelection,
  selectPlacedPrintDesignLayers,
  selectFreshDuplicatePrintDesign,
  selectLatestProcessingPrintDesignLayerId,
  selectLatestReadyPrintDesignLayerId,
} from '../src/features/printing/selection/designLayerSelection.ts';

test('next-design return intent binds to one stable target and is consumed only when it is active and ready', () => {
  const firstId = 'print-design-a';
  const secondId = 'print-design-b';
  const armed = armPrintDesignReturnIntent();
  assert.deepEqual(resolvePrintDesignReturnIntent({
    intent: armed,
    activeLayerId: firstId,
    expectedLayerIds: [firstId],
    layers: [{ id: firstId, state: 'done' }],
  }), { intent: armed, shouldReturn: false });

  const bound = bindPrintDesignReturnIntent(armed, secondId);
  assert.deepEqual(resolvePrintDesignReturnIntent({
    intent: bound,
    activeLayerId: secondId,
    expectedLayerIds: [firstId, secondId],
    layers: [{ id: firstId, state: 'done' }, { id: secondId, state: 'processing' }],
  }), { intent: bound, shouldReturn: false });
  assert.deepEqual(resolvePrintDesignReturnIntent({
    intent: bound,
    activeLayerId: secondId,
    expectedLayerIds: [firstId, secondId],
    layers: [{ id: firstId, state: 'done' }, { id: secondId, state: 'done' }],
  }), { intent: null, shouldReturn: true });
  assert.equal(bindPrintDesignReturnIntent(bound, firstId), null);
  assert.equal(bindPrintDesignReturnIntent(bound, secondId), bound);
  assert.equal(bindPrintDesignReturnIntent(null, secondId), null);
});

test('deferred Gallery return survives readiness until modal focus cleanup releases it', () => {
  const secondId = 'print-design-b';
  const bound = bindPrintDesignReturnIntent(armPrintDesignReturnIntent(), secondId);
  const deferred = deferPrintDesignReturnIntent(bound, secondId);
  assert.deepEqual(resolvePrintDesignReturnIntent({
    intent: deferred,
    activeLayerId: secondId,
    expectedLayerIds: [secondId],
    layers: [{ id: secondId, state: 'done' }],
  }), { intent: deferred, shouldReturn: false });
  const released = releasePrintDesignReturnIntent(deferred, secondId);
  assert.deepEqual(resolvePrintDesignReturnIntent({
    intent: released,
    activeLayerId: secondId,
    expectedLayerIds: [secondId],
    layers: [{ id: secondId, state: 'done' }],
  }), { intent: null, shouldReturn: true });
  assert.equal(releasePrintDesignReturnIntent(deferred, 'print-design-other'), deferred);
});

test('next-design return intent ignores unrelated readiness and cancels stale, failed, or replaced targets', () => {
  const firstId = 'print-design-a';
  const secondId = 'print-design-b';
  const bound = bindPrintDesignReturnIntent(armPrintDesignReturnIntent(), secondId);
  assert.deepEqual(resolvePrintDesignReturnIntent({
    intent: bound,
    activeLayerId: secondId,
    expectedLayerIds: [firstId, secondId],
    layers: [{ id: firstId, state: 'done' }],
  }), { intent: bound, shouldReturn: false });
  assert.deepEqual(resolvePrintDesignReturnIntent({
    intent: bound,
    activeLayerId: firstId,
    expectedLayerIds: [firstId, secondId],
    layers: [{ id: firstId, state: 'done' }, { id: secondId, state: 'done' }],
  }), { intent: null, shouldReturn: false });
  assert.deepEqual(resolvePrintDesignReturnIntent({
    intent: bound,
    activeLayerId: secondId,
    expectedLayerIds: [firstId, secondId],
    layers: [{ id: secondId, state: 'error' }],
  }), { intent: null, shouldReturn: false });
  assert.deepEqual(resolvePrintDesignReturnIntent({
    intent: bound,
    activeLayerId: secondId,
    expectedLayerIds: [firstId],
    layers: [],
  }), { intent: null, shouldReturn: false });
});

test('Gallery identity survives object and signed URL recreation without merging unrelated assets', () => {
  assert.equal(
    printDesignIdentity({ url: 'https://signed-a', galleryImageId: ' image-1 ' }),
    printDesignIdentity({ url: 'https://signed-b', galleryImageId: 'image-1' }),
  );
  assert.notEqual(
    printDesignIdentity({ url: 'https://same', galleryImageId: 'image-1' }),
    printDesignIdentity({ url: 'https://same', galleryImageId: 'image-2' }),
  );
  assert.notEqual(
    printDesignIdentity({ url: 'data:image/png;base64,A' }),
    printDesignIdentity({ url: 'data:image/png;base64,B' }),
  );
  assert.notEqual(
    printDesignIdentity({ url: 'https://same', galleryImageId: 'image-1' }),
    printDesignIdentity({ url: 'https://same' }),
  );
});

test('semantic design dedupe preserves first position while retaining the freshest object', () => {
  const firstGallery = { url: 'https://signed-a', galleryImageId: 'image-1', marker: 'first' };
  const duplicateGallery = { url: 'https://signed-b', galleryImageId: 'image-1', marker: 'duplicate' };
  const upload = { url: 'data:image/png;base64,A', marker: 'upload' };
  assert.deepEqual(
    dedupePrintDesignsByIdentity([firstGallery, duplicateGallery, upload]),
    [duplicateGallery, upload],
  );
  assert.equal(haveSamePrintDesignIdentitySequence(
    [firstGallery, upload],
    [duplicateGallery, { ...upload }],
  ), true);
  assert.equal(haveSamePrintDesignIdentitySequence(
    [firstGallery, upload],
    [upload, duplicateGallery],
  ), false);
});

test('same Gallery reselect refreshes its URL without restarting a healthy cutout', () => {
  const previous = [{ url: 'https://old-signed-url', galleryImageId: 'image-1' }];
  const refreshed = { url: 'https://fresh-signed-url', galleryImageId: 'image-1' };
  const plan = planPrintDesignInputUpdate({
    previous,
    incoming: [previous[0], refreshed],
    cutoutStates: { 0: 'done' },
  });
  assert.deepEqual(plan.nextImages, [refreshed]);
  assert.equal(plan.duplicateCount, 1);
  assert.equal(plan.sameIdentitySequence, true);
  assert.equal(plan.shouldRestartCutout, false);
  assert.deepEqual(plan.newlyAddedIdentities, []);
});

test('errored Gallery reselect retries with the refreshed URL while current requests alone can commit', () => {
  const previous = [{ url: 'https://old-signed-url', galleryImageId: 'image-1' }];
  const refreshed = { url: 'https://fresh-signed-url', galleryImageId: 'image-1' };
  const plan = planPrintDesignInputUpdate({
    previous,
    incoming: [previous[0], refreshed],
    cutoutStates: { 0: 'error' },
  });
  assert.equal(plan.nextImages[0].url, 'https://fresh-signed-url');
  assert.equal(plan.shouldRestartCutout, true);
  assert.equal(canCommitPrintDesignCutoutRequest(4, 4), true);
  assert.equal(canCommitPrintDesignCutoutRequest(4, 5), false);
});

test('fresh duplicate selection remains identifiable even when an unrelated error forces reconciliation', () => {
  const ready = { url: 'https://ready', galleryImageId: 'ready' };
  const errored = { url: 'https://error', galleryImageId: 'error' };
  const refreshedReady = { url: 'https://ready-new', galleryImageId: 'ready' };
  const incoming = [ready, errored, refreshedReady];
  const plan = planPrintDesignInputUpdate({
    previous: [ready, errored],
    incoming,
    cutoutStates: { 0: 'done', 1: 'error' },
  });
  assert.equal(plan.shouldRestartCutout, true);
  assert.equal(
    selectFreshDuplicatePrintDesign({
      previous: [ready, errored],
      incoming,
    }),
    refreshedReady,
  );
  assert.equal(selectFreshDuplicatePrintDesign({
    previous: [ready, errored],
    incoming: [ready],
  }), null);
});

test('mixed duplicate and new batches target only a latest appended duplicate', () => {
  const existing = { url: 'https://old', galleryImageId: 'existing' };
  const duplicate = { url: 'https://fresh', galleryImageId: 'existing' };
  const added = { url: 'data:image/png;base64,NEW' };
  assert.equal(selectFreshDuplicatePrintDesign({
    previous: [existing],
    incoming: [existing, duplicate, added],
  }), null);
  assert.equal(selectFreshDuplicatePrintDesign({
    previous: [existing],
    incoming: [existing, added, duplicate],
  }), duplicate);
});

test('missing semantic identity fails closed', () => {
  assert.throws(() => printDesignIdentity({ url: '   ', galleryImageId: '  ' }), /PRINT_DESIGN_IDENTITY_MISSING/);
  assert.throws(() => dedupePrintDesignsByIdentity([{ url: '' }]), /PRINT_DESIGN_IDENTITY_MISSING/);
});

test('identity Map pruning releases removed upload data URLs and clears all entries', () => {
  const uploadA = { url: `data:image/png;base64,${'A'.repeat(64)}` };
  const uploadB = { url: `data:image/png;base64,${'B'.repeat(64)}` };
  const identityMap = new Map([
    [printDesignIdentity(uploadA), 'layer-a'],
    [printDesignIdentity(uploadB), 'layer-b'],
  ]);
  prunePrintDesignIdentityMap(identityMap, [uploadB]);
  assert.deepEqual([...identityMap.values()], ['layer-b']);
  assert.equal(identityMap.has(printDesignIdentity(uploadA)), false);
  prunePrintDesignIdentityMap(identityMap, []);
  assert.equal(identityMap.size, 0);
});

test('design mask editor resolves the captured layer after reorder and rejects stale or duplicate targets', () => {
  assert.equal(resolvePrintDesignMaskEditorIndex(['layer-a', 'layer-b'], 'layer-a'), 0);
  assert.equal(resolvePrintDesignMaskEditorIndex(['layer-b', 'layer-a'], 'layer-a'), 1);
  assert.equal(resolvePrintDesignMaskEditorIndex(['layer-b'], 'layer-a'), null);
  assert.throws(
    () => resolvePrintDesignMaskEditorIndex(['layer-a', 'layer-a'], 'layer-a'),
    /PRINT_DESIGN_CURRENT_LAYER_ID_DUPLICATE/,
  );
});

test('removed and re-added image receives a new layer identity that cannot satisfy an old editor target', () => {
  const image = { url: 'data:image/png;base64,A' };
  const identityMap = new Map([[printDesignIdentity(image), 'layer-old']]);
  prunePrintDesignIdentityMap(identityMap, []);
  identityMap.set(printDesignIdentity(image), 'layer-new');
  assert.equal(resolvePrintDesignMaskEditorIndex([...identityMap.values()], 'layer-old'), null);
  assert.equal(resolvePrintDesignMaskEditorIndex([...identityMap.values()], 'layer-new'), 0);
});

const garment = { id: 'print-garment', kind: 'garment' as const, ready: true };
const first = { id: 'print-design-a', kind: 'design' as const, ready: true };
const second = { id: 'print-design-b', kind: 'design' as const, ready: true };

test('all placed designs are sent downstream in stable order while editing selection stays independent', () => {
  const candidates = [first, second];
  assert.deepEqual(selectPlacedPrintDesignLayers(candidates), [first, second]);
  assert.deepEqual(candidates, [first, second]);
  assert.throws(
    () => selectPlacedPrintDesignLayers([first, first]),
    /PRINT_DESIGN_PLACED_LAYER_ID_DUPLICATE/,
  );
});

test('completed cutouts survive candidate append, removal, and reindexing', () => {
  const previous = [
    { layerId: first.id, state: 'done' as const, hasProcessedUrl: true, hasResult: true },
    { layerId: second.id, state: 'done' as const, hasProcessedUrl: true, hasResult: true },
  ];
  assert.deepEqual(planPrintDesignCutoutReconciliation({
    previous,
    nextLayerIds: [second.id, 'print-design-c'],
    preferredLayerId: 'print-design-c',
  }), {
    previousIndexByNextIndex: [1, null],
    reusablePreviousIndexByNextIndex: [1, null],
    processOrder: [1],
  });
});

test('new active cutout runs before stale processing or failed survivors', () => {
  const previous = [
    { layerId: first.id, state: 'processing' as const, hasProcessedUrl: false, hasResult: false },
    { layerId: second.id, state: 'error' as const, hasProcessedUrl: false, hasResult: false },
  ];
  assert.deepEqual(planPrintDesignCutoutReconciliation({
    previous,
    nextLayerIds: [first.id, second.id, 'print-design-c'],
    preferredLayerId: 'print-design-c',
  }).processOrder, [2, 0, 1]);
});

test('incomplete done records are reprocessed instead of treated as reusable', () => {
  const plan = planPrintDesignCutoutReconciliation({
    previous: [{ layerId: first.id, state: 'done', hasProcessedUrl: true, hasResult: false }],
    nextLayerIds: [first.id],
    preferredLayerId: first.id,
  });
  assert.deepEqual(plan.reusablePreviousIndexByNextIndex, [null]);
  assert.deepEqual(plan.processOrder, [0]);
});

test('duplicate stable layer identities fail closed instead of merging candidate records', () => {
  assert.throws(() => planPrintDesignCutoutReconciliation({
    previous: [],
    nextLayerIds: [first.id, first.id],
    preferredLayerId: first.id,
  }), /PRINT_DESIGN_NEXT_LAYER_ID_DUPLICATE/);
  assert.throws(() => planPrintDesignCutoutReconciliation({
    previous: [
      { layerId: first.id, state: 'done', hasProcessedUrl: true, hasResult: true },
      { layerId: first.id, state: 'done', hasProcessedUrl: true, hasResult: true },
    ],
    nextLayerIds: [first.id],
    preferredLayerId: first.id,
  }), /PRINT_DESIGN_PREVIOUS_LAYER_ID_DUPLICATE/);
});

test('active removal retains the latest processing survivor as a pending target', () => {
  assert.equal(selectLatestProcessingPrintDesignLayerId([
    { ...first, processing: true },
    { ...second, ready: false, processing: false },
  ]), first.id);
});

test('processing designs stay in the placed z-order until readiness gates generation', () => {
  const processing = { ...second, ready: false };
  assert.deepEqual(selectPlacedPrintDesignLayers([first, processing]), [first, processing]);
});

test('layer order actions preserve objects and move only the stable target identity', () => {
  const third = { id: 'print-design-c', kind: 'design' as const, ready: true, transform: { x: 20 } };
  const layers = [{ ...first, transform: { x: 10 } }, { ...second, transform: { x: 15 } }, third];
  assert.deepEqual(reorderPrintDesignLayers(layers, second.id, 'front').map((layer) => layer.id), [first.id, third.id, second.id]);
  assert.deepEqual(reorderPrintDesignLayers(layers, second.id, 'forward').map((layer) => layer.id), [first.id, third.id, second.id]);
  assert.deepEqual(reorderPrintDesignLayers(layers, second.id, 'backward').map((layer) => layer.id), [second.id, first.id, third.id]);
  assert.deepEqual(reorderPrintDesignLayers(layers, second.id, 'back').map((layer) => layer.id), [second.id, first.id, third.id]);
  const reordered = reorderPrintDesignLayers(layers, second.id, 'front');
  assert.equal(reordered[2], layers[1]);
  assert.deepEqual(reordered[2]?.transform, { x: 15 });
  assert.equal(reorderPrintDesignLayers(layers, 'missing', 'front'), layers);
  assert.equal(reorderPrintDesignLayers(layers, first.id, 'back'), layers);
  assert.throws(() => reorderPrintDesignLayers([first, first], first.id, 'front'), /PRINT_DESIGN_LAYER_ORDER_ID_DUPLICATE/);
});

test('async rematerialization preserves user z-order, drops removals, and appends new identities', () => {
  const reordered = [{ ...second, displayUrl: 'old-b' }, { ...first, displayUrl: 'old-a' }];
  const third = { id: 'print-design-c', kind: 'design' as const, ready: false, displayUrl: 'raw-c' };
  const materialized = [
    { ...first, displayUrl: 'processed-a' },
    { ...second, displayUrl: 'processed-b' },
    third,
  ];
  const preserved = preservePrintDesignLayerOrder(reordered, materialized);
  assert.deepEqual(preserved.map((layer) => layer.id), [second.id, first.id, third.id]);
  assert.equal(preserved[0], materialized[1]);
  assert.deepEqual(preservePrintDesignLayerOrder(reordered, [materialized[0], third]).map((layer) => layer.id), [first.id, third.id]);
  assert.throws(() => preservePrintDesignLayerOrder([first, first], materialized), /PRINT_DESIGN_LAYER_ORDER_ID_DUPLICATE/);
});

test('active removal falls back only to the latest ready surviving design', () => {
  assert.equal(selectLatestReadyPrintDesignLayerId([
    first,
    { ...second, ready: false },
  ]), first.id);
  assert.equal(selectLatestReadyPrintDesignLayerId([
    { ...first, ready: false },
    { ...second, ready: false },
  ]), null);
});

test('a newly active pending design is not replaced before its layer materializes', () => {
  assert.equal(isPendingPrintDesignLayerMaterialization({
    activeLayerId: second.id,
    pendingLayerId: second.id,
    expectedLayerIds: [first.id, second.id],
    materializedLayerIds: [first.id],
  }), true);
  assert.equal(isPendingPrintDesignLayerMaterialization({
    activeLayerId: second.id,
    pendingLayerId: second.id,
    expectedLayerIds: [first.id, second.id],
    materializedLayerIds: [first.id, second.id],
  }), false);
});

test('a newly added design activates exactly when its cutout becomes ready', () => {
  const waiting = resolvePrintPlacementSelection({
    layers: [garment, first, { id: 'print-design-b', kind: 'design', ready: false }],
    selectedLayerId: first.id,
    pendingLayerId: 'print-design-b',
    pendingLayerExpected: true,
    userClearedSelection: false,
  });
  assert.deepEqual(waiting, { selectedLayerId: first.id, pendingLayerId: 'print-design-b' });

  const ready = resolvePrintPlacementSelection({
    layers: [garment, first, { id: 'print-design-b', kind: 'design', ready: true }],
    selectedLayerId: waiting.selectedLayerId,
    pendingLayerId: waiting.pendingLayerId,
    pendingLayerExpected: true,
    userClearedSelection: false,
  });
  assert.deepEqual(ready, { selectedLayerId: 'print-design-b', pendingLayerId: null });
});

test('unrelated cutout updates never snap an existing selection back to design one', () => {
  assert.deepEqual(resolvePrintPlacementSelection({
    layers: [garment, first, { id: 'print-design-b', kind: 'design', ready: true }],
    selectedLayerId: 'print-design-b',
    pendingLayerId: null,
    pendingLayerExpected: false,
    userClearedSelection: false,
  }), { selectedLayerId: 'print-design-b', pendingLayerId: null });
});

test('removing the selected design falls back to the latest remaining ready design', () => {
  assert.deepEqual(resolvePrintPlacementSelection({
    layers: [garment, first],
    selectedLayerId: 'print-design-b',
    pendingLayerId: null,
    pendingLayerExpected: false,
    userClearedSelection: false,
  }), { selectedLayerId: first.id, pendingLayerId: null });
});

test('removing a selected design retains a processing survivor as pending until it is ready', () => {
  const processing = resolvePrintPlacementSelection({
    layers: [garment, { ...first, ready: false }],
    selectedLayerId: 'print-design-b',
    pendingLayerId: first.id,
    pendingLayerExpected: true,
    userClearedSelection: false,
  });
  assert.deepEqual(processing, { selectedLayerId: garment.id, pendingLayerId: first.id });
  assert.deepEqual(resolvePrintPlacementSelection({
    layers: [garment, first],
    selectedLayerId: processing.selectedLayerId,
    pendingLayerId: processing.pendingLayerId,
    pendingLayerExpected: true,
    userClearedSelection: false,
  }), { selectedLayerId: first.id, pendingLayerId: null });
});

test('explicit deselection is preserved across unrelated layer updates', () => {
  assert.deepEqual(resolvePrintPlacementSelection({
    layers: [garment, first],
    selectedLayerId: null,
    pendingLayerId: null,
    pendingLayerExpected: false,
    userClearedSelection: true,
  }), { selectedLayerId: null, pendingLayerId: null });
});

test('explicit deselection cancels a pending design even if its cutout becomes ready', () => {
  assert.deepEqual(resolvePrintPlacementSelection({
    layers: [garment, first, second],
    selectedLayerId: null,
    pendingLayerId: second.id,
    pendingLayerExpected: true,
    userClearedSelection: true,
  }), { selectedLayerId: null, pendingLayerId: null });
});

test('removing a pending design clears the pending target without changing a valid selection', () => {
  assert.deepEqual(resolvePrintPlacementSelection({
    layers: [garment, first],
    selectedLayerId: first.id,
    pendingLayerId: 'print-design-b',
    pendingLayerExpected: false,
    userClearedSelection: false,
  }), { selectedLayerId: first.id, pendingLayerId: null });
});

test('a newly added pending design survives the render before its layer materializes', () => {
  assert.deepEqual(resolvePrintPlacementSelection({
    layers: [garment, first],
    selectedLayerId: first.id,
    pendingLayerId: 'print-design-b',
    pendingLayerExpected: true,
    userClearedSelection: false,
  }), { selectedLayerId: first.id, pendingLayerId: 'print-design-b' });
});
