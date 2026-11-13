import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  arrangeStudioNodes, fitStudioArrangedView, pushStudioHistory, emptyStudioHistory, readStudioLayout, readStudioSnapEnabled, redoStudioHistory,
  sameStudioPositions, steppedStudioZoom, studioCenterOn, studioMinimapArrow, studioMinimapBounds, studioNodePositions, studioSnap, studioViewportRect,
  studioZoomPercent, undoStudioHistory, withStudioLayout, STUDIO_ARRANGE_GAPS, STUDIO_ZOOM_LIMITS,
} from '../src/lib/studioCanvas.ts';
import { replaceFashionStudioInput } from '../src/lib/fashionStudioDetailAdapter.ts';
import { extractFashionStudioSavedDetail } from '../src/lib/fashionStudioDetailHydration.ts';

const page = readFileSync(new URL('../src/pages/FashionStudioDetailPage.tsx', import.meta.url), 'utf8');
const controls = readFileSync(new URL('../src/components/lightchain/StudioCanvasControls.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

// Light's snap (39a7tyl4fysab.js, next to "snapToGrid:!1"): 6 screen px to another node's edge or centre, else a
// 120-unit grid within 5 px at zoom ≥ 25%. Heavy zoom 0.3 is Light's 45%: one Heavy unit is 1/0.45 Light units.
test('dragging lines a node up with another node within 6 screen pixels, like Light', () => {
  const other = { id: 'form', x: 600, y: 0, width: 310, height: 700 };
  // Heavy zoom 0.3 → 1 world unit is 1 screen px. 4px above the other node's top: snaps, with a horizontal guide.
  const near = studioSnap([{ id: 'main', x: 0, y: 4, width: 448, height: 600 }], [other], 0.3, 'main');
  assert.equal(Math.round(near.delta.y * 1000) / 1000, -4);
  assert.deepEqual(near.lines.map(line => [line.axis, Math.round(line.value)]), [['y', 0]]);
  // 9px away and off the grid: nothing.
  const far = studioSnap([{ id: 'main', x: 10, y: 9 + 1000, width: 448, height: 600 }], [other], 0.3, 'main');
  assert.deepEqual(far.lines, []);
  assert.deepEqual(far.delta, { x: 0, y: 0 });
  // Zoomed in to 2× (Heavy 0.6): 6 screen px is 3 world units, so 4 units away no longer lines up.
  const zoomed = studioSnap([{ id: 'main', x: 1000, y: 4, width: 448, height: 600 }], [{ ...other, x: 3000 }], 0.6, 'main');
  assert.equal(zoomed.lines.some(line => line.axis === 'y' && Math.round(line.value) === 0), false);
});

test('with nothing to line up with, the corner snaps to Light\'s 120-unit grid (54 Heavy units) at zoom ≥ 25%', () => {
  const grid = 120 * 0.45;
  const snapped = studioSnap([{ id: 'main', x: grid * 3 + 2, y: grid * 5 - 1.5, width: 448, height: 600 }], [], 0.3, 'main');
  assert.equal(Math.round((grid * 3 + 2 + snapped.delta.x) * 1000) / 1000, Math.round(grid * 3 * 1000) / 1000);
  assert.equal(Math.round((grid * 5 - 1.5 + snapped.delta.y) * 1000) / 1000, Math.round(grid * 5 * 1000) / 1000);
  // Light's 25%: Heavy zoom 0.1667. Below it there is no grid.
  assert.deepEqual(studioSnap([{ id: 'main', x: grid * 3 + 2, y: 0.5, width: 448, height: 600 }], [], 0.15, 'main').lines, []);
});

test('snapping is on unless Light\'s localStorage key says false', () => {
  assert.equal(readStudioSnapEnabled({ getItem: () => null }), true);
  assert.equal(readStudioSnapEnabled({ getItem: () => 'false' }), false);
  assert.equal(readStudioSnapEnabled({ getItem: () => 'true' }), true);
  assert.match(readFileSync(new URL('../src/lib/studioCanvas.ts', import.meta.url), 'utf8'), /'integration\.canvas\.snap\.enabled'/);
});

test('the minimap uses Light\'s bounds (208×112 inside 240×144) and moves the view like Light', () => {
  const view = { zoom: 0.3, panX: -100, panY: -50 };
  const viewport = studioViewportRect(view, 1200, 800);
  assert.deepEqual(viewport, { x: 100, y: 50, width: 1200, height: 800 });
  const bounds = studioMinimapBounds([{ x: 0, y: 0, width: 2080, height: 400 }], viewport);
  // The union is 2080 × 850; 2080/208 = 10 > 850/112, so one minimap unit is 10 world units.
  assert.deepEqual(bounds, { x: 1040 - 1200, y: 425 - 720, width: 2400, height: 1440 });
  assert.deepEqual(studioCenterOn(view, { x: 500, y: 300 }, 1200, 800), { zoom: 0.3, panX: 100, panY: 100 });
  assert.deepEqual(studioMinimapArrow('ArrowLeft'), [1, 0]);
  assert.deepEqual(studioMinimapArrow('ArrowDown'), [0, -1]);
  assert.equal(studioMinimapArrow('a'), null);
});

test('nodes start in Light\'s row and keep a saved position; later nodes follow the one before', () => {
  const specs = [
    { key: 'main', kind: 'main' as const, width: 448 },
    { key: 'form', kind: 'form' as const, width: 310 },
    { key: 'sample', kind: 'result' as const, width: 448 },
    { key: 'result:a', kind: 'result' as const, width: 448 },
  ];
  assert.deepEqual(studioNodePositions(specs, {}), {
    main: { x: 0, y: 0 }, form: { x: 531, y: 0 }, sample: { x: 930, y: 0 }, 'result:a': { x: 1378, y: 0 },
  });
  const moved = studioNodePositions(specs, { sample: { x: 900, y: 800 } });
  assert.deepEqual(moved.sample, { x: 900, y: 800 });
  assert.deepEqual(moved['result:a'], { x: 1348, y: 800 });
});

test('キャンバスを整理 lays 服 → 入力欄 → results out left to right, results stacked and centred, like Light', () => {
  const nodes = [
    { id: 'main', x: 0, y: 0, width: 448, height: 672 },
    { id: 'form', x: 900, y: 300, width: 310, height: 500 },
    { id: 'sample', x: 50, y: 900, width: 448, height: 672 },
    { id: 'result:a', x: 2000, y: -100, width: 448, height: 672 },
  ];
  const positions = arrangeStudioNodes(nodes, [{ source: 'main', target: 'form' }, { source: 'form', target: 'sample' }, { source: 'form', target: 'result:a' }]);
  const { horizontal, vertical } = STUDIO_ARRANGE_GAPS;
  const stacked = 672 * 2 + vertical;
  assert.deepEqual(positions.main, { x: 0, y: (stacked - 672) / 2 });
  assert.deepEqual(positions.form, { x: 448 + horizontal, y: (stacked - 500) / 2 });
  assert.deepEqual(positions.sample, { x: 448 + horizontal + 310 + horizontal, y: 0 });
  assert.deepEqual(positions['result:a'], { x: 448 + horizontal + 310 + horizontal, y: 672 + vertical });
  // Light fits the result into 64% of the canvas, never past 100% (Heavy 0.667) and never below 3%.
  const view = fitStudioArrangedView(nodes.map(node => ({ ...node, ...positions[node.id] })), 1800, 800);
  assert.ok(view.zoom <= 1 / 1.5 + 1e-9 && view.zoom >= STUDIO_ZOOM_LIMITS.min);
  assert.equal(studioZoomPercent(view.zoom), Math.round(Math.min(1, (0.64 * 800) / (stacked / 0.45)) * 100));
});

test('Light\'s zoom buttons step ±20% inside 3%–400%', () => {
  assert.equal(studioZoomPercent(0.2), 30);
  assert.equal(studioZoomPercent(steppedStudioZoom(0.2, 1)), 36);
  assert.equal(studioZoomPercent(steppedStudioZoom(0.2, -1)), 25);
  assert.equal(studioZoomPercent(steppedStudioZoom(STUDIO_ZOOM_LIMITS.max, 1)), 400);
  assert.equal(studioZoomPercent(steppedStudioZoom(STUDIO_ZOOM_LIMITS.min, -1)), 3);
});

test('undo / redo walk node positions back and forth', () => {
  const a = { main: { x: 0, y: 0 } }, b = { main: { x: 10, y: 0 } }, c = { main: { x: 20, y: 5 } };
  let history = pushStudioHistory(emptyStudioHistory(), a);
  history = pushStudioHistory(history, b);
  const back = undoStudioHistory(history, c)!;
  assert.deepEqual(back.positions, b);
  const backAgain = undoStudioHistory(back.history, back.positions)!;
  assert.deepEqual(backAgain.positions, a);
  assert.equal(undoStudioHistory(backAgain.history, backAgain.positions), null);
  const forward = redoStudioHistory(backAgain.history, backAgain.positions)!;
  assert.deepEqual(forward.positions, b);
  // A new move clears the redo side.
  assert.deepEqual(pushStudioHistory(forward.history, forward.positions).future, []);
});

test('positions are saved in the project snapshot and survive the studio\'s own input writes', () => {
  const snapshot = { version: 1, objects: [{ id: 'main-1', type: 'image', src: 'generated-images/a', metadata: { parameters: { layerRole: 'original-base' } } }] };
  const saved = withStudioLayout(snapshot, { main: { x: 12.345, y: -3 }, form: { x: Number.NaN, y: 1 } });
  assert.deepEqual(saved.studioLayout, { version: 1, positions: { main: { x: 12.3, y: -3 } } });
  assert.deepEqual(readStudioLayout(saved), { main: { x: 12.3, y: -3 } });
  assert.deepEqual(readStudioLayout({ studioLayout: { version: 2, positions: { main: { x: 1, y: 1 } } } }), {});
  assert.deepEqual(extractFashionStudioSavedDetail(saved).layout, { main: { x: 12.3, y: -3 } });
  const replaced = replaceFashionStudioInput(saved as never, 'reference', { jobId: 'j', imageId: 'i', storagePath: 'generated-images/r' } as never, 'op-1');
  assert.deepEqual((replaced as unknown as { studioLayout: unknown }).studioLayout, saved.studioLayout);
  assert.equal(sameStudioPositions({ main: { x: 1, y: 2 } }, { main: { x: 1.01, y: 2 } }), true);
  assert.equal(sameStudioPositions({ main: { x: 1, y: 2 } }, { main: { x: 1, y: 2 }, form: { x: 0, y: 0 } }), false);
});

test('the page wires Light\'s canvas controls with Light\'s labels', () => {
  for (const label of ['キャンバスを縮小', 'キャンバスの拡大率', 'キャンバスを拡大']) assert.ok(controls.includes(`aria-label="${label}"`), label);
  for (const label of ['キャンバスを整理', 'ミニマップ', 'グリッドにスナップ', 'ヘルプ', 'ショートカット', '取り消し(ctrl+z)', 'やり直し(ctrl+shift+z)']) {
    assert.ok(page.includes(`aria-label="${label}"`), label);
  }
  // Undo / redo are live (grey only with nothing to undo), not the old disabled placeholders.
  assert.match(page, /aria-label="取り消し\(ctrl\+z\)" title="取り消し\(ctrl\+z\)" disabled=\{!canvasCanUndo\}/);
  assert.doesNotMatch(page, /履歴操作は未接続/);
  // The minimap's own label and arrow keys, and the header moon button.
  assert.match(controls, /aria-label="ミニマップ。矢印キーで表示範囲を動かせます"/);
  assert.match(page, /'ダークモードに切り替え' : 'ライトモードに切り替え'/);
  assert.match(page, /getElementById\('lightchain-header-context'\)/);
  // Light's shortcut wording, only for keys Heavy answers (no copy / paste / delete / multi-select rows).
  for (const text of ['スペースキーを押しながらドラッグ / マウスの中ボタンを押しながらドラッグ', 'Ctrl + マウスホイール', 'グループの移動する', 'Ctrl + Shift + Z', 'Ctrl+Enter']) assert.ok(controls.includes(text), text);
  for (const text of ['キャンバス内コピー', '貼り付け', '複数選択', 'Delete / Backspace']) assert.ok(!controls.includes(text), text);
  assert.match(css, /\.fashion-studio-canvas-navigation \{\n  right: 112px;/);
  assert.match(css, /\.fashion-studio-source-zoom-controls \{\n  z-index: 31;\n  right: 256px;\n  bottom: 16px;/);
});

test('a layout save never races an upload or generation, and waits while a result is unconfirmed', () => {
  // Uploads, retries, generation and adding nodes to the canvas wait for a save in flight before they read the document.
  assert.equal((page.match(/await waitForLayoutSave\(\)/g) ?? []).length, 4);
  assert.match(page, /if \(saver\.flight \|\| !job \|\| busyRef\.current \|\| recoveryRequiredRef\.current \|\| layoutAckPending\(job\)\) return;/);
  assert.match(page, /snapshot: withStudioLayout\(document\.snapshot, job\.positions\), expectedRevision: document\.revision/);
  // The image toolbar opens a new project instead of replacing this project's main image.
  assert.match(page, /newProject \? \{ \.\.\.scope, documentId: '' \} : scope/);
  assert.match(page, /canvasProjectId: input\.scope\.documentId \|\| null/);
});
