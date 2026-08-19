import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Canvas generation waits for image placement before reporting success', async () => {
  const source = await readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /const addImageToCanvasSafely = useCallback\(async/);
  assert.match(source, /await addImageToCanvas\(imageUrl, label, metadata, parentId\);\s*return true;/);
  assert.match(source, /catch \(error: any\)[\s\S]*return false;/);
  assert.match(source, /let canvasGenerationResultCount = 0;/);
  assert.match(source, /canvasGenerationResultCount = \(await Promise\.all\(/);
  assert.match(source, /\.filter\(Boolean\)\.length/);
  assert.match(source, /canvas_generation_no_results/);
});

test('Canvas persistence promotes provider storage paths nested in generation parameters', async () => {
  const source = await readFile(new URL('../src/lib/canvasDocumentPersistence.ts', import.meta.url), 'utf8');

  assert.match(source, /const parameters = metadata\?\.parameters && typeof metadata\.parameters === 'object'/);
  assert.match(source, /parameters\.remoteStoragePath/);
  assert.match(source, /parameters\.sourceStoragePath/);
  assert.match(source, /const storagePath = \[/);
  assert.match(source, /if \(storagePath\) return storagePath;/);
});

test('Generate-to-Canvas handoff reports only actually placed results', async () => {
  const source = await readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8');
  const handoffStart = source.indexOf('const raw = window.sessionStorage.getItem(GENERATED_CANVAS_HANDOFF_KEY)');
  const handlerEnd = source.indexOf('const handleGenerate = async () => {', handoffStart);
  assert.ok(handoffStart >= 0 && handlerEnd > handoffStart);

  const handoff = source.slice(handoffStart, handlerEnd);
  assert.match(handoff, /Promise\.all\(entries\.map\(/);
  assert.match(handoff, /const succeeded = results\.filter\(Boolean\)\.length/);
  assert.match(handoff, /\$\{succeeded\}件の生成結果をCanvasへ配置しました/);
  assert.match(handoff, /\$\{entries\.length - succeeded\}件の生成結果をCanvasへ配置できませんでした/);
  assert.doesNotMatch(handoff, /toast\.success\(`\$\{images\.length\}件の生成結果をCanvasへ配置しました`\)/);
});

test('Canvas derived actions await placement and report partial batches', async () => {
  const source = await readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8');
  const actionStart = source.indexOf('const handleContextAction = async');
  const actionEnd = source.indexOf('\n  // Keep compatibility with FloatingToolbar actions', actionStart);
  assert.ok(actionStart >= 0 && actionEnd > actionStart);
  const actions = source.slice(actionStart, actionEnd);
  assert.match(actions, /const placed = await addImageToCanvasSafely\(data\.resultUrl, '背景削除'/);
  assert.match(actions, /const placed = await addImageToCanvasSafely\(data\.resultUrl, '高解像度'/);
  assert.match(actions, /const placement = await placeDerivedImages\(data\.variations\.map/);
  assert.match(actions, /placement\.succeeded === 0/);
  assert.match(actions, /placement\.succeeded < placement\.total/);

  const modalStart = source.indexOf('const handleEditModalAction = async');
  const modalEnd = source.indexOf('\n  const renderGenerateForm = () => {', modalStart);
  assert.ok(modalStart >= 0 && modalEnd > modalStart);
  const modal = source.slice(modalStart, modalEnd);
  assert.match(modal, /const placed = await addImageToCanvasSafely\(result\.imageUrl, '編集結果'/);
  assert.match(modal, /const placed = await addImageToCanvasSafely\(data\.resultUrl, '背景削除'/);
  assert.match(modal, /const placement = await placeDerivedImages\(\(data\?\.variations \?\? \[\]\)\.map/);
  assert.match(modal, /canvas_derived_result_placement_failed/);
});

test('Gallery Canvas imports do not bypass readable blob-first image loading', async () => {
  const [page, canvas] = await Promise.all([
    readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/canvas/InfiniteCanvas.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(page, /const isGalleryImport = metadata\?\.source === 'gallery-selector';[\s\S]*?const usablePreloadedImage = isGalleryImport\s*\n\s*\? null/);
  assert.match(page, /GallerySelector's <img>[\s\S]*?blob-first loader/);
  assert.match(canvas, /obj\.metadata\?\.source === 'gallery-selector'[\s\S]*?\? undefined/);
  assert.match(canvas, /Gallery imports[\s\S]*?blob-first loader/);
  assert.match(canvas, /const loadViaBlob = async \(\) =>/);
  assert.match(canvas, /A successful direct cross-origin load can still taint[\s\S]*?return await loadViaBlob\(\);/);
});
