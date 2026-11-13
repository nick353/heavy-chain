import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inlineReportImages, isSignedMediaUrl } from '../src/features/agent/agentReportImages.ts';
import { buildAgentDialogueBriefHtml } from '../src/features/agent/agentMerch.ts';

// 2026-11-13 production: the downloaded テーマ企画書.html (task 5f5f71f6) and 図案執行書.html (147398e5) held their pictures as
// signed read URLs (/v1/media/read?token=…, valid for at most an hour), so a saved report opened later showed empty frames.
// The download now writes each of Heavy's images into the file.

const SIGNED = 'https://heavy-chain-api.example.workers.dev/v1/media/read?token=abc.def';
const SIGNED_2 = 'https://heavy-chain-api.example.workers.dev/v1/media/read?token=ghi.jkl';
const DATA = 'data:image/jpeg;base64,/9j/AAAA';

test('only Heavy\'s signed media URLs count as images to write in', () => {
  assert.equal(isSignedMediaUrl(SIGNED), true);
  assert.equal(isSignedMediaUrl('https://heavy-chain-api.example.workers.dev/v1/media/read'), false);
  assert.equal(isSignedMediaUrl('https://item-shopping.c.yimg.jp/i/n/shop_item'), false);
  assert.equal(isSignedMediaUrl(DATA), false);
  assert.equal(isSignedMediaUrl('not a url'), false);
});

test('signed images become data URLs; each address is read once; others are left as they are', async () => {
  const html = `<figure><img src="${SIGNED.replace('&', '&amp;')}" alt="a"></figure><img alt="b" src="${SIGNED}">`
    + `<img src="${SIGNED_2}" alt="c"><img src="https://item-shopping.c.yimg.jp/i/n/x" alt="shop"><img src="${DATA}" alt="d">`;
  const reads: string[] = [];
  const result = await inlineReportImages(html, async (url) => { reads.push(url); return url === SIGNED ? DATA : null; });
  assert.deepEqual(reads.sort(), [SIGNED, SIGNED_2].sort());
  assert.equal(result.inlined, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.html.split(DATA).length - 1, 3, 'both copies of the first image and the existing data URL');
  assert.ok(result.html.includes(`src="${SIGNED_2}"`), 'an image that could not be read keeps its address');
  assert.ok(result.html.includes('src="https://item-shopping.c.yimg.jp/i/n/x"'), 'a shop picture is not fetched');
  assert.ok(!result.html.includes(`src="${SIGNED}"`));
});

test('a reader that throws or returns something that is not an image keeps the address', async () => {
  const html = `<img src="${SIGNED}"><img src="${SIGNED_2}">`;
  const result = await inlineReportImages(html, async (url) => { if (url === SIGNED) throw new Error('network'); return 'data:text/html,<b>'; });
  assert.equal(result.html, html);
  assert.equal(result.failed, 2);
});

test('the 図案執行書 built from a task carries no signed address after writing in', async () => {
  const task = {
    id: 't', prompt: '柑橘の総柄', scene: 'AIグラフィックデザイン', subtype: 'AIグラフィックデザイン', flow: 'dialogue', createdAt: '', updatedAt: '',
    turns: [], designs: [{ key: 'k1', code: 'A-01', name: '大市松', category: '方案A', prompt: 'p', requestId: 'r1', state: 'completed' }],
  } as unknown as Parameters<typeof buildAgentDialogueBriefHtml>[0];
  const html = buildAgentDialogueBriefHtml(task, { k1: SIGNED });
  assert.ok(html.includes(SIGNED), 'the built report shows the image through its signed address');
  const result = await inlineReportImages(html, async () => DATA);
  assert.ok(!result.html.includes('/v1/media/read'));
});

test('the page saves reports through the writing-in step, and shows that it is saving', () => {
  const page = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');
  const download = page.slice(page.indexOf('async function downloadReport'), page.indexOf('/** Light\'s 「オンラインで表示」'));
  assert.match(download, /await inlineReportImages\(report\.html, imageAsDataUrl\)/);
  assert.match(download, /new Blob\(\[html\]/);
  assert.ok(!/new Blob\(\[report\.html\]/.test(download), 'the raw report with signed URLs is not saved');
  assert.match(page, /'保存中…'/);
});
