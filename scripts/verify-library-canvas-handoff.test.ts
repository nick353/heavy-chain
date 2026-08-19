import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const parityPages = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const canvasPage = await readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8');

test('library persisted artifacts can be routed to Canvas with source identity', () => {
  assert.match(parityPages, /listWorkspaceArtifacts\(currentBrand\.id, user\?\.id\)/);
  assert.match(parityPages, /sourceArtifactId=\$\{encodeURIComponent\(asset\.id\)\}/);
  assert.match(canvasPage, /searchParams\.get\('sourceArtifactId'\)/);
  assert.match(canvasPage, /getWorkspaceArtifactCanonicalStoragePath\(artifact\.metadata\)/);
  assert.match(canvasPage, /feature: 'library-import'/);
  assert.match(canvasPage, /sourceArtifactId: artifact\.id/);
  assert.match(canvasPage, /toast\.success\('ライブラリー素材をCanvasへ追加しました'\)/);
});
