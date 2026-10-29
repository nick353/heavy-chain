import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANSWER_MARK, answerPrompt, hasAssistantQuestions, parseAssistantReply, searchAnswerPrompt, variationDirections } from '../src/features/designDetail/assistantQuestions.ts';
import { foundImageFile, searchReferenceImages } from '../src/features/designDetail/referenceImageSearch.ts';
import { imagePrompt } from '../src/features/designDetail/imagePrompt.ts';

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
  assert.match(page, /!hasAssistantQuestions\(attempt\.assistant\.content\) && <button/);
  const server = readFileSync(new URL('../cloudflare/heavy-api/src/designAssistant.ts', import.meta.url), 'utf8');
  assert.match(server, /デザイン方向提案（4提案）/);
  assert.match(server, /\[Q single\] デザインの方向性/);
});

test('Light\'s image-search step: [S] lines are two searches, draw nothing and carry the choice back', () => {
  const searching = 'ご確認ありがとうございます。提案Aで進めます。\n[S] アジサイの水彩 | hydrangea watercolor\n[S] 小花柄のテキスタイル | small floral textile\n→ 送らない';
  const parsed = parseAssistantReply(searching);
  assert.deepEqual(parsed.searches, [{ title: 'アジサイの水彩', query: 'hydrangea watercolor' }, { title: '小花柄のテキスタイル', query: 'small floral textile' }]);
  assert.deepEqual(parsed.suggestions, []);
  assert.doesNotMatch(parsed.body, /\[S\]/);
  assert.equal(hasAssistantQuestions(searching), true);
  const answered = searchAnswerPrompt(`元の依頼\n\n${ANSWER_MARK}\n一\n\n${ANSWER_MARK}\n二`, ['Hydrangea A']);
  assert.equal(answered.split(ANSWER_MARK).length - 1, 3);
  assert.match(answered, /参考画像: Hydrangea A$/);
  assert.match(searchAnswerPrompt('依頼', []), /参考画像: スキップ$/);
});

test('the final reply\'s four [V] lines become #01〜#04 and one direction per candidate', () => {
  const final = ['4つの案で作成します。', '[V] 水彩アジサイ | 淡い水彩の花房を全体に散らす', '[V] 線画 | 細い線画で花房を描く',
    '[V] 幾何 | 花房を幾何学的に単純化する', '[V] 濃色地 | 紺の地に白い花房を置く', '→ 背景を白にする'].join('\n');
  const parsed = parseAssistantReply(final);
  assert.equal(parsed.variations.length, 4);
  assert.match(parsed.body, /#01 水彩アジサイ\n淡い水彩の花房を全体に散らす/);
  assert.match(parsed.body, /#04 濃色地/);
  assert.deepEqual(variationDirections(final), ['水彩アジサイ: 淡い水彩の花房を全体に散らす', '線画: 細い線画で花房を描く', '幾何: 花房を幾何学的に単純化する', '濃色地: 紺の地に白い花房を置く']);
  assert.equal(hasAssistantQuestions(final), false);
  // The shared direction leaves the per-candidate lines out; one [V] line alone is not a variation set.
  const shared = imagePrompt({ input: { prompt: '依頼' }, assistant: { state: 'completed', content: final } } as never);
  assert.doesNotMatch(shared, /\[V\]|→/);
  assert.deepEqual(variationDirections('説明\n[V] 一つ | だけ'), []);
  const controller = readFileSync(new URL('../src/features/designDetail/designDialogueController.ts', import.meta.url), 'utf8');
  assert.match(controller, /const variations = variationDirections\(current\.assistant\.content\);\n          return client\.generate\(variations\.length \? \{ \.\.\.input, variations \} : input\);/);
  const page = readFileSync(new URL('../src/features/designDetail/DesignEntryDetailPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /count: input\.variations\.length, variations: \[\.\.\.input\.variations\]/);
  assert.match(page, /data-testid="design-variation-tag"/);
});

test('reference images come from Wikimedia Commons bitmaps and become ordinary uploads', async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(String(url));
    if (String(url).startsWith('https://commons.wikimedia.org/')) return new Response(JSON.stringify({ query: { pages: {
      '2': { pageid: 2, index: 2, title: 'File:B.png', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/b.png', mime: 'image/png', descriptionurl: 'https://commons.wikimedia.org/wiki/File:B.png' }] },
      '1': { pageid: 1, index: 1, title: 'File:A flower.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/a.jpg', mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } } }] },
      '3': { pageid: 3, index: 3, title: 'File:C.svg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/c.svg.png', mime: 'image/svg+xml' }] },
      '4': { pageid: 4, index: 4, title: 'File:D.jpg', imageinfo: [{ thumburl: 'https://evil.example/d.jpg', mime: 'image/jpeg' }] },
    } } }));
    return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }));
  }) as typeof fetch;
  const found = await searchReferenceImages('hydrangea watercolor', { fetcher });
  assert.deepEqual(found.map((image) => image.title), ['A flower', 'B']);
  assert.equal(found[0].license, 'CC BY-SA 4.0');
  const query = new URL(calls[0]).searchParams;
  assert.equal(query.get('gsrsearch'), 'hydrangea watercolor filetype:bitmap');
  assert.equal(query.get('origin'), '*');
  const file = await foundImageFile(found[0], fetcher);
  assert.equal(file.type, 'image/jpeg');
  assert.equal(file.name, 'search-1.jpg');
  const server = readFileSync(new URL('../cloudflare/heavy-api/src/designAssistant.ts', import.meta.url), 'utf8');
  assert.match(server, /\[S\] <topic in Japanese>/);
  assert.match(server, /exactly four lines "\[V\] <short name>/);
});
