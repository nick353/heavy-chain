import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');

// Light /agent (2026-11-11): one composer text across the scene tabs, never the scene's placeholder as text.
test('switching the agent scene tab keeps the composer text and never inserts the placeholder', () => {
  const tabs = source.slice(source.indexOf('role="tablist" aria-label="業務シーン"'), source.indexOf('role="tablist" aria-label="業務シーン"') + 1200);
  assert.match(tabs, /onClick=\{\(\) => \{\n\s*\/\/ Light keeps one composer text[\s\S]*?setActiveWorkspaceTab\(tab\);\n\s*\}\}/);
  assert.doesNotMatch(tabs, /nextCopy\?\.prompt/);
});

test('the scene card labels follow Light per tab', () => {
  for (const label of ['効率的なコミュニケーション', 'クリエイティブ提案', 'パーソナライズ', 'トレンドデザイン', '視覚的な訴求力', 'オリジナル図案']) {
    assert.ok(source.includes(`'${label}'`), `missing scene label ${label}`);
  }
});

test('a quick start fills the text without its label and focuses the composer at the end', () => {
  assert.match(source, /const text = rest\.join\('｜'\);\n\s*setWorkspaceText\(text\);/);
  assert.match(source, /composer\.setSelectionRange\(text\.length, text\.length\);/);
  assert.match(source, /ref=\{agentComposerRef\}/);
  assert.match(source, /'block h-full min-h-14 overflow-y-auto/);
});

test('the profile shortcut is hidden on インスピレーション and AIグラフィックデザイン like Light', () => {
  assert.match(source, /!\['インスピレーション', 'AIグラフィックデザイン'\]\.includes\(currentWorkspaceTab\) && <button type="button" aria-label="業務プリファレンスプロファイル"/);
});

test('the task page retries its first automatic steps before showing a failure', () => {
  const task = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');
  assert.match(task, /guard\(startThemeRound, 'タスクを開始できませんでした。', 'start'\)/);
  assert.match(task, /guard\(\(\) => startPlan\(theme\), '企画書の作成を開始できませんでした。', 'plan'\)/);
  assert.match(task, /if \(used < 2 && retryKey\) \{[\s\S]*?loadAgentTask\(taskId\)/);
});

test('AIグラフィックデザイン leaves the settings panel empty before a reference, like Light', () => {
  const graphic = readFileSync(new URL('../src/pages/LightchainGraphicDesignPage.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(graphic, /graphic-design-settings-empty/);
});
