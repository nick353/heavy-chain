import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatAgentResearchContent } from '../cloudflare/heavy-api/src/designAssistant.ts';
import { AGENT_REPORT_SOURCES_MAX, agentRoundSources, agentSourceKind, agentSourceLabel, buildAgentResearchReportHtml, type AgentTask } from '../src/features/agent/agentFlow.ts';
import * as dialogueModule from '../src/features/agent/agentDialogue.ts';

// Light's sources outside テーマ企画, read on 2026-11-12 (jp.linkaigc.com/agent, nothing pressed that changes anything):
// - 新商品企画 (task 5ce6e3ac…, 2026-11-12) and 顧客提案 (task 02b36ab0…, 2026-11-12): no source list in the chat or in 概要
//   (概要 = タスク成果物 / 参考スタイル / スタイルを生成; the page's only link is the logo). The research card's note is
//   「確認待ちの複数方向 · 情報源別のエビデンス充足度とデータ不足」 (新商品企画 in Chinese), no count. The sources are inside the
//   research report (オンラインで表示): 顧客提案's ends with 「ソース一覧」 SOURCE INDEX, a table ID / ソース / 内容 / 区分 with rows
//   S01–S11 (first 区分 「EC実商品(収集 2026-11-11)」), and its evidence cards link 「ソースを見る」 to each product page
//   (target="_blank" rel="noopener noreferrer", 15 links; the 新商品企画 report has 6, under 「ソース索引」).
// - AIグラフィックデザイン (two tasks, 2026-07-11 and 2026-04-29) and インスピレーション (its 参考事例, a read-only case that
//   searched trends; new インスピレーション tasks say 「この機能は現在権限がありません」): no 概要 at all and no source in the chat.

const page = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');
const pages = (count: number) => Array.from({ length: count }, (_, index) => ({ title: `Page <${index + 1}>`, url: `https://www.example${index + 1}.com/a?b=${index + 1}` }));
const researchTask = (content: string, extra: Partial<AgentTask> = {}) => ({
  kind: 'heavy-agent-task', version: 1, scene: '商品企画', subtype: '新商品企画', prompt: '北米 2027年春', profile: '', project: null, createdAt: '2026-11-12T00:00:00.000Z',
  rounds: [], choice: null, plan: null, image: null, flow: 'conversation', notes: [],
  research: { requestId: 'r', state: 'completed', content, at: '2026-11-12T03:00:00.000Z' }, ...extra,
}) as unknown as AgentTask;

test('the research report ends with Light\'s source index: ID / ソース / 内容 / 区分, 「ソースを見る」 to the page itself', () => {
  const sources = [
    { title: 'リネン ワンピース | 楽天市場', url: 'https://item.rakuten.co.jp/shop/linen-1/' },
    { title: '#officewear on Instagram', url: 'https://www.instagram.com/explore/tags/officewear/' },
    { title: 'Spring 2027 trends', url: 'https://www.whowhatwear.com/trends-ss27', quote: '**Key Shades:** soft blue and brown' },
  ];
  const content = formatAgentResearchContent({ text: '[調査結果]\n## トレンド\n- ドレープ', sources, searchUsed: true, searchErrors: [] });
  const html = buildAgentResearchReportHtml(researchTask(content));
  assert.match(html, /<h2>ソース一覧<\/h2><span class="index-label">SOURCE INDEX<\/span>/);
  assert.match(html, /<thead><tr><th>ID<\/th><th>ソース<\/th><th>内容<\/th><th>区分<\/th><\/tr><\/thead>/);
  assert.match(html, /<tr><td>S01<\/td><td>rakuten\.co\.jp\(shop\/linen-1\)<br><a href="https:\/\/item\.rakuten\.co\.jp\/shop\/linen-1\/" target="_blank" rel="noopener noreferrer">ソースを見る<\/a><\/td><td>リネン ワンピース 楽天市場<\/td><td>EC\(収集 2026-11-12\)<\/td><\/tr>/);
  assert.match(html, /<td>S02<\/td><td>instagram\.com\(explore\/tags\/officewear\)<br><a href="https:\/\/www\.instagram\.com\/explore\/tags\/officewear\/"[^>]*>ソースを見る<\/a><\/td><td>[^<]*<\/td><td>SNS<\/td>/);
  // The cited sentence is the 内容, without the Markdown marks; the link is the page, not the site's entrance (テーマ企画 only).
  assert.match(html, /<td>S03<\/td><td>whowhatwear\.com\(trends-ss27\)<br><a href="https:\/\/www\.whowhatwear\.com\/trends-ss27"[^>]*>ソースを見る<\/a><\/td><td>Key Shades: soft blue and brown<\/td><td>ウェブ<\/td>/);
  assert.match(html, /※ 収集日はウェブ検索でページを集めた日であり、各ページの公開日ではありません。/);
  // Production's research step keeps no time: the date is the scope's (the research starts when it is confirmed).
  const research = { requestId: 'r', state: 'completed' as const, content };
  const scoped = buildAgentResearchReportHtml(researchTask(content, { research, scope: { regions: ['日本'], ec: [], sns: [], other: '', at: '2026-11-11T03:29:18.151Z' } }));
  assert.match(scoped, /<td>EC\(収集 2026-11-11\)<\/td>/);
  assert.doesNotMatch(buildAgentResearchReportHtml(researchTask(content, { research })), /収集/);
  assert.doesNotMatch(html, /<h2>参考資料<\/h2>|<ol>/);
});

test('the index keeps at most 15 rows, in the research\'s order, and escapes what it shows', () => {
  const content = formatAgentResearchContent({ text: '[調査結果]\n## a\n- b', sources: pages(20), searchUsed: true, searchErrors: [] });
  const html = buildAgentResearchReportHtml(researchTask(content));
  assert.equal(AGENT_REPORT_SOURCES_MAX, 15);
  assert.equal(html.split('>ソースを見る</a>').length - 1, 15);
  assert.match(html, /<td>S15<\/td><td>example15\.com\(a\?b=15\)<br>[^]*?<\/td><td>Page &lt;15&gt;<\/td>/);
  assert.doesNotMatch(html, /S16|example16\.com/);
  assert.match(html, /href="https:\/\/www\.example1\.com\/a\?b=1"/);
  assert.doesNotMatch(html, /Page <1>/);
});

test('the 内容 undoes the search tool\'s Markdown escapes, and the 区分 column is wide enough for the date', () => {
  // Production task 7345ee51 (顧客提案, research of 2026-11-12): ZOZOTOWN's page came back as 「\\3,699」.
  const sources = [{ title: 'ワンピースの人気ランキング', url: 'https://zozo.jp/ranking/x.html', quote: '前後2wayVネックワンピース \\\\3,699 \\* 2色 \\[新作\\]' }];
  const html = buildAgentResearchReportHtml(researchTask(formatAgentResearchContent({ text: '[調査結果]\n## a\n- b', sources, searchUsed: true, searchErrors: [] })));
  assert.match(html, /<td>前後2wayVネックワンピース \\3,699 \* 2色 \[新作\]<\/td>/);
  assert.match(html, /th:nth-child\(1\)\{width:7%\}th:nth-child\(2\)\{width:31%\}th:nth-child\(3\)\{width:42%\}th:nth-child\(4\)\{width:20%\}/);
});

test('with no page, the index says so; a failed search says it was not used', () => {
  const none = buildAgentResearchReportHtml(researchTask(formatAgentResearchContent({ text: '[調査結果]\n## a\n- b', sources: [], searchUsed: true, searchErrors: [] })));
  assert.match(none, /<h2>ソース一覧<\/h2>[\s\S]*参照した資料はありません。/);
  assert.doesNotMatch(none, /<table>/);
  const failed = buildAgentResearchReportHtml(researchTask('## a\n- b\n\n[検索] unavailable'));
  assert.match(failed, /<h2>ソース一覧<\/h2>[\s\S]*ウェブ検索を使えませんでした。/);
});

test('the ソース is the site and where on it, as Light writes 「ZOZOTOWN IEDIT(goods/102817265)」', () => {
  assert.equal(agentSourceLabel('https://zozo.jp/shop/iedit/goods/102817265/'), 'zozo.jp(shop/iedit/goods/102817265)');
  assert.equal(agentSourceLabel('https://www.lemaire.fr/'), 'lemaire.fr');
  assert.equal(agentSourceLabel('https://shopping.yahoo.co.jp/ranking/keyword/?p=%E3%82%A6%E3%82%A3%E3%83%B3%E3%83%89'), 'yahoo.co.jp(ranking/keyword/?p=ウィンド)');
  assert.equal(agentSourceLabel('https://e.com/%E0%A4%A'), 'e.com(%E0%A4%A)');
  assert.equal(agentSourceLabel(`https://e.com/${'a'.repeat(80)}`), `e.com(${'a'.repeat(47)}…)`);
  assert.equal(agentSourceLabel('not a url'), 'not a url');
});

test('the 区分 comes from the site: EC, SNS or ウェブ', () => {
  const cases: Array<[string, string]> = [
    ['https://item.rakuten.co.jp/x/', 'EC'], ['https://zozo.jp/shop/iedit/goods/102817265/', 'EC'], ['https://detail.tmall.com/item.htm?id=1', 'EC'],
    ['https://www.amazon.com/dp/1', 'EC'], ['https://search.kakaku.com/x/', 'EC'], ['https://shopping.yahoo.co.jp/ranking/keyword/?p=a', 'EC'],
    ['https://news.yahoo.co.jp/articles/1', 'ウェブ'],
    ['https://www.instagram.com/p/1/', 'SNS'], ['https://www.youtube.com/watch?v=1', 'SNS'], ['https://www.tiktok.com/@a', 'SNS'], ['https://wear.jp/a/', 'SNS'],
    ['https://www.vogue.com/x', 'ウェブ'], ['https://ja.wikipedia.org/wiki/x', 'ウェブ'], ['not a url', 'ウェブ'],
  ];
  for (const [url, kind] of cases) assert.equal(agentSourceKind(url), kind, url);
});

test('新商品企画 / 顧客提案: the research card shows Light\'s note only, and 概要 has no source list', () => {
  assert.match(page, /<ReportCard testId="agent-research-report" title=\{wording\.researchReport\.title\} note=\{wording\.researchReport\.note\}/);
  assert.doesNotMatch(page, /資料\$\{research\.sources\.length\}件|AIモデルの知識に基づく整理/);
  // In 概要, 参考資料 is for the tasks without the conversation (テーマ企画) only.
  assert.match(page, /\{!conversation && \(\n\s+<div className=\{deliverables\.length \? 'mt-5 border-t border-white\/10 pt-5' : 'mt-5'\}>\n\s+<h3 className="text-base font-medium text-white">参考資料<\/h3>/);
  assert.equal(page.split('>参考資料</h3>').length - 1, 1);
});

test('インスピレーション / AIグラフィックデザイン: no 概要 and no source list, as in Light', () => {
  assert.match(page, /\{task && !dialogue && \(panelOpen \? \(/);
  assert.match(page, /\{conversation && generatedImages\.length > 0 && <ImageShelf title="スタイルを生成"/);
  assert.doesNotMatch(page, /\(conversation \|\| dialogue\) && generatedImages|dialogueSources|agent-dialogue-sources|agentDialogueSources/);
  assert.equal('agentDialogueSources' in dialogueModule, false);
});

test('テーマ企画 keeps its 参考資料: the cited sentences (the server keeps 25), the site and its entrance', () => {
  const claims = Array.from({ length: 30 }, (_, index) => `- P${index} | https://www.lemaire.fr/p${index} | 文${index}`).join('\n');
  const task = { ...researchTask(`## a\n- b\n\n[出典]\n- P | https://www.lemaire.fr/p | x\n\n[検索] ok\n\n[引用]\n${claims}`), subtype: 'テーマ企画', flow: undefined } as unknown as AgentTask;
  const listed = agentRoundSources(task);
  assert.equal(listed?.sources.length, 30);
  assert.equal(listed?.sources[0].quote, '文0');
  assert.match(page, /\{roundSources && roundSources\.sources\.length > 0 && \(\n\s+<ol className="mt-2" data-testid="agent-research-sources">/);
  assert.match(page, /<a href=\{agentSourceHome\(source\.url\)\} target="_blank" rel="noopener noreferrer" className="font-medium text-cyan-300 hover:underline">\{agentSourceSite\(source\.url\)\}<\/a>/);
});
