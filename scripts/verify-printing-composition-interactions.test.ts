import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createPrintingTransformHistory,
  getStageDragPosition,
  hasPrintingTransformHistoryStep,
  isOwnedPointerEvent,
  prunePrintingTransformHistory,
  reconcilePrintingLayersAfterDrag,
  recordPrintingTransformHistory,
  stepPrintingTransformHistory,
  togglePrintingFlip,
} from '../src/lib/printingStageGeometry.ts';
import {
  canConfirmPlacementEdit,
  createPlacementEditBaseline,
  restorePlacementEditBaseline,
} from '../src/features/printing/selection/placementEditSession.ts';
import {
  getGalleryPendingImageUrl,
  resolveGalleryPendingSelection,
} from '../src/features/printing/selection/galleryPendingSelection.ts';
import {
  createGalleryFolderNavigation,
  getGalleryFolderImageIds,
  getGalleryFolderPath,
} from '../src/features/printing/selection/galleryFolderNavigation.ts';

const source = fs.readFileSync('src/components/workspace/PrintingCompositionStage.tsx', 'utf8');
const page = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');
const galleryPage = fs.readFileSync('src/pages/GalleryPage.tsx', 'utf8');
const materialReferences = fs.readFileSync('src/lib/workspaceMaterialReferences.ts', 'utf8');
const imageSelector = fs.readFileSync('src/components/ImageSelector.tsx', 'utf8');
const gallerySelector = fs.readFileSync('src/components/GallerySelector.tsx', 'utf8');
const layout = fs.readFileSync('src/components/layout/Layout.tsx', 'utf8');

test('placement edit cancellation restores surviving transforms and order without reviving removed layers', () => {
  const baseline = createPlacementEditBaseline([
    { id: 'a', transform: { x: 10 } },
    { id: 'b', transform: { x: 20 } },
  ]);
  const restored = restorePlacementEditBaseline({
    baseline,
    currentLayers: [
      { id: 'b', transform: { x: 80 }, displayUrl: 'b-new' },
      { id: 'c', transform: { x: 30 }, displayUrl: 'c' },
    ],
  });

  assert.deepEqual(restored, [
    { id: 'b', transform: { x: 20 }, displayUrl: 'b-new' },
    { id: 'c', transform: { x: 30 }, displayUrl: 'c' },
  ]);
});

test('confirmed single Gallery selection resolves only one live image with a usable URL', () => {
  const images = [
    { id: 'first', image_url: ' https://signed.example/first.png ', storage_path: 'first.png' },
    { id: 'data', image_url: null, storage_path: ' data:image/png;base64,AAAA ' },
    { id: 'blank', image_url: '   ', storage_path: 'relative/blank.png' },
  ];

  assert.equal(getGalleryPendingImageUrl(images[0]), 'https://signed.example/first.png');
  assert.equal(getGalleryPendingImageUrl(images[1]), 'data:image/png;base64,AAAA');
  assert.equal(resolveGalleryPendingSelection(images, ' first ')?.image.id, 'first');
  assert.equal(resolveGalleryPendingSelection(images, 'missing'), null);
  assert.equal(resolveGalleryPendingSelection(images, 'blank'), null);
  assert.equal(resolveGalleryPendingSelection(images, '   '), null);
});

test('printing garment Gallery requires an explicit pending selection commit', () => {
  assert.match(page, /galleryTitle="参考画像を選択"\s+confirmGallerySelection\s+galleryConfirmLabel="素材を追加"/);
  assert.match(imageSelector, /confirmedSingle=\{confirmGallerySelection\}/);
  assert.match(gallerySelector, /else if \(confirmedSingle\) \{\s*setSelectedImages\(new Set\(\[image\.id\]\)\);/);
  assert.match(gallerySelector, /aria-pressed=\{multiple \|\| confirmedSingle \? isSelected : undefined\}/);
  assert.match(gallerySelector, /const handleFilterChange = \(nextFilter: FilterType\) => \{\s*if \(nextFilter === filter\) return;\s*fetchRequestRevisionRef\.current \+= 1;\s*setSelectedImages\(new Set\(\)\);[\s\S]*setLoadedBrandId\(null\);[\s\S]*setFilter\(nextFilter\);/);
  assert.match(gallerySelector, /const requestRevision = fetchRequestRevisionRef\.current \+ 1;/);
  assert.match(gallerySelector, /if \(requestRevision !== fetchRequestRevisionRef\.current\) return;/);
  assert.match(gallerySelector, /if \(requestRevision === fetchRequestRevisionRef\.current\) \{\s*setIsLoading\(false\);/);
  assert.match(gallerySelector, /const handleConfirmSingle = \(\) => \{\s*if \(displayLoading \|\| !pendingSingleSelection \|\| singleCommitInFlightRef\.current\) return;\s*singleCommitInFlightRef\.current = true;/);
  assert.match(gallerySelector, /onSelect\(imageUrl, image\.id, image\.storage_path, null\);\s*handleClose\(\);/);
  assert.match(gallerySelector, /disabled=\{displayLoading \|\| !pendingSingleSelection\}/);
  assert.match(gallerySelector, /\{confirmLabel\}/);

  const clickBranch = gallerySelector.slice(
    gallerySelector.indexOf('const handleImageClick'),
    gallerySelector.indexOf('const pendingSingleSelection'),
  );
  const confirmedSingleBranch = clickBranch.slice(clickBranch.indexOf('else if (confirmedSingle)'));
  assert.ok(
    confirmedSingleBranch.indexOf('setSelectedImages') < confirmedSingleBranch.indexOf('onSelect'),
    'confirmed single click must only stage selection before the legacy immediate branch',
  );
  const legacyImmediateBranch = confirmedSingleBranch.slice(confirmedSingleBranch.indexOf('} else {'));
  assert.doesNotMatch(legacyImmediateBranch, /handleClose\(\)/);
  assert.match(gallerySelector, /fetchRequestRevisionRef\.current \+= 1;\s*singleCommitInFlightRef\.current = false;\s*setSelectedImages\(new Set\(\)\);/);
});

test('Gallery folder navigation validates a rooted acyclic tree and resolves breadcrumbs', () => {
  const folders = [
    { id: 'root-b', name: 'Beta', parent_folder_id: null },
    { id: 'root-a', name: 'Alpha', parent_folder_id: null },
    { id: 'child', name: 'Child', parent_folder_id: 'root-a' },
  ];
  const navigation = createGalleryFolderNavigation(folders);
  assert.deepEqual(navigation.childrenByParentId.get(null)?.map((folder) => folder.id), ['root-a', 'root-b']);
  assert.deepEqual(getGalleryFolderPath(navigation, 'child')?.map((folder) => folder.id), ['root-a', 'child']);
  assert.equal(getGalleryFolderPath(navigation, 'missing'), null);
  assert.throws(
    () => createGalleryFolderNavigation([...folders, folders[0]]),
    /gallery_folder_duplicate:root-b/,
  );
  assert.throws(
    () => createGalleryFolderNavigation([{ id: 'orphan', name: 'Orphan', parent_folder_id: 'missing' }]),
    /gallery_folder_parent_missing:orphan/,
  );
  assert.throws(
    () => createGalleryFolderNavigation([
      { id: 'a', name: 'A', parent_folder_id: 'b' },
      { id: 'b', name: 'B', parent_folder_id: 'a' },
    ]),
    /gallery_folder_cycle:/,
  );
});

test('Gallery folder membership filters only the selected direct folder', () => {
  const memberships = [
    { folder_id: 'folder-a', image_id: 'image-1' },
    { folder_id: 'folder-a', image_id: ' image-2 ' },
    { folder_id: 'folder-b', image_id: 'image-3' },
  ];
  assert.equal(getGalleryFolderImageIds(memberships, null), null);
  assert.deepEqual([...getGalleryFolderImageIds(memberships, 'folder-a')!], ['image-1', 'image-2']);
  assert.deepEqual([...getGalleryFolderImageIds(memberships, 'empty')!], []);
});

test('Gallery folder UI is brand-scoped, read-only, pending-safe, and request-revision guarded', () => {
  assert.match(gallerySelector, /\.from\('folders'\)\s*\.select\('\*'\)\s*\.eq\('brand_id', currentBrand\.id\)/);
  assert.match(gallerySelector, /\.from\('image_folders'\)\s*\.select\('image_id,folder_id'\)\s*\.in\('folder_id', folderIds\)/);
  assert.match(gallerySelector, /data-testid="gallery-folder-breadcrumb"/);
  assert.match(gallerySelector, /data-testid="gallery-folder-grid"/);
  assert.match(gallerySelector, /const handleFolderChange = \(folderId: string \| null\) => \{\s*if \(getGalleryFolderPath\(folderNavigation, folderId\) == null\) return;\s*setSelectedImages\(new Set\(\)\);/);
  assert.match(gallerySelector, /if \(currentFolderImageIds && !currentFolderImageIds\.has\(image\.id\)\) return false;/);
  assert.match(gallerySelector, /if \(requestRevision !== fetchRequestRevisionRef\.current\) return;/);
  assert.match(gallerySelector, /setLoadError\('ギャラリーを読み込めませんでした。時間をおいて再度お試しください。'\)/);
  assert.match(gallerySelector, /const hasCurrentBrandData = Boolean\(currentBrand && loadedBrandId === currentBrand\.id\);/);
  assert.match(gallerySelector, /const visibleImages = hasCurrentBrandData \? images : \[\];/);
  assert.match(gallerySelector, /const handleClose = useCallback\(\(\) => \{\s*clearGalleryState\(\);\s*onClose\(\);/);
  assert.match(gallerySelector, /currentFolderId && filter === 'favorites'[\s\S]*このフォルダにお気に入り画像はありません[\s\S]*このフォルダに画像はありません/);
  assert.doesNotMatch(gallerySelector, /supabase\s*\.from\([^)]*\)[\s\S]{0,200}\.(?:insert|update|delete)\(/);
});

test('Gallery loading preserves a fixed progressive grid without enabling selection early', () => {
  assert.match(gallerySelector, /const GALLERY_SKELETON_TILE_COUNT = 12;/);
  assert.match(gallerySelector, /aria-busy=\{displayLoading\}/);
  assert.match(gallerySelector, /data-testid="gallery-loading-grid"/);
  assert.match(gallerySelector, /className="grid grid-cols-4 gap-3"/);
  assert.match(gallerySelector, /motion-reduce:animate-none/);
  assert.doesNotMatch(gallerySelector, /<div className="spinner" \/>/);
  assert.match(gallerySelector, /data-testid="gallery-image-skeleton"/);
  assert.match(gallerySelector, /data-testid="gallery-image-identity"/);
  assert.match(gallerySelector, /\{imageLabel\}/);
  assert.match(gallerySelector, /onLoad=\{\(\) => handleImageLoad\(image\.id\)\}/);
  assert.match(gallerySelector, /onError=\{\(\) => handleImageError\(image\.id\)\}/);
  assert.match(gallerySelector, /disabled=\{!isImageLoaded \|\| hasImageLoadFailed\}/);
  assert.match(gallerySelector, /setSelectedImages\(\(current\) => \{\s*if \(!current\.has\(imageId\)\) return current;/);
  assert.match(gallerySelector, /loadedImageIds\.has\(pendingSingleSelectionCandidate\.image\.id\)/);
  assert.match(gallerySelector, /!failedImageIds\.has\(pendingSingleSelectionCandidate\.image\.id\)/);
  assert.match(gallerySelector, /画像を表示できません/);
  assert.match(gallerySelector, /disabled=\{displayLoading \|\| !pendingSingleSelection\}/);
});

test('print result cards expose visible exact and fabric identities over each image', () => {
  assert.match(page, /data-testid=\{`print-result-mode-\$\{result\.resultKind\}`\}/);
  assert.match(page, /eyebrow: 'EXACT', label: '配置そのまま'/);
  assert.match(page, /eyebrow: 'FABRIC', label: '布になじませる'/);
});

test('placement session fails closed on duplicate layer identities', () => {
  assert.throws(
    () => createPlacementEditBaseline([
      { id: 'duplicate', transform: { x: 1 } },
      { id: 'duplicate', transform: { x: 2 } },
    ]),
    /duplicate_current_placement_layer_id:duplicate/,
  );
});

test('placement can be decided only after every visible artwork layer is fully ready', () => {
  const ready = { cutoutState: 'done' as const, originalUrl: 'processed.png', displayUrl: 'processed.png' };
  assert.equal(canConfirmPlacementEdit({ garmentMaskConfirmed: true, layers: [ready] }), true);
  assert.equal(canConfirmPlacementEdit({ garmentMaskConfirmed: false, layers: [ready] }), false);
  assert.equal(canConfirmPlacementEdit({ garmentMaskConfirmed: true, layers: [] }), false);
  assert.equal(canConfirmPlacementEdit({
    garmentMaskConfirmed: true,
    layers: [{ ...ready, cutoutState: 'processing' }],
  }), false);
  assert.equal(canConfirmPlacementEdit({
    garmentMaskConfirmed: true,
    layers: [{ ...ready, cutoutState: 'error' }],
  }), false);
  assert.equal(canConfirmPlacementEdit({
    garmentMaskConfirmed: true,
    layers: [{ ...ready, originalUrl: '' }],
  }), false);
  assert.equal(canConfirmPlacementEdit({
    garmentMaskConfirmed: true,
    layers: [ready, { ...ready, displayUrl: '' }],
  }), false);
});

test('focused placement requires an explicit decision before generation and supports reopening', () => {
  assert.match(page, /data-testid="cancel-print-placement"/);
  assert.match(page, /data-testid="confirm-print-placement"/);
  assert.match(page, /data-testid="confirmed-print-placement-summary"/);
  assert.match(page, /data-testid="reopen-print-placement"/);
  assert.match(page, /デザイン配置を「決定」してから生成してください/);
  assert.match(page, /&& !printPlacementSessionOpen/);
  assert.match(page, /&& printPlacementConfirmed/);
  assert.match(page, /disabled=\{!canConfirmPrintPlacement\}/);
  assert.match(page, /if \(!canConfirmPrintPlacement\) \{\s*toast\.error\(printPlacementConfirmationStatus\);/);
  assert.match(page, /id="print-placement-confirmation-status"\s*role="status"/);
  assert.match(page, /key=\{`print-placement-\$\{printPlacementSessionRevision\}`\}/);
  assert.match(page, /beginPrintPlacementSessionEdit\(\);\s*setPrintDesignLayers/);

  const confirmStart = page.indexOf('const confirmPrintPlacementSession');
  const cancelStart = page.indexOf('const cancelPrintPlacementSession');
  const generateStart = page.indexOf('const handleGenerate');
  const confirmBlock = page.slice(confirmStart, cancelStart);
  const cancelBlock = page.slice(cancelStart, generateStart);
  assert.match(confirmBlock, /setPrintPlacementConfirmed\(true\)/);
  assert.doesNotMatch(cancelBlock, /setPrintPlacementConfirmed\(true\)/);
});

test('a delayed design return cannot erase an already-open placement baseline', () => {
  const openStart = page.indexOf('const openPrintPlacementSession');
  const editStart = page.indexOf('const beginPrintPlacementSessionEdit');
  const openBlock = page.slice(openStart, editStart);
  const guardIndex = openBlock.indexOf('if (printPlacementSessionOpenRef.current)');
  const resetIndex = openBlock.indexOf('printPlacementBaselineRef.current = null');
  assert.ok(guardIndex >= 0, 'open placement must guard an already-open editor');
  assert.ok(resetIndex > guardIndex, 'the already-open guard must return before clearing the baseline');
  assert.match(openBlock.slice(guardIndex, resetIndex), /return;/);
});

test('confirmed composition remains visible in the control rail and reopens the same placement session', () => {
  assert.match(page, /data-testid="confirmed-print-composition-preview"/);
  assert.match(page, /data-testid="edit-confirmed-print-composition"/);
  assert.match(page, /onClick=\{openPrintPlacementSession\}/);
  assert.match(page, /interactive=\{false\}/);
  assert.match(page, /layers=\{stageLayers as Array/);
  assert.match(page, /designClipMaskUrl=\{printableSurfaceEnabled \? printableSurfaceStageMaskUrl : null\}/);
  assert.match(page, /invalidatePrintableSuggestion\(\);\s*setPrintPlacementConfirmed\(false\);\s*if \(placedPrintDesignLayers\.length > 0\) openPrintPlacementSession\(\);/);
});

test('read-only composition keeps artwork but omits every placement mutator and edit overlay', () => {
  assert.match(source, /interactive = true/);
  assert.match(source, /interactive\?: boolean/);
  assert.match(source, /\{interactive && <div\s+data-printing-design-thumbnail-rail/);
  assert.match(source, /\{interactive && <div\s+data-printing-transform-history-controls/);
  assert.match(source, /\{interactive && layerOrderMenuOpen/);
  assert.match(source, /\{interactive && <div data-printing-editing-chrome/);

  const artworkStart = source.indexOf('data-printing-artwork-clip');
  const editingStart = source.indexOf('data-printing-editing-chrome');
  assert.ok(artworkStart >= 0 && editingStart > artworkStart, 'artwork must remain outside the interactive-only editing chrome');
});

test('desktop printing keeps the primary composition and generate action pinned beside scrolling history', () => {
  assert.match(page, /className=\{`\$\{isPrinting \? 'max-w-\[1600px\]' : 'max-w-7xl'\} mx-auto/);
  assert.match(page, /className=\{`grid gap-6 \$\{isPrinting\s+\? 'xl:grid-cols-\[360px_minmax\(0,1fr\)\]'\s+: 'xl:grid-cols-\[420px_1fr\]'\}`\}/);
  assert.match(page, /data-testid=\{isPrinting \? 'printing-control-rail' : undefined\}/);
  assert.match(page, /xl:sticky xl:top-\[86px\] xl:flex xl:max-h-\[calc\(100dvh-102px\)\] xl:self-start xl:flex-col xl:overflow-hidden/);
  assert.match(layout, /overflow-x-clip/);
  assert.doesNotMatch(layout, /overflow-x-hidden/);
  assert.match(page, /data-testid=\{isPrinting \? 'printing-control-rail-details' : undefined\}/);
  assert.match(page, /xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain/);
  assert.match(page, /aria-label=\{isPrinting \? 'プリント素材と詳細設定' : undefined\}/);
  assert.match(page, /data-testid=\{isPrinting \? 'printing-control-rail-primary' : undefined\}/);
  assert.match(page, /className="space-y-5 xl:shrink-0"/);
  assert.match(page, /data-testid="confirmed-print-composition-canvas"/);
  assert.match(page, /maxWidth: 'clamp\(96px, calc\(\(100dvh - 520px\) \* 0\.8\), 220px\)'/);

  const outerLayout = page.indexOf("isPrinting ? 'max-w-[1600px]' : 'max-w-7xl'");
  const desktopGrid = page.indexOf("? 'xl:grid-cols-[360px_minmax(0,1fr)]'");
  const details = page.indexOf("'printing-control-rail-details'");
  const primary = page.indexOf("'printing-control-rail-primary'");
  const outputResolution = page.indexOf('aria-label="プリント結果の出力解像度"');
  const preview = page.indexOf('data-testid="confirmed-print-composition-preview"');
  const generate = page.indexOf('onClick={handleGenerate}');
  const results = page.indexOf('data-testid="print-result-run-history"');
  assert.ok(outerLayout >= 0 && desktopGrid > outerLayout, 'print-only width and grid must wrap the existing rail and workspace ordering');
  assert.ok(details >= 0 && primary > details, 'primary controls must follow the internally scrollable details');
  assert.ok(outputResolution > details && outputResolution < primary, 'output settings must stay in the internally scrollable details');
  assert.ok(preview > primary && generate > preview, 'confirmed composition and Generate must remain in the pinned primary region');
  assert.ok(results > generate, 'result history must remain in the adjacent content column');

  const previewWidthForViewport = (height: number) => Math.min(220, Math.max(96, (height - 520) * 0.8));
  assert.equal(previewWidthForViewport(900), 220);
  assert.equal(previewWidthForViewport(768), 198.4);
  assert.equal(previewWidthForViewport(650), 104);
  assert.equal(previewWidthForViewport(600), 96);
});

test('only artwork is inside the garment clip while editing chrome remains an unclipped sibling', () => {
  const artworkClip = source.indexOf('data-printing-artwork-clip');
  const artworkLayer = source.indexOf('data-printing-artwork-layer');
  const editingChrome = source.indexOf('data-printing-editing-chrome');
  const layerControls = source.indexOf('data-printing-layer-controls');

  assert.ok(artworkClip >= 0, 'artwork clip container must be present');
  assert.ok(artworkLayer > artworkClip, 'artwork must render inside the clipped container');
  assert.ok(editingChrome > artworkLayer, 'editing chrome must render after the clipped artwork container');
  assert.ok(layerControls > editingChrome, 'selection controls must render inside the unclipped editing overlay');

  const maskStyleOccurrences = source.match(/getFrameMaskStyle\(designClipMaskUrl \?\? garmentMaskUrl/g) ?? [];
  assert.equal(maskStyleOccurrences.length, 1, 'the design clip mask must only be applied to the artwork container');
});

test('artwork and editing chrome share the exact layer frame transform contract', () => {
  const frameStyleOccurrences = source.match(/getLayerFrameStyle\(size, layer\.transform\)/g) ?? [];
  assert.equal(frameStyleOccurrences.length, 2, 'artwork and chrome must use the same frame style calculation');
  assert.match(source, /rotate\(\$\{transform\.rotation\}deg\)/);
  assert.match(source, /designBoxSize\(size, transform\.scale\)/);
});

test('move, resize, rotate, and pointer-up commit contracts remain wired', () => {
  assert.match(source, /aria-label=\{`\$\{layer\.label\}を選択・移動`\}/);
  assert.match(source, /beginDrag\(layer, 'move', event\)/);
  assert.ok((source.match(/beginDrag\(layer, 'resize', event\)/g) ?? []).length >= 4);
  assert.match(source, /beginDrag\(layer, 'rotate', event\)/);
  assert.match(source, /window\.addEventListener\('pointerup', onUp\)/);
  assert.match(source, /window\.addEventListener\('pointercancel', onCancel\)/);
  assert.match(source, /onCommitLayer\(\{ id: reconciledLayer\.id, transform \}\)/);
});

test('move preserves the exact grab offset and applies pointer deltas to the starting transform', () => {
  const unchanged = getStageDragPosition({
    startPosition: { x: 40, y: 55 },
    startPointer: { x: 250, y: 310 },
    currentPointer: { x: 250, y: 310 },
    stageSize: { width: 500, height: 800 },
  });
  assert.deepEqual(unchanged, { x: 40, y: 55 });

  const moved = getStageDragPosition({
    startPosition: { x: 40, y: 55 },
    startPointer: { x: 250, y: 310 },
    currentPointer: { x: 300, y: 230 },
    stageSize: { width: 500, height: 800 },
  });
  assert.deepEqual(moved, { x: 50, y: 45 });
});

test('move remains clamped to stage bounds and ignores foreign pointer identities', () => {
  assert.deepEqual(getStageDragPosition({
    startPosition: { x: 98, y: 2 },
    startPointer: { x: 100, y: 100 },
    currentPointer: { x: 500, y: -300 },
    stageSize: { width: 400, height: 400 },
  }), { x: 100, y: 0 });
  assert.equal(isOwnedPointerEvent(7, 7), true);
  assert.equal(isOwnedPointerEvent(7, 8), false);
  assert.match(source, /isOwnedPointerEvent\(session\.pointerId, event\.pointerId\)/);
  assert.match(source, /finishDrag\(false\)/);
  assert.match(source, /commit && current \? current\.transform : session\.startTransform/);
});

test('drag completion or cancellation reconciles the latest processed layer without resurrection', () => {
  const startTransform = { x: 40, y: 45 };
  const movedTransform = { x: 63, y: 58 };
  const current = [{ id: 'design-a', state: 'processing', displayUrl: 'raw', transform: movedTransform }];
  const incoming = [
    { id: 'design-a', state: 'done', displayUrl: 'processed', transform: startTransform },
    { id: 'design-b', state: 'done', displayUrl: 'ready', transform: { x: 20, y: 30 } },
  ];
  assert.deepEqual(reconcilePrintingLayersAfterDrag({
    currentLayers: current,
    incomingLayers: incoming,
    layerId: 'design-a',
    transform: movedTransform,
  }), [
    { id: 'design-a', state: 'done', displayUrl: 'processed', transform: movedTransform },
    incoming[1],
  ]);
  assert.deepEqual(reconcilePrintingLayersAfterDrag({
    currentLayers: current,
    incomingLayers: incoming,
    layerId: 'design-a',
    transform: startTransform,
  })[0], { id: 'design-a', state: 'done', displayUrl: 'processed', transform: startTransform });
  assert.deepEqual(reconcilePrintingLayersAfterDrag({
    currentLayers: current,
    incomingLayers: [],
    layerId: 'design-a',
    transform: movedTransform,
  }), []);
});

test('transform history is bounded, clears redo on new edits, and ignores no-op commits', () => {
  const transform = (x: number) => ({
    x,
    y: 50,
    scale: 1,
    rotation: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
  });
  let history = createPrintingTransformHistory<ReturnType<typeof transform>>();
  const unchanged = recordPrintingTransformHistory(history, {
    layerId: 'design-a',
    before: transform(10),
    after: transform(10),
  });
  assert.equal(unchanged, history);
  for (let index = 0; index < 23; index += 1) {
    history = recordPrintingTransformHistory(history, {
      layerId: 'design-a',
      before: transform(index),
      after: transform(index + 1),
    });
  }
  assert.equal(history.past.length, 20);
  assert.equal(history.past[0]?.before.x, 3);
  const undone = stepPrintingTransformHistory(history, 'undo', ['design-a']);
  assert.equal(undone.command?.transform.x, 22);
  assert.equal(undone.state.future.length, 1);
  const branched = recordPrintingTransformHistory(undone.state, {
    layerId: 'design-a',
    before: transform(22),
    after: transform(40),
  });
  assert.equal(branched.future.length, 0);
});

test('undo and redo target stable layer IDs without resurrecting removed layers', () => {
  const base = { x: 30, y: 40, scale: 1, rotation: 0, opacity: 1, flipX: false, flipY: false };
  let history = createPrintingTransformHistory<typeof base>();
  history = recordPrintingTransformHistory(history, {
    layerId: 'removed-design',
    before: base,
    after: { ...base, x: 45 },
  });
  history = recordPrintingTransformHistory(history, {
    layerId: 'design-b',
    before: base,
    after: { ...base, rotation: 18 },
  });
  assert.equal(hasPrintingTransformHistoryStep(history, 'undo', ['design-b']), true);
  const undo = stepPrintingTransformHistory(history, 'undo', ['design-b']);
  assert.deepEqual(undo.command, { layerId: 'design-b', transform: base });
  const redo = stepPrintingTransformHistory(undo.state, 'redo', ['design-b']);
  assert.deepEqual(redo.command, { layerId: 'design-b', transform: { ...base, rotation: 18 } });
  const pruned = prunePrintingTransformHistory(redo.state, []);
  assert.deepEqual(pruned, { past: [], future: [] });
  assert.equal(stepPrintingTransformHistory(history, 'undo', []).command, null);
});

test('horizontal and vertical flip preserve placement and double-toggle back to the exact transform', () => {
  const original = {
    x: 42,
    y: 57,
    scale: 1.25,
    rotation: 18,
    opacity: 0.82,
    flipX: false,
    flipY: false,
  };
  const horizontal = togglePrintingFlip(original, 'horizontal');
  assert.deepEqual(horizontal, { ...original, flipX: true });
  assert.deepEqual(togglePrintingFlip(horizontal, 'horizontal'), original);
  const vertical = togglePrintingFlip(original, 'vertical');
  assert.deepEqual(vertical, { ...original, flipY: true });
  assert.deepEqual(togglePrintingFlip(vertical, 'vertical'), original);
  assert.deepEqual(original, { x: 42, y: 57, scale: 1.25, rotation: 18, opacity: 0.82, flipX: false, flipY: false });
});

test('confirmed ready design exposes accessible image-only flip controls and commits immediately', () => {
  assert.match(source, /data-printing-flip-controls=\{layer\.id\}/);
  assert.match(source, /selected && layer\.cutoutState === 'done' && hasConfirmedGarmentMask/);
  assert.match(source, /aria-label=\{`\$\{layer\.label\}を水平方向に反転`\}/);
  assert.match(source, /aria-label=\{`\$\{layer\.label\}を垂直方向に反転`\}/);
  assert.match(source, /aria-pressed=\{layer\.transform\.flipX\}/);
  assert.match(source, /aria-pressed=\{layer\.transform\.flipY\}/);
  assert.match(source, /togglePrintingFlip\(current\.transform, axis\)/);
  assert.match(source, /onCommitLayer\(\{ id: layerId, transform \}\)/);
  assert.match(source, /transform: `scale\(\$\{layer\.transform\.flipX \? -1 : 1\}, \$\{layer\.transform\.flipY \? -1 : 1\}\)`/);
  const frameStyleBody = source.slice(
    source.indexOf('function getLayerFrameStyle'),
    source.indexOf('function getFrameMaskStyle'),
  );
  assert.doesNotMatch(frameStyleBody, /flipX|flipY/);
});

test('placement undo and redo controls record committed drag and flip transforms only', () => {
  assert.match(source, /data-printing-transform-history-controls/);
  assert.match(source, /aria-label="配置を元に戻す"/);
  assert.match(source, /aria-label="配置をやり直す"/);
  assert.match(source, /disabled=\{!canUndoTransform\}/);
  assert.match(source, /disabled=\{!canRedoTransform\}/);
  assert.match(source, /before: session\.startTransform/);
  assert.match(source, /after: transform/);
  assert.match(source, /before: current\.transform/);
  assert.match(source, /stepPrintingTransformHistory\(/);
  assert.match(source, /layer\.id === command\.layerId \? \{ \.\.\.layer, transform: command\.transform \} : layer/);
  assert.match(source, /onCommitLayer\(\{ id: command\.layerId, transform: command\.transform \}\)/);
  const cancelBranch = source.slice(source.indexOf('const finishDrag'), source.indexOf('useEffect(() => {', source.indexOf('const finishDrag')));
  assert.match(cancelBranch, /if \(commit && current && reconciledLayer\)/);
});

test('stable layer-order controls update the placed set used by stage and generation', () => {
  assert.match(source, /onReorderLayer: \(payload: \{ id: string; action: PrintDesignLayerOrderAction \}\) => void/);
  assert.match(source, /aria-label="レイヤー順を変更"/);
  assert.match(source, /data-printing-layer-order-menu=\{selectedLayer\.id\}/);
  assert.match(source, /\['front', '最上部へ移動'\]/);
  assert.match(source, /\['forward', '一段上へ移動'\]/);
  assert.match(source, /\['backward', '一段下へ移動'\]/);
  assert.match(source, /\['back', '最下部へ移動'\]/);
  assert.match(source, /onReorderLayer\(\{ id: selectedLayerId, action \}\)/);
  assert.match(source, /onSelectLayer\(selectedLayerId\)/);
  assert.match(page, /preservePrintDesignLayerOrder\(previousLayers, materializedLayers\)/);
  assert.match(page, /reorderPrintDesignLayers\(prev, id, action\)/);
  assert.match(page, /designs: placedPrintDesignLayers\.map/);
  assert.match(page, /printDesignLayers: placedPrintDesignLayers\.map/);
});

test('focused stage thumbnail rail changes editing selection without changing placed order', () => {
  assert.match(source, /data-printing-design-thumbnail-rail/);
  assert.match(source, /aria-label="配置デザインを選択"/);
  assert.match(source, /data-printing-design-thumbnail=\{layer\.id\}/);
  assert.match(source, /key=\{layer\.id\}/);
  assert.match(source, /aria-pressed=\{layer\.id === selectedLayerId\}/);
  assert.match(source, /aria-busy=\{layer\.cutoutState === 'processing'\}/);
  assert.match(source, /onSelectLayer\(layer\.id\)/);
  assert.match(source, /opacity: layer\.cutoutState === 'done' \? 1 : 0\.45/);
  assert.doesNotMatch(source, /data-printing-design-thumbnail=\{index\}/);
  const rail = source.slice(
    source.indexOf('data-printing-design-thumbnail-rail'),
    source.indexOf('data-printing-transform-history-controls'),
  );
  assert.doesNotMatch(rail, /onCommitLayer|onReorderLayer/);
});

test('flip state enters request snapshots and every canvas renderer before mask clipping', () => {
  assert.match(page, /flipX: overrides\.flipX \?\? false/);
  assert.match(page, /flipY: overrides\.flipY \?\? false/);
  assert.match(page, /flipX: previousLayer\?\.transform\.flipX \?\? false/);
  assert.match(page, /flipY: previousLayer\?\.transform\.flipY \?\? false/);
  assert.match(page, /flipX: layer\.transform\.flipX/);
  assert.match(page, /flipY: layer\.transform\.flipY/);
  assert.match(page, /ctx\.scale\(transform\.flipX \? -1 : 1, transform\.flipY \? -1 : 1\)/);
  assert.match(materialReferences, /transform: \{ \.\.\.design\.transform \}/);
  assert.match(materialReferences, /clippedDesignContext\.scale\(design\.transform\.flipX \? -1 : 1, design\.transform\.flipY \? -1 : 1\)/);
  assert.match(materialReferences, /designContext\.scale\(design\.transform\.flipX \? -1 : 1, design\.transform\.flipY \? -1 : 1\)/);
  const exactScale = materialReferences.indexOf('clippedDesignContext.scale');
  const exactMask = materialReferences.indexOf('await applyMaskToCanvas', exactScale);
  assert.ok(exactScale >= 0 && exactMask > exactScale, 'exact/fabric flip must render before the printable mask is applied');
});

test('a pending design stays visible locally without blocking ready artwork or the whole stage', () => {
  assert.match(page, /const displayUrl = processedUrl \|\| design\.url/);
  assert.match(page, /originalUrl: processedUrl/);
  assert.match(page, /const canConfirmPrintPlacement = canConfirmPlacementEdit\(\{/);
  assert.match(page, /multipleProcessingStates=\{printDesigns\.map/);
  assert.match(imageSelector, /multipleProcessingStates\?: boolean\[\]/);
  assert.match(imageSelector, /aria-busy=\{multipleProcessingStates\?\.\[index\] \?\? processing\}/);
  assert.match(imageSelector, /multiplePreviewUrls\[index\] \?\? img\.url/);
  assert.match(imageSelector, /\(multipleProcessingStates\?\.\[index\] \?\? processing\) && hideSelectedPreviewWhileProcessing/);
  assert.match(source, /const processingDesignLayers = useMemo/);
  assert.match(source, /const isGarmentProcessing = draftLayers\.some/);
  assert.match(source, /opacity: layer\.cutoutState === 'done' \? 0\.98 : 0\.42/);
  assert.match(source, /data-testid="printing-design-processing-status"/);
  assert.match(source, /\{isGarmentProcessing && \(/);
  assert.doesNotMatch(source, /\{isProcessing && \(/);
  assert.match(source, /hasConfirmedGarmentMask && processingDesignLayers\.length > 0/);
  assert.match(source, /件を透明化中（配置は維持）/);
  assert.match(source, /pendingLayersRef\.current = layers/);
  assert.match(source, /reconcilePrintingLayersAfterDrag\(\{/);
});

test('artwork and editing controls require the explicitly confirmed garment mask invariant', () => {
  assert.match(source, /garmentMaskConfirmed: boolean/);
  assert.match(source, /const hasConfirmedGarmentMask = hasRenderableGarment && garmentMaskConfirmed/);
  assert.match(source, /\{hasConfirmedGarmentMask \? \(/);
  assert.match(source, /hasRenderableGarment && !hasConfirmedGarmentMask && !isGarmentProcessing/);
  assert.match(source, /確定するまでデザインの表示・移動・生成は行いません/);
});

test('range AI output remains locked until its visible blue mask is explicitly confirmed', () => {
  assert.match(page, /const \[printGarmentMaskExplicitlyConfirmed, setPrintGarmentMaskExplicitlyConfirmed\] = useState\(false\)/);
  assert.match(page, /explicitlyConfirmed: printGarmentMaskExplicitlyConfirmed/);
  assert.match(page, /setPrintGarmentMaskExplicitlyConfirmed\(selectionSource === 'tap'\)/);
  assert.match(page, /const confirmProcessedGarmentMask = \(\) => \{/);
  assert.match(page, /canExplicitlyConfirmProcessedGarmentMask\(\{/);
  assert.match(page, /setPrintGarmentMaskExplicitlyConfirmed\(true\)/);
  assert.match(page, /data-testid="confirm-processed-garment-mask"/);
  assert.match(page, /青い認識範囲を確認し、「決定」を押してください/);
  assert.match(page, /選択したAIマスクはまだ未確定です。[^']*「このAIマスクで確定」を押すまでデザインは適用されません/);
  assert.match(page, /自動切り抜きはまだ未確定です。[^']*「決定」を押すまでデザインは適用されません/);
  assert.match(page, /isCurrentGarmentMaskEditorTarget\(\{/);
  assert.match(page, /GARMENT_MASK_EDITOR_STALE_TARGET/);
});

test('printing results render as newest-first run groups with exact and fabric retained together', () => {
  assert.match(page, /const printResultRuns = useMemo\(/);
  assert.match(page, /groupPrintResultHistory\(visibleGeneratedResults\)/);
  assert.match(page, /data-testid="print-result-run-history"/);
  assert.match(page, /data-testid="print-result-run"/);
  assert.match(page, /生成履歴 \{runIndex \+ 1\}/);
  assert.match(page, /生成履歴 \{printResultRuns\.length\}\/\{PRINT_RESULT_HISTORY_MAX_RUNS\}/);
  assert.match(page, /履歴は最大4回分です/);
  assert.doesNotMatch(page, /履歴は最大8件です/);
  assert.match(page, /runId: job\.runId/);
  assert.match(page, /resultKind: 'surface'/);
});

test('completed printing history exposes atomic run deletion and clear-all controls', () => {
  assert.match(page, /const deletePrintResultRun = \(result: WorkbenchResult\) => \{/);
  assert.match(page, /removePrintResultRun\(current, runId\)/);
  assert.match(page, /pendingSurfaceJob\?\.runId === runId/);
  assert.match(page, /onDeleteRun=\{deletePrintResultRun\}/);
  assert.match(page, /この生成を削除/);
  assert.match(page, /data-testid="clear-print-result-history"/);
  assert.match(page, /const clearPrintResultHistory = \(\) => \{/);
  assert.match(page, /const completedRunIds = new Set\(printResultRuns\.map\(\(run\) => run\.runId\)\)/);
  assert.match(page, /removePrintResultRuns\(current, completedRunIds\)/);
  assert.match(page, /プリント生成履歴をすべて削除しました/);
  assert.match(page, /全削除/);
});

test('completed print history offers an explicit return to the next design without clearing history', () => {
  assert.match(page, /const printDesignSelectorRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(page, /data-testid="print-design-selection-anchor"/);
  assert.match(page, /const returnToPrintDesignSelection = \(\) => \{/);
  assert.match(page, /printDesignReturnIntentRef\.current = armPrintDesignReturnIntent\(\)/);
  assert.match(page, /selector\.scrollIntoView\(\{ behavior: preferredScrollBehavior\(\), block: 'center' \}\)/);
  assert.match(page, /button\[aria-label="ギャラリーから画像を選択"\]/);
  assert.match(page, /button\[aria-label\^="デザイン "\]:not\(\[disabled\]\)/);
  assert.match(page, /data-testid="print-design-selection-anchor" tabIndex=\{-1\}/);
  assert.match(page, /data-testid="try-next-print-design"/);
  assert.match(page, /次のデザインを試す/);
  assert.match(page, /!isGenerating && printResultRuns\.length > 0/);
  assert.doesNotMatch(
    page.match(/const returnToPrintDesignSelection = \(\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? '',
    /setGeneratedResults|setProgressivePrintRun|setPrintDesigns/,
  );
});

test('CTA-owned next design returns to the placement pane exactly after the bound layer is ready', () => {
  assert.match(page, /const printPlacementPaneRef = useRef<HTMLElement>\(null\)/);
  assert.match(page, /resolvePrintDesignReturnIntent\(\{/);
  assert.match(page, /printDesignReturnIntentRef\.current = resolution\.intent/);
  assert.match(page, /if \(!resolution\.shouldReturn\) return/);
  assert.match(page, /pane\.scrollIntoView\(\{ behavior: preferredScrollBehavior\(\), block: 'center' \}\)/);
  assert.match(page, /pane\.focus\(\{ preventScroll: true \}\)/);
  assert.match(page, /consumeReadyPrintDesignReturn\(layerId\)/);
  assert.match(page, /deferPrintDesignReturnIntent\(/);
  assert.match(page, /const duplicateSelection = selectFreshDuplicatePrintDesign\(\{/);
  assert.ok(
    page.indexOf('const duplicateSelection = selectFreshDuplicatePrintDesign({')
      < page.indexOf('if (!inputPlan.shouldRestartCutout) {'),
    'duplicate identity must bind before unrelated errors choose the restart branch',
  );
  assert.match(page, /if \(duplicateTargetLayerId\) \{[\s\S]*?nextActiveLayerId = duplicateTargetLayerId;[\s\S]*?preferredLayerId = duplicateTargetLayerId/);
  assert.match(page, /scheduleDeferredPrintDesignReturn\(duplicateTargetLayerId\)/);
  assert.match(page, /releasePrintDesignReturnIntent\(/);
  assert.match(page, /printDesignReturnFrameRef\.current = requestAnimationFrame\(\(\) => \{[\s\S]*?requestAnimationFrame/);
  assert.match(page, /prefers-reduced-motion: reduce/);
  assert.match(page, /ref=\{printPlacementPaneRef\}/);
  assert.match(page, /data-testid="design-placement-pane"/);
  assert.match(page, /printDesignReturnIntentRef\.current = null;[\s\S]*?pendingActivePrintDesignLayerIdRef\.current = null;[\s\S]*?userClearedSelectionRef\.current = true/);
});

test('new and explicit design choices remain wired to one editing selection', () => {
  assert.match(page, /pendingActivePrintDesignLayerIdRef/);
  assert.match(page, /const \[activePrintDesignLayerId, setActivePrintDesignLayerId\]/);
  assert.match(page, /selectPlacedPrintDesignLayers\(printDesignLayers\)/);
  assert.match(page, /resolvePrintPlacementSelection\(\{/);
  assert.match(page, /pendingLayerExpected: Boolean\(/);
  assert.match(page, /nextPendingLayerId = nextActiveLayerId/);
  assert.match(page, /setActivePrintDesignLayerId\(nextActiveLayerId\)/);
  assert.match(page, /const readyFallbackLayerId = selectLatestReadyPrintDesignLayerId\(/);
  assert.match(page, /if \(!activeLayer && activeLayerExpected\) return/);
  assert.match(page, /isPendingPrintDesignLayerMaterialization\(\{/);
  assert.match(page, /pendingLayerId: pendingActivePrintDesignLayerIdRef\.current/);
  assert.match(page, /activeLayer && activeLayer\.cutoutState !== 'error'/);
  assert.match(page, /data-testid="print-design-placement-row"/);
  assert.match(page, /aria-pressed=\{activePrintDesignLayerId === getPrintDesignLayerId\(design\)\}/);
  assert.match(page, /onClick=\{\(\) => selectLayer\(getPrintDesignLayerId\(design\)\)\}/);
  assert.match(page, /選択中/);
  assert.match(page, /if \(!isPrinting\) \{[\s\S]*selectedLayerId !== fabricLayer\.id/);
});

test('repeat design changes reuse completed cutouts and prioritize the new active candidate', () => {
  assert.match(page, /inputPlan = planPrintDesignInputUpdate\(\{/);
  assert.match(page, /if \(!inputPlan\.shouldRestartCutout\) \{[\s\S]*?prunePrintDesignIdentityMap\(printDesignLayerIdsRef\.current, nextImages\);[\s\S]*?currentPrintDesignLayerIdsRef\.current = nextImages\.map\(getPrintDesignLayerId\);[\s\S]*?setPrintDesigns\(nextImages\);\s*return \{ ok: true \};/);
  assert.match(page, /const printDesignLayerIdsRef = useRef\(new Map<string, string>\(\)\)/);
  assert.match(page, /const identity = printDesignIdentity\(design\)/);
  const reconcilePlan = page.indexOf('reconciliation = planPrintDesignCutoutReconciliation({');
  const pruneMap = page.indexOf('prunePrintDesignIdentityMap(printDesignLayerIdsRef.current, nextImages)', reconcilePlan);
  assert.ok(reconcilePlan >= 0 && pruneMap > reconcilePlan, 'identity Map must be pruned after old identities are read for reconciliation');
  assert.match(page, /canCommitPrintDesignCutoutRequest\(requestId, printDesignCutoutRequestRef\.current\)/);
  assert.doesNotMatch(page, /new WeakMap<SelectedImage, string>/);
  assert.doesNotMatch(page, /images\.indexOf\(design\)/);
  assert.doesNotMatch(page, /printDesigns\.includes\(design\)/);
  assert.match(page, /planPrintDesignCutoutReconciliation\(\{/);
  assert.match(page, /preferredLayerId = nextActiveLayerId/);
  assert.match(page, /reconciliation\.reusablePreviousIndexByNextIndex\.forEach/);
  assert.match(page, /for \(const index of reconciliation\.processOrder\)/);
  assert.match(page, /setPrintDesignProcessedUrls\(\(current\) => \(\{ \.\.\.current, \[index\]: result\.dataUrl \}\)\)/);
  assert.match(page, /setPrintDesignCutoutResults\(\(current\) => \(\{ \.\.\.current, \[index\]: result \}\)\)/);
  assert.match(page, /pendingActivePrintDesignLayerIdRef\.current = readyFallbackLayerId[\s\S]*processingFallbackLayerId/);
  assert.match(page, /pendingActivePrintDesignLayerIdRef\.current = nextPendingLayerId/);
  assert.match(page, /const processingFallbackLayerId = selectLatestProcessingPrintDesignLayerId\(fallbackLayers\)/);
  assert.match(page, /current === activePrintDesignLayerId \? readyFallbackLayerId : current/);
  assert.doesNotMatch(page, /setPrintDesignProcessedUrls\(\{\}\)/);
  assert.doesNotMatch(page, /setPrintDesignCutoutResults\(\{\}\)/);
});

test('stage, readiness, request identity, and snapshot use every placed design in stable order', () => {
  assert.match(page, /return \[\.\.\.garments, \.\.\.placedPrintDesignLayers\]/);
  assert.match(page, /printDesignLayers: placedPrintDesignLayers\.map/);
  assert.match(page, /designs: placedPrintDesignLayers\.map\(\(layer\) => \(\{/);
  assert.match(page, /layers: placedPrintDesignLayers/);
  assert.match(page, /if \(isPrinting && !canConfirmPrintPlacement\)/);
  assert.match(page, /disabled=\{!canConfirmPrintPlacement\}/);
  assert.doesNotMatch(page, /activePrintDesignLayerId,\s*printDesignLayers:/);
  const generationSignatureBlock = page.slice(
    page.indexOf('const generationInputSignature = useMemo'),
    page.indexOf('const generationInputSignatureRef = useRef'),
  );
  assert.doesNotMatch(generationSignatureBlock, /activePrintDesignLayerId/);
});

test('completed print results expose an honest local favorite destination flow', () => {
  assert.match(page, /aria-label=\{`\$\{result\.title\} をお気に入りに追加`\}/);
  assert.match(page, /data-testid="print-result-favorite-dialog"/);
  assert.match(page, /title="お気に入りに追加"/);
  assert.match(page, /パーソナルスペース/);
  assert.match(page, /チームスペース/);
  assert.match(page, /チーム共有用の保存先モデルはまだ接続されていません/);
  assert.match(page, /savePrintResultFavorite\(\{/);
  assert.match(page, /toast\.success\(`「\$\{destinationLabel\}」へお気に入り保存しました`\)/);
  assert.match(page, /if \(!saved\.ok\)/);
  assert.match(page, /この端末に保存できませんでした/);
  assert.match(page, /onFavorite=\{isPrinting \? openFavoriteDialog : undefined\}/);
});

test('favorite action is limited to ready result cards, not pending surfaces', () => {
  const readyBranch = page.indexOf("if (surface.status === 'ready' && surface.result)");
  const favoriteCard = page.indexOf('onFavorite={onFavorite}', readyBranch);
  const pendingCard = page.indexOf('data-testid={`progressive-print-${label}-card`}', favoriteCard);
  assert.ok(readyBranch >= 0 && favoriteCard > readyBranch && pendingCard > favoriteCard);
  const pendingMarkup = page.slice(pendingCard, page.indexOf('\n  );\n}', pendingCard));
  assert.doesNotMatch(pendingMarkup, /onFavorite|お気に入りに追加/);
});

test('named local favorite destinations are browsable in Gallery', () => {
  assert.match(galleryPage, /const \[favoriteDestinationFilter, setFavoriteDestinationFilter\] = useState<string \| null>\(null\)/);
  assert.match(galleryPage, /favoriteDestinationLabels/);
  assert.match(galleryPage, /printResultDestinationLabel/);
  assert.match(galleryPage, /aria-label="お気に入りグループ"/);
  assert.match(galleryPage, /getMetadataString\(image, 'printResultDestinationLabel'\) === favoriteDestinationFilter/);
  assert.match(galleryPage, /favoriteDestinationLabels\.map\(\(destination\) =>/);
  assert.doesNotMatch(galleryPage, /\['all', \.\.\.favoriteDestinationLabels\]/);
  assert.match(galleryPage, /!favoriteDestinationLabels\.includes\(favoriteDestinationFilter\)[\s\S]*setFavoriteDestinationFilter\(null\)/);
});

test('stale or cross-brand results cannot be favorited into the current brand', () => {
  assert.match(page, /const \[favoriteTargetBrandId, setFavoriteTargetBrandId\] = useState<string \| null>\(null\)/);
  assert.match(page, /brandId: currentBrand\.id/);
  assert.match(page, /if \(!currentBrand\?\.id \|\| result\.brandId !== currentBrand\.id\)/);
  assert.match(page, /favoriteTargetBrandId !== currentBrand\.id/);
  assert.match(page, /素材またはブランド変更前の結果は保存できません/);
});

test('Gallery favorite mutation is limited to printing results and closes filtered removals', () => {
  assert.match(galleryPage, /if \(image\.feature_type !== 'printing-result'\)/);
  assert.match(galleryPage, /このローカル成果物は、現在の保存形式ではお気に入りを変更できません/);
  assert.match(galleryPage, /setSelectedImage\(filter === 'favorites' && !newValue \? null : updatedImage\)/);
  assert.match(galleryPage, /if \(filter === 'favorites' && !newValue\) setSearchParams\(\{\}\)/);
});

test('design mask editor commits by stable layer identity instead of a stale array index', () => {
  assert.match(page, /capturedDesignLayerId\?: string/);
  assert.match(page, /const currentPrintDesignLayerIdsRef = useRef<string\[\]>\(\[\]\)/);
  assert.match(page, /capturedDesignLayerId: getPrintDesignLayerId\(design\)/);
  assert.match(page, /resolvePrintDesignMaskEditorIndex\(/);
  assert.match(page, /DESIGN_MASK_EDITOR_STALE_TARGET/);
  assert.doesNotMatch(page, /target\.index/);
  assert.doesNotMatch(page, /kind: 'design',\s*index,/);
});

test('clearing editing chrome does not clear the active design identity', () => {
  const clearSelection = page.match(/const clearSelectedLayer = \(\) => \{([\s\S]*?)\n {2}\};/)?.[1] ?? '';
  assert.match(clearSelection, /pendingActivePrintDesignLayerIdRef\.current = null/);
  assert.match(clearSelection, /setSelectedLayerId\(null\)/);
  assert.doesNotMatch(clearSelection, /setActivePrintDesignLayerId/);
});

test('automatic editing-selection reconciliation cannot overwrite active design choice', () => {
  const reconciliation = page.match(/const next = resolvePrintPlacementSelection\(\{([\s\S]*?)\n {2}\}, \[activeLayers/)?.[1] ?? '';
  assert.match(reconciliation, /setSelectedLayerId\(next\.selectedLayerId\)/);
  assert.doesNotMatch(reconciliation, /setActivePrintDesignLayerId/);
});
