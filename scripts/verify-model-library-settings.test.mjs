import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const result = await build({ entryPoints: [new URL('../src/lib/modelLibrarySettings.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const settings = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const fresh = settings.defaultModelLibrarySettings();

test('label mode is complete without a source image or invented custom measurements', () => {
  assert.deepEqual(settings.readModelLibrarySettings(fresh), fresh);
  assert.equal(fresh.inputMode, 'label');
  assert.equal(Object.hasOwn(fresh, 'height'), false);
});
test('mode changes preserve both edited input sets through JSON reload', () => {
  const label = { ...fresh, gender: '女性', age: '中年', nationality: '日本', half: true };
  const custom = { ...settings.chooseModelLibraryMode(label, 'custom'), customPrompt: '淡い背景', chest: '100', waist: '80', hip: '100' };
  const reloaded = settings.readModelLibrarySettings(JSON.parse(JSON.stringify(custom)));
  assert.deepEqual(reloaded, custom);
  assert.deepEqual(settings.chooseModelLibraryMode(settings.chooseModelLibraryMode(reloaded, 'label'), 'custom'), custom);
});
test('old label settings map only explicit mode, skin tone and switch values', () => {
  const old = { customMode: 'ラベル', gender: '女性', age: '中年', nationality: '日本', skinTone: '白い肌', bodyType: '正常', half: 'オン', angleZoom: 50 };
  const restored = settings.readLegacyModelLibrarySettings(old);
  assert.equal(restored.half, true); assert.equal(restored.skinColor, '白い肌');
  assert.equal(restored.inputMode, 'label'); assert.equal(Object.hasOwn(restored, 'height'), false);
  for (const key of ['customMode', 'gender', 'age', 'nationality', 'skinTone', 'bodyType', 'half']) {
    const missing = { ...old }; delete missing[key]; assert.equal(settings.readLegacyModelLibrarySettings(missing), null, key);
  }
  assert.equal(settings.readLegacyModelLibrarySettings({ ...old, customMode: 'カスタム' }), null);
});
test('missing mode and invalid or foreign saved fields never receive fresh defaults', () => {
  assert.equal(settings.readModelLibrarySettings({ gender: '男性', half: false, age: 'スマート' }), null);
  for (const value of [{ ...fresh, sourceUrl: 'https://foreign.test?token=secret' }, { ...fresh, age: 'unknown' }, { ...fresh, half: 'オフ' }, { ...fresh, modelLibraryVersion: 2 }]) assert.equal(settings.readModelLibrarySettings(value), null);
  const custom = settings.chooseModelLibraryMode(fresh, 'custom');
  assert.equal(settings.readModelLibrarySettings({ ...custom, chest: '85' }), null);
  assert.equal(settings.readModelLibrarySettings({ ...custom, customPrompt: 'a'.repeat(801) }), null);
  assert.ok(settings.readModelLibrarySettings({ ...custom, customPrompt: 'a'.repeat(800) }));
});
test('gender selection retains supported heights and resets to that gender and height minima', () => {
  const expected = { 男性: ['175cm', '86', '62', '88'], 男の子: ['130cm', '65', '58', '68'], 女性: ['175cm', '80', '22', '92'], 女の子: ['130cm', '67', '57', '70'] };
  for (const [gender, values] of Object.entries(expected)) {
    const custom = settings.changeModelLibraryGender(settings.chooseModelLibraryMode(fresh, 'custom'), gender);
    assert.deepEqual([custom.height, custom.chest, custom.waist, custom.hip], values);
    assert.ok(settings.readModelLibrarySettings(custom));
  }
});
test('height changes reset to catalog bounds while saved out-of-range measurements stay unavailable', () => {
  const female = settings.changeModelLibraryGender(settings.chooseModelLibraryMode(fresh, 'custom'), '女性');
  const edited = { ...female, chest: '110' };
  assert.equal(settings.changeModelLibraryHeight(edited, '175cm'), edited);
  const lower = settings.changeModelLibraryHeight(edited, '165cm');
  assert.deepEqual([lower.height, lower.chest, lower.waist, lower.hip], ['165cm', '79', '26', '90']);
  assert.equal(settings.readModelLibrarySettings({ ...female, chest: '79' }), null);
  assert.equal(settings.readModelLibrarySettings({ ...female, height: '130cm' }), null);
  assert.equal(settings.readModelLibrarySettings({ ...female, customSimilarity: 'unknown' }), null);
});
test('catalog selection matches the two native source previews and never substitutes a default gender', () => {
  const male = settings.chooseModelLibraryMode(fresh, 'custom');
  assert.match(settings.modelLibraryBodyPreview(male), /\/0ee175d46d7c46bdc7bb78d26d96a709\.webp$/);
  const female = settings.changeModelLibraryGender(male, '女性');
  assert.match(settings.modelLibraryBodyPreview(female), /\/fa9a82f60eb90212040467b90f492f19\.webp$/);
  assert.equal(settings.modelLibraryBodyPreview({ ...male, customGender: 'unknown' }), null);
  assert.equal(settings.modelLibraryBodyPreview(fresh), null);
});
test('only active mode conditions enter the creation prompt', () => {
  const both = settings.chooseModelLibraryMode({ ...fresh, nationality: '日本' }, 'custom');
  const custom = settings.modelLibrarySettingsPrompt({ ...both, customPrompt: '夕方の背景' });
  assert.match(custom, /身長: 175cm/); assert.match(custom, /夕方の背景/); assert.doesNotMatch(custom, /国籍:/);
  assert.match(custom, /頭頂から両足のつま先まで/); assert.match(custom, /頭の上と足元に余白/);
  const label = settings.modelLibrarySettingsPrompt(settings.chooseModelLibraryMode(both, 'label'));
  assert.match(label, /国籍: 日本/); assert.doesNotMatch(label, /身長:|胸囲:|顔の参考図/);
  assert.doesNotMatch(label, /縦長|つま先|余白/);
});
