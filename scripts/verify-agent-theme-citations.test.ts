import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const flow = readFileSync(new URL('../src/features/agent/agentFlow.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');

test('the web-searching テーマ企画 bases its trend sentences and インスピレーション lines on a page\'s concrete fact, so Claude cites them', () => {
  assert.match(flow, /傾向の文と各テーマの「インスピレーション：」の行は、検索結果のページに書かれた具体的な事実（色名・アイテム・数字・事例）を1つずつ根拠にして書く。/);
  // Still no URLs in the text: the app lists the sources with the cited sentence.
  assert.match(flow, /事例）を1つずつ根拠にして書く。出典やURLは書かない。'/);
  // 参考資料 shows the site, then the cited sentence (the title only when there is none).
  assert.match(page, /\{source\.quote \?\? source\.title\}/);
});
