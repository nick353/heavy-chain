import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Video Workstation fails closed instead of routing into image generation', async () => {
  const source = await readFile(new URL('../src/pages/VideoWorkstationPage.tsx', import.meta.url), 'utf8');
  const reachableDetailSource = source.slice(source.indexOf('function VideoSourceEditorParity'));

  assert.match(source, /video_provider_not_admitted: 動画providerの利用可能状態が未確認です/);
  assert.match(source, /providerRoute: 'unsupported'/);
  assert.match(source, /画像生成への代替は行いません/);
  assert.match(reachableDetailSource, /data-testid="video-source-editor-parity"/);
  assert.match(reachableDetailSource, /data-testid="video-generation-blocked"/);
  assert.match(reachableDetailSource, /data-lightchain-provider-route="unsupported"/);
  assert.match(reachableDetailSource, /disabled[\s\S]*?権限がありません 6/);
  assert.doesNotMatch(source, /buildGenerationIntentHref/);
  assert.doesNotMatch(source, /feature:\s*'campaign-image'/);
  assert.doesNotMatch(source, /generationIntent:\s*\{/);
});
