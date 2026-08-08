import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const pagePath = new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url);
const propertiesPath = new URL('../src/components/canvas/PropertiesPanel.tsx', import.meta.url);
const storePath = new URL('../src/stores/canvasStore.ts', import.meta.url);

const [page, properties, store] = await Promise.all([
  readFile(pagePath, 'utf8'),
  readFile(propertiesPath, 'utf8'),
  readFile(storePath, 'utf8'),
]);

test('local upload selects the new image and restores the visible canvas viewport', () => {
  const processStart = page.indexOf('const processLocalUploadFiles');
  const handlerStart = page.indexOf('const handleFileUpload');
  const uploadEnd = page.indexOf('const loadCanvasImage', handlerStart);
  assert.ok(processStart >= 0 && handlerStart >= 0 && uploadEnd > handlerStart, 'local upload handler must exist');
  const upload = page.slice(processStart, uploadEnd);

  assert.match(upload, /const newId = addObject\(/);
  assert.match(upload, /selectObject\(newId\)/);
  assert.match(upload, /setViewMode\('canvas'\)/);
  assert.match(upload, /setZoom\(1\)/);
  assert.match(upload, /setPan\(0, 0\)/);
  assert.match(page, /input\.value = ''/);
  assert.match(upload, /setLocalUploadState\(\{ status: 'loading'/);
  assert.match(upload, /setLocalUploadState\(\{\s*status: 'ready'/);
  assert.match(upload, /handleObjectSelect\(newId\)/);
  assert.match(page, /const readLocalUploadFile = async/);
  assert.match(page, /Promise\.any\(\[fromArrayBuffer, fromFileReader\]\)/);
  assert.match(page, /LOCAL_UPLOAD_READ_TIMEOUT_MS/);
  assert.match(upload, /new Blob\(\[bytes\], \{ type: file\.type \}\)/);
  assert.match(upload, /画像の読み込みに失敗しました。もう一度お試しください/);
  assert.match(page, /canvas_upload_image_timeout/);
  assert.match(page, /onInputCapture=\{handleFileUpload\}/);
  assert.match(page, /onChangeCapture=\{handleFileUpload\}/);
  assert.match(upload, /localUploadEventKeysRef\.current\.has\(eventKey\)/);
  assert.match(upload, /const \{ bytes, dataUrl: source \} = await readLocalUploadFile\(file\)/);
  assert.match(upload, /src: source,/);
  assert.match(page, /ref=\{localUploadInputRef\}/);
  assert.match(page, /window\.setInterval\(\(\) => \{/);
  assert.match(page, /const files = Array\.from\(input\.files \?\? \[\]\)/);
  assert.match(page, /processLocalUploadFiles\(files\)/);
  assert.match(page, /data-testid="canvas-local-upload-readback"/);
  assert.match(page, /data-status=\{localUploadState\.status\}/);
  assert.match(page, /data-source-revision=\{localUploadState\.sourceRevision \?\? ''\}/);
  assert.match(page, /data-error-code=\{localUploadState\.errorCode \?\? ''\}/);
});
test('local upload data URLs stay in the active canvas session without filling localStorage', () => {
  assert.match(store, /obj\.metadata\?\.feature === 'local-upload'/);
  assert.match(store, /obj\.metadata\?\.sourceIdentity\?\.kind === 'local-upload'/);
  assert.match(store, /const stripPersistedDataUrls = \(value: unknown\)/);
  assert.match(store, /value\.startsWith\('data:'\) \? '' : value/);
  assert.match(store, /const sanitizePersistedObjects = \(objects: CanvasObject\[\]\)/);
  assert.match(store, /projects: state\.projects\.map\(sanitizePersistedProject\)/);
  assert.match(store, /objects: sanitizePersistedObjects\(state\.objects\)/);
  assert.match(store, /Strip every data URL from the persisted snapshot/);
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
