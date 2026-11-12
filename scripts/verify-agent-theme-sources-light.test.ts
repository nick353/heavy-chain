import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENT_THEME_SOURCES_MAX, callClaudeResearch, researchClaimText } from '../cloudflare/heavy-api/src/claude-text.ts';
import { formatAgentResearchContent } from '../cloudflare/heavy-api/src/designAssistant.ts';
import { agentRoundSources, agentSourceSite, parseAgentResearch, parseThemeResponse, type AgentTask } from '../src/features/agent/agentFlow.ts';
import { agentDialogueHistory, parseAgentDialogueReply } from '../src/features/agent/agentDialogue.ts';

// Light's テーマ企画 参考資料, read on 2026-11-12 from its 23 テーマ企画 tasks (jp.linkaigc.com/agent, planMode=plan):
// 0 to 25 entries (median 6); each entry is the site's registered domain and one sentence of Light's own answer that the
// source backs (2 to 136 characters, never the page's text, no sentence twice in 179 entries); the same site comes again
// for another sentence (mangohouse.jp 6 times in one list); online shops are listed like any site (rakuten.co.jp,
// dhgate.com, net-a-porter.com, modaoperandi.com, minne.com). Heavy listed one entry per page (at most 20) under the page's
// own text: English or a shop's keyword list (production research 498af21f: 「ワンピース レディース 春 夏 春夏 黒 白…」).

type Json = Record<string, any>;
const env = { ANTHROPIC_API_KEY: 'server-only-test-key' } as any;
const reply = (content: Json[]) => async () => Response.json({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content, usage: { input_tokens: 1, output_tokens: 1 } });
const cite = (url: string, cited_text: string, title?: string) => ({ type: 'web_search_result_location', url, cited_text, ...(title ? { title } : {}) });
const run = (content: Json[]) => callClaudeResearch(env, { system: 's', messages: [{ role: 'user', content: 'q' }] }, reply(content));

const themeTask = (extra: Partial<AgentTask> = {}): AgentTask => ({
  kind: 'heavy-agent-task', version: 1, scene: '商品企画', subtype: 'テーマ企画', prompt: 'Lemaire の 2027年春夏 を参考に、リネンのワンピース、ブラウス を含む レディース 企画', profile: '', project: null,
  createdAt: '2026-11-12T00:00:00.000Z', rounds: [], choice: null, plan: null, image: null, notes: [], ...extra,
});

const report = [
  { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [
    { url: 'https://www.whowhatwear.com/trends-ss27', title: '9 Spring/Summer 2027 Trends' },
    { url: 'https://item.rakuten.co.jp/likefashion/pocp0007/', title: '【楽天市場】リネン ワンピース' },
    { url: 'https://search.kakaku.com/%E3%83%AA%E3%83%8D%E3%83%B3%20%E3%83%96%E3%83%A9%E3%82%A6%E3%82%B9/', title: '「リネン ブラウス」の人気商品一覧' },
    { url: 'https://www.walmart.com/ip/1', title: 'Sweater' },
  ] },
  // Narration before the report: not listed even when cited.
  { type: 'text', text: 'まず2027年春夏のトレンドを調べます。', citations: [cite('https://www.walmart.com/ip/1', 'Sweater')] },
  { type: 'text', text: '[調査結果]\n## トレンド\n- ' },
  { type: 'text', text: '2027年春夏は手仕事の跡を見せるデザインが広がる', citations: [cite('https://www.whowhatwear.com/trends-ss27', '# 9 Trends Set to Define Spring 2027 Fashion ## By Hand', '9 Spring/Summer 2027 Trends')] },
  { type: 'text', text: '。\n- ' },
  { type: 'text', text: '楽天では**半袖のリネンワンピース**がマキシ丈で売れている', citations: [cite('https://item.rakuten.co.jp/likefashion/pocp0007/', 'ボリューム袖 韓国 コーデ 春 夏 秋 ブラック 黒')] },
  { type: 'text', text: '。\n- ' },
  // The same page backs another sentence: Light lists the site again.
  { type: 'text', text: 'リネン混の価格は5,000〜8,000円が中心', citations: [cite('https://item.rakuten.co.jp/likefashion/pocp0007/', '¥5,990')] },
  { type: 'text', text: '。\n## 色と素材\n- ' },
  // A shop's search list backs a sentence: listed under the report's sentence, not the list's keywords.
  { type: 'text', text: '価格.comのリネンブラウスは花柄と刺繍が上位に並ぶ', citations: [cite('https://search.kakaku.com/%E3%83%AA%E3%83%8D%E3%83%B3%20%E3%83%96%E3%83%A9%E3%82%A6%E3%82%B9/', 'リバティ LIBERTY 半袖 シャツ フランダースリネン 花柄 麻100％ リネン 麻 ブラウス')] },
  { type: 'text', text: '。\n- ' },
  // The same sentence cited twice is listed once.
  { type: 'text', text: '2027年春夏は手仕事の跡を見せるデザインが広がる', citations: [cite('https://www.whowhatwear.com/trends-ss27', 'By Hand')] },
  { type: 'text', text: '。\n- 一般論の行（引用なし）。' },
];

test('テーマ企画 lists one entry per cited sentence of the report, under that sentence, with shops and the same page again', async () => {
  const result = await run(report);
  assert.deepEqual(result.claims, [
    { url: 'https://www.whowhatwear.com/trends-ss27', title: '9 Spring/Summer 2027 Trends', quote: '2027年春夏は手仕事の跡を見せるデザインが広がる' },
    { url: 'https://item.rakuten.co.jp/likefashion/pocp0007/', title: '【楽天市場】リネン ワンピース', quote: '楽天では**半袖のリネンワンピース**がマキシ丈で売れている' },
    { url: 'https://item.rakuten.co.jp/likefashion/pocp0007/', title: '【楽天市場】リネン ワンピース', quote: 'リネン混の価格は5,000〜8,000円が中心' },
    { url: 'https://search.kakaku.com/%E3%83%AA%E3%83%8D%E3%83%B3%20%E3%83%96%E3%83%A9%E3%82%A6%E3%82%B9/', title: '「リネン ブラウス」の人気商品一覧', quote: '価格.comのリネンブラウスは花柄と刺繍が上位に並ぶ' },
  ]);
  // The per-page list that インスピレーション and 新商品企画 use is unchanged: each cited page once, with the page's text.
  assert.deepEqual(result.sources.map(source => [source.url, source.quote]), [
    ['https://www.walmart.com/ip/1', 'Sweater'],
    ['https://www.whowhatwear.com/trends-ss27', '# 9 Trends Set to Define Spring 2027 Fashion ## By Hand'],
    ['https://item.rakuten.co.jp/likefashion/pocp0007/', 'ボリューム袖 韓国 コーデ 春 夏 秋 ブラック 黒'],
    ['https://search.kakaku.com/%E3%83%AA%E3%83%8D%E3%83%B3%20%E3%83%96%E3%83%A9%E3%82%A6%E3%82%B9/', 'リバティ LIBERTY 半袖 シャツ フランダースリネン 花柄 麻100％ リネン 麻 ブラウス'],
  ]);
});

test('a cited block that carries the marker or a heading keeps only its sentence', async () => {
  assert.equal(researchClaimText('[調査結果]\n## トレンド\n- ディープグリーンが主要カラー'), 'ディープグリーンが主要カラー');
  // The bold stays (Light shows it in bold, 2026-11-12); list marks go.
  assert.equal(researchClaimText('1. **ブラウン**とオフホワイト\n・ミントグリーン'), '**ブラウン**とオフホワイト ミントグリーン');
  const result = await run([{ type: 'text', text: '[調査結果]\n## トレンド\n- ディープグリーンが主要カラー', citations: [cite('ftp://x', 'a'), cite('https://fashionunited.jp/news/x', 'Deep Green', 'WGSN')] }]);
  assert.deepEqual(result.claims, [{ url: 'https://fashionunited.jp/news/x', title: 'WGSN', quote: 'ディープグリーンが主要カラー' }]);
  // No citation lists nothing (Light shows no 参考資料 when its answer did not search).
  assert.deepEqual((await run([{ type: 'text', text: '[調査結果]\n## トレンド\n- 一般論' }])).claims, []);
});

test('at most 25 entries, the first 25 sentences in the report\'s order; the per-page list keeps its 20', async () => {
  const blocks: Json[] = [{ type: 'text', text: '[調査結果]\n## トレンド\n' }];
  for (let index = 1; index <= 30; index += 1) blocks.push({ type: 'text', text: `- 事実${index}`, citations: [cite(`https://site${index}.example/a`, `page ${index}`)] }, { type: 'text', text: '\n' });
  const result = await run(blocks);
  assert.equal(AGENT_THEME_SOURCES_MAX, 25);
  assert.equal(result.claims.length, 25);
  assert.deepEqual(result.claims.map(claim => claim.quote), Array.from({ length: 25 }, (_, index) => `事実${index + 1}`));
  assert.equal(result.sources.length, 20);
});

test('the sentences go after [検索], so the report, 新商品企画, the chat and its history read the content as before', async () => {
  const result = await run(report);
  const content = formatAgentResearchContent(result);
  assert.match(content, /\n\[検索\] ok\n\n\[引用\]\n- 9 Spring\/Summer 2027 Trends \| https:\/\/www\.whowhatwear\.com\/trends-ss27 \| 2027年春夏は手仕事の跡を見せるデザインが広がる\n/);
  const parsed = parseAgentResearch(content);
  assert.equal(parsed.search, 'ok');
  assert.doesNotMatch(parsed.report, /\[引用\]|\[出典\]/);
  // The per-page list (新商品企画's report) is exactly the [出典] block.
  assert.deepEqual(parsed.sources.map(source => source.url), result.sources.map(source => source.url));
  assert.deepEqual(parsed.claims?.map(claim => claim.quote), result.claims.map(claim => claim.quote));
  // インスピレーション / AIグラフィックデザイン: the chat keeps the [出典] block apart from its text and history (Light shows no list for it).
  const chat = parseAgentDialogueReply(content);
  assert.deepEqual(chat.sources.map(source => source.url), result.sources.map(source => source.url));
  assert.doesNotMatch(chat.body, /\[引用\]|手仕事の跡を見せるデザインが広がる \|/);
  const dialogueTask = { ...themeTask(), scene: 'インスピレーション', subtype: 'インスピレーション', flow: 'dialogue', dialogueStart: null,
    turns: [{ id: 'a1', role: 'assistant', at: '2026-11-12T00:00:00.000Z', step: { requestId: 'r1', state: 'completed', content }, mode: 'agent-research' }, { id: 'u2', role: 'user', at: '2026-11-12T00:01:00.000Z', text: 'A' }] } as unknown as AgentTask;
  assert.doesNotMatch(JSON.stringify(agentDialogueHistory(dialogueTask)), /\[引用\]/);
  // A theme round's text stops at [出典] as before.
  assert.doesNotMatch(parseThemeResponse(`[概要]\nx\n[テーマ]\n- A：a\n\n${content.slice(content.indexOf('[出典]'))}`).summary, /\[引用\]/);
});

test('テーマ企画 shows the sentence list; research written before it keeps the page list; an empty list stays empty', async () => {
  const result = await run(report);
  const research = (content: string) => ({ requestId: 'r', state: 'completed' as const, content });
  const listed = agentRoundSources(themeTask({ research: research(formatAgentResearchContent(result)) }));
  assert.deepEqual(listed?.sources.map(source => source.quote), result.claims.map(claim => claim.quote));
  assert.equal(listed?.sources.filter(source => source.url === 'https://item.rakuten.co.jp/likefashion/pocp0007/').length, 2);
  const older = agentRoundSources(themeTask({ research: research(formatAgentResearchContent({ ...result, claims: undefined })) }));
  assert.deepEqual(older?.sources.map(source => source.url), result.sources.map(source => source.url));
  const empty = agentRoundSources(themeTask({ research: research(formatAgentResearchContent({ ...result, claims: [] })) }));
  assert.deepEqual(empty?.sources, []);
});

test('the site is named as Light names it: the registered domain', () => {
  const cases: Array<[string, string]> = [
    ['https://ja.wikipedia.org/wiki/かりゆしウェア', 'wikipedia.org'],
    ['https://item.rakuten.co.jp/likefashion/pocp0007/', 'rakuten.co.jp'],
    ['https://search.kakaku.com/x/', 'kakaku.com'],
    ['https://kakaku.com/fashion/ss_0015/', 'kakaku.com'],
    ['https://www.pref.okinawa.jp/x', 'pref.okinawa.jp'],
    ['https://www8.cao.go.jp/okinawa/', 'cao.go.jp'],
    ['https://news.yahoo.co.jp/articles/1', 'yahoo.co.jp'],
    ['https://topics.smt.docomo.ne.jp/article/1', 'docomo.ne.jp'],
    ['https://www.rollingstone.co.uk/x', 'rollingstone.co.uk'],
    ['https://www.elle.com/jp/', 'elle.com'],
    ['https://metalmagazine.eu/x', 'metalmagazine.eu'],
    ['https://www.lettuce.co.jp/products/list?category_id=10', 'lettuce.co.jp'],
    ['https://fashiontheoryco.substack.com/p/x', 'substack.com'],
    ['https://hypebeast.com', 'hypebeast.com'],
    ['not a url', 'not a url'],
  ];
  for (const [url, site] of cases) assert.equal(agentSourceSite(url), site, url);
});

test('the task page names テーマ企画 sources by their site and lets a page come again; the chat has no list', () => {
  const page = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /roundSources\.sources\.map\(\(source, index\) => \([\s\S]{0,500}<li key=\{`\$\{index\}:\$\{source\.url\}`\}[\s\S]{0,400}\{agentSourceSite\(source\.url\)\}<\/a>/);
  assert.doesNotMatch(page, /dialogueSources|agent-dialogue-sources/);
});
