import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('a new design file opens on Light\'s Hello start screen with the assistant collapsed', () => {
  const detail = read('src/features/designDetail/DesignEntryDetailPage.tsx');
  assert.match(detail, /const helloStart = isNewFile && \(inspiration \|\| workspaceId === 'design'\)/);
  // While a text-only request is being sent the Hello screen gives way to the 生成中... square (#178).
  assert.match(detail, /\{!hasContent && helloStart && !entrySending && <label data-testid="design-inspiration-start"/);
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

test('a scene button fills Light\'s prompt template and attaches its sample images as chips', () => {
  const detail = read('src/features/designDetail/DesignEntryDetailPage.tsx');
  assert.match(detail, /title: '生地パターン適用', prompt: '服装のデザインを変更せず、異なる生地を服装に適用してください', assets: \['fabric1\.jpg', 'fabric2\.jpg', 'fabric3\.jpg', 'fabric4\.jpg', 'fabric5\.png'\]/);
  assert.match(detail, /title: '線画から実写化', prompt: 'シャツを白黒線稿の服装デザイン図に変換し、白背景にしてください', assets: \['draft1\.png'\]/);
  assert.match(detail, /title: 'デザインミックス', prompt: '画像1の色と生地を変更せず、襟型を画像2の襟型に変更してください', assets: \['multi1\.jpg', 'multi2\.jpg'\]/);
  assert.match(detail, /title: 'プリント修正', prompt: '画像1のアジサイ要素を参考に、四方連続のプリントパターンをデザインし、レイアウトとスタイルは画像2を参考にしてください', assets: \['print1\.png', 'print2\.jpg'\]/);
  // Light replaces the earlier chips when another scene is pressed.
  assert.match(detail, /setPrompt\(scene\.prompt\); setEntryError\(null\); references\.clear\(\);/);
  assert.match(detail, /fetch\(`\/scene-assets\/\$\{name\}`/);
  assert.match(detail, /if \(run === sceneRun\.current\) await references\.addFiles\(files\);/);
  for (const name of ['fabric1.jpg', 'fabric5.png', 'draft1.png', 'multi1.jpg', 'multi2.jpg', 'print1.png', 'print2.jpg']) {
    assert.ok(readFileSync(new URL(`../public/scene-assets/${name}`, import.meta.url)).byteLength > 0, name);
  }
});
