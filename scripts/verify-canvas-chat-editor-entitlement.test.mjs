import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const canvasSource = await readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8');
const chatSource = await readFile(new URL('../src/components/ChatEditor.tsx', import.meta.url), 'utf8');

test('Canvas passes parent-owned Heavy readiness and reason into ChatEditor', () => {
  assert.match(canvasSource, /<ChatEditor[\s\S]*?heavyReadiness=\{\{[\s\S]*?ready: heavyGenerationReady[\s\S]*?reason: heavyEntitlementDisplayMessage[\s\S]*?inputKey: null/);
  assert.match(canvasSource, /The parent status read is requestless/);
});

test('ChatEditor fails closed without the exact parent-approved prompt/image input', () => {
  assert.match(chatSource, /export interface ChatEditorHeavyReadiness/);
  assert.match(chatSource, /if \(!readiness\) return \{ ready: false, reason: HEAVY_READINESS_UNAVAILABLE_COPY \}/);
  assert.match(chatSource, /if \(readiness\.ready !== true\)/);
  assert.match(chatSource, /!readiness\.inputKey \|\| readiness\.inputKey !== inputKey/);
  assert.match(chatSource, /if \(!requestReadiness\.ready\) throw new Error\(requestReadiness\.reason\)/);
  assert.match(chatSource, /rightsConfirmed: requestReadiness\.ready/);
  assert.match(chatSource, /latestReadiness\.inputKey !== requestReadiness\.inputKey/);
  assert.doesNotMatch(chatSource, /rightsConfirmed\s*=\s*false/);
  assert.doesNotMatch(chatSource, /権限がありません/);
});

test('non-generative ChatEditor controls remain available', () => {
  assert.match(chatSource, /data-testid="chat-edit-context"/);
  assert.match(chatSource, /画像を編集/);
  assert.match(chatSource, /画像を生成/);
  assert.match(chatSource, /キャンバスに追加/);
});
