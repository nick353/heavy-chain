import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  STUDIO_FEEDBACK_OTHER, STUDIO_FEEDBACK_TEXT, dislikeStudioFeedback, emptyStudioFeedback, likeStudioFeedback, studioFeedbackFromRows,
  studioFeedbackPopoverBelow, studioFeedbackReasons, submitStudioFeedbackImprove, submitStudioFeedbackReasons, toggleStudioFeedbackReason,
} from '../src/lib/studioFeedback.ts';

// ファッションスタジオの生成結果の 👍👎「フィードバックする」。本家の部品（841152）の動きと同じかを確かめる。

test('理由の札: 機能ごとに本家の札の言葉から選び、最後はいつも「その他」。人の写らない3Dには顔・体の札を出さない', () => {
  for (const fn of ['text', 'region', 'underwear', '3d', null] as const) {
    const reasons = studioFeedbackReasons(fn);
    assert.equal(reasons.at(-1), STUDIO_FEEDBACK_OTHER, String(fn));
    assert.equal(new Set(reasons).size, reasons.length, `${fn} に同じ札が2つ`);
    assert.ok(reasons.length >= 5 && reasons.length <= 10, `${fn} は ${reasons.length} 枚`);
  }
  assert.ok(!studioFeedbackReasons('3d').some(reason => /顔|身体|体つき|いびつ/.test(reason)));
  assert.ok(studioFeedbackReasons('region').includes('素材の相性が悪い'), '範囲指定（定向融合）は融合の札');
  assert.ok(studioFeedbackReasons('underwear').includes('元画像の顔と一致しない'), '下着はモデルの顔の札');
  assert.deepEqual(studioFeedbackReasons(undefined), studioFeedbackReasons(null));
});

test('👍: 押すとすぐ向き 1 で保存し理由は外す。もう押してあれば何もしない', () => {
  const start = { direction: 0 as const, reasons: ['ディテールが不明'], remark: '', improve: '色を残したい' };
  const liked = likeStudioFeedback(start, 'text');
  assert.deepEqual(liked.save, { studio_function: 'text', direction: 1, reasons: [], remark: '', improve: '色を残したい' });
  assert.equal(liked.state.direction, 1);
  assert.deepEqual(liked.state.reasons, []);
  const again = likeStudioFeedback(liked.state, 'text');
  assert.equal(again.save, null);
  assert.equal(again.state, liked.state);
});

test('👎: まだ👎でなければすぐ向き 0 で保存。理由の窓の「送信」で理由とその他の文を付けて保存', () => {
  const disliked = dislikeStudioFeedback(emptyStudioFeedback(), 'region');
  assert.deepEqual(disliked.save, { studio_function: 'region', direction: 0, reasons: [], remark: '', improve: '' });
  assert.equal(dislikeStudioFeedback(disliked.state, 'region').save, null, '2回目は保存しない（窓だけ開く）');
  let state = toggleStudioFeedbackReason(disliked.state, 'エッジがぼやけている');
  state = toggleStudioFeedbackReason(state, STUDIO_FEEDBACK_OTHER);
  state = { ...state, remark: '肩ひもが太い' };
  assert.deepEqual(submitStudioFeedbackReasons(state, 'region').save,
    { studio_function: 'region', direction: 0, reasons: ['エッジがぼやけている', STUDIO_FEEDBACK_OTHER], remark: '肩ひもが太い', improve: '' });
  // その他を外すと文は送らない
  const withoutOther = toggleStudioFeedbackReason(state, STUDIO_FEEDBACK_OTHER);
  assert.deepEqual(submitStudioFeedbackReasons(withoutOther, 'region').save?.remark, '');
  assert.deepEqual(toggleStudioFeedbackReason(withoutOther, 'エッジがぼやけている').reasons, []);
});

test('フィードバックする: 今の👍👎のまま要望を付けて保存し、空でも送れる。長さは本家の上限まで', () => {
  const liked = likeStudioFeedback(emptyStudioFeedback(), '3d').state;
  assert.deepEqual(submitStudioFeedbackImprove({ ...liked, improve: '背景を白に' }, '3d').save,
    { studio_function: '3d', direction: 1, reasons: [], remark: '', improve: '背景を白に' });
  assert.equal(submitStudioFeedbackImprove(emptyStudioFeedback(), null).save?.direction, null);
  const long = submitStudioFeedbackReasons({ direction: 0, reasons: [STUDIO_FEEDBACK_OTHER, STUDIO_FEEDBACK_OTHER], remark: 'あ'.repeat(80), improve: 'い'.repeat(1200) }, 'text').save!;
  assert.equal(long.remark.length, 50);
  assert.equal(long.improve.length, 1000);
  assert.deepEqual(long.reasons, [STUDIO_FEEDBACK_OTHER]);
});

test('開き直し: サーバーの行から結果ごとの👍👎と理由を戻す（壊れた行は空の状態）', () => {
  const states = studioFeedbackFromRows([
    { object_id: 'a', direction: 1, reasons: [], remark: '', improve: '' },
    { object_id: 'b', direction: 0, reasons: ['構造が不明', 3], remark: 'x', improve: 'y' },
    { object_id: 'c', direction: 'bad', reasons: 'no' },
    { object_id: 'a', direction: 0 },
    null,
  ]);
  assert.equal(states.get('a')?.direction, 1, '新しい順の最初の行を使う');
  assert.deepEqual(states.get('b'), { direction: 0, reasons: ['構造が不明'], remark: 'x', improve: 'y' });
  assert.deepEqual(states.get('c'), emptyStudioFeedback());
});

test('理由の窓は上に出し、上に余白が無いときだけ下に出す。本家の言葉', () => {
  assert.equal(studioFeedbackPopoverBelow(600, 240), false);
  assert.equal(studioFeedbackPopoverBelow(200, 240), true);
  assert.equal(STUDIO_FEEDBACK_TEXT.sent, 'フィードバックを送信しました');
  assert.equal(STUDIO_FEEDBACK_TEXT.improvePlaceholder, '効果に満足していませんか？新しい機能が必要ですか？ご要望をお知らせください、実現します！');
});

test('スタジオの生成結果の帯は 👍👎・フィードバックする・再生成の部品を使い、サーバーの道へ送る', () => {
  const page = readFileSync(new URL('../src/pages/FashionStudioDetailPage.tsx', import.meta.url), 'utf8');
  const feedbackBlock = page.slice(page.indexOf('data-testid="fashion-studio-node-feedback"'));
  assert.match(feedbackBlock.slice(0, 800), /<StudioFeedbackBar documentId=\{projectCode\}/);
  const bar = readFileSync(new URL('../src/components/lightchain/StudioFeedbackBar.tsx', import.meta.url), 'utf8');
  for (const id of ['studio-feedback-like', 'studio-feedback-dislike', 'studio-feedback-improve', 'studio-feedback-reasons-submit', 'studio-feedback-improve-submit']) assert.ok(bar.includes(id), id);
  const api = readFileSync(new URL('../src/lib/cloudflareApi.ts', import.meta.url), 'utf8');
  assert.match(api, /\/studio-feedback\/\$\{encodeURIComponent\(objectId\)\}`, \{\s*method: 'PUT'/);
});
