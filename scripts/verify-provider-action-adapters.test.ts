import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMPOSITE_PROVIDER_ACTIONS, runCompositeProviderAction, type CompositeDeps, type PlanItem } from '../src/lib/providerActionAdapters.ts';
import { buildZip, crc32, unsharpMask } from '../src/lib/clientImageOps.ts';

type Body = Record<string, any>;
const item = (key: string, label: string, prompt: string, extra: Partial<PlanItem> = {}): PlanItem =>
  ({ key, label, prompt, headline: '', subheadline: '', ...extra });

function fakeDeps(planItems: PlanItem[] | Error = []) {
  const imageCalls: Array<{ action: string; body: Body }> = []; const planCalls: Body[] = [];
  let n = 0;
  const deps: CompositeDeps = {
    async image(action, body) {
      imageCalls.push({ action, body });
      const count = Number(body.count) || 1;
      return { images: Array.from({ length: count }, () => { n++; return { imageUrl: `https://img/${n}`, storagePath: `p/${n}`, imageId: `i${n}`, jobId: `j${n}` }; }) };
    },
    async plan(body) { planCalls.push(body); if (planItems instanceof Error) throw planItems; return { items: planItems }; },
    async toDataUrl() { return 'data:image/png;base64,AAAA'; },
    async cutout(url) { return `cutout:${url}`; },
    async upscale(url, options) { return `upscaled:${url}:${options.scale}`; },
  };
  return { deps, imageCalls, planCalls };
}
const legal = { brandId: 'brand', legalSafety: { rightsConfirmed: true }, generationProvider: 'workers_ai' };

test('every previously unimplemented image feature is composed in the browser', () => {
  for (const action of ['multilingual-banner', 'design-gacha', 'product-shots', 'generate-variations', 'colorize', 'remove-background', 'upscale']) {
    assert(COMPOSITE_PROVIDER_ACTIONS.has(action), action);
  }
  for (const action of ['generate-image', 'edit-image', 'model-matrix', 'optimize-prompt']) assert(!COMPOSITE_PROVIDER_ACTIONS.has(action), action);
});

test('multilingual-banner renders one translated banner per language in the legacy shape', async () => {
  const { deps, imageCalls, planCalls } = fakeDeps([
    item('en', '英語', 'Spring banner', { headline: 'Spring Sale', subheadline: 'Up to 30% off' }),
    item('ko', '韓国語', 'Korean banner', { headline: '봄 세일' }),
  ]);
  const result = await runCompositeProviderAction('multilingual-banner',
    { ...legal, headline: '春セール', subheadline: '最大30%オフ', languages: ['en', 'ko'], aspectRatio: '4:5', referenceImage: 'https://ref' }, deps);
  assert.equal(planCalls[0].task, 'banner');
  assert.deepEqual(planCalls[0].items, ['en', 'ko']);
  assert.equal(planCalls[0].imageDataUrl, 'data:image/png;base64,AAAA');
  assert.equal(imageCalls.length, 2);
  assert.equal(imageCalls[0].action, 'edit-image');
  assert.equal(imageCalls[0].body.imageUrl, 'https://ref');
  assert.equal(imageCalls[0].body.aspectRatio, '4:5');
  assert.deepEqual(imageCalls[0].body.textOverlay, { text: 'Spring Sale\nUp to 30% off' });
  assert.deepEqual(imageCalls[0].body.legalSafety, { rightsConfirmed: true });
  assert.equal(imageCalls[0].body.generationProvider, 'workers_ai');
  assert.deepEqual(result.banners.map((b: Body) => [b.languageName, b.headline, b.imageUrl, b.storagePath]),
    [['英語', 'Spring Sale', 'https://img/1', 'p/1'], ['韓国語', '봄 세일', 'https://img/2', 'p/2']]);
});

test('design-gacha and product-shots generate without a reference and keep labels', async () => {
  const gacha = fakeDeps([item('1', 'ミニマル', 'minimal tee'), item('2', 'レトロ', 'retro tee')]);
  const variations = await runCompositeProviderAction('design-gacha', { ...legal, brief: 'Tシャツ', directions: 2, fixedElements: ['product'] }, gacha.deps);
  assert.deepEqual(gacha.imageCalls.map(c => c.action), ['generate-image', 'generate-image']);
  assert.equal(gacha.planCalls[0].count, 2);
  assert.deepEqual(variations.variations.map((v: Body) => v.directionName), ['ミニマル', 'レトロ']);
  assert.equal(variations.jobId, 'j1');

  const shots = fakeDeps([item('front', '正面', 'front view'), item('back', '背面', 'back view')]);
  const result = await runCompositeProviderAction('product-shots', { ...legal, productDescription: '白シャツ', shots: ['front', 'back'], imageUrl: 'https://garment' }, shots.deps);
  assert.deepEqual(shots.imageCalls.map(c => [c.action, c.body.prompt]), [['edit-image', 'front view'], ['edit-image', 'back view']]);
  assert.deepEqual(result.shots.map((s: Body) => s.shotName), ['正面', '背面']);
  assert.equal(result.productDescription, '白シャツ');
  await assert.rejects(runCompositeProviderAction('product-shots', { ...legal }, fakeDeps().deps), /product_description_or_image_required/);
});

test('variations share one instruction across candidates; scenes plan one edit each', async () => {
  const single = fakeDeps([item('1', 'v', 'casual variation')]);
  const result = await runCompositeProviderAction('generate-variations', { ...legal, imageUrl: 'https://g', count: 3, strength: 0.5, prompt: 'カジュアル' }, single.deps);
  assert.equal(single.imageCalls.length, 1);
  assert.equal(single.imageCalls[0].body.count, 3);
  assert.equal(single.planCalls[0].task, 'variations');
  assert.equal(result.variations.length, 3);

  const scenes = fakeDeps([item('cafe', 'カフェ', 'in a cafe'), item('street', '街', 'on a street')]);
  const sceneResult = await runCompositeProviderAction('generate-variations',
    { ...legal, imageUrl: 'https://g', scenes: ['cafe', 'street'], featureType: 'scene-coordinate' }, scenes.deps);
  assert.equal(scenes.planCalls[0].task, 'scene');
  assert.deepEqual(scenes.imageCalls.map(c => c.body.featureType), ['scene-coordinate', 'scene-coordinate']);
  assert.equal(sceneResult.variations.length, 2);
  await assert.rejects(runCompositeProviderAction('generate-variations', { ...legal }, fakeDeps().deps), /reference_image_required/);
});

test('colorize names each variation and falls back to template prompts when Claude is unavailable', async () => {
  const { deps, imageCalls } = fakeDeps(new Error('503 claude_api_key_missing'));
  const result = await runCompositeProviderAction('colorize', { ...legal, imageUrl: 'https://g', colors: ['red', 'navy'], pattern: 'solid' }, deps);
  assert.equal(imageCalls.length, 2);
  assert.match(imageCalls[0].body.prompt, /Recolor only the garment.*red/);
  assert.deepEqual(result.variations.map((v: Body) => v.colorName), ['red', 'navy']);
});

test('one failed render keeps the rest; all failing surfaces the error', async () => {
  const { deps } = fakeDeps([item('red', '赤', 'red'), item('blue', '青', 'blue')]);
  let calls = 0; const image = deps.image;
  deps.image = async (action, body) => { calls++; if (calls === 1) throw new Error('quota'); return image(action, body); };
  const partial = await runCompositeProviderAction('colorize', { ...legal, imageUrl: 'https://g', colors: ['red', 'blue'] }, deps);
  assert.deepEqual(partial.variations.map((v: Body) => v.colorName), ['青']);
  deps.image = async () => { throw new Error('quota'); };
  await assert.rejects(runCompositeProviderAction('colorize', { ...legal, imageUrl: 'https://g', colors: ['red'] }, deps), /quota/);
});

test('remove-background cuts out locally for transparent and edits for a new background', async () => {
  const transparent = fakeDeps();
  const cut = await runCompositeProviderAction('remove-background', { ...legal, imageUrl: 'https://g', newBackground: 'transparent background' }, transparent.deps);
  assert.equal(cut.resultUrl, 'cutout:https://g');
  assert.equal(transparent.imageCalls.length, 0);

  const replaced = fakeDeps();
  const edited = await runCompositeProviderAction('remove-background', { ...legal, imageUrl: 'https://g', newBackground: 'white background, studio lighting' }, replaced.deps);
  assert.equal(replaced.imageCalls[0].action, 'edit-image');
  assert.deepEqual(replaced.imageCalls[0].body.imageUrls, ['https://g']);
  assert.match(replaced.imageCalls[0].body.prompt, /white background/);
  assert.equal(edited.resultUrl, 'https://img/1');

  const withReference = fakeDeps();
  await runCompositeProviderAction('remove-background', { ...legal, imageUrl: 'https://g', backgroundReferenceImage: 'https://bg' }, withReference.deps);
  assert.deepEqual(withReference.imageCalls[0].body.imageUrls, ['https://g', 'https://bg']);
});

test('upscale runs in the browser with a bounded scale', async () => {
  const { deps, imageCalls } = fakeDeps();
  assert.equal((await runCompositeProviderAction('upscale', { ...legal, imageUrl: 'https://g', scale: 4 }, deps)).resultUrl, 'upscaled:https://g:4');
  assert.equal((await runCompositeProviderAction('upscale', { ...legal, imageUrl: 'https://g', scale: 9 }, deps)).resultUrl, 'upscaled:https://g:2');
  assert.equal(imageCalls.length, 0);
});

test('ZIP writer produces an archive that unzip verifies', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const zip = buildZip([
    { name: 'a.png', data: new Uint8Array([1, 2, 3]) },
    { name: 'a.png', data: new Uint8Array([4, 5]) },
    { name: '日本語/バナー.png', data: new Uint8Array(1000).fill(7) },
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'hc-zip-')); const path = join(dir, 'out.zip');
  writeFileSync(path, zip);
  // Python's zipfile checks CRCs and decodes UTF-8 names (flag bit 11).
  const out = execFileSync('python3', ['-c', 'import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps([[i.filename,i.file_size,i.date_time[0]] for i in z.infolist()]))', path], { encoding: 'utf8' });
  const entries = JSON.parse(out) as Array<[string, number, number]>;
  assert.deepEqual(entries.map(([name, size]) => [name, size]), [['a.png', 3], ['a-2.png', 2], ['日本語_バナー.png', 1000]]);
  assert(entries.every(([, , year]) => year >= 2024));
});

test('unsharp mask leaves flat areas unchanged and boosts edges', () => {
  const width = 4, height = 3; const data = new Uint8ClampedArray(width * height * 4).fill(100);
  unsharpMask(data, width, height, 1);
  assert(data.every(v => v === 100));
  data[(1 * width + 1) * 4] = 200;
  const copy = new Uint8ClampedArray(data); unsharpMask(copy, width, height, 1);
  assert(copy[(1 * width + 1) * 4] > 200);
});
