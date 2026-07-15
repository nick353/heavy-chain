import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GarmentParserSurfaceValidationError,
  prepareGarmentParserSurfaceProposal,
  type GarmentParserClassDefinition,
} from '../src/features/printing/surface/garmentParserSurfaceAdapter.ts';

const classes: readonly GarmentParserClassDefinition[] = [
  { id: 0, label: 'background', role: 'ignore' },
  { id: 3, label: 'top', role: 'garment' },
  { id: 4, label: 'dress', role: 'garment' },
  { id: 12, label: 'arms', role: 'occluder' },
];

const centeredLabels = (width: number, height: number, classId = 3) => {
  const labels = new Uint8Array(width * height);
  for (let y = 10; y < height - 10; y += 1) {
    for (let x = 12; x < width - 12; x += 1) labels[(y * width) + x] = classId;
  }
  return labels;
};

test('a single semantic garment class creates a bounded semantic surface', () => {
  const width = 120;
  const height = 160;
  const result = prepareGarmentParserSurfaceProposal({ width, height, labels: centeredLabels(width, height), classes });
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.equal(result.selected.label, 'top');
  assert.equal(result.surface.status, 'semantic-ready');
  assert.ok(result.suggestionDiagnostics.printablePixels > 0);
  assert.ok(result.printableAlpha.every((alpha, index) => alpha <= result.garmentAlpha[index]));
});

test('multiple significant garment classes require explicit selection', () => {
  const width = 160;
  const height = 180;
  const labels = centeredLabels(width, height, 3);
  for (let y = 100; y < 165; y += 1) {
    for (let x = 20; x < 140; x += 1) labels[(y * width) + x] = 4;
  }
  const result = prepareGarmentParserSurfaceProposal({ width, height, labels, classes });
  assert.equal(result.kind, 'selection-required');
  if (result.kind === 'selection-required') assert.deepEqual(result.candidates.map((candidate) => candidate.label), ['top', 'dress']);
});

test('preferred class selection is deterministic and preserves occluder plane', () => {
  const width = 160;
  const height = 180;
  const labels = new Uint8Array(width * height);
  for (let y = 15; y < 165; y += 1) {
    for (let x = 15; x < 95; x += 1) labels[(y * width) + x] = 3;
  }
  for (let y = 40; y < 140; y += 1) {
    for (let x = 110; x < 150; x += 1) labels[(y * width) + x] = 4;
  }
  for (let y = 60; y < 90; y += 1) {
    for (let x = 2; x < 8; x += 1) labels[(y * width) + x] = 12;
  }
  const result = prepareGarmentParserSurfaceProposal({ width, height, labels, classes, preferredClassId: 3 });
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.equal(result.selected.classId, 3);
  assert.equal(result.occluderAlpha[(70 * width) + 5], 255);
  assert.equal(result.printableAlpha[(70 * width) + 5], 0);
});

test('separate same-class garments fail through the existing component fallback', () => {
  const width = 180;
  const height = 180;
  const labels = new Uint8Array(width * height);
  for (let y = 30; y < 150; y += 1) {
    for (let x = 15; x < 75; x += 1) labels[(y * width) + x] = 3;
    for (let x = 105; x < 165; x += 1) labels[(y * width) + x] = 3;
  }
  const result = prepareGarmentParserSurfaceProposal({ width, height, labels, classes });
  assert.equal(result.kind, 'fallback-required');
  if (result.kind === 'fallback-required') assert.equal(result.reason, 'SURFACE_MULTIPLE_COMPONENTS');
});

test('frame crop, missing preferred class, and tiny garment fail closed', () => {
  const frame = centeredLabels(100, 120);
  for (let y = 0; y < 120; y += 1) frame[y * 100] = 3;
  const frameResult = prepareGarmentParserSurfaceProposal({ width: 100, height: 120, labels: frame, classes });
  assert.equal(frameResult.kind, 'fallback-required');
  if (frameResult.kind === 'fallback-required') assert.equal(frameResult.reason, 'SURFACE_FRAME_CROPPED');

  const preferred = prepareGarmentParserSurfaceProposal({ width: 100, height: 120, labels: centeredLabels(100, 120), classes, preferredClassId: 4 });
  assert.equal(preferred.kind, 'fallback-required');
  if (preferred.kind === 'fallback-required') assert.equal(preferred.reason, 'PREFERRED_CLASS_NOT_PRESENT');

  const tiny = new Uint8Array(100 * 100);
  tiny[(50 * 100) + 50] = 3;
  const tinyResult = prepareGarmentParserSurfaceProposal({ width: 100, height: 100, labels: tiny, classes });
  assert.equal(tinyResult.kind, 'fallback-required');
  if (tinyResult.kind === 'fallback-required') assert.equal(tinyResult.reason, 'GARMENT_CLASS_TOO_SMALL');
});

test('malformed dimensions, buffers, and schemas are rejected', () => {
  const capture = (run: () => unknown) => assert.throws(run, (error) => error instanceof GarmentParserSurfaceValidationError);
  capture(() => prepareGarmentParserSurfaceProposal({ width: 0, height: 1, labels: new Uint8Array(), classes }));
  capture(() => prepareGarmentParserSurfaceProposal({ width: 4_001, height: 4_001, labels: new Uint8Array(), classes }));
  capture(() => prepareGarmentParserSurfaceProposal({ width: 10, height: 10, labels: new Uint8Array(99), classes }));
  capture(() => prepareGarmentParserSurfaceProposal({ width: 10, height: 10, labels: new Uint8Array(100), classes: [...classes, classes[0]] }));
});

test('undeclared observed labels fail closed instead of bypassing garment or occluder roles', () => {
  const width = 120;
  const height = 160;
  const labels = centeredLabels(width, height);
  labels[(80 * width) + 60] = 99;
  assert.throws(
    () => prepareGarmentParserSurfaceProposal({ width, height, labels, classes }),
    (error) => error instanceof GarmentParserSurfaceValidationError
      && error.code === 'PARSER_SURFACE_UNDECLARED_LABEL',
  );
});
