import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupHistoryEntries, lightchainHistoryResumeHref, lightchainHistoryTitle } from '../src/lib/lightchainHistoryEntries.ts';

const row = (id: string, jobId: string | null, featureType: string, createdAt: string) => ({
  id, job_id: jobId, brand_id: 'b', user_id: 'u', storage_path: `generated-images/${id}`, image_url: `https://x/${id}`,
  is_favorite: false, created_at: createdAt, prompt: null, feature_type: featureType, style_preset: null, model_used: null, metadata: null,
});

test('one entry per generation keeps the newest-first order and every image of the job', () => {
  const entries = groupHistoryEntries([
    row('a1', 'job-a', 'lightchain-printing-image', '2026-10-08T01:45:00Z'),
    row('a2', 'job-a', 'lightchain-printing-image', '2026-10-08T01:45:00Z'),
    row('b1', null, 'lightchain-fabric-image', '2026-10-08T01:00:00Z'),
    row('c1', 'job-c', 'edit-image', '2026-10-07T00:00:00Z'),
  ] as never);
  assert.deepEqual(entries.map((entry) => [entry.key, entry.images.map((image) => image.id)]), [
    ['job:job-a', ['a1', 'a2']], ['image:b1', ['b1']], ['job:job-c', ['c1']],
  ]);
  assert.equal(entries[0].title, 'プリントイメージ');
  assert.equal(entries[2].title, 'edit image');
});

test('resume links reopen the tool route with the job, and only for Lightchain tool results', () => {
  assert.equal(lightchainHistoryResumeHref({ feature_type: 'lightchain-printing-image', job_id: 'ai-1' }), '/tools/printing?resumeJob=ai-1');
  assert.equal(lightchainHistoryResumeHref({ feature_type: 'lightchain-fabric-image-provider-result', job_id: 'ai-2' }), '/tools/fabric?resumeJob=ai-2');
  assert.equal(lightchainHistoryResumeHref({ feature_type: 'edit-image', job_id: 'ai-3' }), null);
  assert.equal(lightchainHistoryResumeHref({ feature_type: 'lightchain-printing-image', job_id: null }), null);
  assert.equal(lightchainHistoryTitle(null), '生成画像');
});

test('the panel mirrors the measured Light layout and pages older results on scroll', () => {
  const panel = readFileSync(new URL('../src/components/lightchain/LightchainHistoryPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /grid grid-cols-2 gap-2/);
  assert.match(panel, /aria-label="ライブラリーに保存"/);
  assert.match(panel, /aria-label="ほかのツールに送る"/);
  assert.match(panel, /scrollHeight - target\.scrollTop - target\.clientHeight < 600/);
  assert.match(panel, /window\.confirm\(/);
});
