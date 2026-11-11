import assert from 'node:assert/strict';
import test from 'node:test';
import { studioProviderPrompt } from '../src/lib/studioFunctionPrompt.ts';
import { validateLegalSafetyInput } from '../cloudflare/heavy-api/src/legalSafety.ts';

// Light's 3D画像に変換 sample (2026-11-11) is a photo-real ghost-mannequin product shot on white, not a CGI render.
test('3D function asks for Light\'s ghost-mannequin product shot of the chosen area and side', () => {
  const sent = studioProviderPrompt('ワンピース/セットアップを3D画像に変換（正面）', '3d', { garment: '连身装', perspective: '正面' });
  assert.ok(sent.startsWith('ワンピース/セットアップを3D画像に変換（正面）\n'));
  assert.match(sent, /ghost-mannequin/);
  assert.match(sent, /one-piece dress or full outfit/);
  assert.match(sent, /FRONT view/);
  assert.match(sent, /#FFFFFF/);
  assert.match(sent, /no grey, no gradient/);
  assert.doesNotMatch(sent, /CGI/);
  const back = studioProviderPrompt('トップスを3D画像に変換（背面）', '3d', { garment: '上装', perspective: '背面' });
  assert.match(back, /the top \(upper-body garment\)/);
  assert.match(back, /BACK view/);
});

// Light's text sample comes back as a natural photograph; Heavy's first production run (2026-11-11) looked airbrushed.
test('text mode keeps the user text first and asks for the garment kept in a natural photograph', () => {
  const sent = studioProviderPrompt('そのまま', 'text');
  assert.ok(sent.startsWith('そのまま\n'));
  assert.match(sent, /Keep the garment from image 1 exactly/);
  assert.match(sent, /not an airbrushed or painted look/);
});

// 2026-11-11 production: the underwear directive "keep that model's face" was refused by the server's likeness guard.
test('no function directive trips the server likeness or brand guard', () => {
  const sent = [
    studioProviderPrompt('図2のモデル外観・ポーズ・背景を維持し、全身の服を図1に変更', 'underwear', { hasReference: true }),
    studioProviderPrompt('下着を着せて', 'underwear', { hasReference: false }),
    studioProviderPrompt('範囲指定で生成（融合ポイント1）', 'region', { hasReference: true }),
    studioProviderPrompt('範囲指定で生成（融合ポイント1）', 'region', { hasReference: false }),
    studioProviderPrompt('ビジュアルテーマ：ハイエンドなファッション誌のような雰囲気。', 'text'),
    studioProviderPrompt('トップスを3D画像に変換（背面）', '3d', { garment: '上装', perspective: '背面' }),
  ];
  for (const prompt of sent) assert.deepEqual(validateLegalSafetyInput([prompt]), { blocked: false, reasons: [] }, prompt);
});

test('underwear tells the provider which image is the garment and which is the model', () => {
  const withModel = studioProviderPrompt('図2のモデル外観・ポーズ・背景を維持し、全身の服を図1に変更', 'underwear', { hasReference: true });
  assert.match(withModel, /The first image is the innerwear garment\. The second image is the model photo/);
  assert.doesNotMatch(studioProviderPrompt('下着を着せて', 'underwear', { hasReference: false }), /second image/);
});

test('region replaces the garment marked on the guide image with the reference design', () => {
  const sent = studioProviderPrompt('範囲指定で生成（融合ポイント1）', 'region', { hasReference: true });
  assert.match(sent, /Image 2 is the reference garment\. Image 3 is image 1 with teal brush strokes marking where to fuse it/);
  // Light keeps the garment's own colour, fabric and hem; only the marked part takes the reference's construction.
  assert.match(sent, /keeping the garment's own colours, fabric, print, trims and hem from image 1/);
  assert.doesNotMatch(sent, /Replace only the marked garment/);
  // 2026-11-12 production: the marked chest still came out in the reference's white until this sentence was added.
  assert.match(sent, /Take only the shape from the reference, never its colour, fabric or print/);
  assert.match(sent, /no colour from the reference appears on the garment/);
  assert.match(sent, /must not contain any teal marks/);
});

test('a text-mode request that asks for 3D also gets the 3D directive', () => {
  assert.match(studioProviderPrompt('この服を立体感のある3Dレンダリング画像に変換してください。', 'text'), /ghost-mannequin/);
  assert.match(studioProviderPrompt('３Ｄ画像にして', 'text'), /ghost-mannequin/);
});

// Light: 範囲指定 has up to three fusion points (one reference each), テキストで生成 up to nine references.
test('multi-point region and multi-reference text name every image and still pass the server guard', () => {
  const region = studioProviderPrompt('範囲指定で生成（融合ポイント3）', 'region', { hasReference: true, points: 3 });
  assert.match(region, /Images 2 to 4 are reference garments\. Image 5 is image 1 with coloured brush strokes/);
  assert.match(region, /the teal marks take the construction of image 2, the magenta marks take the construction of image 3, the orange marks take the construction of image 4/);
  assert.match(region, /keeping the garment's own colours, fabric, print, trims and hem from image 1/);
  assert.match(region, /Take only the shape from each reference, never its colour, fabric or print/);
  const text = studioProviderPrompt('この服で撮影', 'text', { referenceCount: 3 });
  assert.match(text, /Images 2 to 4 are reference images/);
  assert.match(studioProviderPrompt('この服で撮影', 'text', { referenceCount: 1 }), /Image 2 is a reference image/);
  for (const prompt of [region, text]) assert.deepEqual(validateLegalSafetyInput([prompt]), { blocked: false, reasons: [] });
});
