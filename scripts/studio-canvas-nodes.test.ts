import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { extractFashionStudioSavedDetail } from '../src/lib/fashionStudioDetailHydration.ts';
import { buildFashionStudioGeneratedSnapshot, replaceFashionStudioInput } from '../src/lib/fashionStudioDetailAdapter.ts';
import { readStudioLayout, withStudioLayout } from '../src/lib/studioCanvas.ts';
import {
  STUDIO_CANVAS_IMAGE_ROLE, STUDIO_CANVAS_LIMIT_MESSAGE, STUDIO_MAX_CANVAS_IMAGES, STUDIO_MAX_CHILD_FORMS, isStudioChildDocument, isStudioFormKey, newStudioFormId,
  readStudioCanvasImages, readStudioForms, readStudioParent, studioCanvasImageKey, studioCanvasImageObject, studioChildFormIdOf, studioChildFormKey, studioChildNodeKey,
  studioNodeBeside, studioSettleNewNodes, withStudioCanvasImage, withStudioForm, withStudioParent,
} from '../src/lib/studioCanvasNodes.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../src/pages/FashionStudioDetailPage.tsx');
const list = read('../src/pages/FashionStudioPage.tsx');
const editMenu = read('../src/components/lightchain/StudioImageEditMenu.tsx');
const css = read('../src/index.css');

const remote = (n: number) => ({ jobId: `job-${n}`, imageId: `img-${n}`, storagePath: `generated-images/img-${n}` });
const image = (id: string, layerRole: string, extra: Record<string, unknown> = {}) => ({ id, type: 'image', src: `generated-images/${id}`,
  metadata: { storagePath: `generated-images/${id}`, parameters: { layerRole, ...extra } } });
const snapshot = (objects: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({ version: 1, objects, ...extra, view: { zoom: 0.3, panX: 0, panY: 0, gridVisible: false, snapToGrid: false, gridSize: 20 } });
/** A project saved before this change (2026-11-12 production shape): main, reference, a result, its history, moved nodes. */
const oldProject = () => withStudioLayout(snapshot([
  image('main', 'original-base'), image('ref', 'material-reference'),
  image('history-1', 'generated-result-history'), image('result', 'generated-result', { generationOperationId: 'op-1' }),
]), { main: { x: 0, y: 0 }, form: { x: 531, y: 0 }, 'result:result': { x: 930, y: 0 } });

// Light's board (2026-11-12): the image toolbar's functions add a form to the same canvas joined to the image, and
// one project holds many forms and free images. A project saved before that reads exactly as before.
test('a project saved before more nodes reads as one form with no added nodes', () => {
  const detail = extractFashionStudioSavedDetail(oldProject());
  assert.equal(detail.roles.main.objectId, 'main');
  assert.equal(detail.roles.reference.objectId, 'ref');
  assert.equal(detail.roles.result.objectId, 'result');
  assert.deepEqual(detail.history.map(item => item.objectId), ['history-1']);
  assert.deepEqual(detail.forms, []);
  assert.deepEqual(detail.canvasImages, []);
  assert.equal(detail.parent, null);
  assert.deepEqual(detail.layout, { main: { x: 0, y: 0 }, form: { x: 531, y: 0 }, 'result:result': { x: 930, y: 0 } });
});

test('a form added from the image toolbar is listed in the project with its place, and malformed entries are skipped', () => {
  const form = { id: 'fabc123', documentId: 'doc-child-1', fn: 'region' as const, sourceKey: 'result:result', edit: null };
  const next = withStudioForm(oldProject(), form, { [studioChildFormKey(form.id)]: { x: 1500.4, y: 80 } });
  assert.deepEqual(readStudioForms(next), [form]);
  // The added form's place joins the layout already saved; nothing else moves.
  assert.deepEqual(readStudioLayout(next), { main: { x: 0, y: 0 }, form: { x: 531, y: 0 }, 'result:result': { x: 930, y: 0 }, 'fabc123/form': { x: 1500.4, y: 80 } });
  // The project's own roles are untouched.
  const detail = extractFashionStudioSavedDetail(next);
  assert.equal(detail.roles.main.objectId, 'main');
  assert.equal(detail.roles.result.objectId, 'result');
  assert.deepEqual(detail.forms, [form]);
  // Adding the same form again (a write retried after a lost answer) keeps one entry.
  assert.equal(readStudioForms(withStudioForm(next, form)).length, 1);
  const messy = { ...next, studioForms: { version: 1, forms: [
    form, { ...form }, { id: 'bad id!', documentId: 'd', fn: 'text', sourceKey: 'main' }, { id: 'f2', documentId: 'd2', fn: 'video', sourceKey: 'main' },
    { id: 'f3', documentId: '', fn: 'text', sourceKey: 'main' }, 'x', null,
    { id: 'f4', documentId: 'd4', fn: 'text', sourceKey: 'main', edit: { tool: 'repair', prompt: 'Restore', editOptions: { resolution: '4k', aspectRatio: '3:4', extra: 1 } } },
    { id: 'f5', documentId: 'd5', fn: 'text', sourceKey: 'main', edit: { tool: 'rm -rf', prompt: 'x' } },
  ] } };
  assert.deepEqual(readStudioForms(messy).map(item => [item.id, item.edit?.tool ?? null]), [['fabc123', null], ['f4', 'repair'], ['f5', null]]);
  assert.deepEqual(readStudioForms(messy)[1].edit, { tool: 'repair', prompt: 'Restore', editOptions: { aspectRatio: '3:4', resolution: '4k' } });
});

test('a project stops taking forms at its limit with Light\'s message', () => {
  let current = snapshot([image('main', 'original-base')]);
  for (let index = 0; index < STUDIO_MAX_CHILD_FORMS; index += 1) current = withStudioForm(current, { id: `f${index}`, documentId: `d${index}`, fn: 'text', sourceKey: 'main', edit: null });
  assert.equal(readStudioForms(current).length, STUDIO_MAX_CHILD_FORMS);
  assert.throws(() => withStudioForm(current, { id: 'one-more', documentId: 'dx', fn: 'text', sourceKey: 'main', edit: null }), /studio_canvas_form_limit/);
  assert.equal(STUDIO_CANVAS_LIMIT_MESSAGE, 'キャンバスの要素上限を超えました。一部の要素を削除するか、新しいプロジェクトを作成してください');
});

test('a form document is marked with its project, so the project list shows only the project', () => {
  const child = withStudioParent(snapshot([image('main', 'original-base')]), { documentId: 'doc-parent', formId: 'fabc123' });
  assert.deepEqual(readStudioParent(child), { documentId: 'doc-parent', formId: 'fabc123' });
  assert.equal(isStudioChildDocument(child), true);
  assert.equal(isStudioChildDocument(oldProject()), false);
  assert.equal(isStudioChildDocument({ objects: [], studioParent: { documentId: 'p', formId: 'not ok' } }), false);
  assert.equal(extractFashionStudioSavedDetail(child).parent?.documentId, 'doc-parent');
  assert.match(list, /if \(isStudioChildDocument\(document\.snapshot\)\) return false;/);
});

test('free images (clip, upload, search, edit) are their own layers and never taken for a role', () => {
  const object = studioCanvasImageObject({ id: 'cut-1', remote: remote(5), kind: 'edit', sourceKey: 'result:result', tool: 'remove-background', operationId: 'op-5',
    credit: { title: 'Linen', license: 'CC BY 2.0', pageUrl: 'https://openverse.org/image/1', creator: 'A', licenseUrl: 'javascript:alert(1)' } });
  const next = withStudioCanvasImage(oldProject(), object, { [studioCanvasImageKey('cut-1')]: { x: 1400, y: 10 } });
  const detail = extractFashionStudioSavedDetail(next);
  assert.equal(detail.roles.main.status, 'available');
  assert.equal(detail.roles.result.objectId, 'result');
  assert.deepEqual(detail.canvasImages.map(item => [item.key, item.kind, item.sourceKey, item.tool]), [['node:cut-1', 'edit', 'result:result', 'remove-background']]);
  assert.deepEqual(detail.canvasImages[0].candidates, ['generated-images/img-5']);
  // Only https credit links are kept.
  assert.deepEqual(detail.canvasImages[0].credit, { title: 'Linen', license: 'CC BY 2.0', pageUrl: 'https://openverse.org/image/1', creator: 'A' });
  assert.equal(readStudioLayout(next)['node:cut-1'].x, 1400);
  assert.equal((object.metadata.parameters as Record<string, unknown>).layerRole, STUDIO_CANVAS_IMAGE_ROLE);
  assert.throws(() => studioCanvasImageObject({ id: 'x', remote: { ...remote(6), storagePath: 'data:image/png;base64,AAAA' }, kind: 'upload', operationId: 'op' }), /studio_canvas_image_invalid/);
  let full = snapshot([image('main', 'original-base')]);
  for (let index = 0; index < STUDIO_MAX_CANVAS_IMAGES; index += 1) full = withStudioCanvasImage(full, studioCanvasImageObject({ id: `i${index}`, remote: remote(index), kind: 'upload', operationId: `op${index}` }));
  assert.throws(() => withStudioCanvasImage(full, studioCanvasImageObject({ id: 'over', remote: remote(999), kind: 'upload', operationId: 'op' })), /studio_canvas_image_limit/);
  assert.equal(readStudioCanvasImages(full).length, STUDIO_MAX_CANVAS_IMAGES);
});

test('generating or replacing an input keeps the added forms, free images and their places', () => {
  const form = { id: 'fabc123', documentId: 'doc-child-1', fn: 'text' as const, sourceKey: 'main', edit: null };
  const base = withStudioCanvasImage(withStudioForm(oldProject(), form, { 'fabc123/form': { x: 1500, y: 0 } }),
    studioCanvasImageObject({ id: 'up-1', remote: remote(7), kind: 'upload', operationId: 'op-7' }), { 'node:up-1': { x: 2000, y: 0 } });
  const document = { id: 'doc', snapshot: base } as never;
  const handoff = { baseDocument: { snapshot: base }, input: { main: { objectId: 'main' }, prompt: 'p' }, requestId: 'op-new', persisted: { remote: remote(9) } } as never;
  const generated = buildFashionStudioGeneratedSnapshot(document, handoff);
  const replaced = replaceFashionStudioInput(base as never, 'main', remote(10), 'op-main');
  for (const next of [generated, replaced]) {
    const detail = extractFashionStudioSavedDetail(next);
    assert.deepEqual(detail.forms, [form]);
    assert.deepEqual(detail.canvasImages.map(item => item.id), ['up-1']);
    assert.equal(detail.layout['fabc123/form'].x, 1500);
    assert.equal(detail.layout['node:up-1'].x, 2000);
  }
});

test('node keys: the project\'s own stay as they were, a form\'s are "<formId>/…", free images "node:<id>"', () => {
  assert.equal(studioChildFormKey('fabc'), 'fabc/form');
  assert.equal(studioChildNodeKey('fabc', 'result:r1'), 'fabc/result:r1');
  assert.equal(studioChildFormIdOf('fabc/result:r1'), 'fabc');
  assert.equal(studioChildFormIdOf('result:r1'), null);
  assert.equal(studioChildFormIdOf('node:abc'), null);
  assert.equal(isStudioFormKey('form'), true);
  assert.equal(isStudioFormKey('fabc/form'), true);
  assert.equal(isStudioFormKey('fabc/result:r1'), false);
  assert.match(newStudioFormId(() => '0123-4567-89ab-cdef-0000'), /^f0123456789ab$/);
});

test('a new node lands 100 Light units right of its image, a random 0-300 lower, then below anything it would cover', () => {
  const source = { x: 0, y: 0, width: 448, height: 600 };
  assert.deepEqual(studioNodeBeside(source, [], { width: 310, height: 500 }, () => 0), { x: 493, y: 0 });
  assert.deepEqual(studioNodeBeside(source, [], { width: 310, height: 500 }, () => 1), { x: 493, y: 135 });
  const blocker = { x: 500, y: 0, width: 310, height: 520 };
  assert.deepEqual(studioNodeBeside(source, [blocker], { width: 310, height: 500 }, () => 0), { x: 493, y: 565 });
  // Without a source (an uploaded image) it goes right of everything.
  assert.deepEqual(studioNodeBeside(null, [source, blocker], { width: 448, height: 600 }, () => 0), { x: 855, y: 0 });
});

test('a result without a saved place steps down past a node it would cover; saved nodes and a touching row stay put', () => {
  const sizes = { form: { width: 310, height: 500 }, r1: { width: 448, height: 600 }, r2: { width: 448, height: 600 }, clip: { width: 448, height: 600 } };
  // The form's results touch in a row; the クリッピング image was put beside the first result before the second came.
  const positions = { form: { x: 0, y: 0 }, r1: { x: 400, y: 0 }, r2: { x: 848, y: 0 }, clip: { x: 900, y: 80 } };
  const order = ['form', 'r1', 'clip', 'r2'];
  assert.deepEqual(studioSettleNewNodes(positions, sizes, order, new Set(['r2'])), { ...positions, r2: { x: 848, y: 725 } });
  // r1 touching r2 is not an overlap; with nothing in the way nothing moves.
  const free = { form: { x: 0, y: 0 }, r1: { x: 400, y: 0 }, r2: { x: 848, y: 0 } };
  assert.deepEqual(studioSettleNewNodes(free, sizes, ['form', 'r1', 'r2'], new Set(['r1', 'r2'])), free);
  // A result with a saved place is never moved, and an unmeasured one keeps its line-up place.
  assert.deepEqual(studioSettleNewNodes(positions, sizes, order, new Set()), positions);
  assert.deepEqual(studioSettleNewNodes(positions, { ...sizes, r2: { width: 448, height: 0 } }, order, new Set(['r2'])), positions);
  // The page settles only results (its own and its forms') that have no saved place.
  assert.match(page, /const newResultKeys = new Set\(\[\.\.\.resultNodeKeys, \.\.\.childForms\.flatMap\(form => childResultKeys\(form\)\)\]\.filter\(key => !savedPositions\[key\]\)\);\n\s*const basePositions = studioSettleNewNodes\(\{ \.\.\.studioNodePositions\(nodeSpecs, savedPositions\), \.\.\.extraPositions \}, sizes, nodeKeys, newResultKeys\);/);
});

test('the image toolbar is Light\'s, and its functions add a form to this canvas instead of opening a new project', () => {
  const toolbar = page.slice(page.indexOf('data-testid="fashion-studio-node-toolbar"'), page.indexOf('data-testid="fashion-studio-node-feedback"'));
  const order = ['>クリッピング</button>', 'STUDIO_TOOLBAR_FUNCTIONS.map', '<StudioImageEditMenu', 'aria-label="画像検索"', 'aria-label="お気に入り"', 'aria-label="ダウンロード"', '<StudioSendMenu'];
  let at = -1;
  for (const marker of order) { const next = toolbar.indexOf(marker); assert.ok(next > at, `toolbar order: ${marker}`); at = next; }
  assert.match(toolbar, /onClick=\{\(\) => void addChildForm\(key, url, fn\)\}/);
  assert.doesNotMatch(page, /openNodeInNewProject|新しいプロジェクトを開きます/);
  // A form is its own document marked with the project, then listed in the project in the same write as its place.
  assert.match(page, /withStudioParent\(input\.snapshot, \{ documentId: child\.parentId, formId: child\.formId \}\)/);
  assert.match(page, /withStudioForm\(snapshot, form, \{ \[formKey\]: anchor \}\)/);
  // Each added form is the page drawn inside the project's canvas for its own document.
  assert.match(page, /childForms\.map\(form => <FashionStudioDetailPage key=\{form\.id\} embedded=\{\{ formId: form\.id, documentId: form\.documentId/);
  assert.match(page, /const projectCode = embedded \? embedded\.documentId : searchParams\.get\('boardProjectCode'\) \?\? '';/);
  // Edges: image → added form → its results; a 画像編集 result straight off the image; a free image off its source.
  assert.match(page, /\[\{ source: form\.sourceKey, target: studioChildFormKey\(form\.id\) \}, \.\.\.childResultKeys\(form\)\.map\(target => \(\{ source: studioChildFormKey\(form\.id\), target \}\)\)\]/);
  assert.match(page, /canvasImages\.filter\(image => image\.sourceKey\)\.map\(image => \(\{ source: image\.sourceKey!, target: image\.key \}\)\)/);
});

test('画像編集, クリッピング, 画像検索, お気に入り and 画像をアップロード add their images to this canvas', () => {
  assert.match(page, /onClientResult=\{async \(tool, file\) => \{ await addCanvasImage\(file, \{ kind: 'edit', sourceKey: key, tool \}\); \}\}/);
  assert.match(page, /onServerEdit=\{\(tool, request: StudioServerEditRequest\) => addChildForm\(key, url, 'text', \{ tool, prompt: request\.prompt/);
  assert.match(page, /onExtract=\{async file => \{ if \(await addCanvasImage\(file, \{ kind: 'clip', nearKey: clipTarget\.key \}\)\) setClipTarget\(null\); \}\}/);
  assert.match(page, /<StudioImageSearchPanel projectId=\{projectCode\} brandId=\{scope\.brandId\} request=\{searchRequest\}/);
  assert.match(page, /addCanvasImage\(file, \{ kind: 'search', nearKey: searchRequest\?\.key \?\? null, credit \}\)/);
  assert.match(page, /onSelectFromCanvas=\{selectFromCanvas\}/);
  assert.doesNotMatch(page, /fashion-studio-source-image-search/);
  assert.match(page, /aria-label="画像をアップロード" title="画像をアップロード" disabled=\{!inputsReady \|\| !scope\} onClick=\{\(\) => canvasImageInputRef\.current\?\.click\(\)\}/);
  // ?imgUrl= (送る from another tool): a new project without one, a new image node in an open project.
  assert.match(page, /<StudioIncomingImage onFile=\{file => addCanvasImage\(file, \{ kind: 'upload' \}\)\}/);
  assert.match(page, /<StudioIncomingImage onFile=\{file => uploadOwnMain\(file\)\}/);
  // The image is saved like an input before the project lists it.
  assert.match(page, /featureType: STUDIO_CANVAS_IMAGE_FEATURE/);
  assert.match(page, /return snapshot => withStudioCanvasImage\(snapshot, object, \{ \[key\]: point \}\);/);
});

test('windows over the page stay open: presses there never reach the canvas, and the edit menu opens its windows on the page', () => {
  assert.match(page, /if \(!\(event\.target instanceof Node\) \|\| !event\.currentTarget\.contains\(event\.target\)\) return;/);
  assert.match(page, /if \(pressed !== document\.body && pressed && !pageRef\.current\?\.contains\(pressed\)\) return;/);
  assert.match(editMenu, /\{dialog && typeof document !== 'undefined' && createPortal\(<div data-studio-chrome="">/);
  assert.match(page, /createPortal\(<div data-studio-chrome="">\{dialogs\}<\/div>, document\.body\)/);
  // The toolbar's own buttons are styled; the items of the menus opened inside it keep their own look.
  assert.match(css, /\.fashion-studio-node-toolbar > button,\n\.fashion-studio-node-toolbar \.fashion-studio-node-toolbar-trigger,/);
  assert.doesNotMatch(css, /^\.fashion-studio-node-toolbar button,$/m);
});

test('範囲指定のマスク調整 is Light\'s two-pane 簡易エディター and 再生成 / 👍👎 follow the result\'s own form', () => {
  assert.doesNotMatch(page, /MaskPaintDialog/);
  assert.match(page, /<StudioMaskEditor ariaLabel=/);
  assert.match(page, /reference=\{maskDialog\.referenceUrl \? \{ imageUrl: maskDialog\.referenceUrl \} : null\}/);
  assert.match(page, /<StudioFeedbackBar documentId=\{childForm\.documentId\} objectId=\{childResult\.objectId\} fn=\{childForm\.edit \? null : childForm\.fn\}/);
  assert.match(page, /onRegenerate=\{\(\) => childApisRef\.current\[childForm\.id\]\?\.generate\(\)\}/);
  assert.match(page, /<StudioFeedbackBar documentId=\{projectCode\} objectId=\{canvasImage\.id\} fn=\{null\} \/>/);
  // A 画像編集 form runs once right after it was added, never again on a reload.
  assert.match(page, /if \(!host\?\.edit \|\| !host\.autoRun \|\| editRunRef\.current/);
  assert.match(page, /editImageWithPrompt\(imageUrl, embeddedRef\.current\?\.edit \? prompt : studioProviderPrompt\(/);
});

// 2026-11-12 本番で押して見つけた4件（クリッピングの窓の上が帯に隠れる・AIマスク認識の一覧が切れる・ポイントが減らない・回しても新しいノードで全体に戻る）。
const maskEditor = read('../src/components/lightchain/StudioMaskEditor.tsx');

test('the windows the page opens (クリッピング, お気に入り, 範囲指定の簡易エディター, キャンバスから選択) sit over the whole page, header included', () => {
  const parentReturn = page.slice(page.indexOf('<main ref={pageRef}'));
  const portal = parentReturn.slice(parentReturn.indexOf('{typeof document !== \'undefined\' && createPortal(<div data-studio-chrome="">'));
  const portalBody = portal.slice(0, portal.indexOf('</div>, document.body)}'));
  assert.ok(portalBody.length > 0, 'the page portals its windows to the body');
  for (const piece of ['{clipTarget && <StudioClippingDialog', '{collectTarget && <StudioCollectDialog', '{dialogs}']) assert.ok(portalBody.includes(piece), piece);
  // Nothing of them is left inside <main>, under the site header's layer.
  const inline = parentReturn.replace(portalBody, '');
  assert.doesNotMatch(inline, /\{clipTarget && <StudioClippingDialog/);
  assert.doesNotMatch(inline, /^\s*\{dialogs\}\s*$/m);
});

test('簡易エディター is Light\'s floating bar over a dark page: the chosen tool\'s small bar under it, 520×515 panes below', () => {
  // No box around it and no sideways-scrolling row (2026-11-12 production: the AIマスク認識 list was cut off inside that row).
  // The page behind is darkened about 80% like Light (2026-11-12: Light's pixels before and after it opens).
  assert.match(maskEditor, /<div className="fixed inset-0 z-50 overflow-auto bg-black\/80" role="dialog"/);
  assert.doesNotMatch(maskEditor, /overflow-x-auto/);
  assert.match(maskEditor, /<div className="flex h-\[45px\] items-center gap-1 rounded-lg border border-white\/\[0\.08\] bg-\[#26292b\] px-2 shadow-2xl" role="toolbar"/);
  // The chosen tool: teal outline and text; キャンセル is grey.
  assert.match(maskEditor, /active \? 'border-\[#20d0c4\] text-\[#20d0c4\]' : 'border-transparent text-white\/90/);
  assert.match(maskEditor, /className="h-9 rounded-md bg-\[#5b6164\] px-4 text-sm text-white/);
  // The small bar follows the chosen tool's button; AIマスク認識 shows its parts as a row of radios, not a dropdown.
  assert.match(maskEditor, /useLayoutEffect\(\(\) => \{ setSubLeft\(toolRefs\.current\[tool\]\?\.offsetLeft \?\? 0\); \}, \[tool\]\);/);
  assert.match(maskEditor, /style=\{\{ left: subLeft \}\} role="toolbar"/);
  assert.match(maskEditor, /\{tool === 'ai-mask' \? \(\n\s*<div role="radiogroup"/);
  assert.match(maskEditor, /role="radio" aria-checked=\{aiPick === candidate\} disabled=\{busy !== null\} onClick=\{\(\) => void recognize\(candidate\)\}/);
  // Light's radio bar is low (34px, 12px words); the other tools' bar is 48px.
  assert.match(maskEditor, /\$\{tool === 'ai-mask' \? 'h-\[34px\]' : 'h-12'\}`\} style=\{\{ left: subLeft \}\}/);
  assert.match(maskEditor, /onClick=\{\(\) => void recognize\(candidate\)\} className="flex h-7 items-center gap-1\.5 rounded-md px-2\.5 text-xs /);
  assert.doesNotMatch(maskEditor, /role="menu"/);
  assert.doesNotMatch(maskEditor, /ChevronDown/);
  // Panes: 520×515, teal border and title on the chosen one; the other is dimmed with Light's hint.
  assert.match(maskEditor, /h-\[min\(515px,calc\(87vh-180px\)\)\] min-h-\[320px\] w-\[520px\]/);
  // The image sits 24px inside the pane like Light's (only the surface's own margin; the pane body adds none).
  assert.match(maskEditor, /<div className="relative min-h-0 flex-1">\n\s*<StudioMaskSurface/);
  assert.match(read('../src/components/lightchain/StudioMaskSurface.tsx'), /const pad = 24;/);
  assert.match(maskEditor, /activePane === id \? 'border-\[#20d0c4\]' : 'border-\[#4b5053\]'/);
  assert.match(maskEditor, /'参考にしたい領域を描画してください' : '調整したい領域を描画してください'/);
  // The pane not in use is darkened as a whole, title included, about 78% like Light's, with the hint in its middle.
  assert.match(maskEditor, /<\/div>\n(?:\s*\{\/\*.*\*\/\}\n)?\s*\{panes\.length > 1 && activePane !== id && \(\n\s*<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black\/\[0\.78\] text-sm text-white">\{paneHint\(id\)\}<\/div>\n\s*\)\}\n\s*<\/section>/);
  assert.match(maskEditor, /rounded-xl border-2 bg-\[#25292c\]/);
  // 抽出・お気に入り・保存 are teal fills like Light.
  const clipping = read('../src/components/lightchain/StudioClippingDialog.tsx');
  assert.equal(clipping.match(/className="h-9 rounded-md bg-\[#20d0c4\] px-4 text-sm text-\[#0f1718\]/g)?.length, 2);
  assert.match(page, /data-testid="fashion-studio-region-mask-save" disabled=\{api\.busy\} className="h-9 rounded-md bg-\[#20d0c4\]/);
});

test('the points pill is read again when a generation here or in a form on the canvas ends', () => {
  assert.match(page, /const runningTasks = \(busy \? 1 : 0\) \+ Object\.values\(childReports\)\.filter\(report => report\.busy\)\.length;/);
  assert.match(page, /if \(embedded \|\| runningTasks >= before \|\| !scope \|\| !cloudflareDataPlane\) return;\n\s*const captured = scopeKey;\n\s*void cloudflareDataPlane\.getImageUsage\(scope\.brandId\)\.then\(usage => \{\n\s*const units = fashionStudioRemainingUnits\(usage\);\n\s*if \(units !== null\) setHydration\(previous => previous\?\.scopeKey === captured \? \{ \.\.\.previous, remainingUnits: units \} : previous\);/);
  assert.match(page, /\}, \[runningTasks\]\);/);
  assert.match(page, /\{activityContent\}<span>\{runningTasks\} <span className="mx-1">進行中<\/span>/);
});

test('scrolling or zooming with the wheel keeps the view where the person put it when nodes are added', () => {
  assert.match(page, /pageHeight: bounds\.height \}\)\) \{\n\s*event\.preventDefault\(\);\n(?:\s*\/\/.*\n)*\s*userViewRef\.current = viewportScopeKey;\n\s*\}/);
  // The first fit still follows the nodes until the person moves the view.
  assert.match(page, /if \(fittedRef\.current === key && userViewRef\.current === viewportScopeKey\) return;/);
});

const collectDialog = read('../src/components/lightchain/StudioCollectDialog.tsx');
const sendMenu = read('../src/components/lightchain/StudioSendMenu.tsx');

test('お気に入りに追加 looks like Light\'s window: round space switch, no ×, open teal folders, a grey キャンセル, Light\'s measured sizes', () => {
  // Measured on Light's production window on 2026-11-12: page darkened ~75%, title 14px, tabs and buttons 12px, tabs not bold.
  assert.match(collectDialog, /bg-black\/75" role="dialog" aria-modal="true" aria-label=\{TEXT\.title\} data-testid="studio-collect-dialog"/);
  assert.match(collectDialog, /w-\[min\(520px,calc\(100vw-32px\)\)\] flex-col rounded-xl bg-\[#26292b\]/);
  assert.match(collectDialog, /<h2 className="text-sm font-normal text-white\/90">/);
  assert.match(collectDialog, /<div className="ml-auto flex items-center rounded-full bg-\[#313538\] p-1" role="tablist"/);
  assert.match(collectDialog, /`h-7 rounded-full px-4 text-xs transition \$\{active \? 'bg-\[#20d0c4\]\/15 text-\[#20d0c4\]' : 'text-white\/60 hover:text-white'\}`/);
  assert.doesNotMatch(collectDialog, /font-semibold/);
  assert.doesNotMatch(collectDialog, /aria-label="閉じる"/);
  assert.match(collectDialog, /px-6 pb-1 text-xs text-white\/35">/);
  // Folders: Light's open-folder mark, a faint line under each row; the list grows with up to four rows like Light's.
  assert.match(collectDialog, /<StudioFolderOpenIcon \/><span className="truncate">\{folder\.name\}<\/span>/);
  assert.match(collectDialog, /data-icon="folder-open-filled"/);
  assert.match(collectDialog, /<li key=\{folder\.id\} className="flex items-center border-b border-white\/\[0\.06\]">/);
  assert.match(collectDialog, /<div className="mx-6 mb-7 mt-3 min-h-\[176px\] flex-1 overflow-y-auto" data-testid="studio-collect-folders">/);
  assert.match(collectDialog, /<div className="flex items-center gap-4 border-t border-white\/10 px-6 py-4">/);
  assert.match(collectDialog, /className="h-8 rounded-md bg-\[#20d0c4\] px-4 text-xs text-\[#0f1718\] disabled:opacity-40">\{TEXT\.newGroup\}/);
  assert.match(collectDialog, /className="ml-auto h-8 rounded-md bg-\[#545d62\] px-4 text-xs text-white/);
  assert.match(collectDialog, /px-4 text-xs text-\[#0f1718\] disabled:bg-\[#454a4d\] disabled:text-white\/30/);
});

test('送る opens its list beside the toolbar, centred on the button like Light', () => {
  assert.match(sendMenu, /<div role="menu" aria-label="送る" className="absolute left-full top-1\/2 z-40 ml-2 w-max min-w-\[180px\] -translate-y-1\/2/);
  assert.match(sendMenu, /const itemClass = 'flex w-full items-center gap-2 rounded-lg px-2 py-3\.5 /);
});

test('the toolbar icons are Light\'s own 20×20 toolbar icons, the same ten as Light\'s toolbar', () => {
  const icons = read('../src/components/lightchain/StudioToolbarIcon.tsx');
  assert.match(icons, /<svg viewBox="0 0 20 20" width="1em" height="1em" fill="none" aria-hidden="true" data-toolbar-icon=\{name\}/);
  for (const name of ['clipping', 'text', 'region', 'underwear', '3d', 'edit', 'search', 'collect', 'download', 'send']) assert.match(icons, new RegExp(`\\n  '${name}': \\[\\n    \\{ d: 'M`));
  const toolbar = page.slice(page.indexOf('data-testid="fashion-studio-node-toolbar"'), page.indexOf('data-testid="fashion-studio-node-feedback"'));
  assert.match(toolbar, /<StudioToolbarIcon name="clipping" \/>クリッピング<\/button>/);
  assert.match(toolbar, /<StudioToolbarIcon name=\{fn\} \/>\{info\.label\}<\/button>/);
  assert.match(toolbar, /triggerIcon=\{<StudioToolbarIcon name="edit" \/>\}/);
  assert.match(toolbar, /setSearchOpen\(true\); \}\}><StudioToolbarIcon name="search" \/><\/button>/);
  assert.match(toolbar, /onClick=\{\(\) => setCollectTarget\(\{ url \}\)\}><StudioToolbarIcon name="collect" \/><\/button>/);
  assert.match(toolbar, /onClick=\{\(\) => void downloadNodeImage\(url\)\}><StudioToolbarIcon name="download" \/><\/button>/);
  assert.match(toolbar, /icon=\{<StudioToolbarIcon name="send" \/>\}/);
  assert.doesNotMatch(toolbar, /className="h-4 w-4"/);
  // Other places keep their own marks: 画像編集 and 送る fall back to theirs.
  assert.match(sendMenu, /\{icon \?\? <SendHorizontal aria-hidden="true" className="h-4 w-4" \/>\}/);
  assert.match(editMenu, /\{triggerIcon \?\? <WandSparkles aria-hidden="true" className="h-4 w-4" \/>\}\{label\}\n\s*<\/button>/);
});

test('the toolbar is Light\'s size: 42 high, 32px buttons with 20px marks and 12px white words of weight 500, 32px square mark buttons, 32px dividers, teal on hover', () => {
  assert.match(css, /\.fashion-studio-node-toolbar \{\n(?:\s*\/\*[^]*?\*\/\n)?\s*height: 42px;\n\s*gap: 4px;\n\s*border-color: rgb\(255 255 255 \/ 10%\);\n\s*border-radius: 12px;\n\s*color: #fff;\n\s*font-size: 12px;\n\s*font-weight: 500;\n\s*line-height: 16px;/);
  assert.match(css, /\.fashion-studio-node-toolbar > button,\n\.fashion-studio-node-toolbar \.fashion-studio-node-toolbar-trigger \{\n\s*height: 32px;\n\s*gap: 4px;\n\s*padding: 0 8px;\n\}/);
  assert.match(css, /\.fashion-studio-node-toolbar > button > svg,\n\.fashion-studio-node-toolbar \.fashion-studio-node-toolbar-trigger > svg \{\n\s*width: 20px;\n\s*height: 20px;/);
  assert.match(css, /\.fashion-studio-node-toolbar > button:hover:not\(:disabled\),\n\.fashion-studio-node-toolbar \.fashion-studio-node-toolbar-trigger:hover:not\(:disabled\) \{\n\s*color: #20d0c4;\n\}/);
  assert.match(css, /\.fashion-studio-node-toolbar > \.fashion-studio-node-toolbar-divider \{\n\s*height: 32px;\n\s*margin: 0;/);
  // 4 + 32 + 4 inside, 1px lines: 42.
  assert.equal(4 + 32 + 4 + 2, 42);
  // Light measured on screen (2026-11-12): テキストで生成 is a 124 wide button, its words 84 wide (7 × 12px); the mark buttons are 32 square.
  assert.equal(8 + 20 + 4 + 7 * 12 + 8, 124);
  assert.match(css, /\.fashion-studio-node-toolbar > button\[aria-label\],\n\.fashion-studio-node-toolbar \.fashion-studio-node-toolbar-trigger\[aria-label="送る"\] \{\n\s*width: 32px;\n\s*justify-content: center;\n\s*padding: 0;\n\}/);
  assert.match(css, /\.fashion-studio-node-toolbar > \.fashion-studio-node-toolbar-divider:first-of-type \{\n\s*margin-left: 4px;\n\}/);
  // Only the mark buttons carry an aria-label: クリッピング and the function buttons show their words.
  const toolbar = page.slice(page.indexOf('data-testid="fashion-studio-node-toolbar"'), page.indexOf('data-testid="fashion-studio-node-feedback"'));
  assert.equal((toolbar.match(/<button type="button" aria-label=/g) ?? []).length, 3);
  // Light draws the studio in its body font, so Japanese comes out in PingFang SC.
  assert.match(css, /\.fashion-studio-project-detail-parity \{\n[^}]*font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",/);
  assert.doesNotMatch(css, /\.fashion-studio-project-detail-parity \{\n[^}]*font-family: Inter/);
});

test('画像編集 and 送る light up while their list is open, like Light (a lighter ground, teal mark and words)', () => {
  assert.match(css, /\.fashion-studio-node-toolbar \.fashion-studio-node-toolbar-trigger\[aria-expanded="true"\] \{\n\s*background: rgb\(255 255 255 \/ 10%\);\n\s*color: #20d0c4;\n\}/);
  // The light look uses Light's light colours: a black 8% ground and #022f31.
  assert.match(css, /\.fashion-studio-node-toolbar \.fashion-studio-node-toolbar-trigger\[aria-expanded="true"\]\) \{ background: rgba\(0, 0, 0, 0\.08\); color: #022f31; \}/);
  assert.match(editMenu, /aria-haspopup="menu"\n\s*aria-expanded=\{menuOpen\}/);
  assert.match(sendMenu, /aria-haspopup="menu"\n\s*aria-expanded=\{open\}/);
  assert.match(page, /<StudioImageEditMenu [^>]*triggerClassName="fashion-studio-node-toolbar-trigger"/);
  assert.match(page, /<StudioSendMenu imageUrl=\{url\} className="fashion-studio-node-toolbar-trigger" icon=\{<StudioToolbarIcon name="send" \/>\} \/>/);
});

test('the 画像編集 list is Light\'s size and look: about 190 wide on #303538, 37px rows of 12px words, a round NEW, Light\'s marks', () => {
  assert.match(editMenu, /className=\{`absolute top-full z-40 mt-1\.5 w-\[194px\] rounded-xl border border-white\/10 bg-\[#303538\] p-1 shadow-2xl/);
  assert.match(editMenu, /const itemClass = 'flex h-\[37px\] w-full items-center gap-2 rounded-lg pl-3\.5 pr-3 text-left text-xs /);
  // The longest item, ワンクリックで背景削除 (11 characters of 12px), fits on its line: 194 - 2 border - 8 padding - 14 - 12 - 16 icon - 8 gap = 134.
  assert.ok(194 - 2 - 8 - 14 - 12 - 16 - 8 >= 11 * 12);
  assert.match(editMenu, /\{item\.badge && <span className="rounded-full px-2 py-0\.5 text-xs font-medium leading-4 text-\[#0b2a33\]"/);
  // Light's own eight list icons, copied from the list opened in Light's production studio.
  const menuIcons = read('../src/components/lightchain/StudioEditMenuIcon.tsx');
  const boxes = [['repair', 20], ['partial', 16], ['upscale', 16], ['remove-background', 16], ['clipping', 16], ['crop', 16], ['expand', 16], ['erase', 16]] as const;
  boxes.forEach(([name, box]) => assert.match(menuIcons, new RegExp(`\\n  '${name}': \\{ box: ${box}, paths: \\[\\n    \\{ d: 'M`)));
  assert.match(editMenu, /repair: menuIcon\('repair'\), partial: menuIcon\('partial'\), upscale: menuIcon\('upscale'\), 'remove-background': menuIcon\('remove-background'\),\n\s*clipping: menuIcon\('clipping'\), crop: menuIcon\('crop'\), expand: menuIcon\('expand'\), erase: menuIcon\('erase'\),/);
  assert.doesNotMatch(editMenu, /const StudioRepairIcon|crop: Crop|expand: Scaling/);
  // The windows show the same mark at their top left as the list (Light's windows do).
  assert.match(editMenu, /partial: \{ title: '部分編集', icon: TOOL_ICON\.partial,/);
  assert.match(editMenu, /clipping: \{ title: 'クリッピング', icon: TOOL_ICON\.clipping,/);
  assert.match(editMenu, /erase: \{ title: 'AI削除', icon: TOOL_ICON\.erase,/);
  assert.match(editMenu, /<EditDialogFrame icon=\{TOOL_ICON\.crop\} title="AIトリミング"/);
  assert.match(editMenu, /<EditDialogFrame icon=\{TOOL_ICON\.expand\} title="AI拡張"/);
});

test('a signed image URL kept while the page is open is signed again before the studio reads the image once more', () => {
  // 2026-11-12 production: クリッピング showed 画像を読み込めませんでした 11 minutes after a reload, because the node's URL had
  // been reused from the cache 5 minutes before it expired (the media read answered 401).
  const storage = read('../src/lib/storage.ts');
  assert.match(storage, /const signedUrlPaths = new Map<string, string>\(\);/);
  assert.match(storage, /if \(cached && cached\.reuseUntil > Date\.now\(\)\) \{ signedUrlPaths\.set\(cached\.url, path\); return cached\.url; \}/);
  assert.match(storage, /if \(!result\.ok\) return null;\n\s*signedUrlPaths\.set\(result\.url, path\);/);
  assert.match(storage, /export async function refreshSignedImageUrl\(url: string\): Promise<string> \{\n\s*const path = signedUrlPaths\.get\(url\);\n\s*if \(!path\) return url;\n\s*try \{\n\s*return \(await createSignedMediaUrl\(path\)\) \?\? url;/);
  // Every place that reads the image again goes through it.
  const surface = read('../src/components/lightchain/StudioMaskSurface.tsx');
  assert.match(surface, /const loadImage = async \(url: string\) => \{\n\s*const source = await refreshSignedImageUrl\(url\);/);
  assert.match(surface, /const response = await fetch\(await refreshSignedImageUrl\(url\)\);/);
  assert.match(surface, /<img src=\{image\.src\} alt="編集する画像"/);
  assert.match(editMenu, /const loadImage = async \(url: string\) => \{\n\s*const source = await refreshSignedImageUrl\(url\);/);
  assert.match(editMenu, /<img src=\{image \? image\.src : imageUrl\} alt="トリミングする画像"/);
  assert.match(editMenu, /<img src=\{image \? image\.src : imageUrl\} alt="拡張する画像"/);
  assert.match(collectDialog, /studioCollectImageDataUrl\(await refreshSignedImageUrl\(imageUrl\)\)/);
  // 送る opens the tab inside the click (so it is not blocked) and sends it on once the URL is signed again.
  assert.match(sendMenu, /const tab = window\.open\('', '_blank'\);\n\s*void refreshSignedImageUrl\(imageUrl\)\.then\(url => \{\n\s*const href = studioSendHref\(path, url\);\n\s*if \(tab\) tab\.location\.href = href; else window\.open\(href, '_blank'\);/);
  // Generation, the mask editor's size, ダウンロード and 全画面表示.
  assert.match(page, /const mainUrl = await refreshSignedImageUrl\(loadedMain\.url\);/);
  assert.match(page, /const references = await Promise\.all\(chosen\.map\(item => refreshSignedImageUrl\(sourceOf\(item\)\)\)\);/);
  assert.match(page, /const main = \{ objectId: detail\.roles\.main\.objectId, imageUrl: mainUrl, verified: true \};/);
  assert.match(page, /naturalImageSize\(await refreshSignedImageUrl\(loadedMain\.url\)\)/);
  assert.match(page, /await loadStudioExampleFile\(await refreshSignedImageUrl\(url\)\)/);
  assert.match(page, /void refreshSignedImageUrl\(url\)\.then\(fresh => \{ if \(fresh !== url\) setLightbox/);
  assert.doesNotMatch(page, /onExpand=\{setLightbox\}|onExpand: setLightbox/);
});

test('the 👍👎 bar under a result is Light\'s size: 42 high, 32px square thumbs with 16px white marks, 32px buttons of 12px words, 32px dividers', () => {
  assert.match(css, /\.fashion-studio-node-feedback \{\n\s*height: 42px;\n\s*border-color: rgb\(255 255 255 \/ 10%\);\n\s*border-radius: 12px;\n\s*color: #fff;\n\}/);
  assert.match(css, /\.fashion-studio-node-feedback \[data-testid="studio-feedback-bar"\] \{ gap: 4px; \}/);
  assert.match(css, /\.fashion-studio-node-feedback \[data-testid="studio-feedback-bar"\] > button,\n\.fashion-studio-node-feedback \[data-testid="studio-feedback-improve"\] \{\n\s*height: 32px;\n\s*padding: 0 8px;\n\s*font-size: 12px;\n\s*font-weight: 500;/);
  assert.match(css, /\.fashion-studio-node-feedback \.fashion-studio-feedback-icon > svg \{ width: 16px; height: 16px; \}/);
  assert.match(css, /\.fashion-studio-node-feedback \.fashion-studio-feedback-icon \{\n\s*width: 32px;\n\s*justify-content: center;\n\s*padding: 0;\n\s*color: inherit;\n\}/);
  assert.match(css, /\.fashion-studio-node-feedback \[data-testid="studio-feedback-bar"\] > \.fashion-studio-node-toolbar-divider \{ height: 32px; margin: 0;/);
  // Light measured on screen (2026-11-12): 1 + (4 + 32 + 4 + 32 + 4) + 1 + (4 + 124 + 4) + 1 + (4 + 52 + 4) + 1 = 272, where フィードバックする is 9 × 12 + 16 and 再生成 3 × 12 + 16.
  assert.equal(1 + (4 + 32 + 4 + 32 + 4) + 1 + (4 + (9 * 12 + 16) + 4) + 1 + (4 + (3 * 12 + 16) + 4) + 1, 272);
});
