import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCanvasProjectIdKind } from '../src/lib/canvasSaveDiagnostic.ts';

test('classifies canonical, uppercase, legacy, and missing Canvas project IDs', () => {
  assert.equal(classifyCanvasProjectIdKind('123e4567-e89b-12d3-a456-426614174000'), 'canonical-uuid');
  assert.equal(classifyCanvasProjectIdKind('123E4567-E89B-12D3-A456-426614174000'), 'canonical-uuid');
  assert.equal(classifyCanvasProjectIdKind('legacy-project-id'), 'legacy');
  assert.equal(classifyCanvasProjectIdKind(null), 'none');
});
