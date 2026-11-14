import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGENT_PRODUCT_LINE, YAHOO_ATTRIBUTION_HTML, agentDirectionSearches, agentJapanMarket, agentProduct, agentProductGender, agentYen, parseAgentProducts,
} from '../src/features/agent/agentProducts.ts';

// The owner chose Yahoo!ショッピング for real products (2026-11-12). Its terms as the owner accepted them: the images stay on
// Yahoo!'s addresses and link to their product pages, and Yahoo!'s credit HTML is shown unchanged where products are shown.

const product = (n: number, extra: Record<string, unknown> = {}) => ({
  name: `リネンシャツ ${n}`, url: `https://store.shopping.yahoo.co.jp/zozo/${n}.html`, price: 7990, image: `https://item-shopping.c.yimg.jp/i/n/zozo_${n}`,
  store: 'ZOZOTOWN Yahoo!店', query: 'レディース リネン シャツ', at: '2026-11-12', ...extra,
});

test('the credit is Yahoo! JAPAN\'s snippet, character for character', () => {
  assert.equal(YAHOO_ATTRIBUTION_HTML, '<!-- Begin Yahoo! JAPAN Web Services Attribution Snippet -->\n'
    + '<span style="margin:15px 15px 15px 15px"><a href="https://developer.yahoo.co.jp/sitemap/">Webサービス by Yahoo! JAPAN</a></span>\n'
    + '<!-- End Yahoo! JAPAN Web Services Attribution Snippet -->');
});

test('the research\'s [商品] block gives products on Yahoo!\'s own addresses only', () => {
  const content = ['## トレンド', '- a', '', '[出典]', '- リネンシャツ 1（ZOZOTOWN Yahoo!店） | https://store.shopping.yahoo.co.jp/zozo/1.html | リネンシャツ 1 ¥7,990', '', '[検索] ok', '', '[商品]',
    JSON.stringify(product(1)), JSON.stringify(product(1)), JSON.stringify(product(2, { image: 'https://evil.example/x.jpg' })), JSON.stringify(product(3, { url: 'http://store.shopping.yahoo.co.jp/x' })),
    JSON.stringify(product(4, { price: null, store: '' })), 'not json', '{"broken":'].join('\n');
  assert.deepEqual(parseAgentProducts(content).map(entry => [entry.name, entry.price]), [['リネンシャツ 1', 7990], ['リネンシャツ 4', null]]);
  assert.deepEqual(parseAgentProducts('## a\n[出典]\n[検索] ok'), []);
  assert.equal(agentProduct({ ...product(5), image: 'https://item-shopping.c.yimg.jp.evil.example/x' }), null);
  assert.equal(agentYen(12800), '¥12,800');
  assert.equal(agentYen(null), '');
});

test('only plans of the Japanese market search real products, one search per direction', () => {
  assert.equal(agentJapanMarket({ flow: 'conversation', scope: { regions: ['中国', '日本'] } }), true);
  assert.equal(agentJapanMarket({ flow: 'conversation', scope: { regions: ['北美'] } }), false);
  assert.equal(agentJapanMarket({ flow: undefined, scope: null }), false);
  assert.equal(AGENT_PRODUCT_LINE, '実商品の検索: 日本');
  assert.equal(agentProductGender('28〜40歳の女性'), 'レディース');
  assert.equal(agentProductGender('メンズとレディース'), '');
  const searches = agentDirectionSearches({ prompt: '都市部で働く28〜40歳の女性向け', requirements: null }, [
    { name: 'クワイエット・リネン（シャツ）', description: 'リネン55%の落ち感。生成りと墨。' },
    { name: 'ドレープ・ニュートラル（スカート・パンツ）', description: '落ち感のある素材。' },
    { name: '都市の余白', description: '構築的なシルエット。' },
  ]);
  // The item in 「（…）」 travels as `needs`, so a product that does not name it is dropped (2026-11-14: 「水着 ¥2,090」 on a
  // direction about something else). A concept name has no item to hold the answers to.
  assert.deepEqual(searches, [
    { query: 'レディース リネン シャツ', fallback: 'レディース シャツ', needs: ['シャツ'] },
    { query: 'レディース スカート', needs: ['スカート'] },
    { query: 'レディース 都市の余白' },
  ]);
});

test('the page shows the products\' images from Yahoo!, links each to its page, and shows the credit with them', () => {
  const page = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /agentJapanMarket\(task\)/);
  assert.match(page, /searchAgentProducts\(/);
  assert.match(page, /dangerouslySetInnerHTML=\{\{ __html: YAHOO_ATTRIBUTION_HTML \}\}/);
  assert.equal(page.match(/href=\{product\.url\} target="_blank" rel="noopener noreferrer"/g)?.length, 2);
  // Product images are never sent to the image service, stored or used as references.
  const parts = readFileSync(new URL('../src/features/agent/agentMerch.ts', import.meta.url), 'utf8');
  assert.match(parts, /state: 'completed' as const, product/);
});

// ---------------------------------------------------------------------------
// The research and the report, with answers shaped like the API's (field names from the spec page).
import { AGENT_RESEARCH_MAX_PRODUCTS, agentProductKeywords, agentProductsResponse, formatAgentResearchContent, runAgentResearch } from '../cloudflare/heavy-api/src/designAssistant.ts';
import { agentResearchPrompt, agentReportSourceList, buildAgentResearchReportHtml, parseAgentResearch, type AgentTask } from '../src/features/agent/agentFlow.ts';
import { agentReportCsp, agentReportPrompt, buildAgentAiReportHtml, sanitizeAgentReportHtml } from '../src/features/agent/agentReport.ts';
import { agentBuildDirectionImages } from '../src/features/agent/agentMerch.ts';

const hit = (n: number) => ({ name: `リネンシャツ レディース ${n}`, url: `https://store.shopping.yahoo.co.jp/zozo/${n}.html`, price: 7990 + n,
  image: { small: `https://item-shopping.c.yimg.jp/i/c/zozo_${n}`, medium: `https://item-shopping.c.yimg.jp/i/g/zozo_${n}` },
  exImage: { url: `https://item-shopping.c.yimg.jp/i/n/zozo_${n}`, width: 600, height: 600 }, seller: { sellerId: 'zozo', name: 'ZOZOTOWN Yahoo!店' } });
const claude = (content: unknown[]) => Response.json({ stop_reason: 'end_turn', content, usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 1 } } });
const cite = (text: string, url: string) => ({ type: 'text', text, citations: [{ type: 'web_search_result_location', url, title: 't', cited_text: text }] });
const japanTask = (extra: Partial<AgentTask> = {}): AgentTask => ({
  kind: 'heavy-agent-task', version: 1, scene: '商品企画', subtype: '新商品企画', flow: 'conversation', prompt: '30代女性向けのリネンシャツの新商品企画', profile: '', project: null,
  createdAt: '2026-11-12T00:00:00.000Z', choice: null, plan: null, image: null, notes: [], rounds: [],
  requirements: { requestId: 'q', state: 'completed', content: '[要件]\nシリーズ名：リネン' }, aligned: { at: '2026-11-12T00:01:00.000Z' },
  scope: { regions: ['日本'], ec: ['ZOZOTOWN'], sns: [], other: '', at: '2026-11-12T00:02:00.000Z' }, ...extra,
});

test('with the key, the research adds Yahoo!ショッピング\'s products found with the shop search\'s phrases; without it, nothing changes', async () => {
  const yahoo: URL[] = [];
  const systems: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('https://shopping.yahooapis.jp/')) { yahoo.push(new URL(url)); return Response.json({ hits: [hit(yahoo.length * 10 + 1), hit(yahoo.length * 10 + 2)] }); }
    const body = JSON.parse(String(init?.body));
    systems.push(body.system);
    if (body.tools[0].allowed_domains) return claude([{ type: 'text', text: '[調査結果]\n## 通販の実商品\n- ' }, cite('ZOZOのリネンシャツ ¥7,990', 'https://zozo.jp/shop/a/goods/1/'), { type: 'text', text: '\n[商品検索] レディース リネンシャツ | 「レディース シャツ」 | x' }]);
    return claude([{ type: 'text', text: '[調査結果]\n## トレンド\n- ' }, cite('リネンが伸びている', 'https://www.wwdjapan.com/a')]);
  }) as typeof fetch;
  const prompt = agentResearchPrompt(japanTask());
  const messages = [{ role: 'user' as const, content: [{ type: 'text', text: prompt }] }];
  const withKey = await runAgentResearch({ ANTHROPIC_API_KEY: 'k', YAHOO_SHOPPING_APP_ID: 'client-id' } as any, prompt, messages, undefined, fetchImpl, async () => {});
  // The shop search is asked for the phrases only when the products will be searched.
  assert.match(systems.find(system => system.includes('only look for real products'))!, /\[商品検索\]/);
  assert.deepEqual(yahoo.map(url => url.searchParams.get('query')), ['レディース リネンシャツ', 'レディース シャツ']);
  assert.deepEqual(withKey.products?.map(product => product.url), ['https://store.shopping.yahoo.co.jp/zozo/11.html', 'https://store.shopping.yahoo.co.jp/zozo/21.html',
    'https://store.shopping.yahoo.co.jp/zozo/12.html', 'https://store.shopping.yahoo.co.jp/zozo/22.html']);
  assert.equal(withKey.usage?.yahoo_queries, 2);
  const content = formatAgentResearchContent(withKey);
  assert.match(content, /\n- リネンシャツ レディース 11（ZOZOTOWN Yahoo!店） \| https:\/\/store\.shopping\.yahoo\.co\.jp\/zozo\/11\.html \| リネンシャツ レディース 11 ¥8,001 （ZOZOTOWN Yahoo!店）/);
  const parsed = parseAgentResearch(content);
  assert.equal(parsed.products?.length, 4);
  assert.equal(parsed.products?.[0].image, 'https://item-shopping.c.yimg.jp/i/n/zozo_11');
  // The cited sentences (テーマ企画's list) never take a product line.
  assert.equal(parsed.claims?.some(claim => claim.url.includes('yahoo')), false);
  assert.equal(AGENT_RESEARCH_MAX_PRODUCTS, 8);
  // Without the key: the same two searches as before, no phrases asked, no Yahoo! call.
  yahoo.length = 0; systems.length = 0;
  const without = await runAgentResearch({ ANTHROPIC_API_KEY: 'k' } as any, prompt, messages, undefined, fetchImpl, async () => {});
  assert.equal(yahoo.length, 0);
  assert.equal(without.products, undefined);
  assert.equal(systems.some(system => system.includes('[商品検索]')), false);
  assert.deepEqual(agentProductKeywords('a\n[商品検索] レディース リネンシャツ | 「レディース シャツ」 | x | 4つ目 | 5つ目'), ['レディース リネンシャツ', 'レディース シャツ', '4つ目']);
});

test('the direction cards\' searches answer `available: false` without the key, and the products with it', async () => {
  const body = { searches: [{ query: 'レディース リネン シャツ', fallback: 'レディース シャツ' }] };
  assert.deepEqual(await (await agentProductsResponse({} as any, body)).json(), { available: false, results: [] });
  const fetchImpl = (async () => Response.json({ hits: [hit(1)] })) as typeof fetch;
  const answer = await (await agentProductsResponse({ YAHOO_SHOPPING_APP_ID: 'k' } as any, body, fetchImpl, async () => {})).json() as any;
  assert.equal(answer.available, true);
  assert.equal(answer.results[0].products[0].image, 'https://item-shopping.c.yimg.jp/i/n/zozo_1');
  for (const bad of [{}, { searches: [] }, { searches: Array.from({ length: 5 }, () => ({ query: 'a' })) }, { searches: [{ query: 'a', extra: 1 }] }, { searches: [{ query: 'x'.repeat(61) }] }])
    assert.equal((await agentProductsResponse({ YAHOO_SHOPPING_APP_ID: 'k' } as any, bad, fetchImpl)).status, 400);
  // A direction with a product shows it (no generation); one without is generated as before.
  const images = agentBuildDirectionImages(japanTask(), ['A（シャツ）｜a｜b｜c', 'B（スカート）｜a｜b｜c'], () => 'id', [{ products: [agentProduct(product(1))!] }, { products: [] }]);
  assert.deepEqual(images.map(image => [image.state, image.product?.url ?? null]), [['completed', 'https://store.shopping.yahoo.co.jp/zozo/1.html'], ['pending', null]]);
});

test('the reports show the products\' images from Yahoo!, link them, mark them EC実商品 and end with the credit', () => {
  const content = formatAgentResearchContent({ text: '## トレンド\n- リネン', searchUsed: true, searchErrors: [],
    sources: [{ title: 'WWD', url: 'https://www.wwdjapan.com/a', quote: 'リネン' }, { title: 'リネンシャツ 1（ZOZOTOWN Yahoo!店）', url: product(1).url, quote: 'リネンシャツ 1 ¥7,990' }],
    products: [product(1) as any] });
  const task = japanTask({ research: { requestId: 'r', state: 'completed', content, at: '2026-11-12T01:00:00.000Z' },
    rounds: [{ step: { requestId: 'round-1', state: 'completed', content: 'x' }, summary: '', themes: ['A（シャツ）｜a｜b｜c', 'B｜a｜b｜c', 'C｜a｜b｜c', 'D｜a｜b｜c'] }] });
  // The fixed report: a card per product, 「ソースを見る」, the row's 区分, and Yahoo!'s credit unchanged.
  const fixed = buildAgentResearchReportHtml(task);
  assert.match(fixed, /<h2>EC実商品<\/h2><div class="products"><figure class="product"><a href="https:\/\/store\.shopping\.yahoo\.co\.jp\/zozo\/1\.html" target="_blank" rel="noopener noreferrer"><img src="https:\/\/item-shopping\.c\.yimg\.jp\/i\/n\/zozo_1"/);
  assert.match(fixed, /<td>S01<\/td><td>yahoo\.co\.jp\(zozo\/1\.html\)/);
  assert.match(fixed, /<td>EC実商品\(収集 2026-11-12\)<\/td>/);
  assert.ok(fixed.includes(`<footer class="credit">${YAHOO_ATTRIBUTION_HTML}</footer>`));
  assert.deepEqual(agentReportSourceList([{ url: 'https://www.wwdjapan.com/a' }, { url: product(1).url }], [product(1)]).map(row => row.url), [product(1).url, 'https://www.wwdjapan.com/a']);
  // The slides: the request lists the products with their image; only those images survive, from Yahoo!'s image host.
  assert.match(agentReportPrompt(task), /P01 \| リネンシャツ 1 \| ¥7,990 \| ZOZOTOWN Yahoo!店 \| https:\/\/item-shopping\.c\.yimg\.jp\/i\/n\/zozo_1 \| https:\/\/store\.shopping\.yahoo\.co\.jp\/zozo\/1\.html \| 2026-11-12/);
  const { body } = sanitizeAgentReportHtml(`<a href="${product(1).url}"><img src="${product(1).image}" alt="リネン" onerror="x()"></a><img src="https://evil.example/t.png"><img src="https://item-shopping.c.yimg.jp/other">`, [product(1).url], [product(1).image]);
  assert.equal(body, `<a href="${product(1).url}" target="_blank" rel="noopener noreferrer"><img src="${product(1).image}" alt="リネン" loading="lazy" referrerpolicy="no-referrer"></a>`);
  assert.equal(agentReportCsp([product(1).image, 'https://evil.example/x']), "default-src 'none'; style-src 'unsafe-inline'; img-src data: https://item-shopping.c.yimg.jp; font-src 'none'; base-uri 'none'; form-action 'none'");
  const page = (n: number, inner = '') => `<section class="report-page" data-page-id="page-${n}"><div class="page-body">${inner}${'所見'.repeat(300)}</div></section>`;
  const slides = `<style>:root{--color-accent:#7A303B}</style><main class="report">${[1, 2, 3].map(n => page(n)).join('')}${page(4, `<a class="media-frame media-link" href="${product(1).url}"><img src="${product(1).image}" alt="p"></a><table><tr><td>EC実商品</td></tr></table><h3>ソース一覧</h3>`)}</main>`;
  const html = buildAgentAiReportHtml({ ...task, report: { round: 'round-1', step: { requestId: 'p', state: 'completed', content: slides } } }, 't')!;
  assert.match(html, /img-src data: https:\/\/item-shopping\.c\.yimg\.jp;/);
  assert.match(html, /<img src="https:\/\/item-shopping\.c\.yimg\.jp\/i\/n\/zozo_1" alt="p" loading="lazy" referrerpolicy="no-referrer">/);
  assert.ok(html.endsWith(`<footer class="report-credit">${YAHOO_ATTRIBUTION_HTML}</footer></body></html>`));
  // No products: no credit, no image host.
  const plain = japanTask({ research: { requestId: 'r', state: 'completed', content: formatAgentResearchContent({ text: '## a\n- b', sources: [], searchUsed: true, searchErrors: [] }) } });
  assert.doesNotMatch(buildAgentResearchReportHtml(plain), /Yahoo! JAPAN/);
});
