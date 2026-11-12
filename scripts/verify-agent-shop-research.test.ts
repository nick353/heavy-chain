import test from 'node:test';
import assert from 'node:assert/strict';
import { callClaudeResearch, type ResearchResult } from '../cloudflare/heavy-api/src/claude-text.ts';
import { AGENT_SHOP_MAX_USES, agentShopDomains as serverShopDomains, mergeShopResearch, runAgentResearch } from '../cloudflare/heavy-api/src/designAssistant.ts';
import { agentResearchPrompt, agentReportSourceList, agentShopDomains, type AgentTask } from '../src/features/agent/agentFlow.ts';

// Light's sources are mostly real products (its 顧客提案 source index starts with 「EC実商品」, 6 of its 新商品企画 report's links
// are product pages). Heavy's research was one broad web search: in production 2026-11-12 only 14% of its sources were shop
// pages, 8% had a price and 3 were single product pages. Now a second search runs beside it, only on the scope's shops, and
// its cited products are added; the broad search (trend articles) stays as it was.

const task = (extra: Partial<AgentTask> = {}): AgentTask => ({
  kind: 'heavy-agent-task', version: 1, scene: '商品企画', subtype: '新商品企画', flow: 'conversation', prompt: '30代女性向けのリネンシャツの新商品企画', profile: '', project: null,
  createdAt: '2026-11-12T00:00:00.000Z', choice: null, plan: null, image: null, notes: [], rounds: [],
  requirements: { requestId: 'q', state: 'completed', content: '[要件]\nシリーズ名：リネン' }, aligned: { at: '2026-11-12T00:01:00.000Z' },
  scope: { regions: ['日本'], ec: ['ZOZOTOWN', 'Rakuten Fashion'], sns: ['Instagram'], other: '', at: '2026-11-12T00:02:00.000Z' }, ...extra,
});

test('the research request names the shops of the scope as domains, the region\'s large shops when none is chosen', () => {
  assert.deepEqual(agentShopDomains(task()), ['zozo.jp', 'rakuten.co.jp']);
  const prompt = agentResearchPrompt(task());
  // A plan of the Japanese market also lets the server add Yahoo!ショッピング's products (when it has the key).
  assert.match(prompt, /\n通販サイトの検索先: zozo\.jp, rakuten\.co\.jp\n実商品の検索: 日本$/);
  // The broad research keeps its own instructions and headings.
  assert.match(prompt, /ウェブ検索で最新の情報（市場・気候、トレンド/);
  assert.match(prompt, /「## 市場と気候」「## トレンド」/);
  assert.deepEqual(agentShopDomains(task({ scope: { regions: ['日本', '北美'], ec: [], sns: [], other: '', at: 'x' } })),
    ['zozo.jp', 'rakuten.co.jp', 'shopping.yahoo.co.jp', 'amazon.co.jp', 'nordstrom.com', 'amazon.com', 'shein.com']);
  // A shop a web search cannot reach (TikTok Shop) has no domain, so the region's shops are searched instead.
  assert.deepEqual(agentShopDomains(task({ scope: { regions: ['日本'], ec: ['Tiktok shop'], sns: [], other: '', at: 'x' } })), ['zozo.jp', 'rakuten.co.jp', 'shopping.yahoo.co.jp', 'amazon.co.jp']);
  assert.equal(agentShopDomains(task({ scope: { regions: ['日本', '北美', '欧洲'], ec: ['ZOZOTOWN', 'Rakuten Fashion', 'Amazon Japan', 'Mercari', 'Yahoo! Shopping', 'MAGASEEK', 'SHOPLIST', 'Walmart', 'ASOS'], sns: [], other: '', at: 'x' } })).length, 8);
  // テーマ企画 has no scope: the shops Light's テーマ企画 listed and the large Japanese ones.
  const theme = task({ flow: undefined, subtype: 'テーマ企画', scope: null });
  assert.deepEqual(agentShopDomains(theme), ['zozo.jp', 'rakuten.co.jp', 'shopping.yahoo.co.jp', 'minne.com', 'net-a-porter.com', 'ssense.com']);
  assert.match(agentResearchPrompt(theme), /\n通販サイトの検索先: zozo\.jp, rakuten\.co\.jp, shopping\.yahoo\.co\.jp, minne\.com, net-a-porter\.com, ssense\.com$/);
  // The chat scenes do not research.
  assert.deepEqual(agentShopDomains(task({ flow: 'dialogue', scene: 'インスピレーション', subtype: 'インスピレーション', scope: null })), []);
});

test('the server reads only domains from that line', () => {
  assert.deepEqual(serverShopDomains('依頼\n通販サイトの検索先: zozo.jp, Rakuten.co.jp、shopping.yahoo.co.jp zozo.jp\n'), ['zozo.jp', 'rakuten.co.jp', 'shopping.yahoo.co.jp']);
  assert.deepEqual(serverShopDomains('通販サイトの検索先: https://evil.example/x, javascript:alert(1), a, -bad-.com, ok.example'), ['ok.example']);
  assert.deepEqual(serverShopDomains('通販サイトの検索先: ' + Array.from({ length: 12 }, (_, i) => `s${i}.example`).join(', ')).length, 8);
  assert.deepEqual(serverShopDomains('ZOZOTOWN を見て'), []);
  assert.deepEqual(serverShopDomains('通販サイトの検索先:\n次の行: zozo.jp'), []);
});

const reply = (content: unknown[], searches: number) => Response.json({ stop_reason: 'end_turn', content, usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: searches } } });
const hit = (url: string, title: string) => ({ type: 'web_search_result', url, title });
const cite = (text: string, url: string, title: string) => ({ type: 'text', text, citations: [{ type: 'web_search_result_location', url, title, cited_text: text }] });

test('the research runs the broad search and the shop search at once and adds the cited products', async () => {
  const sent: Record<string, any>[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push(body);
    if (body.tools?.[0]?.allowed_domains) {
      return reply([
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'リネンシャツ ZOZOTOWN' } },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [hit('https://zozo.jp/shop/a/goods/1/', 'リネンシャツ A'), hit('https://item.rakuten.co.jp/b/2/', 'リネン B')] },
        { type: 'text', text: '[調査結果]\n## 通販の実商品\n- ' },
        cite('ブランドAのリネンシャツ（ZOZOTOWN）¥7,990、ランキング3位', 'https://zozo.jp/shop/a/goods/1/', 'リネンシャツ A'),
        { type: 'text', text: '\n- 出典のない商品の行\n- ' },
        cite('楽天のリネンBは洗えるリネンで高評価', 'https://item.rakuten.co.jp/b/2/', 'リネン B'),
      ], 2);
    }
    return reply([
      { type: 'server_tool_use', id: 'w1', name: 'web_search', input: { query: '2027 春夏 トレンド' } },
      { type: 'web_search_tool_result', tool_use_id: 'w1', content: [hit('https://www.wwdjapan.com/articles/1', 'WWD')] },
      { type: 'text', text: '[調査結果]\n## トレンド\n- ' },
      cite('リネンの需要が伸びている', 'https://www.wwdjapan.com/articles/1', 'WWD'),
    ], 4);
  }) as typeof fetch;
  const prompt = agentResearchPrompt(task());
  const result = await runAgentResearch({ ANTHROPIC_API_KEY: 'server-only-test-key' } as any, prompt, [{ role: 'user', content: [{ type: 'text', text: prompt }] }], undefined, fetcher);
  assert.equal(sent.length, 2);
  const broad = sent.find(body => !body.tools[0].allowed_domains)!;
  const shop = sent.find(body => body.tools[0].allowed_domains)!;
  // The broad search is the one it was: 5 searches on the whole web, without the shop line.
  assert.deepEqual(broad.tools, [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5, allowed_callers: ['direct'] }]);
  assert.doesNotMatch(JSON.stringify(broad.messages), /通販サイトの検索先/);
  assert.match(JSON.stringify(broad.messages), /## 市場と気候/);
  // The shop search: only the scope's shops, at most 3 searches, its job after the request.
  assert.deepEqual(shop.tools, [{ type: 'web_search_20260209', name: 'web_search', max_uses: AGENT_SHOP_MAX_USES, allowed_callers: ['direct'], allowed_domains: ['zozo.jp', 'rakuten.co.jp'] }]);
  assert.match(shop.system, /only look for real products sold on the online shops/);
  // Only a cited bullet reaches the report, so the shop search is told to cite each product (production: 0 cited of 3 searches).
  assert.match(shop.system, /Each bullet is one sentence that cites the search result of that product/);
  assert.match(shop.messages[0].content.at(-1).text, /zozo\.jp・rakuten\.co\.jp で売られている実商品だけを調べる/);
  // Only cited product lines are added, after the broad report.
  assert.match(result.text, /- リネンの需要が伸びている\n\n## 通販の実商品\n- ブランドAのリネンシャツ（ZOZOTOWN）¥7,990、ランキング3位\n- 楽天のリネンBは洗えるリネンで高評価$/);
  assert.doesNotMatch(result.text, /出典のない商品/);
  assert.deepEqual(result.sources.map(source => source.url), ['https://www.wwdjapan.com/articles/1', 'https://zozo.jp/shop/a/goods/1/', 'https://item.rakuten.co.jp/b/2/']);
  assert.deepEqual(result.claims.map(claim => claim.url), ['https://www.wwdjapan.com/articles/1', 'https://zozo.jp/shop/a/goods/1/', 'https://item.rakuten.co.jp/b/2/']);
  // The receipt keeps both searches' cost and the shop search's own share.
  assert.deepEqual(result.usage, { prompt_tokens: 2000, completion_tokens: 200, total_tokens: 2200, web_search_requests: 6, shop_prompt_tokens: 1000, shop_completion_tokens: 100, shop_web_search_requests: 2, shop_claims: 2 });
});

test('a failed shop search leaves the research as it was, and is never retried without searching', async () => {
  const sent: Record<string, any>[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push(body);
    if (body.tools?.[0]?.allowed_domains) return new Response('{"error":"bad domain"}', { status: 400 });
    return reply([{ type: 'web_search_tool_result', tool_use_id: 'w1', content: [hit('https://a.example/', 'A')] }, { type: 'text', text: '[調査結果]\n- ' }, cite('事実', 'https://a.example/', 'A')], 1);
  }) as typeof fetch;
  const prompt = agentResearchPrompt(task());
  const result = await runAgentResearch({ ANTHROPIC_API_KEY: 'server-only-test-key' } as any, prompt, [{ role: 'user', content: [{ type: 'text', text: prompt }] }], undefined, fetcher);
  assert.equal(sent.length, 2);
  assert.doesNotMatch(result.text, /通販の実商品/);
  assert.deepEqual(result.usage, { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, web_search_requests: 1 });
  // The broad search still falls back to writing without search when search is not offered (unchanged).
  await assert.rejects(callClaudeResearch({ ANTHROPIC_API_KEY: 'k' } as any, { system: 's', messages: [{ role: 'user', content: 'x' }], allowedDomains: ['zozo.jp'], fallbackWithoutSearch: false },
    (async () => new Response('{}', { status: 400 })) as typeof fetch), /claude_upstream_400/);
  // No shop line (older requests, the chat scenes): one search only.
  sent.length = 0;
  await runAgentResearch({ ANTHROPIC_API_KEY: 'k' } as any, 'x', [{ role: 'user', content: [{ type: 'text', text: 'x' }] }], undefined, fetcher);
  assert.equal(sent.length, 1);
});

test('merging keeps 20 pages and 25 sentences, the shop ones included; a shop search that cited nothing adds only its cost', () => {
  const pages = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => ({ url: `https://${prefix}${i}.example/`, title: `${prefix}${i}`, quote: `${prefix} の文 ${i}` }));
  const research = (sources: ReturnType<typeof pages>, extra: Partial<ResearchResult> = {}): ResearchResult => ({ text: '## トレンド\n- a', sources, claims: sources, searchUsed: true, searchErrors: [], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }, model: 'm', ...extra });
  const main = research(pages('main', 20), { claims: pages('main', 25) });
  const shop = research(pages('shop', 10));
  const merged = mergeShopResearch(main, shop);
  assert.equal(merged.sources.length, 20);
  assert.equal(merged.sources.filter(source => source.url.includes('shop')).length, 6);
  assert.equal(merged.claims.length, 25);
  assert.equal(merged.claims.filter(claim => claim.url.includes('shop')).length, 8);
  // The report's 15 rows keep up to 6 shop pages (Heavy's EC list decides what a shop page is).
  const rows = agentReportSourceList([...pages('w', 14), { url: 'https://zozo.jp/a', title: 'z' }, { url: 'https://item.rakuten.co.jp/b', title: 'r' }]);
  assert.equal(rows.length, 15);
  assert.deepEqual(rows.slice(-2).map(row => row.url), ['https://zozo.jp/a', 'https://item.rakuten.co.jp/b']);
  // Nothing cited: the research as it was, with the shop search's cost.
  const empty = mergeShopResearch(main, research([], { claims: [], text: '## 通販の実商品\n- 見つからなかった' }));
  assert.equal(empty.text, main.text);
  assert.deepEqual(empty.sources, main.sources);
  assert.equal(empty.usage?.shop_prompt_tokens, 10);
  // The receipt says the shop search added nothing (its cost without effect is measurable).
  assert.equal(empty.usage?.shop_claims, 0);
  assert.equal(merged.usage?.shop_claims, 8);
  assert.equal(mergeShopResearch(main, null), main);
});
