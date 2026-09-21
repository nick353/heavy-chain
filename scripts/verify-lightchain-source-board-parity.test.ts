import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const parityPages = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const parityCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const fashionStudio = await readFile(new URL('../src/pages/FashionStudioPage.tsx', import.meta.url), 'utf8');
const videoDashboard = await readFile(new URL('../src/pages/VideoProjectDashboardPage.tsx', import.meta.url), 'utf8');

test('canonical Wear Design Lab board and detail route stay source-shaped', () => {
  assert.match(appSource, /path="\/flow\/orientedDesign"[\s\S]*?<LightchainOrientedDesignPage \/>/);
  assert.match(appSource, /path="\/flow\/orientedDesign\/detail"[\s\S]*?<LightchainOrientedDesignDetailPage \/>/);
  assert.match(parityPages, /className="oriented-design-content"/);
  assert.match(parityPages, /data-testid="oriented-design-detail-upload"/);
  assert.match(parityPages, /jpg、jpeg、png、webp形式の画像（最大20M）に対応/);
  assert.doesNotMatch(parityPages, /type="checkbox"/);
  assert.match(parityCss, /\.oriented-design-new-card, \.oriented-design-project-card[^\n]*width: 220px; height: 240px/);
});

test('canonical Fashion Studio overview keeps board geometry while retaining operations', () => {
  assert.match(appSource, /path="\/flow\/integration"[\s\S]*?<FashionStudioPage \/>/);
  assert.match(fashionStudio, /className="fashion-studio-overview-parity/);
  for (const marker of ['ピン留め', 'アセットライブラリに保存', '削除', '前のページ', '次のページ', '参考事例']) {
    assert.ok(fashionStudio.includes(marker), `missing Fashion Studio operation: ${marker}`);
  }
  assert.match(parityCss, /\.fashion-studio-overview-parity > section > div:nth-child\(2\)[\s\S]*?width: 220px; height: 240px/);
});

test('video project board keeps canonical card geometry and fail-closed provider detail', async () => {
  assert.match(appSource, /path="\/flow\/GenerateShortVideo"[\s\S]*?<VideoProjectDashboardPage \/>/);
  assert.match(videoDashboard, /h-\[240px\]/);
  assert.match(videoDashboard, /lg:grid-cols-\[repeat\(7,220px\)\]/);
  const videoDetail = await readFile(new URL('../src/pages/VideoWorkstationPage.tsx', import.meta.url), 'utf8');
  assert.match(videoDetail, /video_provider_not_admitted/);
  assert.doesNotMatch(videoDetail, /権利確認後/);
});

console.log('Lightchain source board parity tests: 3/3 passed');
