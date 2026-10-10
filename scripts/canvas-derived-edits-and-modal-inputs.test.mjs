import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isImageAdmissionLimitError, runAdmissionLimitedTasks } from '../src/lib/admissionLimitedTasks.ts';

const noSleep = async () => {};

test('four derived edits all succeed against a server that admits only three running jobs', async () => {
  let running = 0;
  let peak = 0;
  const task = (label) => async () => {
    if (running >= 3) throw new Error('cloudflare_api_429_image_quota_or_concurrency_limit');
    running += 1; peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return label;
  };
  const results = await runAdmissionLimitedTasks(['red', 'navy', 'green', 'yellow'].map(task), { sleep: noSleep });
  assert.deepEqual(results.map((r) => r.status === 'fulfilled' ? r.value : 'x'), ['red', 'navy', 'green', 'yellow']);
  assert.ok(peak <= 2);
});

test('admission refusals are retried, other failures are not', async () => {
  let calls = 0;
  const flaky = async () => { calls += 1; if (calls < 3) throw new Error('image_quota_or_concurrency_limit'); return 'ok'; };
  const broken = async () => { throw new Error('provider_failed'); };
  const [a, b] = await runAdmissionLimitedTasks([flaky, broken], { concurrency: 1, sleep: noSleep });
  assert.equal(a.status, 'fulfilled');
  assert.equal(calls, 3);
  assert.equal(b.status, 'rejected');
  assert.equal(isImageAdmissionLimitError(new Error('provider_failed')), false);
});

test('retries are bounded', async () => {
  let calls = 0;
  const [r] = await runAdmissionLimitedTasks([async () => { calls += 1; throw new Error('image_quota_or_concurrency_limit'); }], { retries: 2, sleep: noSleep });
  assert.equal(r.status, 'rejected');
  assert.equal(calls, 3);
});

test('canvas colorize/variations use the admission-limited runner instead of firing all at once', () => {
  const page = readFileSync(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /runAdmissionLimitedTasks\(requests\.map/);
  assert.doesNotMatch(page, /Promise\.allSettled\(requests\.map/);
});

test('glass inputs inside a light modal panel get dark text instead of white-on-white', () => {
  const modal = readFileSync(new URL('../src/components/ui/Modal.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(modal, /ui-modal-panel relative w-full/);
  assert.match(css, /html:not\(\.dark\) \.ui-modal-panel \.input-field-glass \{[^}]*color: #171717;/);
});

test('canvas chat editor receives a resolved, readable image URL instead of the raw object src', () => {
  const page = readFileSync(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8');
  const chat = readFileSync(new URL('../src/components/ChatEditor.tsx', import.meta.url), 'utf8');
  assert.match(page, /selectedImageUrl=\{chatSelectedImageUrl\}/);
  assert.doesNotMatch(page, /selectedImageUrl=\{selectedObject\?\.type === 'image' \? \(selectedObject as any\)\.src/);
  assert.match(page, /resolveCanvasObjectImageUrl\(object\)\s*\.then\(\(url\) => \{ if \(!cancelled\) setChatSelectedImageUrl\(url\)/);
  assert.match(chat, /aria-label="送信"/);
  assert.match(chat, /text-neutral-900 placeholder:text-neutral-400/);
});
