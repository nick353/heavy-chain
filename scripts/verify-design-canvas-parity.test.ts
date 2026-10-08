import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { designEntryHref } from '../src/lib/designProjectArtifacts.ts';
import { canvasImageReference, imageProjectId, openImageProject } from '../src/features/designDetail/imageProject.ts';
import { createDesignCanvasObject, DESIGN_SHAPES } from '../src/features/designDetail/designCanvasShapes.ts';
import { BEGINNER_GUIDE_TABS, CANVAS_SHORTCUT_GROUPS, applyCanvasPatch, cloneCanvasObjects, diffCanvasObjects, expandGroupSelection, groupObjects, moveCanvasLayer, objectsInRect,
  throughSelect, ungroupObjects } from '../src/features/designDetail/designCanvasShortcuts.ts';

const artifact = (metadata: Record<string, unknown>) => ({ id: 'a-1', title: 't', featureType: 'text-to-image', createdAt: '2026-10-01T00:00:00Z', metadata }) as never;

test('project cards open the image as its own Canvas project, like Light', () => {
  assert.equal(designEntryHref({ origin: 'remote', artifact: artifact({ remoteImageId: 'ai-1' }) }), '/designProduction/detail?openImageId=ai-1');
  assert.equal(designEntryHref({ origin: 'local', artifact: artifact({ imageId: 'ai-2' }) }), '/designProduction/detail?openImageId=ai-2');
  assert.equal(designEntryHref({ origin: 'local', artifact: artifact({}) }), '/canvas/new?sourceArtifactId=a-1');
  assert.equal(designEntryHref({ origin: 'remote', artifact: artifact({}) }), null);
});

test('one deterministic project per user, brand and image; created once with the image placed', async () => {
  const scope = { userId: 'u', brandId: 'b' };
  const id = await imageProjectId(scope, 'ai-1');
  assert.match(id, /^imgp-[0-9a-f]{40}$/);
  assert.equal(id, await imageProjectId(scope, 'ai-1'));
  assert.notEqual(id, await imageProjectId({ userId: 'u2', brandId: 'b' }, 'ai-1'));
  const docs = new Map<string, Record<string, unknown>>();
  let creates = 0;
  const client = {
    async getDocument(documentId: string) { const doc = docs.get(documentId); if (!doc) throw new Error('not_found'); return doc as never; },
    async createDocument(input: { documentId?: string; title: string; snapshot: unknown }) {
      creates += 1;
      docs.set(input.documentId!, { id: input.documentId, ownerId: 'u', brandId: 'b', title: input.title, snapshot: input.snapshot, snapshotVersion: 1, revision: 0 });
      return docs.get(input.documentId!) as never;
    },
  };
  const first = await openImageProject({ scope, imageId: 'ai-1', assertContext: () => {}, client, measure: async () => ({ width: 880, height: 1100 }) });
  const objects = (first.snapshot as { objects: Record<string, unknown>[] }).objects;
  assert.equal(objects.length, 1);
  assert.equal(objects[0].src, 'generated-images/ai-1');
  assert.equal(objects[0].width, 352);
  await openImageProject({ scope, imageId: 'ai-1', assertContext: () => {}, client, measure: async () => { throw new Error('should not measure'); } });
  assert.equal(creates, 1);
});

test('a saved canvas image can be selected as the edit reference', () => {
  assert.deepEqual(canvasImageReference({ src: 'generated-images/ai-9', label: 'デザイン 1' }),
    { order: 0, kind: 'upload', imageId: 'ai-9', storagePath: 'generated-images/ai-9', name: 'デザイン 1' });
  assert.equal(canvasImageReference({ src: 'https://example.com/x.png' }), null);
});

test('shapes, panels and text are created in the canvas like Light', () => {
  assert.deepEqual(DESIGN_SHAPES.map((shape) => shape.label), ['矩形', '円形', '三角形', '線', '矢印']);
  const rect = createDesignCanvasObject('rect', 1000, 1000, 3, () => 'x');
  assert.deepEqual([rect.type, rect.shapeType, rect.x, rect.y, rect.zIndex], ['shape', 'rect', 700, 700, 3]);
  assert.equal(createDesignCanvasObject('text', 0, 0, 1, () => 'x').type, 'text');
  assert.equal(createDesignCanvasObject('frame', 0, 0, 1, () => 'x').type, 'frame');
  const detail = fs.readFileSync('src/features/designDetail/DesignEntryDetailPage.tsx', 'utf8');
  assert.match(detail, /data-testid="design-shape-menu"/);
  assert.match(detail, /onClick=\{\(\) => addObject\('frame'\)\}/);
  assert.match(detail, /onClick=\{\(\) => addObject\('text'\)\}/);
  assert.doesNotMatch(detail, /\/canvas\/\$\{encodeURIComponent\(projectId\)\}/);
  assert.match(detail, /今日は何をデザインしますか？/);
  assert.match(detail, /data-testid="design-layer-delete"/);
});

test('inspiration card, zoom group and collapsed assistant follow Light', () => {
  const detail = fs.readFileSync('src/features/designDetail/DesignEntryDetailPage.tsx', 'utf8');
  assert.match(detail, /params\.get\('projectSubType'\) === 'clothingDesign'/);
  assert.match(detail, /Hello！デザインはここから始まります/);
  assert.match(detail, /data-testid="design-zoom-group"/);
  assert.match(detail, /aria-label="初心者ガイド"/);
  assert.match(detail, /data-testid="design-shortcuts"/);
  assert.match(detail, /setPanelOpen\(!\(panelDefaultKey\.endsWith\(':inspiration'\) \|\| panelDefaultKey\.endsWith\(':canvas'\)\)\)/);
  assert.ok(fs.existsSync('public/lightchain-assets/mirror/lightchain-qlxy-prod/persistence/font-end/design-empty-placeholder.png'));
  const pages = fs.readFileSync('src/pages/LightchainParityPages.tsx', 'utf8');
  assert.match(pages, /title="インスピレーション"[^\n]*navigate\('\/designProduction\/detail\?projectSubType=clothingDesign'\)/);
});

test('Light guide tabs, shortcut groups and layer ordering', () => {
  assert.equal(BEGINNER_GUIDE_TABS.length, 7);
  assert.deepEqual(CANVAS_SHORTCUT_GROUPS.map((group) => group.title), ['キャンバス', '要素', '新しいオブジェクトを作成', 'レイヤー操作']);
  const objects = [{ id: 'a', zIndex: 1 }, { id: 'b', zIndex: 2 }, { id: 'c', zIndex: 3 }];
  const order = (list: { id: string; zIndex: unknown }[]) => [...list].sort((x, y) => Number(x.zIndex) - Number(y.zIndex)).map((o) => o.id).join('');
  assert.equal(order(moveCanvasLayer(objects, 'a', 'front')), 'bca');
  assert.equal(order(moveCanvasLayer(objects, 'c', 'back')), 'cab');
  assert.equal(order(moveCanvasLayer(objects, 'a', 'up')), 'bac');
  assert.equal(order(moveCanvasLayer(objects, 'c', 'down')), 'acb');
  const detail = fs.readFileSync('src/features/designDetail/DesignEntryDetailPage.tsx', 'utf8');
  assert.match(detail, /\{ t: 'text', r: 'rect', o: 'circle', l: 'line' \}/);
  assert.ok(fs.existsSync('public/lightchain-assets/mirror/jp/static/none_list.png'));
});

test('multi-select, groups, through-select, paste and undo work like Light\'s canvas shortcuts', () => {
  const objects = [
    { id: 'a', type: 'shape', x: 0, y: 0, width: 100, height: 100, zIndex: 1 },
    { id: 'b', type: 'shape', x: 50, y: 50, width: 100, height: 100, zIndex: 2 },
    { id: 'c', type: 'shape', x: 500, y: 500, width: 100, height: 100, zIndex: 3 },
  ];
  assert.deepEqual(objectsInRect(objects, { x1: 120, y1: 120, x2: -10, y2: -10 }), ['a', 'b']);
  assert.equal(throughSelect(objects, { x: 75, y: 75 }, null), 'a');
  assert.equal(throughSelect(objects, { x: 75, y: 75 }, 'a'), 'b');
  assert.equal(throughSelect(objects, { x: 10, y: 10 }, null), 'a');
  assert.equal(throughSelect(objects, { x: 300, y: 300 }, null), null);
  const grouped = groupObjects(objects, ['a', 'c'], 'g1');
  assert.deepEqual(expandGroupSelection(grouped, ['c']), ['a', 'c']);
  assert.deepEqual(expandGroupSelection(ungroupObjects(grouped, ['a', 'c']), ['c']), ['c']);
  assert.ok(!('groupId' in ungroupObjects(grouped, ['a'])[0]));
  let n = 0;
  const clones = cloneCanvasObjects([grouped[2], grouped[0]], 10, () => `n${++n}`);
  assert.deepEqual(clones.map((clone) => [clone.x, clone.zIndex]), [[40, 10], [540, 11]]);
  assert.equal(clones[0].groupId, clones[1].groupId);
  assert.notEqual(clones[0].groupId, 'g1');
  assert.ok(clones.every((clone) => !['a', 'c'].includes(String(clone.id))));
  const moved = objects.map((object) => object.id === 'a' ? { ...object, x: 9 } : object).filter((object) => object.id !== 'c');
  const patch = diffCanvasObjects(objects, moved)!;
  assert.deepEqual(Object.keys(patch.before).sort(), ['a', 'c']);
  assert.equal(diffCanvasObjects(objects, objects), null);
  // Undo restores only the patched ids and keeps an object added meanwhile (e.g. an AI result).
  const undone = applyCanvasPatch([...moved, { id: 'ai', type: 'image', zIndex: 4 }], patch.before);
  assert.deepEqual(undone.map((object) => [object.id, object.x]), [['a', 0], ['b', 50], ['ai', undefined], ['c', 500]]);
  assert.deepEqual(applyCanvasPatch(undone, patch.after).map((object) => object.id), ['a', 'b', 'ai']);
  // Saving an edit reloads the document; selection and undo history reset only when the project changes.
  const page = fs.readFileSync('src/features/designDetail/DesignEntryDetailPage.tsx', 'utf8');
  assert.match(page, /useEffect\(\(\) => \{ setSelectedIds\(\[\]\); setHistory\(\{ undo: \[\], redo: \[\] \}\); \}, \[identity\]\);/);
  assert.equal(page.match(/setHistory\(\{ undo: \[\], redo: \[\] \}\)/g)?.length, 1);
  // macOS turns Ctrl + click into a context-menu click with no click event, so 透過選択 runs on pointerdown.
  assert.match(page, /onPointerDown=\{\(event\) => \{\s*\/\/ 透過選択[\s\S]{0,400}throughSelect\(/);
});
