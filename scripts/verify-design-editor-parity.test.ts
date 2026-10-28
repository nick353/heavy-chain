import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('a new design file opens on Light\'s Hello start screen with the assistant collapsed', () => {
  const detail = read('src/features/designDetail/DesignEntryDetailPage.tsx');
  assert.match(detail, /const helloStart = isNewFile && \(inspiration \|\| workspaceId === 'design'\)/);
  assert.match(detail, /\{!hasContent && helloStart && <label data-testid="design-inspiration-start"/);
  assert.match(detail, /\$\{helloStart \? 'inspiration'/);
});

test('the design assistant greets with Light\'s editing scenes and a chat switcher', () => {
  const detail = read('src/features/designDetail/DesignEntryDetailPage.tsx');
  assert.match(detail, /\{workspaceId === 'design' \? <>/);
  assert.match(detail, /data-testid="design-chat-switcher"/);
  assert.match(detail, /チャット履歴はありません/);
  assert.match(detail, /<Plus className="h-5 w-5" \/>/);
  assert.match(detail, /data-testid="design-reference-chip"[\s\S]*画像\{index \+ 1\}/);
});

test('the canvas menu is always shown and opens Light\'s タスク・アセット・レイヤー panel', () => {
  const detail = read('src/features/designDetail/DesignEntryDetailPage.tsx');
  assert.doesNotMatch(detail, /\{hasContent && <nav aria-label="キャンバスメニュー"/);
  assert.match(detail, /\['tasks', 'タスク'\], \['assets', 'アセット'\], \['layers', 'レイヤー'\]/);
  assert.match(detail, /タスク履歴が新登場！完了した生成結果をいつでも確認できます/);
  assert.match(detail, /タスク履歴はありません/);
  assert.match(detail, /画像をアップロードしてデザインを始めましょう/);
  assert.match(detail, /w-\[400px\]/);
  const assets = read('src/features/designDetail/DesignAssetLibrary.tsx');
  assert.match(assets, /マイライブラリー/);
  assert.match(assets, /grid-cols-3/);
});

test('the canvas has キャンバスを整理, ミニマップ and a toolbar over the selection', () => {
  const detail = read('src/features/designDetail/DesignEntryDetailPage.tsx');
  assert.match(detail, /aria-label="キャンバスを整理"/);
  assert.match(detail, /data-testid="design-minimap"/);
  assert.match(detail, /data-testid="design-selection-toolbar"/);
});

test('the assistant ends with follow-up requests that show as Light\'s suggestion buttons', () => {
  const detail = read('src/features/designDetail/DesignEntryDetailPage.tsx');
  assert.match(detail, /data-testid="design-assistant-suggestions"/);
  assert.match(detail, /\{visible\?\.dialogue\?\.attempts\.length \? 'デザインアシスタント' : '新しいチャット'\}/);
  const server = read('cloudflare/heavy-api/src/designAssistant.ts');
  assert.match(server, /each on its own line starting with "→ "/);
});
