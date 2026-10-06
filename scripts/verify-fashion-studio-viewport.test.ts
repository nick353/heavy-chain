import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as viewportLibrary from '../src/lib/studioViewport.ts';
import { clampStudioZoom, panStudioViewport, zoomStudioViewport, normalizedStudioWheel, studioWorldTransform, createStudioViewportInteraction, STUDIO_DEFAULT_VIEWPORT } from '../src/lib/studioViewport.ts';

const interactionFixture = () => {
  const captures: number[] = [], releases: number[] = [];
  const states: any[] = [];
  const controller = createStudioViewportInteraction({ publish: state => states.push(state), capture: id => captures.push(id), release: id => releases.push(id) });
  return { controller, captures, releases, states };
};
const pointer = (overrides = {}) => ({ pointerId: 1, button: 0, x: 50, y: 75, interactive: false, ...overrides });
const key = (overrides = {}) => ({ key: ' ', down: true, interactive: false, focused: true, anchor: { x: 500, y: 300 }, ...overrides });
test('zoom clamps to 10–200 percent and default transform exactly preserves baseline', () => {
  assert.equal(clampStudioZoom(-1), 0.1); assert.equal(clampStudioZoom(3), 2); assert.equal(clampStudioZoom(NaN), 0.3);
  assert.equal(studioWorldTransform(STUDIO_DEFAULT_VIEWPORT), 'translate(0px, 0px) scale(1)');
});
test('anchored zoom retains exact world point under pointer including min/max clamping', () => {
  const before = { zoom: 0.6, panX: -130, panY: 50 }, anchor = { x: 423, y: 199 };
  for (const zoom of [0.1, 0.3, 1.2, 20]) {
    const after = zoomStudioViewport(before, zoom, anchor);
    assert.ok(Math.abs((anchor.x - after.panX) / (after.zoom / 0.3) - (anchor.x - before.panX) / 2) < 1e-9);
    assert.ok(Math.abs((anchor.y - after.panY) / (after.zoom / 0.3) - (anchor.y - before.panY) / 2) < 1e-9);
  }
});
test('pan is screen-pixel based and does not mutate input view', () => {
  const before = { zoom: 0.5, panX: 10, panY: 20 }; assert.deepEqual(panStudioViewport(before, 30, -80), { zoom: 0.5, panX: 40, panY: -60 });
  assert.deepEqual(before, { zoom: 0.5, panX: 10, panY: 20 });
});
test('wheel pixel/line/page deltas normalize consistently', () => {
  assert.deepEqual(normalizedStudioWheel({ deltaX: 2, deltaY: 3, deltaMode: 0 }, 600), { x: 2, y: 3 });
  assert.deepEqual(normalizedStudioWheel({ deltaX: 2, deltaY: 3, deltaMode: 1 }, 600), { x: 32, y: 48 });
  assert.deepEqual(normalizedStudioWheel({ deltaX: 2, deltaY: 3, deltaMode: 2 }, 600), { x: 1200, y: 1800 });
});
test('select mode selects stable node ID or clears empty selection without moving anything', () => {
  const f = interactionFixture(); assert.equal(f.controller.down(pointer({ objectId: 'saved-main' })), true);
  assert.equal(f.controller.snapshot().selectedObjectId, 'saved-main'); assert.equal(f.controller.move({ pointerId: 1, x: 500, y: 500 }), false);
  f.controller.down(pointer()); assert.equal(f.controller.snapshot().selectedObjectId, null); assert.deepEqual(f.controller.snapshot().view, STUDIO_DEFAULT_VIEWPORT);
});
test('move mode primary drag captures pointer and pans all world content by same delta', () => {
  const f = interactionFixture(); f.controller.mode('move'); assert.equal(f.controller.down(pointer()), true);
  assert.deepEqual(f.captures, [1]); assert.equal(f.controller.snapshot().panning, true);
  f.controller.move({ pointerId: 1, x: 75, y: -125 }); assert.deepEqual(f.controller.snapshot().view, { zoom: 0.3, panX: 25, panY: -200 });
  assert.equal(f.controller.move({ pointerId: 99, x: 1000, y: 1000 }), false); f.controller.up(1);
  assert.deepEqual(f.releases, [1]); assert.equal(f.controller.snapshot().panning, false);
});
test('middle or focused Space plus primary pans in either mode; right button does not', () => {
  for (const mode of ['select', 'move'] as const) {
    const f = interactionFixture(); f.controller.mode(mode); assert.equal(f.controller.down(pointer({ button: 2 })), false);
    assert.equal(f.controller.down(pointer({ button: 1 })), true); f.controller.up(1);
    assert.equal(f.controller.key(key()), true); assert.equal(f.controller.down(pointer()), true); f.controller.up(1);
  }
});
test('cancel, blur-style cancellation, reset and dispose release capture and reject late moves', () => {
  for (const exit of ['cancel', 'reset', 'dispose'] as const) {
    const f = interactionFixture(); f.controller.mode('move'); f.controller.down(pointer()); f.controller[exit]();
    assert.deepEqual(f.releases, [1]); assert.equal(f.controller.snapshot().panning, false); assert.equal(f.controller.move({ pointerId: 1, x: 600, y: 600 }), false);
  }
});
test('interactive composer pointer/wheel/Space and unfocused keys never navigate', () => {
  const f = interactionFixture(); f.controller.mode('move'); const prior = f.controller.snapshot();
  assert.equal(f.controller.down(pointer({ interactive: true })), false);
  assert.equal(f.controller.key(key({ interactive: true })), false); assert.equal(f.controller.key(key({ focused: false })), false);
  assert.equal(f.controller.wheel({ deltaX: 3, deltaY: 100, deltaMode: 0, ctrlKey: true, metaKey: false, interactive: true, anchor: { x: 30, y: 30 }, pageHeight: 600 }), false);
  assert.deepEqual(f.controller.snapshot(), prior); assert.deepEqual(f.captures, []);
});
test('plain wheel pans and control/meta-wheel zoom around exact pointer anchor', () => {
  const f = interactionFixture(); const base = { deltaX: 16, deltaY: 32, deltaMode: 0, ctrlKey: false, metaKey: false, interactive: false, anchor: { x: 120, y: 90 }, pageHeight: 600 };
  f.controller.wheel(base); assert.deepEqual(f.controller.snapshot().view, { zoom: 0.3, panX: -16, panY: -32 });
  const prior = f.controller.snapshot().view; f.controller.wheel({ ...base, metaKey: true });
  assert.deepEqual(f.controller.snapshot().view, zoomStudioViewport(prior, prior.zoom * Math.exp(-32 * 0.002), base.anchor));
});
test('plus/minus and zoom controls use viewport center without stealing activation keys', () => {
  const f = interactionFixture(); f.controller.key(key({ key: '+' }));
  assert.deepEqual(f.controller.snapshot().view, zoomStudioViewport(STUDIO_DEFAULT_VIEWPORT, 0.36, { x: 500, y: 300 }));
  assert.equal(f.controller.key(key({ key: 'Enter' })), false); f.controller.zoom(-1, { x: 500, y: 300 });
  assert.ok(Math.abs(f.controller.snapshot().view.zoom - 0.3) < 1e-10);
});

// Lightweight JSX render/event harness, not a browser layout engine. Executes
// actual page handlers and effects; CSS layout/real pointer delivery stay root QA.
type VNode = { type: any; props: Record<string, any> };
class Surface {
  dataset: Record<string, string> = {};
  listeners = new Map<string, Function>();
  captured = new Set<number>(); focusCount = 0;
  kind: string;
  constructor(kind = 'canvas') { this.kind = kind; }
  closest(selector: string) {
    if (selector === '[data-studio-object-id]') return this.dataset.studioObjectId ? this : null;
    return this.kind === 'composer' || this.kind === 'button' ? this : null;
  }
  getBoundingClientRect() { return { left: 0, top: 50, width: 1424, height: 582 }; }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
  focus() { this.focusCount++; }
  contains(target: Surface | null) { return target === this || (this.kind === 'canvas' && target?.kind === 'composer'); }
  addEventListener(name: string, callback: Function, options?: any) { if (name === 'wheel') assert.equal(options.passive, false); this.listeners.set(name, callback); }
  removeEventListener(name: string) { this.listeners.delete(name); }
}
const allNodes = (node: any): VNode[] => {
  if (Array.isArray(node)) return node.flatMap(allNodes); if (!node || !node.props) return [];
  if (typeof node.type === 'function' && node.type.name === 'FashionStudioImageNode') return allNodes(node.type(node.props));
  return [node, ...allNodes(node.props.children)];
};
const renderHarness = () => {
  const source = readFileSync(new URL('../src/pages/FashionStudioDetailPage.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { fileName: 'FashionStudioDetailPage.tsx', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  assert.equal(compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const slots: any[] = []; let index = 0; const effects: Array<() => void> = []; const cleanups: Function[] = [];
  const canvas = new Surface(); const browserWindow = new Surface(); const fileInput = { clickCount: 0, click() { this.clickCount++; } };
  const writes = { canvas: 0, provider: 0 }; const snapshot = { revision: 8, view: { zoom: 2, panX: 30, panY: 70 } };
  const auth = { user: { id: 'user' }, currentBrand: { id: 'brand' }, brandState: { requestGeneration: 1 } };
  let projectCode = 'project';
  const react = {
    useState(initial: any) { const i = index++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (value: any) => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useRef(initial: any) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(callback: Function, dependencies: any[]) { const i = index++; const prior = slots[i];
      if (!prior || dependencies.some((value, j) => value !== prior.dependencies[j])) { effects.push(() => { prior?.cleanup?.(); const cleanup = callback(); slots[i] = { dependencies, cleanup }; if (cleanup) cleanups.push(cleanup); }); } },
  };
  const useAuthStore = Object.assign(() => auth, { getState: () => auth });
  const control = () => ({ start: () => { writes.provider++; }, retry: () => {}, dispose: () => {} });
  const libraries: Record<string, any> = {
    'react': react, 'react/jsx-runtime': { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }), Fragment: Symbol('fragment') },
    'lucide-react': new Proxy({}, { get: (_target, name) => String(name) }),
    'react-router-dom': { Link: 'a', useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams({ boardProjectCode: projectCode })] },
    '../lib/studioViewport': viewportLibrary,
    '../stores/authStore': { useAuthStore }, '../lib/authBrandSelection': { canSelectConfirmedBrand: () => true },
    '../lib/cloudflareApi': { cloudflareDataPlane: {} }, '../lib/storage': { resolveGeneratedImageUrlWithStatus: async () => ({ ok: true, url: 'image' }) },
    '../lib/fashionStudioThumbnails': { fashionStudioThumbnailScopeKey: () => '[]', createFashionStudioThumbnailController: control },
    '../lib/fashionStudioDetailHydration': { fashionStudioDetailScopeKey: (scope: any) => JSON.stringify(scope),
      emptyFashionStudioDetail: () => ({ roles: { main: { objectId: null, candidates: [] }, reference: { objectId: null, candidates: [] }, result: { objectId: null, candidates: [] } }, prompt: '' }),
      createFashionStudioDetailHydration: (ports: any) => ({ load(scope: any) { ports.publish({ scopeKey: JSON.stringify(scope), status: 'success', title: 'Saved', remainingUnits: 7,
        detail: { roles: { main: { objectId: 'main-id', status: 'available', candidates: ['main'] }, reference: { objectId: 'ref-id', status: 'available', candidates: ['ref'] }, result: { objectId: 'result-id', status: 'available', candidates: ['result'] } }, prompt: '' } }); }, dispose() {} }) },
    '../lib/fashionStudioDetailAdapter': { createFashionStudioInputController: control, createFashionStudioGenerationAdapters: (value: any) => value },
    '../lib/fashionStudioDetailGeneration': { createFashionStudioDetailGeneration: control },
    '../lib/canvasDocumentPersistence': { createCanvasDocument: () => writes.canvas++, updateCanvasDocument: () => writes.canvas++ },
    '../lib/imageApi': {}, '../lib/providerResultPersistence': {},
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(compiled.outputText, { exports, require: (name: string) => { if (!(name in libraries)) throw new Error(name); return libraries[name]; },
    Element: Surface, window: browserWindow, URLSearchParams, console });
  let tree: any;
  const render = () => {
    index = 0; tree = exports.FashionStudioDetailPage();
    for (const node of allNodes(tree)) if (node.props.ref) node.props.ref.current = node.props['data-testid'] === 'lightchain-fashion-studio-canvas' ? canvas : fileInput;
    const pending = effects.splice(0); pending.forEach(effect => effect()); return tree;
  };
  const find = (name: string) => allNodes(tree).find(node => node.props['data-testid'] === name || node.props['aria-label'] === name)!;
  render(); render();
  return { render, find, canvas, browserWindow, fileInput, writes, snapshot, tree: () => tree, switchProject: () => { projectCode = 'different'; render(); render(); }, unmount: () => cleanups.reverse().forEach(cleanup => cleanup()) };
};
const pageEvent = (target: Surface, overrides = {}) => ({ target, currentTarget: target, pointerId: 1, button: 0, clientX: 300, clientY: 300, prevented: false,
  preventDefault() { this.prevented = true; }, ...overrides });
test('render tree places nodes/edges/composer in one transformed world and excludes all fixed chrome', () => {
  const h = renderHarness(); const world = h.find('fashion-studio-world'); const worldNodes = allNodes(world);
  assert.equal(world.props.style.transform, 'translate(0px, 0px) scale(1)'); assert.equal(world.props.style.transformOrigin, '0 0');
  for (const marker of ['fashion-studio-saved-main-image', 'fashion-studio-saved-reference-image', 'fashion-studio-saved-result-image', 'lightchain-fashion-studio-generation-panel']) assert.ok(worldNodes.some(node => node.props['data-testid'] === marker));
  assert.ok(worldNodes.some(node => node.type === 'svg'));
  for (const marker of ['lightchain-fashion-studio-canvas-toolbar', 'lightchain-fashion-studio-zoom-controls', 'タスク', 'ポイント', '画像検索', 'アセット']) assert.ok(!worldNodes.includes(h.find(marker)), marker);
  h.unmount();
});
test('page handlers pan shared world, retain fixed toolbar, and cancel capture on pointer cancellation', () => {
  const h = renderHarness(); h.find('移動').props.onClick(); h.render();
  const down = pageEvent(h.canvas); h.find('lightchain-fashion-studio-canvas').props.onPointerDown(down); h.render(); assert.equal(down.prevented, true); assert.ok(h.canvas.captured.has(1));
  h.find('lightchain-fashion-studio-canvas').props.onPointerMove(pageEvent(h.canvas, { clientX: 300, clientY: 100 })); h.render();
  assert.equal(h.find('fashion-studio-world').props.style.transform, 'translate(0px, -200px) scale(1)'); assert.equal(h.find('lightchain-fashion-studio-canvas-toolbar').props.style, undefined);
  h.find('lightchain-fashion-studio-canvas').props.onPointerCancel(); h.render(); assert.equal(h.canvas.captured.size, 0); h.unmount();
});
test('actual composer events do not prevent text selection, Space typing or wheel scrolling', () => {
  const h = renderHarness(); h.find('移動').props.onClick(); h.render(); const composer = new Surface('composer');
  const down = pageEvent(composer, { currentTarget: h.canvas }); h.find('lightchain-fashion-studio-canvas').props.onPointerDown(down); assert.equal(down.prevented, false);
  const space = pageEvent(composer, { key: ' ', currentTarget: h.canvas }); h.find('lightchain-fashion-studio-canvas').props.onKeyDown(space); assert.equal(space.prevented, false);
  const wheel = pageEvent(composer, { deltaX: 0, deltaY: 300, deltaMode: 0, ctrlKey: true, metaKey: false }); h.canvas.listeners.get('wheel')!(wheel); assert.equal(wheel.prevented, false);
  h.render(); assert.equal(h.find('fashion-studio-world').props.style.transform, 'translate(0px, 0px) scale(1)'); h.unmount();
});
test('native canvas wheel prevents page scrolling only when handled and anchors zoom below header', () => {
  const h = renderHarness();
  const pan = pageEvent(h.canvas, { deltaX: 2, deltaY: 3, deltaMode: 1, ctrlKey: false, metaKey: false });
  h.canvas.listeners.get('wheel')!(pan); h.render(); assert.equal(pan.prevented, true);
  assert.equal(h.find('fashion-studio-world').props.style.transform, 'translate(-32px, -48px) scale(1)');
  const zoom = pageEvent(h.canvas, { deltaX: 0, deltaY: -60, deltaMode: 0, ctrlKey: true, metaKey: false });
  h.canvas.listeners.get('wheel')!(zoom); h.render(); assert.equal(zoom.prevented, true);
  const expected = zoomStudioViewport({ zoom: 0.3, panX: -32, panY: -48 }, 0.3 * Math.exp(0.12), { x: 300, y: 250 });
  assert.equal(h.find('fashion-studio-world').props.style.transform, studioWorldTransform(expected)); h.unmount();
});
test('composer-to-canvas focus during drag preserves capture, leaving viewport cancels it', () => {
  const h = renderHarness(); h.find('移動').props.onClick(); h.render(); h.find('lightchain-fashion-studio-canvas').props.onPointerDown(pageEvent(h.canvas));
  h.find('lightchain-fashion-studio-canvas').props.onBlur({ target: new Surface('composer'), currentTarget: h.canvas, relatedTarget: h.canvas });
  assert.equal(h.canvas.captured.size, 1);
  h.find('lightchain-fashion-studio-canvas').props.onBlur({ target: h.canvas, currentTarget: h.canvas, relatedTarget: new Surface('outside') });
  assert.equal(h.canvas.captured.size, 0); h.unmount();
});
test('actual zoom controls, focused key zoom, add input and disabled history buttons are wired', () => {
  const h = renderHarness(); h.find('ズームイン').props.onClick(); h.render();
  assert.match(h.find('fashion-studio-world').props.style.transform, /scale\(1\.2\)/);
  assert.equal(JSON.stringify(h.find('lightchain-fashion-studio-zoom-controls').props.children[1].props.children), JSON.stringify([36, '%']));
  const event = pageEvent(h.canvas, { key: '-' }); h.find('lightchain-fashion-studio-canvas').props.onKeyDown(event); h.render(); assert.equal(event.prevented, true);
  h.find('画像を追加').props.onClick(); assert.equal(h.fileInput.clickCount, 1);
  for (const name of ['元に戻す', 'やり直す']) { assert.equal(h.find(name).props.disabled, true); assert.equal(h.find(name).props.onClick, undefined); }
  h.unmount();
});
test('actual selection uses stable role ID and empty canvas clears outline without changing geometry', () => {
  const h = renderHarness(); const target = new Surface('node'); target.dataset.studioObjectId = 'main-id';
  h.find('lightchain-fashion-studio-canvas').props.onPointerDown(pageEvent(target, { currentTarget: h.canvas })); h.render();
  assert.equal(h.find('fashion-studio-saved-main-image').props['data-selected'], true);
  h.find('lightchain-fashion-studio-canvas').props.onPointerDown(pageEvent(h.canvas)); h.render(); assert.equal(h.find('fashion-studio-saved-main-image').props['data-selected'], false); h.unmount();
});
test('lost capture/window blur/unmount/project change cancel interaction and project reset restores baseline', () => {
  for (const exit of ['lost', 'blur', 'unmount', 'project']) {
    const h = renderHarness(); h.find('移動').props.onClick(); h.render(); h.find('lightchain-fashion-studio-canvas').props.onPointerDown(pageEvent(h.canvas));
    h.find('lightchain-fashion-studio-canvas').props.onPointerMove(pageEvent(h.canvas, { clientY: 100 })); h.render();
    if (exit === 'lost') h.find('lightchain-fashion-studio-canvas').props.onLostPointerCapture({ pointerId: 1 });
    if (exit === 'blur') h.browserWindow.listeners.get('blur')!(); if (exit === 'unmount') h.unmount(); if (exit === 'project') h.switchProject();
    h.render(); assert.equal(h.canvas.captured.size, 0);
    if (exit === 'project') { assert.equal(h.find('fashion-studio-world').props.style.transform, 'translate(0px, 0px) scale(1)'); assert.equal(h.find('選択').props['aria-pressed'], true); }
    if (exit !== 'unmount') h.unmount();
  }
});
test('navigation produces zero document/provider writes and leaves snapshot revision/view intact', () => {
  const h = renderHarness(); const before = structuredClone(h.snapshot);
  h.find('移動').props.onClick(); h.render(); h.find('lightchain-fashion-studio-canvas').props.onPointerDown(pageEvent(h.canvas));
  h.find('lightchain-fashion-studio-canvas').props.onPointerMove(pageEvent(h.canvas, { clientY: 50 })); h.find('lightchain-fashion-studio-canvas').props.onPointerUp({ pointerId: 1 });
  h.find('ズームイン').props.onClick(); h.render(); assert.deepEqual(h.writes, { canvas: 0, provider: 0 }); assert.deepEqual(h.snapshot, before); h.unmount();
});
test('CSS clips below header, preserves child coordinates/inner scale and limits touch-action to navigation surfaces', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(css, /\.fashion-studio-project-detail-parity\s*\{[^}]*height: calc\(100dvh - 50px\)/);
  for (const value of ['top: 190.86px', 'left: 30.29%', 'top: 134.36px', 'left: 58.93%', 'top: 557.16px', 'left: 56.31%', 'top: 379.36px', 'left: 11.67vw', 'transform: scale(0.3)']) assert.ok(css.includes(value), value);
  assert.match(css, /\.fashion-studio-source-image-node\[data-selected="true"\]\s*\{[^}]*outline:/);
  assert.doesNotMatch(css, /\.fashion-studio-viewport\s*\{[^}]*touch-action/);
  assert.match(css, /\.fashion-studio-source-generation-panel\s*\{[^}]*touch-action: auto/);
});
