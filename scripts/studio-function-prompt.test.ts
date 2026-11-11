import assert from 'node:assert/strict';
import test from 'node:test';
import { studioProviderPrompt } from '../src/lib/studioFunctionPrompt.ts';

// Light's 3D画像に変換 sample (2026-11-11) is a photo-real ghost-mannequin product shot on white, not a CGI render.
test('3D function asks for Light\'s ghost-mannequin product shot of the chosen area and side', () => {
  const sent = studioProviderPrompt('ワンピース/セットアップを3D画像に変換（正面）', '3d', { garment: '连身装', perspective: '正面' });
  assert.ok(sent.startsWith('ワンピース/セットアップを3D画像に変換（正面）\n'));
  assert.match(sent, /ghost-mannequin/);
  assert.match(sent, /one-piece dress or full outfit/);
  assert.match(sent, /FRONT view/);
  assert.match(sent, /#FFFFFF/);
  assert.doesNotMatch(sent, /CGI/);
  const back = studioProviderPrompt('トップスを3D画像に変換（背面）', '3d', { garment: '上装', perspective: '背面' });
  assert.match(back, /the top \(upper-body garment\)/);
  assert.match(back, /BACK view/);
});

test('text mode sends the user text unchanged', () => {
  assert.equal(studioProviderPrompt('そのまま', 'text'), 'そのまま');
});

test('underwear tells the provider which image is the garment and which is the model', () => {
  const withModel = studioProviderPrompt('図2のモデル外観・ポーズ・背景を維持し、全身の服を図1に変更', 'underwear', { hasReference: true });
  assert.match(withModel, /Image 1 is the innerwear garment\. Image 2 is the model photo/);
  assert.doesNotMatch(studioProviderPrompt('下着を着せて', 'underwear', { hasReference: false }), /Image 2/);
});

test('region replaces the garment marked on the guide image with the reference design', () => {
  const sent = studioProviderPrompt('範囲指定で生成（融合ポイント1）', 'region', { hasReference: true });
  assert.match(sent, /Image 2 is the reference garment\. Image 3 is image 1 with teal brush strokes/);
  assert.match(sent, /must not contain any teal marks/);
});

test('a text-mode request that asks for 3D also gets the 3D directive', () => {
  assert.match(studioProviderPrompt('この服を立体感のある3Dレンダリング画像に変換してください。', 'text'), /ghost-mannequin/);
  assert.match(studioProviderPrompt('３Ｄ画像にして', 'text'), /ghost-mannequin/);
});
