import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';

import {
  buildManualPrintableSurface,
  ManualPrintableSurfaceValidationError,
} from '../src/features/printing/surface/manualPrintableSurface.ts';

const garment = {
  width: 2,
  height: 2,
  rgba: Uint8Array.from([
    1, 2, 3, 4,
    5, 6, 7, 8,
    9, 10, 11, 12,
    13, 14, 15, 16,
  ]),
};

const editedAlpha = Uint8Array.from([200, 0, 255, 9]);

test('manual printable surface builds manual-ready identity and white-alpha content plane', async () => {
  const surface = await buildManualPrintableSurface({
    garment,
    editedAlpha,
    manualRevision: 7,
    crypto: { createHash },
  });

  assert.equal(surface.provenance, 'manual-printable-area');
  assert.equal(surface.identity.status, 'manual-ready');
  assert.equal(surface.identity.version, 'garment-surface-map-v1');
  assert.equal(surface.identity.manualRevision, 7);
  assert.equal(surface.identity.sourceHash, 'sha256:a1eb65130100bf4ef2b2e5ad703bbf1b8b588b68dda4326c5f17e4e7543c7df3');
  assert.equal(surface.identity.contentHash, 'sha256:8e941c2af64bc2b12236a9a892b3e747edae963339db570de0fad2b64452d275');
  assert.equal(surface.plane.version, 'png-alpha-v1');
  assert.deepEqual([...surface.plane.rgba], [
    255, 255, 255, 4,
    255, 255, 255, 0,
    255, 255, 255, 12,
    255, 255, 255, 9,
  ]);
});

test('manual printable surface accepts webcrypto-style digest injection', async () => {
  const surface = await buildManualPrintableSurface({
    garment,
    editedAlpha,
    manualRevision: 1,
    crypto: { subtle: webcrypto.subtle },
  });

  assert.equal(surface.identity.sourceHash, 'sha256:a1eb65130100bf4ef2b2e5ad703bbf1b8b588b68dda4326c5f17e4e7543c7df3');
  assert.equal(surface.identity.contentHash, 'sha256:8e941c2af64bc2b12236a9a892b3e747edae963339db570de0fad2b64452d275');
});

test('manual printable surface rejects malformed dimensions, rgba length, and alpha length', async () => {
  await assert.rejects(
    () => buildManualPrintableSurface({
      garment: { width: 0, height: 2, rgba: new Uint8Array(0) },
      editedAlpha: new Uint8Array(0),
      manualRevision: 0,
      crypto: { createHash },
    }),
    (error) => error instanceof ManualPrintableSurfaceValidationError
      && error.code === 'MANUAL_PRINTABLE_SURFACE_DIMENSION_INVALID',
  );

  await assert.rejects(
    () => buildManualPrintableSurface({
      garment: { width: 2, height: 2, rgba: Uint8Array.from([1, 2, 3, 4]) },
      editedAlpha,
      manualRevision: 0,
      crypto: { createHash },
    }),
    (error) => error instanceof ManualPrintableSurfaceValidationError
      && error.code === 'MANUAL_PRINTABLE_SURFACE_RGBA_LENGTH_INVALID',
  );

  await assert.rejects(
    () => buildManualPrintableSurface({
      garment,
      editedAlpha: Uint8Array.from([1, 2, 3]),
      manualRevision: 0,
      crypto: { createHash },
    }),
    (error) => error instanceof ManualPrintableSurfaceValidationError
      && error.code === 'MANUAL_PRINTABLE_SURFACE_ALPHA_LENGTH_INVALID',
  );
});

test('manual printable surface rejects over-budget pixel dimensions', async () => {
  await assert.rejects(
    () => buildManualPrintableSurface({
      garment: { width: 4_001, height: 4_000, rgba: new Uint8Array(0) },
      editedAlpha: new Uint8Array(0),
      manualRevision: 0,
      crypto: { createHash },
    }),
    (error) => error instanceof ManualPrintableSurfaceValidationError
      && error.code === 'MANUAL_PRINTABLE_SURFACE_PIXEL_LIMIT_EXCEEDED',
  );
});
