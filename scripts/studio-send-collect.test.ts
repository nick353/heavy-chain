import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INCOMING_IMAGE_MAX_BYTES, fetchIncomingImageFile, incomingImageFileName, parseIncomingImageUrl, searchWithoutIncomingImage, type IncomingImageFetch,
} from '../src/lib/incomingImage.ts';
import { STUDIO_SEND_GROUPS, studioSendHref } from '../src/lib/studioSendMenu.ts';
import {
  STUDIO_COLLECT_FEATURE_TYPE, STUDIO_COLLECT_LIBRARY_SOURCE, STUDIO_COLLECT_TEXT, buildStudioCollectArtifact, studioCollectChildren, studioCollectFolders, studioCollectGroupName,
  studioCollectImageDataUrl, studioCollectTrail,
} from '../src/lib/studioCollect.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/App.tsx');
const sendMenuSource = read('../src/components/lightchain/StudioSendMenu.tsx');
const collectSource = read('../src/components/lightchain/StudioCollectDialog.tsx');

const ORIGIN = 'https://heavychain.app';
const API = 'https://heavy-chain-api.nichika2000823.workers.dev';
const context = { origin: ORIGIN, apiOrigins: [API] };
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const respond = (body: Uint8Array, type: string, init: { status?: number; length?: number } = {}): IncomingImageFetch => async () => {
  const headers = new Headers({ 'content-type': type });
  if (init.length !== undefined) headers.set('content-length', String(init.length));
  return new Response(new Blob([body], { type }), { status: init.status ?? 200, headers });
};

// ---- 送る（メニュー） -------------------------------------------------------------------------------------
test('送るの行き先は本家と同じ3つの束・並び・名前で、Lightchain Lab だけ Heavy の名前', () => {
  assert.deepEqual(STUDIO_SEND_GROUPS.map(group => group.label), ['企画デザインツール', 'AIフィッティング', 'グラフィックツール']);
  assert.deepEqual(STUDIO_SEND_GROUPS.map(group => group.items.map(item => `${item.label} ${item.path}`)), [
    ['デザインワークスペース /designProduction/detail', 'ウェアデザインラボ /flow/orientedDesign/detail', '生地プリントの試着シミュレーション /tools/fabric',
      '線画から実写へ変換 /tools/line-draft-to-tile', '色変更 /editor/changeColor/detail', '平絵をベクター化 /tools/svg-convert', 'カスタムスタイル /model-base/style'],
    ['AIフィッティング /model', 'モデル企画ライブラリ /model-library/model-custom-form', 'ファッションスタジオ /flow/integration/detail',
      '動画ワークステーション /flow/GenerateShortVideo/detail', 'Heavy Chain Lab /flow/laboratory/detail', '画像修正 /tools/reactor'],
    ['デザインワークスペース /designProduction/detail', 'プリントデザイン /editor/patternDesign/detail',
      'パターンをベクター画像に変換（プロフェッショナル版） /tools/vector-special', 'デザインアレンジ /editor/pattern/detail'],
  ]);
});

test('行き先の道はすべて Heavy の App.tsx にある', () => {
  for (const item of STUDIO_SEND_GROUPS.flatMap(group => group.items)) assert.ok(app.includes(`path="${item.path}"`), `${item.path} が App.tsx に無い`);
});

test('選ぶと新しいタブで <行き先>?imgUrl=<画像の住所>（本家の qs.stringify と同じ符号化）', () => {
  const image = `${API}/v1/media/read?token=a.b+c/d=&variant=thumb`;
  const href = studioSendHref('/tools/reactor', image);
  assert.equal(href, `/tools/reactor?imgUrl=${encodeURIComponent(image)}`);
  assert.equal(new URL(href, ORIGIN).searchParams.get('imgUrl'), image);
  // The tab opens inside the click; it goes to studioSendHref(path, <the image's URL, signed again if it had expired>).
  assert.match(sendMenuSource, /const tab = window\.open\('', '_blank'\);/);
  assert.match(sendMenuSource, /const href = studioSendHref\(path, url\);\n\s*if \(tab\) tab\.location\.href = href; else window\.open\(href, '_blank'\);/);
  assert.match(sendMenuSource, /STUDIO_SEND_GROUPS\.map\(/);
  assert.match(sendMenuSource, /aria-label="送る"/);
  assert.match(sendMenuSource, /title="送る"/);
  assert.match(sendMenuSource, /data-track-id="send-menu"/);
  // 本家は modal なしで右に開く。
  assert.match(sendMenuSource, /role="menu" aria-label="送る" className="absolute left-full/);
  assert.match(sendMenuSource, /export function StudioSendMenu\(\{ imageUrl, disabled = false, className, icon \}: \{ imageUrl: string; disabled\?: boolean; className\?: string; icon\?: ReactNode \}\)/);
});

// ---- 受け取り（?imgUrl=） ---------------------------------------------------------------------------------
test('読める住所: Heavy が配る画像（同じ画面・heavychain.app・API の署名つきの住所・画像の data:・同じ画面の blob:）', () => {
  for (const raw of [
    '/lightchain-assets/route-icons/design-on.png',
    `${ORIGIN}/scene-assets/a.jpg`,
    'https://www.heavychain.app/a.webp',
    `${API}/v1/media/read?token=abc.def`,
    'data:image/png;base64,iVBORw0KGgo=',
    'data:image/jpeg;base64,/9j/',
    `blob:${ORIGIN}/0b6c4f5e-1111-4222-8333-944445555666`,
  ]) assert.ok(parseIncomingImageUrl(raw, context), raw);
});

test('受けない住所: 外の任意の住所・API の別の道・印の無い署名・http・資格情報つき・スクリプト・SVG・別の画面の blob', () => {
  for (const raw of [
    'https://example.com/a.png',
    '//evil.example/a.png',
    'https://heavychain.app.evil.example/a.png',
    `${API}/v1/media/abc/content`,
    `${API}/v1/media/read`,
    `${API}/v1/media/read?bucket=generated-images&path=generated-images/x`,
    'http://heavychain.app/a.png',
    'https://user:pass@heavychain.app/a.png',
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'blob:https://example.com/0b6c4f5e-1111-4222-8333-944445555666',
    '',
    '   ',
  ]) assert.equal(parseIncomingImageUrl(raw, context), null, raw);
  assert.equal(parseIncomingImageUrl(null, context), null);
  // API の住所が設定に無ければ、その署名つきの住所も受けない。
  assert.equal(parseIncomingImageUrl(`${API}/v1/media/read?token=abc`, { origin: ORIGIN }), null);
});

test('受け取った画像を File に: 画像だけ・20MB まで・読めなければ投げる', async () => {
  const url = parseIncomingImageUrl(`${API}/v1/media/read?token=abc`, context)!;
  const file = await fetchIncomingImageFile(url, { fetchImpl: respond(PNG, 'image/png') });
  assert.equal(file.type, 'image/png');
  assert.equal(file.name, '送られた画像.png');
  assert.equal(file.size, PNG.length);
  await assert.rejects(fetchIncomingImageFile(url, { fetchImpl: respond(PNG, 'text/html') }), /incoming_image_type/);
  await assert.rejects(fetchIncomingImageFile(url, { fetchImpl: respond(PNG, 'image/svg+xml') }), /incoming_image_type/);
  await assert.rejects(fetchIncomingImageFile(url, { fetchImpl: respond(PNG, 'image/png', { status: 404 }) }), /incoming_image_unavailable/);
  await assert.rejects(fetchIncomingImageFile(url, { fetchImpl: respond(PNG, 'image/png', { length: INCOMING_IMAGE_MAX_BYTES + 1 }) }), /incoming_image_too_large/);
  await assert.rejects(fetchIncomingImageFile(url, { fetchImpl: respond(PNG, 'image/png'), maxBytes: 4 }), /incoming_image_too_large/);
  assert.equal(incomingImageFileName(new URL(`${ORIGIN}/scene-assets/coat.jpg`), 'image/jpeg'), 'coat.jpg');
  assert.equal(incomingImageFileName(new URL('data:image/webp;base64,UklGRg=='), 'image/webp'), '送られた画像.webp');
});

test('開いたら imgUrl だけを URL から消す（ほかの引数は残す）', () => {
  assert.equal(searchWithoutIncomingImage('?imgUrl=%2Fa.png'), '');
  assert.equal(searchWithoutIncomingImage('?boardProjectCode=p1&imgUrl=%2Fa.png&tab=x'), '?boardProjectCode=p1&tab=x');
  assert.equal(searchWithoutIncomingImage(''), '');
});

test('受け取りは、URL から消した後・受け取り先の準備ができてから1回だけ渡し、作り直した部品が引き継ぐ', () => {
  const hook = read('../src/lib/incomingImage.ts');
  assert.match(hook, /navigate\(\{ pathname: location\.pathname, search: searchWithoutIncomingImage\(location\.search\), hash: location\.hash \}, \{ replace: true/);
  assert.match(hook, /if \(!entry \|\| !ready \|\| raw !== null\) return;/);
  assert.match(hook, /if \(!active \|\| taken !== entry\) return;\n\s+taken = null;\n\s+return onFileRef\.current\(file\);/);
  assert.match(hook, /taken\.pathname === location\.pathname && Date\.now\(\) - taken\.at < ADOPT_MS/);
  // 共通の画像作業は、下書きの復元が済んでから受け取る（復元が受け取った画像を上書きしない）。
  const workspace = read('../src/hooks/useCanonicalImageWorkspace.ts');
  assert.match(workspace, /inputsSettled:settledScope===scope&&state\.status!=='loading'/);
  assert.match(workspace, /draftReady\.current = scope;\n\s+setSettledScope\(scope\);/);
});

test('送るの行き先の画面は、それぞれ既存の画像の入り口へ受け取りをつなぐ（ファッションスタジオは呼び出し側）', () => {
  const pages: Array<[string, RegExp]> = [
    ['../src/features/designDetail/DesignEntryDetailPage.tsx', /useIncomingImageFile\(\(file\) => addFiles\(\[file\]\), \{ ready: brandReady \}\)/],
    ['../src/pages/LightchainParityPages.tsx', /useIncomingImageFile\(\(file\) => workspace\.upload\('primary', file\), \{ ready: workspace\.inputsSettled && !referenceCase \}\)/],
    ['../src/pages/LightchainParityPages.tsx', /useIncomingImageFile\(acceptReferenceImage,\{ready:workspace\.inputsSettled\}\)/],
    ['../src/pages/LightchainMaterialWorkbenchPage.tsx', /if \(isPrinting\) selectPrintGarment\(image\); else setFabricDesign\(image\);\n\s+\}, \{ ready:/],
    ['../src/pages/LightchainLineToolsPage.tsx', /useIncomingImageFile\(acceptFile, \{ ready: workspace\.inputsSettled \}\)/],
    ['../src/pages/ChangeColorDetailPage.tsx', /useIncomingImageFile\(acceptFile, \{ ready: workspace\.inputsSettled \}\)/],
    ['../src/pages/LightchainCustomStylePage.tsx', /useIncomingImageFile\(\(file\) => startUpload\(\[file\]\), \{ ready: Boolean\(brandId\) && styles !== null && !busy \}\)/],
    ['../src/pages/LightchainWorkbenchPage.tsx', /useIncomingImageFile\(\(file\) => uploadMaterialSlotFile\('primary', file\), \{ ready:/],
    ['../src/components/lightchain/SourceModelLibrarySurface.tsx', /useIncomingImageFile\(\(file\)=>\{if\(locked\)return;if\(settings\?\.inputMode!=='custom'\)chooseMode\('custom'\);return workspace\.upload\('secondary',file\);\}/],
    ['../src/pages/VideoWorkstationPage.tsx', /useIncomingImageFile\(acceptInitialImageFile\)/],
    ['../src/pages/LightchainLabDetailPage.tsx', /useIncomingImageFile\(\(file\) => workspace\.upload\('primary', file\), \{ ready: workspace\.inputsSettled \}\)/],
    ['../src/pages/LightchainImageRepairPage.tsx', /useIncomingImageFile\(acceptFile, \{ ready: workspace\.inputsSettled \}\)/],
    ['../src/pages/PrintDesignDetailPage.tsx', /useIncomingImageFile\(\(file\) => acceptFile\('primary', file\), \{ ready: workspace\.inputsSettled \}\)/],
    ['../src/pages/PatternDesignDetailPage.tsx', /useIncomingImageFile\(\(file\) => acceptFile\('primary', file\), \{ ready: workspace\.inputsSettled \}\)/],
  ];
  for (const [path, pattern] of pages) assert.match(read(path), pattern, path);
  // 手で選ぶ入り口も同じ関数を通る（受け取りだけ別の道にしない）。
  assert.match(read('../src/pages/LightchainWorkbenchPage.tsx'), /try \{ await uploadMaterialSlotFile\(slot, file\); \} finally \{ event\.target\.value = ''; \}/);
  assert.match(read('../src/pages/VideoWorkstationPage.tsx'), /if \(file\) acceptInitialImageFile\(file\);/);
});

// ---- お気に入り ---------------------------------------------------------------------------------------
test('お気に入りの保存の形はプリントデザインの collect と同じ（librarySource・libraryGroup はフォルダの id）', () => {
  const artifact = buildStudioCollectArtifact({
    brandId: 'brand-1', userId: 'user-1', imageUrl: 'data:image/png;base64,iVBORw0KGgo=', title: '結果', folder: { id: 'folder-9' },
    sourceStoragePath: 'generated-images/img-1', createdAt: '2026-11-12T00:00:00.000Z',
  });
  assert.deepEqual(artifact, {
    brandId: 'brand-1', scopeId: 'user-1', featureType: STUDIO_COLLECT_FEATURE_TYPE, title: '結果', prompt: '結果', imageUrl: 'data:image/png;base64,iVBORw0KGgo=',
    createdAt: '2026-11-12T00:00:00.000Z', metadata: { librarySource: STUDIO_COLLECT_LIBRARY_SOURCE, libraryGroup: 'folder-9', sourceStoragePath: 'generated-images/img-1' },
  });
  assert.equal(buildStudioCollectArtifact({ brandId: 'b', userId: 'u', imageUrl: 'data:', folder: { id: 'f' } }).title, 'ファッションスタジオ');
  assert.equal('sourceStoragePath' in buildStudioCollectArtifact({ brandId: 'b', userId: 'u', imageUrl: 'data:', folder: { id: 'f' } }).metadata, false);
  assert.match(collectSource, /saveWorkspaceArtifactBestEffort\(\n\s+buildStudioCollectArtifact\(/);
  assert.match(collectSource, /if \(!result\.localPersisted \|\| \(cloudflareDataPlane && !result\.remote\)\) throw new Error\('library_save_unconfirmed'\);/);
  assert.match(collectSource, /toast\.success\(TEXT\.saved\);\n\s+onClose\(\);/);
});

test('お気に入りのフォルダはライブラリー画面と同じ /v1/folders、ホームから階層をたどる', () => {
  const folders = studioCollectFolders([
    { id: 'a', name: '春夏', parent_folder_id: null },
    { id: 'b', name: 'コート', parent_folder_id: 'a' },
    { id: 'c', name: '親が消えた', parent_folder_id: 'gone' },
    { id: 'd', name: '秋冬' },
  ]);
  assert.deepEqual(studioCollectChildren(folders, null).map(folder => folder.name), ['春夏', '親が消えた', '秋冬']);
  assert.deepEqual(studioCollectChildren(folders, 'a').map(folder => folder.name), ['コート']);
  assert.deepEqual(studioCollectTrail(folders, 'b').map(folder => folder.name), ['春夏', 'コート']);
  assert.deepEqual(studioCollectTrail(folders, null), []);
  assert.equal(studioCollectGroupName('  新しい  '), '新しい');
  assert.equal(studioCollectGroupName('   '), null);
  assert.equal(studioCollectGroupName('x'.repeat(51)), null);
  assert.match(collectSource, /cloudflareDataPlane\.listFolders\(brandId\)/);
  assert.match(collectSource, /cloudflareDataPlane\.createFolder\(\{ id, brand_id: brandId, name, parent_folder_id: parentId \}\)/);
});

test('お気に入りの窓は本家と同じ言葉で、決定は選ぶまで押せず、チームスペースは空', () => {
  assert.equal(STUDIO_COLLECT_TEXT.title, 'お気に入りに追加');
  assert.deepEqual([STUDIO_COLLECT_TEXT.personal, STUDIO_COLLECT_TEXT.team, STUDIO_COLLECT_TEXT.home, STUDIO_COLLECT_TEXT.newGroup, STUDIO_COLLECT_TEXT.cancel, STUDIO_COLLECT_TEXT.confirm],
    ['パーソナルスペース', 'チームスペース', 'ホーム', '新規グループ作成', 'キャンセル', '決定']);
  assert.match(collectSource, /disabled=\{!selected \|\| busy !== null\} onClick=\{\(\) => void confirm\(\)\}/);
  assert.match(collectSource, /const selected = space === 'personal' \? folders\?\.find\(folder => folder\.id === selectedId\) \?\? null : null;/);
  assert.match(collectSource, /\{space === 'team' \? \(\n\s+<p className="py-10 text-center text-sm text-white\/50">\{TEXT\.teamEmpty\}<\/p>/);
  assert.match(collectSource, /export function StudioCollectDialog\(\{ imageUrl, title, sourceStoragePath, onClose \}: \{\n\s+imageUrl: string;\n\s+title\?: string;/);
});

test('お気に入りの画像は data: にして保存する（住所は Heavy が配る画像だけを読む）', async () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(await studioCollectImageDataUrl(dataUrl, { origin: ORIGIN, apiOrigins: [API] }), dataUrl);
  const converted = await studioCollectImageDataUrl(`${API}/v1/media/read?token=abc`, { origin: ORIGIN, apiOrigins: [API], fetchImpl: respond(PNG, 'image/png') });
  assert.equal(converted, `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`);
  await assert.rejects(studioCollectImageDataUrl('https://example.com/a.png', { origin: ORIGIN, apiOrigins: [API], fetchImpl: respond(PNG, 'image/png') }), /studio_collect_image_url_rejected/);
});
