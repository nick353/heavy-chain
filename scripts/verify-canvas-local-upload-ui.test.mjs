import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const pagePath = new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url);
const propertiesPath = new URL('../src/components/canvas/PropertiesPanel.tsx', import.meta.url);

const [page, properties] = await Promise.all([
  readFile(pagePath, 'utf8'),
  readFile(propertiesPath, 'utf8'),
]);

test('local upload selects the new image and restores the visible canvas viewport', () => {
  const uploadStart = page.indexOf('const handleFileUpload');
  const uploadEnd = page.indexOf('const loadCanvasImage', uploadStart);
  assert.ok(uploadStart >= 0 && uploadEnd > uploadStart, 'local upload handler must exist');
  const upload = page.slice(uploadStart, uploadEnd);

  assert.match(upload, /const newId = addObject\(/);
  assert.match(upload, /selectObject\(newId\)/);
  assert.match(upload, /setViewMode\('canvas'\)/);
  assert.match(upload, /setZoom\(1\)/);
  assert.match(upload, /setPan\(0, 0\)/);
  assert.match(upload, /e\.currentTarget\.value = ''/);
});
test('empty canvas no longer exposes the explicit guide or empty properties panel', () => {
  assert.doesNotMatch(page, /title="キャンバスガイドを開く"/);
  assert.doesNotMatch(page, /onClick=\{resetGuide\}/);
  assert.match(page, /const \[sidePanel, setSidePanel\] = useState<SidePanel>\(null\)/);
  assert.match(page, /\{selectedObject && \(\s*<button[\s\S]*?title="プロパティ"/);
  assert.match(properties, /if \(!selectedObject\) \{\s*return null;/);
  assert.match(properties, /<h3 className="font-semibold text-neutral-800">プロパティ<\/h3>/);
});

test('rights confirmation remains available without the oversized empty-canvas card', () => {
  assert.match(page, /UPLOAD_RIGHTS_CONFIRMATION_LABEL/);
  assert.match(page, /className="mt-2 flex min-w-0 items-center gap-2/);
  assert.match(page, /const \[rightsConfirmed, setRightsConfirmed\] = useState\(false\)/);
  assert.match(page, /legalSafety: \{ rightsConfirmed \}/);
  assert.match(page, /if \(!rightsConfirmed\)/);
  assert.match(page, /GENERATION_LEGAL_COPY/);
});
