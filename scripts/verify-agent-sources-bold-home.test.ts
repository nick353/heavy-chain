import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callClaudeResearch, researchClaimText } from '../cloudflare/heavy-api/src/claude-text.ts';
import { formatAgentResearchContent } from '../cloudflare/heavy-api/src/designAssistant.ts';
import { agentQuoteParts, agentRoundSources, agentSourceHome, cleanAgentQuote, parseAgentResearch, type AgentTask } from '../src/features/agent/agentFlow.ts';
import { parseAgentDialogueReply } from '../src/features/agent/agentDialogue.ts';

// Light's テーマ企画 参考資料, read on 2026-11-12 (jp.linkaigc.com/agent, 「Okinawa風 2024年 Womenデザイン企画」 and
// 「ZIMMERMANN風 2026年 Womenデザイン企画」): the list is Markdown. Each entry is <ol><li><a href="https://<site>"
// target="_blank">, then the sentence in a <blockquote>, then <hr>. A sentence's **…** is a
// <strong class="text-base leading-6 font-semibold break-words text-text-primary"> (「**気候適応と快適性の追求:** 沖縄の年間平均気温が
// 23.3℃と温暖であるため」), brighter than the sentence (text-secondary-foreground). The link is the site's entrance:
// https://wikipedia.org, https://pref.okinawa.jp, https://cao.go.jp, https://san-a.co.jp, https://youtube.com (no www, path or
// trailing slash). Heavy dropped the ** (#248) and linked the cited page itself (https://www.lemaire.fr/pages/runway-…).

const page = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');
const bold = (text: string) => ({ text, bold: true });
const plain = (text: string) => ({ text, bold: false });

test('a ** pair in the cited sentence is a bold run, as in Light', () => {
  assert.deepEqual(agentQuoteParts('**気候適応と快適性の追求:** 沖縄の年間平均気温が23.3℃と温暖であるため'),
    [bold('気候適応と快適性の追求:'), plain(' 沖縄の年間平均気温が23.3℃と温暖であるため')]);
  // Production task 6080ebb2 (research 498af21f): a page's bold sentence.
  assert.deepEqual(agentQuoteParts('**metallics (+17%)…**'), [bold('metallics (+17%)…')]);
  assert.deepEqual(agentQuoteParts('楽天では**半袖のリネンワンピース**がマキシ丈で売れている'),
    [plain('楽天では'), bold('半袖のリネンワンピース'), plain('がマキシ丈で売れている')]);
  assert.deepEqual(agentQuoteParts('Light — washed and airy **Key Shades:** The light palette'),
    [plain('Light — washed and airy '), bold('Key Shades:'), plain(' The light palette')]);
  assert.deepEqual(agentQuoteParts('**a** **b**'), [bold('a'), plain(' '), bold('b')]);
  // A pair inside a pair is one bold run; *** counts as **.
  assert.deepEqual(agentQuoteParts('**a **b** c** d'), [bold('a b c'), plain(' d')]);
  assert.deepEqual(agentQuoteParts('***Linen*** dress'), [bold('Linen'), plain(' dress')]);
});

test('a ** with no partner is dropped and the text stays plain (no symbol is shown)', () => {
  // Production task 6080ebb2: the search tool's Markdown cut mid-way.
  assert.deepEqual(agentQuoteParts('** The key directions for Spring Summer 2027 are nature-inspired textures'),
    [plain('The key directions for Spring Summer 2027 are nature-inspired textures')]);
  assert.deepEqual(agentQuoteParts('Earthy tones lead** and beige'), [plain('Earthy tones lead and beige')]);
  // An opening ** is not followed by a space and a closing one does not follow a space, as in Markdown.
  assert.deepEqual(agentQuoteParts('cut** in the middle **of a page'), [plain('cut in the middle of a page')]);
  assert.deepEqual(agentQuoteParts('**a** and **b'), [bold('a'), plain(' and b')]);
  assert.deepEqual(agentQuoteParts('**'), []);
  assert.deepEqual(agentQuoteParts('** **'), []);
  assert.deepEqual(agentQuoteParts('****'), []);
});

test('heading marks and __ still go; hashtags stay', () => {
  assert.deepEqual(agentQuoteParts('# 9 Trends Set to Define Spring 2027 Fashion ## Spring/Summer 2027 Trends ### By Hand Today, designers'),
    [plain('9 Trends Set to Define Spring 2027 Fashion Spring/Summer 2027 Trends By Hand Today, designers')]);
  assert.deepEqual(agentQuoteParts('## **Key Shades:** The light palette'), [bold('Key Shades:'), plain(' The light palette')]);
  assert.deepEqual(agentQuoteParts('__Note__ 夏の定番 #リネン ワンピース'), [plain('Note 夏の定番 #リネン ワンピース')]);
});

test('the stored sentence keeps only the pairs shown in bold, and reading it again gives the same runs', () => {
  for (const value of ['** The key directions', '**metallics (+17%)…**', 'cut** in the middle **of a page', '# 9 Trends ## **By Hand** today', '**a **b** c** d']) {
    const clean = cleanAgentQuote(value);
    assert.equal(cleanAgentQuote(clean), clean, value);
    assert.deepEqual(agentQuoteParts(clean), agentQuoteParts(value), value);
  }
  assert.equal(cleanAgentQuote('** The key directions'), 'The key directions');
  assert.equal(cleanAgentQuote('# 9 Trends ## **By Hand** today'), '9 Trends **By Hand** today');
  const content = '## トレンド\n- 自然由来\n\n[出典]\n- Trendalytics | https://trendalytics.co/x | ** The key directions\n- WWD | https://www.wwd.com/y | **metallics (+17%)…**\n- 記号だけ | https://example.com/h | **\n\n[検索] ok';
  assert.deepEqual(parseAgentResearch(content).sources, [
    { title: 'Trendalytics', url: 'https://trendalytics.co/x', quote: 'The key directions' },
    { title: 'WWD', url: 'https://www.wwd.com/y', quote: '**metallics (+17%)…**' },
    // Nothing left: the title is shown instead.
    { title: '記号だけ', url: 'https://example.com/h' },
  ]);
  assert.deepEqual(parseAgentDialogueReply('[調査結果]\n方案A\n\n[出典]\n- WWW | https://www.whowhatwear.com/x | # 9 Trends ## **By Hand**\n\n[検索] ok').sources,
    [{ title: 'WWW', url: 'https://www.whowhatwear.com/x', quote: '9 Trends **By Hand**' }]);
});

type Json = Record<string, any>;
const env = { ANTHROPIC_API_KEY: 'server-only-test-key' } as any;
const reply = (content: Json[]) => async () => Response.json({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content, usage: { input_tokens: 1, output_tokens: 1 } });
const cite = (url: string, cited_text: string) => ({ type: 'web_search_result_location', url, cited_text, title: 'T' });
const run = (content: Json[]) => callClaudeResearch(env, { system: 's', messages: [{ role: 'user', content: 'q' }] }, reply(content));

test('new research keeps the report sentence\'s bold for テーマ企画 (Light shows the bold of its own sentence)', async () => {
  assert.equal(researchClaimText('[調査結果]\n## 色\n- **ディープグリーン**が主要カラー'), '**ディープグリーン**が主要カラー');
  const long = `**${'あ'.repeat(156)}**の続き`;
  const result = await run([
    { type: 'text', text: '[調査結果]\n## 色と素材\n- ' },
    { type: 'text', text: '**気候適応と快適性の追求:** 平均気温が23.3℃', citations: [cite('https://ja.wikipedia.org/wiki/x', 'a')] },
    { type: 'text', text: '\n- ' },
    // The same sentence without its bold is the same sentence: listed once.
    { type: 'text', text: '気候適応と快適性の追求: 平均気温が23.3℃', citations: [cite('https://www.pref.okinawa.jp/y', 'b')] },
    { type: 'text', text: '\n- ' },
    // A span of only the marks is no sentence.
    { type: 'text', text: '**', citations: [cite('https://www.cao.go.jp/z', 'c')] },
    { type: 'text', text: '\n- ' },
    // The 160-character cut never leaves half of a **.
    { type: 'text', text: long, citations: [cite('https://www.san-a.co.jp/w', 'd')] },
  ]);
  assert.deepEqual(result.claims.map(claim => claim.quote), ['**気候適応と快適性の追求:** 平均気温が23.3℃', `**${'あ'.repeat(156)}…`]);
  const parsed = parseAgentResearch(formatAgentResearchContent(result));
  assert.deepEqual(agentQuoteParts(parsed.claims![0].quote!), [bold('気候適応と快適性の追求:'), plain(' 平均気温が23.3℃')]);
  assert.deepEqual(agentQuoteParts(parsed.claims![1].quote!), [plain(`${'あ'.repeat(156)}…`)]);
});

test('テーマ企画 links go to the site\'s entrance, as in Light', () => {
  assert.equal(agentSourceHome('https://ja.wikipedia.org/wiki/%E3%81%8B%E3%82%8A%E3%82%86%E3%81%97%E3%82%A6%E3%82%A7%E3%82%A2'), 'https://wikipedia.org');
  assert.equal(agentSourceHome('https://www.lemaire.fr/pages/runway-spring-summer-2027'), 'https://lemaire.fr');
  assert.equal(agentSourceHome('https://www.pref.okinawa.jp/kurashikankyo/x.html'), 'https://pref.okinawa.jp');
  assert.equal(agentSourceHome('https://item.rakuten.co.jp/likefashion/pocp0007/'), 'https://rakuten.co.jp');
  assert.equal(agentSourceHome('https://search.kakaku.com/%E3%83%AA%E3%83%8D%E3%83%B3/'), 'https://kakaku.com');
  assert.equal(agentSourceHome('http://www.youtube.com/watch?v=1'), 'https://youtube.com');
  assert.equal(agentSourceHome('https://trendhunter.com'), 'https://trendhunter.com');
  // No site name of that kind: its own address.
  assert.equal(agentSourceHome('https://localhost:8080/a'), 'https://localhost:8080/a');
  assert.equal(agentSourceHome('https://[::1]/a'), 'https://[::1]/a');
  // Older tasks link the same way: the stored URL is unchanged and the link is made when shown.
  const task = { kind: 'heavy-agent-task', version: 1, scene: '商品企画', subtype: 'テーマ企画', prompt: 'p', profile: '', project: null, createdAt: '2026-11-12T00:00:00.000Z',
    rounds: [], choice: null, plan: null, image: null, notes: [],
    research: { requestId: 'r', state: 'completed', content: '## a\n\n[出典]\n- Lemaire | https://www.lemaire.fr/pages/runway-spring-summer-2027 | x\n\n[検索] ok' } } as unknown as AgentTask;
  assert.deepEqual(agentRoundSources(task)?.sources.map(source => [source.url, agentSourceHome(source.url)]),
    [['https://www.lemaire.fr/pages/runway-spring-summer-2027', 'https://lemaire.fr']]);
});

test('the task page draws the bold as <strong> elements (no HTML string) and links テーマ企画 sites to their entrance', () => {
  assert.match(page, /const SourceQuote = \(\{ text \}: \{ text: string \}\) => \(\n\s+<>\{agentQuoteParts\(text\)\.map\(\(part, index\) => \(part\.bold \? <strong key=\{index\} className="font-semibold text-white">\{part\.text\}<\/strong> : <Fragment key=\{index\}>\{part\.text\}<\/Fragment>\)\)\}<\/>/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
  // テーマ企画's list shows the sentence through it (インスピレーション / AIグラフィック have no list: Light has none, 9th pass).
  assert.equal(page.split('{source.quote ? <SourceQuote text={source.quote} /> : source.title}').length - 1, 1);
  assert.doesNotMatch(page, /\{source\.quote \?\? source\.title\}/);
  // テーマ企画: the entrance, in a new tab.
  assert.match(page, /roundSources\.sources\.map\(\(source, index\) => \([\s\S]{0,700}<a href=\{agentSourceHome\(source\.url\)\} target="_blank" rel="noopener noreferrer"[^>]*>\{agentSourceSite\(source\.url\)\}<\/a>/);
});
