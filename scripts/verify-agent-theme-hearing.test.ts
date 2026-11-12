import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatAgentResearchContent } from '../cloudflare/heavy-api/src/designAssistant.ts';
import { agentPaletteColors, agentResearchPrompt, parsePlanItemImages, parsePlanResponse, planPrompt, themePrompt, type AgentTask } from '../src/features/agent/agentFlow.ts';
import {
  AGENT_HEARING_ITEMS, AGENT_HEARING_MAX_ASKS, agentHearingLines, agentHearingPrompt, agentHearingState, agentHearingTitle, parseAgentHearing,
} from '../src/features/agent/agentHearing.ts';
import { agentBuildPlanItemImages, buildAgentThemePlanHtml } from '../src/features/agent/agentMerch.ts';

// Light's テーマ企画 (read 2026-11-12 from its past tasks; it cannot be run again on this account): when the request leaves out
// what the plan needs, it first asks 「デザイン企画書を作成するにあたり、以下の情報が必要です」 for the category range, the
// apparel field, the brand (「指定なし」) and the season and year, under a 「デザイン依頼」 card answered in words; it asks again
// only for what the answer left out, then searches. A task with a brand is named 「ZIMMERMANN風 2026年 Womenデザイン企画」.
// After the themes Light could not be run, so the plan's swatches, the main items' designs and テーマ企画書 are Heavy's own.

const done = (content: string) => ({ requestId: crypto.randomUUID(), state: 'completed' as const, content });
const themeTask = (extra: Partial<AgentTask> = {}): AgentTask => ({
  kind: 'heavy-agent-task', version: 1, scene: '商品企画', subtype: 'テーマ企画', prompt: '星空からインスピレーションを受けたデザイン企画書を作成して', profile: '', project: null,
  createdAt: '2026-11-12T00:00:00.000Z', rounds: [], choice: null, plan: null, image: null, notes: [], hearing: { steps: [], answers: [] }, ...extra,
});

test('the hearing asks for what is missing, again for what the answer left out, and at most three times', () => {
  // A new テーマ企画 starts with its questions; tasks made before them have none.
  assert.deepEqual(agentHearingState(themeTask()), { kind: 'start' });
  assert.deepEqual(agentHearingState(themeTask({ hearing: undefined })), { kind: 'none' });
  const prompt = agentHearingPrompt(themeTask());
  assert.match(prompt, /依頼: 星空からインスピレーション/);
  assert.match(prompt, /\[不足\]/);
  assert.match(prompt, /「指定なし」/);
  // The answer names the missing items; the page shows Light's own wording for them.
  const first = done('[不足] 1|2|3|4\n[ブランド]\n[年]\n[分野]');
  const asking = themeTask({ hearing: { steps: [first], answers: [] } });
  assert.deepEqual(agentHearingState(asking), { kind: 'ask', missing: [1, 2, 3, 4], index: 0 });
  assert.match(AGENT_HEARING_ITEMS[0], /^デザインするアイテムのカテゴリー範囲（例：ジャケット/);
  assert.match(AGENT_HEARING_ITEMS[2], /「指定なし」とご記入ください/);
  // An answer starts the next question with it.
  const answered = themeTask({ hearing: { steps: [first], answers: [{ text: 'プラネタリウム施設 ユニフォーム ボタンダウンシャツ', at: 'x' }] } });
  assert.deepEqual(agentHearingState(answered), { kind: 'start' });
  assert.match(agentHearingPrompt(answered), /これまでのユーザーの補足:\n1\. プラネタリウム施設/);
  // Everything known: done, with the values for the name.
  const known = done('[不足] なし\n[ブランド] ZIMMERMANN\n[年] 2026\n[分野] Women');
  assert.deepEqual(agentHearingState(themeTask({ hearing: { steps: [first, known], answers: [{ text: 'a', at: 'x' }] } })),
    { kind: 'done', parsed: { missing: [], brand: 'ZIMMERMANN', year: '2026', field: 'Women' } });
  // After the third answer the search starts with what is known.
  const steps = Array.from({ length: AGENT_HEARING_MAX_ASKS }, () => done('[不足] 4'));
  const answers = steps.map(() => ({ text: 'わからない', at: 'x' }));
  assert.equal(agentHearingState(themeTask({ hearing: { steps, answers } })).kind, 'done');
  assert.equal(agentHearingState(themeTask({ hearing: { steps, answers: answers.slice(0, -1) } })).kind, 'ask');
  // A failed question waits for its retry; a stray reply never blocks the task.
  assert.equal(agentHearingState(themeTask({ hearing: { steps: [{ requestId: 'f', state: 'failed' }], answers: [] } })).kind, 'failed');
  assert.equal(agentHearingState(themeTask({ hearing: { steps: [done('了解しました。')], answers: [] } })).kind, 'done');
});

test('the task is named like Light\'s テーマ企画 only with a brand', () => {
  assert.equal(agentHearingTitle(parseAgentHearing('[不足] なし\n[ブランド] ZIMMERMANN\n[年] 2026\n[分野] Women')), 'ZIMMERMANN風 2026年 Womenデザイン企画');
  assert.equal(agentHearingTitle(parseAgentHearing('[不足] なし\n[ブランド] Kariyushi\n[年] ２０２６年\n[分野]')), 'Kariyushi風 2026年 デザイン企画');
  assert.equal(agentHearingTitle(parseAgentHearing('[不足] なし\n[ブランド] 指定なし\n[年] 2026\n[分野] Unisex')), null);
  assert.equal(parseAgentHearing('[不足] 1｜４\n[分野] 女性').field, '');
  assert.deepEqual(parseAgentHearing('[不足] 1｜４').missing, [1, 4]);
});

test('the answers reach the research, the themes and the plan', () => {
  const research = { requestId: 'r', state: 'completed' as const, content: formatAgentResearchContent({ text: '## トレンド\n- 星', sources: [], searchUsed: true, searchErrors: [] }) };
  const task = themeTask({ hearing: { steps: [done('[不足] なし')], answers: [{ text: 'ユニセックス 指定なし 2026年春夏', at: 'x' }] } });
  assert.deepEqual(agentHearingLines(themeTask()), []);
  for (const prompt of [agentResearchPrompt(task), themePrompt({ ...task, research }), planPrompt({ ...task, research }, '宇宙の庭園')]) {
    assert.match(prompt, /ユーザーが補足した企画の条件（カテゴリー範囲・分野・ブランド・シーズン）:\n- ユニセックス 指定なし 2026年春夏/);
  }
});

const planContent = [
  '## タイトル', '- フェードブルー・オフィスリネン 27SS', '## コンセプト', '- 冷房下の通勤を涼しく',
  '## カラーパレット', '- 主役:フェードブルー(#A9BFD6)、ネイビー(#1f2f4f)', '- ベース:ロウミルク（#EFE9DC）', '- 全体で6色に絞る',
  '## 主力アイテム', '- ベルト付きリネン混ロングスカート', '- ハーフスリーブのリネンジャケット',
  '[画像プロンプト]', 'A moodboard flat lay of faded blue linen "style" pieces',
  '[アイテム画像]', '- ベルト付きリネン混ロングスカート｜faded blue linen-blend long skirt with self-fabric belt, "style" detail', '- ジャケット｜navy half-sleeve linen jacket', '- 説明のない行', '- ｜no name',
].join('\n');

test('the plan asks for color codes and, for テーマ企画, one picture description per main item', () => {
  const theme = planPrompt(themeTask(), 'テーマ');
  assert.match(theme, /「色名\(#RRGGBB\)」/);
  assert.match(theme, /\[アイテム画像\]/);
  // Other scenes' plans keep their image prompt only.
  assert.doesNotMatch(planPrompt(themeTask({ subtype: '新商品企画', scene: '商品企画' }), 'テーマ'), /\[アイテム画像\]/);
  // The mood board prompt is still the first line after its marker; the item lines are not plan sections.
  const parsed = parsePlanResponse(planContent);
  assert.equal(parsed.imagePrompt, 'A moodboard flat lay of faded blue linen "style" pieces');
  assert.deepEqual(parsed.sections.map(section => section.heading), ['コンセプト', 'カラーパレット', '主力アイテム']);
  assert.deepEqual(parsePlanItemImages(planContent), [
    { name: 'ベルト付きリネン混ロングスカート', prompt: 'faded blue linen-blend long skirt with self-fabric belt, aesthetic detail' },
    { name: 'ジャケット', prompt: 'navy half-sleeve linen jacket' },
  ]);
  assert.deepEqual(agentPaletteColors('主役:フェードブルー(#A9BFD6)、ネイビー(#1f2f4f)'), [{ name: 'フェードブルー', hex: '#A9BFD6' }, { name: 'ネイビー', hex: '#1F2F4F' }]);
  assert.deepEqual(agentPaletteColors('ベース:ロウミルク（#EFE9DC）'), [{ name: 'ロウミルク', hex: '#EFE9DC' }]);
  assert.deepEqual(agentPaletteColors('全体で6色に絞る'), []);
});

test('the main items become pending pictures, and テーマ企画書 holds the plan, swatches, pictures and 参考資料', () => {
  let n = 0;
  const task = themeTask({ choice: { theme: 'フェードブルー・オフィスリネン', at: 'x' }, plan: done(planContent) });
  const images = agentBuildPlanItemImages(task, () => `id-${++n}`);
  assert.deepEqual(images.map(image => [image.key, image.code, image.name, image.state, image.requestId]),
    [['I1', 'I1', 'ベルト付きリネン混ロングスカート', 'pending', 'id-1'], ['I2', 'I2', 'ジャケット', 'pending', 'id-2']]);
  assert.deepEqual(agentBuildPlanItemImages(themeTask(), () => 'x'), []);
  // A plan without the item lines draws its 主力アイテム from their own words.
  const noLines = themeTask({ plan: done(planContent.slice(0, planContent.indexOf('[画像プロンプト]'))) });
  assert.deepEqual(agentBuildPlanItemImages(noLines, () => 'y').map(image => [image.code, image.name, image.prompt]),
    [['I1', 'ベルト付きリネン混ロングスカート', 'ベルト付きリネン混ロングスカート'], ['I2', 'ハーフスリーブのリネンジャケット', 'ハーフスリーブのリネンジャケット']]);
  const html = buildAgentThemePlanHtml({ ...task, designs: images.map(image => ({ ...image, state: 'completed' })) }, 'タスク名', 'https://img.example/board.png?sig=1&x=<2>',
    { I1: 'https://img.example/i1.png' });
  assert.match(html, /<title>テーマ企画書<\/title>/);
  assert.match(html, /<h1>フェードブルー・オフィスリネン 27SS<\/h1>/);
  assert.match(html, /採用テーマ：フェードブルー・オフィスリネン/);
  assert.match(html, /<i style="background:#A9BFD6"><\/i><span>フェードブルー #A9BFD6<\/span>/);
  assert.match(html, /<img src="https:\/\/img\.example\/i1\.png" alt="ベルト付きリネン混ロングスカート">/);
  assert.doesNotMatch(html, /alt="ジャケット"/);
  assert.match(html, /src="https:\/\/img\.example\/board\.png\?sig=1&amp;x=&lt;2&gt;"/);
  assert.doesNotMatch(html, /<script/i);
});

test('the page asks before searching, takes the answer from the card or the input, and offers テーマ企画書', () => {
  const page = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');
  const tasks = readFileSync(new URL('../src/features/agent/agentTasks.ts', import.meta.url), 'utf8');
  assert.match(tasks, /input\.subtype === 'テーマ企画' \? \{ hearing: \{ steps: \[\], answers: \[\] \} \}/);
  // The questions come before the search, which waits for them (and for the task's name).
  const hearingAt = page.indexOf("if (agentThemeSearches(task) && !task.rounds.length && !task.research && task.hearing)");
  const searchAt = page.indexOf("// Light's テーマ企画 searches the web before its first themes");
  assert.ok(hearingAt > 0 && hearingAt < searchAt);
  assert.match(page, /if \(!dialogue && hearingAsk\) \{ if \(answerHearing\(draft\)\) setDraft\(''\); return; \}/);
  assert.match(page, /!stepFailed\(task\.research\?\.state\) && !hearingOpen/);
  assert.match(page, /data-testid="agent-hearing-request"/);
  assert.match(page, /key: 'theme-plan', title: 'テーマ企画書'/);
  assert.match(page, /data-testid="agent-plan-designs"/);
  assert.match(page, /data-testid="agent-plan-swatches"/);
  // テーマ企画's plan is sent in the agent mode (9,000 tokens), not the plain one that stops at 2,560.
  assert.match(page, /planPrompt\(saved\.task, theme\), \(task, result\) => \(\{ \.\.\.task, plan: result \}\), agentThemeSearches\(saved\.task\) \? 'agent' : textMode\(saved\.task\)\)/);
});
