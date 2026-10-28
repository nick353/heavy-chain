import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the credits badge opens Light\'s ポイント詳細 dialog', () => {
  const dialog = read('src/components/lightchain/PointDetailDialog.tsx');
  for (const label of ['ポイント詳細', 'ポイント残高', '消費ポイント', 'アカウント', 'ポイントイベント', '日付', 'ポイント変更']) {
    assert.ok(dialog.includes(label), label);
  }
  assert.match(dialog, /getImageUsageEvents\(brandId\)/);
  assert.match(dialog, /text-red-400">-\{event\.units\}/);
  // Heavy has no purchase flow, so the dialog must not offer Light's チャージ.
  assert.doesNotMatch(dialog, />チャージ</);
  for (const page of ['src/pages/LightchainParityPages.tsx', 'src/pages/FashionStudioPage.tsx']) {
    assert.match(read(page), /<PointDetailButton className=/, page);
  }
});

test('the API lists the brand\'s charged requests for ポイント詳細', () => {
  const api = read('cloudflare/heavy-api/src/image-ai.ts');
  assert.match(api, /url\.pathname === '\/v1\/image-ai\/usage\/events'/);
  assert.match(api, /requireBrandRole\(request,env,brand,'viewer'\); if \(owner instanceof Response\) return owner;\n    return reply\(await imageUsageEvents\(env,brand\)\)/);
  assert.match(api, /WHERE r\.brand_id=\? AND r\.quota_units>0 ORDER BY r\.created_at DESC/);
});
