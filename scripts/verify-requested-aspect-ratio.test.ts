import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestedAspectRatio } from '../src/features/designDetail/requestedAspectRatio.ts';

const LIGHT_REQUEST = 'このリネンシャツのInstagram用の正方形の宣伝画像を作ってください。キャッチコピーは『夏を、さらりと。』。明るく爽やかな雰囲気で。';

test('the 2026-11-11 marketing request comes back square like Light (2048×2048), not in the garment photo frame', () => {
  assert.equal(requestedAspectRatio(LIGHT_REQUEST), '1:1');
  assert.equal(requestedAspectRatio(`${LIGHT_REQUEST}\n\nDesign direction:\nシャツを中央に配置します。`), '1:1');
});

test('explicit ratios and pixel sizes win; unsupported ones are ignored', () => {
  assert.equal(requestedAspectRatio('Instagramのフィード用に4:5で作って'), '4:5');
  assert.equal(requestedAspectRatio('16：9のバナーにして'), '16:9');
  assert.equal(requestedAspectRatio('1080×1920pxで書き出して'), '9:16');
  assert.equal(requestedAspectRatio('1080x1080の投稿画像'), '1:1');
  assert.equal(requestedAspectRatio('7:3でお願いします'), null);
  assert.equal(requestedAspectRatio('10:30までに白背景で作って'), null);
});

test('frame words count only when they describe the image, never a garment part', () => {
  assert.equal(requestedAspectRatio('縦長のポスターにしてください'), '2:3');
  assert.equal(requestedAspectRatio('横長のECバナーを作って'), '3:2');
  assert.equal(requestedAspectRatio('スクエアの投稿にして'), '1:1');
  assert.equal(requestedAspectRatio('正方形のポケットが付いたシャツの画像'), null);
  assert.equal(requestedAspectRatio('縦長のシルエットのワンピースを白背景で'), null);
  assert.equal(requestedAspectRatio('キャッチコピーは縦組みで入れて'), null);
});

test('story / reel placements are 9:16; no frame wording keeps the old behaviour', () => {
  assert.equal(requestedAspectRatio('この画像を使って、Instagramのストーリーズ用の画像を作成する'), '9:16');
  assert.equal(requestedAspectRatio('TikTok用のサムネを作って'), '9:16');
  assert.equal(requestedAspectRatio('この黒Tシャツの商品メイン画像を作って'), null);
});

test("the user's words decide first; the assistant's direction only fills in", () => {
  assert.equal(requestedAspectRatio('縦長のポスターにして\n\nDesign direction:\nInstagram用の1:1正方形で作ります。'), '2:3');
  assert.equal(requestedAspectRatio('夏の宣伝画像を作って\n\nDesign direction:\nInstagram用の1:1正方形で作ります。'), '1:1');
});

test('the design / marketing chat passes the ratio to both image calls, and a masked edit keeps the source frame', () => {
  const page = readFileSync(new URL('../src/features/designDetail/DesignEntryDetailPage.tsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../src/lib/imageApi.ts', import.meta.url), 'utf8');
  // With no frame in the request Light still answers square (2048×2048), so 1:1 is the default.
  assert.match(page, /const aspectRatio = requestedAspectRatio\(input\.prompt\) \?\? '1:1';/);
  assert.match(page, /featureType, \.\.\.variations, aspectRatio \};/);
  assert.match(api, /options\?\.aspectRatio && !options\?\.maskDataUrl \? \{ aspectRatio: options\.aspectRatio \}/);
});

test('the design chat matches Light (2026-11-11): result before the explanation, 「画像N ×」 chips, white backgrounds honoured', () => {
  const page = readFileSync(new URL('../src/features/designDetail/DesignEntryDetailPage.tsx', import.meta.url), 'utf8');
  const landing = readFileSync(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const contracts = readFileSync(new URL('../cloudflare/heavy-api/src/image-ai-contracts.ts', import.meta.url), 'utf8');
  // The image task card comes before the assistant's explanation and follow-up requests.
  assert.ok(page.indexOf('data-testid="design-image-task"') < page.indexOf('data-testid="design-assistant-message"'));
  // Attached images are tagged 画像N with a × and a teal edge; no file name, no 準備完了.
  assert.match(landing, /<span data-design-dialogue-reference-name="" title=\{reference\.name\}>画像\{referenceIndex \+ 1\}<\/span>/);
  assert.match(landing, /\{reference\.status !== 'ready' && <span data-design-dialogue-reference-status=""/);
  assert.match(landing, /<X aria-hidden="true" className="h-3\.5 w-3\.5" \/><\/button>/);
  assert.match(css, /\[data-design-dialogue-reference\] \{[^}]*border: 1px solid #0bcabc/);
  // A requested white background replaces the source photo's grey, and a product image fills the frame.
  assert.match(contracts, /a white background is pure white \(#FFFFFF\) from edge to edge/);
  assert.match(contracts, /show the whole garment large and centered, filling most of the frame/);
});
