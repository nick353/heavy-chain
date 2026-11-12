import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatAgentResearchContent } from '../cloudflare/heavy-api/src/designAssistant.ts';
import { agentAnswerSources, agentRoundSources, agentThemeEvidence, parseAgentResearch, parseThemeResponse, stripAgentCiteMarks, themePrompt, type AgentTask } from '../src/features/agent/agentFlow.ts';

// Light's テーマ企画 参考資料 (read 2026-11-12 from its 23 テーマ企画 tasks, 179 entries): each entry is one sentence of the
// answer shown on screen (「このコレクションは、90年代から…インスピレーションを得ています」 under hypebeast.com), in the
// answer's order, a site again for another sentence, never one sentence twice, 0 to 25 entries. Heavy listed the sentences
// of its research report, which the screen never shows (#250). Now the theme answer marks its sentences with the numbered
// research evidence (〔1〕), the screen drops the marks, and 参考資料 lists each marked sentence under its source.

const claims = [
  { title: 'Lemaire SS27', url: 'https://www.lemaire.fr/pages/runway-spring-summer-2027', quote: 'マットとツヤ、構築と流動性という対比' },
  { title: '楽天 リネン', url: 'https://item.rakuten.co.jp/likefashion/pocp0007/', quote: '楽天では**半袖のリネンワンピース**がマキシ丈で売れている' },
  { title: 'Lemaire 2', url: 'https://www.lemaire.fr/pages/fabrics', quote: '麻45%×リヨセル55%のサマードレス' },
];
const pages = [{ title: 'Lemaire SS27', url: 'https://www.lemaire.fr/pages/runway-spring-summer-2027', quote: 'Matte and shine' }];
const research = (withClaims = true) => ({ requestId: 'research-1', state: 'completed' as const,
  content: formatAgentResearchContent({ text: '## トレンド\n- マットとツヤの対比', sources: pages, ...(withClaims ? { claims } : {}), searchUsed: true, searchErrors: [] }) });
const themeTask = (extra: Partial<AgentTask> = {}): AgentTask => ({
  kind: 'heavy-agent-task', version: 1, scene: '商品企画', subtype: 'テーマ企画', prompt: 'Lemaire の 2027年春夏 を参考に、リネンのワンピースを含むレディース企画', profile: '', project: null,
  createdAt: '2026-11-12T00:00:00.000Z', rounds: [], choice: null, plan: null, image: null, notes: [], research: research(), ...extra,
});
const evidence = claims.map(claim => claim.url);
const answer = [
  '[概要]',
  'Lemaireの2027年春夏は、マットとツヤの対比が軸になっています。〔1〕楽天では**半袖のリネンワンピース**が売れています〔2〕。一般論として春夏は軽い素材が好まれます。',
  '以下の4つのテーマを提案します。',
  '1. 静かな対比',
  'キーエレメント：麻とリヨセルのサマードレス〔3〕〔1〕',
  'インスピレーション：Lemaireのランウェイ〔1〕',
  'カラーパレット：生成り、墨〔9〕',
  'Lemaireの2027年春夏は、マットとツヤの対比が軸になっています。〔1〕',
  '[テーマ]',
  '- 静かな対比：マットとツヤ〔1〕',
  '- 麻の朝：リネン',
  '- 都市の余白：構築',
  '- 生成りの午後：流動',
].join('\n');

test('the theme prompt numbers the research evidence by site and asks for the numbers after the sentences they back', () => {
  const task = themeTask();
  assert.deepEqual(agentThemeEvidence(task).map(source => source.url), evidence);
  const prompt = themePrompt(task);
  assert.match(prompt, /調査の根拠（〔番号〕サイト：調査で分かったこと）:\n〔1〕lemaire\.fr：マットとツヤ、構築と流動性という対比\n〔2〕rakuten\.co\.jp：楽天では半袖のリネンワンピースがマキシ丈で売れている\n〔3〕lemaire\.fr：麻45%×リヨセル55%のサマードレス/);
  assert.match(prompt, /文の終わり（句点の直後）にその根拠の番号を〔1〕のように付ける/);
  assert.match(prompt, /\[テーマ\] の行には番号を付けない/);
  // 参考資料 is what the citations feed, so the theme prompt still never forbids 出典.
  assert.doesNotMatch(prompt, /出典/);
  // Research written before [引用] numbers its cited pages; no research, no list.
  assert.deepEqual(agentThemeEvidence(themeTask({ research: research(false) })).map(source => source.url), pages.map(page => page.url));
  assert.doesNotMatch(themePrompt(themeTask({ research: null })), /調査の根拠/);
  // 新商品企画 writes no テーマ企画 answer.
  assert.deepEqual(agentThemeEvidence(themeTask({ subtype: '新商品企画', flow: 'conversation' })), []);
});

test('the screen shows the answer without the numbers', () => {
  const parsed = parseThemeResponse(answer);
  assert.doesNotMatch(parsed.summary, /〔|〕/);
  assert.match(parsed.summary, /軸になっています。楽天では\*\*半袖のリネンワンピース\*\*が売れています。/);
  assert.deepEqual(parsed.themes, ['静かな対比：マットとツヤ', '麻の朝：リネン', '都市の余白：構築', '生成りの午後：流動']);
  assert.equal(stripAgentCiteMarks('a〔1、3〕b 〔2〕〔4〕c'), 'abc');
});

test('参考資料 lists each marked sentence of the answer under its source, in order, once each, sites again', () => {
  const task = themeTask({ rounds: [{ step: { requestId: 't1', state: 'completed', content: answer }, summary: '', themes: [], evidence }] });
  const listed = agentRoundSources(task);
  assert.deepEqual(listed?.sources.map(source => [source.url, source.quote]), [
    [evidence[0], 'Lemaireの2027年春夏は、マットとツヤの対比が軸になっています。'],
    [evidence[1], '楽天では**半袖のリネンワンピース**が売れています'],
    // Several numbers: the first that exists. The label stays, as on screen.
    [evidence[2], 'キーエレメント：麻とリヨセルのサマードレス'],
    [evidence[0], 'インスピレーション：Lemaireのランウェイ'],
  ]);
  // The unmarked sentence, the number outside the list (〔9〕), the repeated sentence and the [テーマ] line are not listed.
  assert.equal(listed?.sources.some(source => /一般論|生成り|静かな対比/.test(source.quote ?? '')), false);
  assert.equal(listed?.search, 'ok');
});

test('a new answer that marked nothing lists nothing; older answers keep their lists', () => {
  const unmarked = '[概要]\n傾向です。\n[テーマ]\n- A：a';
  assert.deepEqual(agentRoundSources(themeTask({ rounds: [{ step: { requestId: 't1', state: 'completed', content: unmarked }, summary: '', themes: [], evidence }] }))?.sources, []);
  // A round from before the numbering (no `evidence`) keeps the research's sentences (#250).
  assert.deepEqual(agentRoundSources(themeTask({ rounds: [{ step: { requestId: 't1', state: 'completed', content: unmarked }, summary: '', themes: [] }] }))?.sources.map(source => source.quote),
    claims.map(claim => claim.quote));
  // A round that searched itself (tasks made before the research step) keeps its own pages.
  const own = formatAgentResearchContent({ text: '[概要]\ny\n[テーマ]\n- B：b', sources: [{ title: 'hypebeast', url: 'https://hypebeast.com/x', quote: 'q' }], searchUsed: true, searchErrors: [] });
  assert.deepEqual(agentRoundSources(themeTask({ research: null, rounds: [{ step: { requestId: 't0', state: 'completed', content: own }, summary: '', themes: [] }] }))?.sources.map(source => source.url), ['https://hypebeast.com/x']);
});

test('at most 25 entries, each sentence cut at 160 characters without half a bold mark', () => {
  const urls = Array.from({ length: 25 }, (_, index) => `https://site${index + 1}.example/a`);
  const lines = Array.from({ length: 30 }, (_, index) => `事実${index + 1}です。〔${(index % 25) + 1}〕`);
  const sources = agentAnswerSources(`[概要]\n${lines.join('')}\n${'長'.repeat(170)}〔1〕\n[テーマ]\n- A：a`, urls, parseAgentResearch(research().content));
  assert.equal(sources.length, 25);
  assert.equal(sources[24].quote, '事実25です。');
  const long = agentAnswerSources(`[概要]\n${'長'.repeat(158)}**太字**〔1〕`, urls, parseAgentResearch(research().content));
  assert.equal(long[0].quote!.length <= 160, true);
  assert.doesNotMatch(long[0].quote!, /\*\*[^*]*$/);
});

test('the task page keeps the numbered evidence on the round it asks for', () => {
  const page = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /const evidence = agentThemeEvidence\(task\)\.map\(\(source\) => source\.url\);[\s\S]{0,200}\.\.\.\(evidence\.length \? \{ evidence \} : \{\}\)/);
});
