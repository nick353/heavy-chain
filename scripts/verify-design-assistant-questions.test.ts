import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANSWER_MARK, answerPrompt, hasAssistantQuestions, parseAssistantReply } from '../src/features/designDetail/assistantQuestions.ts';

const reply = [
  '画像分析が完了しました。',
  '画像1: 主要素 アジサイ',
  'デザインを進めるにあたり、いくつか確認させてください。',
  '[Q multi] アジサイから維持したい要素（複数選択可） | 花房の形 | 水色の配色 | 葉と茎',
  '[Q single] デザインの方向性 | A) 拡張デザイン | B) 完全な再構築',
  '[Q text] その他のご要望やメモ（任意） | 特別な色の変更、サイズ感、用途などがあればご記入ください',
].join('\n');

test('Light\'s confirmation questions are read from [Q] lines and kept out of the message body', () => {
  const parsed = parseAssistantReply(reply);
  assert.deepEqual(parsed.questions.map((question) => question.kind), ['multi', 'single', 'text']);
  assert.deepEqual(parsed.questions[1].options, ['A) 拡張デザイン', 'B) 完全な再構築']);
  assert.equal(parsed.questions[2].options[0], '特別な色の変更、サイズ感、用途などがあればご記入ください');
  assert.doesNotMatch(parsed.body, /\[Q /);
  assert.match(parsed.body, /画像分析が完了しました。/);
  assert.equal(hasAssistantQuestions(reply), true);
  assert.equal(hasAssistantQuestions('ブラウスを青にします。\n→ 背景を白にする'), false);
  assert.deepEqual(parseAssistantReply('説明\n→ 背景を白にする').suggestions, ['背景を白にする']);
  // A choice question with fewer than two options is not a question.
  assert.equal(parseAssistantReply('[Q single] 方向 | A) だけ').questions.length, 0);
});

test('answers go back with the earlier request so the final image keeps the whole brief', () => {
  const questions = parseAssistantReply(reply).questions;
  const prompt = answerPrompt('画像1のアジサイ要素を参考に…', questions, [['花房の形', '水色の配色'], ['A) 拡張デザイン'], []]);
  assert.match(prompt, /^画像1のアジサイ要素を参考に…\n\n【確認の回答】\n/);
  assert.match(prompt, /アジサイから維持したい要素（複数選択可）: 花房の形、水色の配色/);
  assert.match(prompt, /デザインの方向性: A\) 拡張デザイン/);
  assert.match(prompt, /その他のご要望やメモ（任意）: おまかせ/);
  assert.ok(prompt.includes(ANSWER_MARK));
});

test('a reply with questions draws nothing, and the answer turn has no bubble', () => {
  const controller = readFileSync(new URL('../src/features/designDetail/designDialogueController.ts', import.meta.url), 'utf8');
  assert.match(controller, /if \(hasAssistantQuestions\(current\.assistant\.content\)\) return;\n      if \(!current\.imageAttempted && !allowImage\) return;/);
  const page = readFileSync(new URL('../src/features/designDetail/DesignEntryDetailPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /\{!attempt\.input\.prompt\.includes\(ANSWER_MARK\) && <div className=\{userBubble\} data-testid="design-user-bubble">/);
  assert.match(page, /active\.send\(answerPrompt\(attempt\.input\.prompt, questions, answers\), attempt\.input\.references\)/);
  assert.match(page, /!parseAssistantReply\(attempt\.assistant\.content \?\? ''\)\.questions\.length && <button/);
  const server = readFileSync(new URL('../cloudflare/heavy-api/src/designAssistant.ts', import.meta.url), 'utf8');
  assert.match(server, /デザイン方向提案（4提案）/);
  assert.match(server, /\[Q single\] デザインの方向性/);
});
