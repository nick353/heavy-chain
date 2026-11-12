import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { extractFashionStudioSavedDetail } from '../src/lib/fashionStudioDetailHydration.ts';
import { buildFashionStudioGeneratedSnapshot, replaceFashionStudioInput } from '../src/lib/fashionStudioDetailAdapter.ts';
import { readStudioLayout, withStudioLayout } from '../src/lib/studioCanvas.ts';
import {
  STUDIO_CANVAS_IMAGE_ROLE, STUDIO_CANVAS_LIMIT_MESSAGE, STUDIO_MAX_CANVAS_IMAGES, STUDIO_MAX_CHILD_FORMS, isStudioChildDocument, isStudioFormKey, newStudioFormId,
  readStudioCanvasImages, readStudioForms, readStudioParent, studioCanvasImageKey, studioCanvasImageObject, studioChildFormIdOf, studioChildFormKey, studioChildNodeKey,
  studioNodeBeside, withStudioCanvasImage, withStudioForm, withStudioParent,
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
  assert.match(maskEditor, /<div className="fixed inset-0 z-50 overflow-auto bg-black\/70" role="dialog"/);
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
  assert.doesNotMatch(maskEditor, /role="menu"/);
  assert.doesNotMatch(maskEditor, /ChevronDown/);
  // Panes: 520×515, teal border and title on the chosen one; the other is dimmed with Light's hint.
  assert.match(maskEditor, /h-\[min\(515px,calc\(87vh-180px\)\)\] min-h-\[320px\] w-\[520px\]/);
  assert.match(maskEditor, /activePane === id \? 'border-\[#20d0c4\]' : 'border-\[#4b5053\]'/);
  assert.match(maskEditor, /'参考にしたい領域を描画してください' : '調整したい領域を描画してください'/);
  assert.match(maskEditor, /\{panes\.length > 1 && activePane !== id && \(\n\s*<div className="pointer-events-none absolute inset-0/);
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

test('お気に入りに追加 looks like Light\'s window: round space switch, no ×, teal folders, a grey キャンセル', () => {
  assert.match(collectDialog, /w-\[min\(520px,calc\(100vw-32px\)\)\] flex-col rounded-xl bg-\[#26292b\]/);
  assert.match(collectDialog, /<div className="ml-auto flex items-center rounded-full bg-\[#1c1f21\] p-1" role="tablist"/);
  assert.match(collectDialog, /active \? 'bg-\[#20d0c4\]\/15 font-semibold text-\[#20d0c4\]'/);
  assert.doesNotMatch(collectDialog, /aria-label="閉じる"/);
  assert.match(collectDialog, /<Folder aria-hidden="true" className="h-4 w-4 shrink-0 fill-\[#20d0c4\] text-\[#20d0c4\]" \/>/);
  assert.match(collectDialog, /<li key=\{folder\.id\} className="flex items-center border-b border-white\/10">/);
  assert.match(collectDialog, /<div className="flex items-center gap-4 border-t border-white\/10 px-6 py-4">/);
  assert.match(collectDialog, /className="ml-auto h-8 rounded-md bg-\[#5b6164\] px-4 text-sm text-white/);
  assert.match(collectDialog, /disabled:bg-\[#3b4043\] disabled:text-white\/30/);
});

test('送る opens its list beside the toolbar, centred on the button like Light', () => {
  assert.match(sendMenu, /<div role="menu" aria-label="送る" className="absolute left-full top-1\/2 z-40 ml-2 w-max min-w-\[180px\] -translate-y-1\/2/);
  assert.match(sendMenu, /const itemClass = 'flex w-full items-center gap-2 rounded-lg px-2 py-3\.5 /);
});

test('the toolbar icons are Light\'s: クリッピング with a pointer, 画像検索 with AI, お気に入り folder with a star, a level 送る plane, 画像編集 without an arrow', () => {
  assert.match(page, /<SquareDashedMousePointer className="h-4 w-4" \/>クリッピング<\/button>/);
  assert.match(page, /setSearchOpen\(true\); \}\}><StudioAiSearchIcon className="h-4 w-4" \/><\/button>/);
  assert.match(page, /onClick=\{\(\) => setCollectTarget\(\{ url \}\)\}><StudioFolderStarIcon className="h-4 w-4" \/><\/button>/);
  assert.match(sendMenu, /<SendHorizontal aria-hidden="true" className="h-4 w-4" \/>/);
  assert.match(editMenu, /<WandSparkles aria-hidden="true" className="h-4 w-4" \/>\{label\}\n\s*<\/button>/);
});
