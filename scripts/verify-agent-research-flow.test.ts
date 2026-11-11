import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callClaudeResearch, ClaudeTextError } from '../cloudflare/heavy-api/src/claude-text.ts';
import { formatAgentResearchContent } from '../cloudflare/heavy-api/src/designAssistant.ts';
import {
  AGENT_INTAKE_STEPS, AGENT_PROMPT_BUDGET, DEFAULT_AGENT_SCOPE, agentNotePrompt, agentRequestRejection, agentRequirementsPrompt, planPrompt, agentMissingNames, agentRoundSources, agentThemeSearches, parseThemeResponse, buildAgentResearchReportHtml, parseAgentDirection, agentResearchPrompt, agentResearchSteps, agentScopeOptions, agentScopeSummary,
  effectiveAgentRequirements, parseAgentRequirements, parseAgentResearch, pruneAgentScope, readAgentTask, themePrompt, type AgentTask,
} from '../src/features/agent/agentFlow.ts';

type Json = Record<string, any>;
const env = { ANTHROPIC_API_KEY: 'server-only-test-key' } as any;
const reply = (content: Json[], stop_reason = 'end_turn') => Response.json({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason, content, usage: { input_tokens: 100, output_tokens: 40 } });
const search = (results: Json[]) => ({ type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: results });

// Light's 「確認して調査を開始」 (2026-11-11) collects material on the web; Heavy uses Claude's server-side web search.
test('research sends the web search tool with a cap and fallbacks, and collects sources from results and citations', async () => {
  const sent: Json[] = [];
  const result = await callClaudeResearch(env, { system: 'sys', messages: [{ role: 'user', content: '北米の春' }] }, async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return reply([
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'spring workwear' } },
      search([{ type: 'web_search_result', url: 'https://example.com/a', title: 'Trend A' }, { type: 'web_search_result', url: 'https://example.com/b', title: 'Trend B' }]),
      { type: 'text', text: '検索しました。' },
      { type: 'text', text: '[調査結果]\n## トレンド\n- リネン混が伸びている', citations: [{ type: 'web_search_result_location', url: 'https://example.org/c', title: 'Cited C', cited_text: 'x' }] },
    ]);
  });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].tools, [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5, allowed_callers: ['direct'] }]);
  assert.equal(sent[0].fallbacks, 'default');
  assert.equal(sent[0].model, 'claude-sonnet-5-5');
  assert.equal(result.text, '## トレンド\n- リネン混が伸びている');
  // Cited pages first; with fewer than three citations the search hits fill in after them.
  assert.deepEqual(result.sources.map(source => source.url), ['https://example.org/c', 'https://example.com/a', 'https://example.com/b']);
  assert.equal(result.searchUsed, true);
  assert.deepEqual(result.usage, { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 });
});

// Production 2026-11-12: a Japanese fashion search also returned Wikipedia pages on music and climbing, and all of them
// were listed under 参考資料. With three or more citations only the cited pages are listed.
test('with three or more citations only the cited pages are sources, titled from the search results when the citation has none', async () => {
  const result = await callClaudeResearch(env, { system: 'sys', messages: [{ role: 'user', content: '日本の秋' }] }, async () => reply([
    search([{ url: 'https://zozo.example/a', title: 'ZOZOTOWN ベスト' }, { url: 'https://wiki.example/music', title: '2026 in Japanese music' }, { url: 'https://rakuten.example/b', title: '楽天 アウター' }, { url: 'https://weather.example/c', title: '秋の天気' }]),
    { type: 'text', text: '[調査結果]\n## 価格\n- ベストは15,000円前後', citations: [
      { type: 'web_search_result_location', url: 'https://zozo.example/a', title: 'ZOZOTOWN ベスト', cited_text: 'x' },
      { type: 'web_search_result_location', url: 'https://rakuten.example/b', cited_text: 'y' },
      { type: 'web_search_result_location', url: 'https://weather.example/c', title: '秋の天気', cited_text: 'z' },
      { type: 'web_search_result_location', url: 'https://zozo.example/a', title: 'ZOZOTOWN ベスト', cited_text: 'again' },
    ] },
  ]));
  // Light shows the cited sentence under each source (2026-11-12): the first one cited from each page is kept.
  assert.deepEqual(result.sources, [
    { url: 'https://zozo.example/a', title: 'ZOZOTOWN ベスト', quote: 'x' },
    { url: 'https://rakuten.example/b', title: '楽天 アウター', quote: 'y' },
    { url: 'https://weather.example/c', title: '秋の天気', quote: 'z' },
  ]);
  assert.equal(result.searchUsed, true);
});

test('pause_turn resumes by re-sending the assistant turn without an extra user message', async () => {
  const sent: Json[] = [];
  const result = await callClaudeResearch(env, { system: 'sys', messages: [{ role: 'user', content: '調べて' }] }, async (_url, init) => {
    const body = JSON.parse(String(init?.body)); sent.push(body);
    return sent.length === 1
      ? reply([{ type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'q' } }, search([{ url: 'https://example.com/p', title: 'P' }])], 'pause_turn')
      : reply([{ type: 'text', text: '[調査結果]\n## 市場と気候\n- 寒暖差' }]);
  });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].messages.map((message: Json) => message.role), ['user', 'assistant']);
  assert.equal(sent[1].messages[1].content[0].type, 'server_tool_use');
  assert.equal(result.text, '## 市場と気候\n- 寒暖差');
  assert.deepEqual(result.sources, [{ url: 'https://example.com/p', title: 'P' }]);
});

// Production 2026-11-12: with dynamic filtering one search over max_uses ended the whole code run, Claude saw none of the
// 20 results and wrote that it had no data. Direct calls keep the earlier results; only the extra search fails.
test('a search over the cap keeps the earlier results, the sources and an ok status, and the prompt states the cap', async () => {
  const result = await callClaudeResearch(env, { system: 's', messages: [{ role: 'user', content: 'q' }] }, async () => reply([
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'pantone spring 2027' } },
    search([{ type: 'web_search_result', url: 'https://example.com/pantone', title: 'Pantone SS27' }]),
    { type: 'server_tool_use', id: 'srvtoolu_2', name: 'web_search', input: { query: 'one more' } },
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_2', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
    { type: 'text', text: '[調査結果]\n## トレンド\n- PantoneのSS27はバターイエロー' },
  ]));
  assert.equal(result.searchUsed, true);
  assert.deepEqual(result.sources, [{ url: 'https://example.com/pantone', title: 'Pantone SS27' }]);
  assert.deepEqual(result.searchErrors, ['max_uses_exceeded']);
  const parsed = parseAgentResearch(formatAgentResearchContent(result));
  assert.equal(parsed.search, 'ok');
  assert.match(parsed.report, /バターイエロー/);
  const designAssistant = readFileSync(new URL('../cloudflare/heavy-api/src/designAssistant.ts', import.meta.url), 'utf8');
  assert.match(designAssistant, /You can search at most \$\{AGENT_RESEARCH_MAX_USES\} times/);
  assert.match(designAssistant, /Never write that data could not be obtained when searches returned results/);
});

test('a search error inside a 200 answer is recorded, and a 400 falls back to one call without the tool', async () => {
  const failed = await callClaudeResearch(env, { system: 's', messages: [{ role: 'user', content: 'q' }] }, async () => reply([
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
    { type: 'text', text: '[調査結果]\n## トレンド\n- 知識に基づく' },
  ]));
  assert.equal(failed.searchUsed, false);
  assert.deepEqual(failed.searchErrors, ['max_uses_exceeded']);
  const sent: Json[] = [];
  const fallback = await callClaudeResearch(env, { system: 's', messages: [{ role: 'user', content: 'q' }] }, async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return sent.length === 1 ? new Response('{"error":{"type":"invalid_request_error","message":"web search is not enabled"}}', { status: 400 }) : reply([{ type: 'text', text: '## トレンド\n- 検索なし' }]);
  });
  assert.equal(sent.length, 2);
  assert.ok(sent[0].tools); assert.equal(sent[1].tools, undefined);
  assert.equal(fallback.searchUsed, false);
  assert.deepEqual(fallback.searchErrors, ['web_search_unavailable']);
  const content = formatAgentResearchContent(fallback);
  assert.equal(parseAgentResearch(content).search, 'unavailable');
});

test('a refusal is a definite failure with a stable code', async () => {
  await assert.rejects(callClaudeResearch(env, { system: 's', messages: [{ role: 'user', content: 'q' }] }, async () => reply([], 'refusal')),
    (error: unknown) => error instanceof ClaudeTextError && error.code === 'claude_request_refused');
});

test('research content round-trips the report, the sources and the search status', () => {
  const content = formatAgentResearchContent({ text: '## トレンド\n- 春のリネン', sources: [{ title: 'A | 見出し', url: 'https://example.com/a' }], searchUsed: true, searchErrors: [] });
  const parsed = parseAgentResearch(content);
  assert.equal(parsed.search, 'ok');
  assert.deepEqual(parsed.sources, [{ title: 'A 見出し', url: 'https://example.com/a' }]);
  assert.deepEqual(parsed.sections, [{ heading: 'トレンド', items: ['春のリネン'] }]);
});

// Light's scope form (its bundle, 2026-11-11): 中国 pre-selected; each region adds its own platforms.
test('the research scope offers Light\'s platforms per region and posts Light\'s summary', () => {
  assert.deepEqual(DEFAULT_AGENT_SCOPE.regions, ['中国']);
  assert.deepEqual(agentScopeOptions(['中国'], 'ec').map(option => option.label), ['淘宝（タオバオ）', '天猫（Tmall）', '京东（JD.com）', '抖音（Douyin）', '快手（Kuaishou）', '小红书（Xiaohongshu）', '唯品会（Vipshop）']);
  const both = agentScopeOptions(['中国', '北美'], 'sns').map(option => option.label);
  assert.deepEqual(both, ['抖音（Douyin）', '快手（Kuaishou）', '小红书（Xiaohongshu）', '微博（Weibo）', 'Instagram', 'TikTok', 'Pinterest', 'YouTube', 'Facebook', 'Reddit']);
  assert.equal(agentScopeOptions(['北美', '欧洲'], 'ec').filter(option => option.value === 'Amazon Fashion').length, 1);
  assert.deepEqual(pruneAgentScope({ regions: ['北美'], ec: ['天猫', 'Walmart'], sns: ['微博', 'Instagram'] }), { regions: ['北美'], ec: ['Walmart'], sns: ['Instagram'] });
  assert.equal(agentScopeSummary({ regions: ['中国', '北美'], ec: ['天猫'], sns: ['Instagram'], other: '' }), '中国、北米、天猫（Tmall）、Instagram');
  assert.deepEqual(agentResearchSteps({ regions: ['北美', '中国'], ec: ['天猫'], sns: ['Instagram'] }),
    ['調査要件の組み立てと市場調査の実施（北米・中国／天猫・Instagram）', '調査結果の整理とリサーチ・ビジュアル方向レポート（HTML）の表示', 'デザイン方向選択フォームの表示']);
  assert.equal(AGENT_INTAKE_STEPS.length, 3);
});

const conversationTask = (extra: Partial<AgentTask> = {}): AgentTask => ({
  kind: 'heavy-agent-task', version: 1, scene: '商品企画', subtype: '新商品企画', prompt: '北米市場向けに2027年春のレディース企画', profile: '', project: null,
  createdAt: '2026-11-11T00:00:00.000Z', rounds: [], choice: null, plan: null, image: null, flow: 'conversation', requirements: null, notes: [], aligned: null, scope: null, research: null, ...extra,
});

test('the requirement summary, the missing items and the latest supplement are read like Light\'s', () => {
  const content = '[要件]\n目標：北米市場向けの新商品企画\n価格：未指定\n[補足が必要]\n①価格帯（通貨・上下限）②販売チャネル（百貨店／EC）③総スタイル数';
  const parsed = parseAgentRequirements(content);
  assert.deepEqual(parsed.lines.slice(0, 2), [{ label: '目標', value: '北米市場向けの新商品企画' }, { label: '価格', value: '未指定' }]);
  assert.equal(agentMissingNames(parsed.missing), '価格帯／販売チャネル／総スタイル数');
  const updated = '[返答]\n価格帯を反映しました。\n[要件]\n価格：80〜150ドル\n[補足が必要]\n①販売チャネル';
  const task = conversationTask({
    requirements: { requestId: 'r1', state: 'completed', content },
    notes: [{ id: 'n1', text: '価格は80〜150ドル', at: '2026-11-11T00:01:00.000Z', stage: 'requirements', reply: { requestId: 'n1', state: 'completed', content: updated } }],
  });
  assert.equal(effectiveAgentRequirements(task), updated);
  assert.equal(parseAgentRequirements(updated).reply, '価格帯を反映しました。');
});

test('research and themes carry the confirmed scope and the research; tasks made before the conversation still load', () => {
  const scope = { regions: ['北美'], ec: ['Walmart'], sns: ['Instagram'], other: 'Aritzia', at: '2026-11-11T00:02:00.000Z' };
  const research = { requestId: 'x', state: 'completed' as const, content: formatAgentResearchContent({ text: '## トレンド\n- ユーティリティ', sources: [], searchUsed: true, searchErrors: [] }) };
  const prompt = agentResearchPrompt(conversationTask({ scope }));
  assert.match(prompt, /地域=北米 \/ ECプラットフォーム=Walmart \/ SNS=Instagram \/ その他=Aritzia/);
  assert.match(prompt, /\[調査結果\]/);
  assert.match(themePrompt(conversationTask({ scope, research })), /ウェブ調査の結果:\n## トレンド\n- ユーティリティ/);
  const legacy = { kind: 'heavy-agent-task', version: 1, scene: '商品企画', subtype: '新商品企画', prompt: '旧タスク', profile: '', project: null, createdAt: '2026-10-01', rounds: [], choice: null, plan: null, image: null };
  const read = readAgentTask({ agentTask: legacy });
  assert.ok(read); assert.equal(read!.flow, undefined);
  assert.doesNotMatch(themePrompt(read!), /ウェブ調査/);
});

// Production 2026-11-12: a detailed research report made the theme request about 5,000 characters; the server (then
// 4,000) turned it away and the page kept reading back a request that never existed.
test('every planning request stays under the cap even with the longest parts, and a rejection fails the step', () => {
  const huge = 'あ'.repeat(20000);
  const requirementsStep = { requestId: 'q', state: 'completed' as const, content: `[要件]\n目標：${huge}\n[補足が必要]\n①${huge}` };
  const research = { requestId: 'r', state: 'completed' as const, content: formatAgentResearchContent({ text: `## トレンド\n- ${huge}`, sources: [], searchUsed: true, searchErrors: [] }) };
  const notes = Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, text: huge, at: '2026-11-12T00:00:00.000Z', stage: 'themes' as const, reply: { requestId: `nr${index}`, state: 'completed' as const, content: '[返答]\nok' } }));
  const rounds = Array.from({ length: 6 }, (_, index) => ({ step: { requestId: `t${index}`, state: 'completed' as const }, summary: '', themes: [huge, huge, huge, huge] }));
  const task = conversationTask({ prompt: huge, profile: huge, requirements: requirementsStep, notes, research, rounds,
    scope: { regions: ['日本'], ec: ['ZOZOTOWN'], sns: ['Instagram'], other: huge, at: '2026-11-12T00:00:00.000Z' } });
  const prompts = { requirements: agentRequirementsPrompt(task), note: agentNotePrompt(task, { text: huge, stage: 'requirements' }), research: agentResearchPrompt(task), theme: themePrompt(task), plan: planPrompt(task, huge) };
  Object.entries(prompts).forEach(([name, prompt]) => assert.ok(prompt.length <= AGENT_PROMPT_BUDGET, `${name}: ${prompt.length}`));
  assert.ok(AGENT_PROMPT_BUDGET < 16000);
  // Turned away or never stored: the step fails with a retry. Network drops, expired sessions, limits and outages do not.
  assert.equal(agentRequestRejection(new Error('cloudflare_api_400_invalid_design_assistant_request')), 'invalid_design_assistant_request');
  assert.equal(agentRequestRejection(new Error('cloudflare_api_404_not_found')), 'not_found');
  assert.equal(agentRequestRejection(new Error('cloudflare_api_409_design_assistant_request_conflict')), 'design_assistant_request_conflict');
  assert.equal(agentRequestRejection(new Error('cloudflare_api_413_design_assistant_body_too_large')), 'design_assistant_body_too_large');
  ['cloudflare_api_401_unauthorized', 'cloudflare_api_403_forbidden', 'cloudflare_api_408_timeout', 'cloudflare_api_429_design_assistant_daily_limit', 'cloudflare_api_503_design_assistant_storage_unavailable', 'Failed to fetch', 'cloudflare_session_changed']
    .forEach(message => assert.equal(agentRequestRejection(new Error(message)), null, message));
  assert.equal(agentRequestRejection('not an error'), null);
  const page = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /const rejected = agentRequestRejection\(error\);\n\s+if \(rejected\) \{\n\s+try \{ await commit\(\(task\) => apply\(task, \{ requestId: step\.requestId, state: 'failed', errorCode: rejected \}\)\); return; \}/);
});

// Light's 「ビジュアル方向性を選択」 and its HTML report (2026-11-11).
test('directions read as name, description and recommendation, and the report escapes everything it shows', () => {
  assert.deepEqual(parseAgentDirection('リラックス・テーラリング（ジャンプスーツ）｜ドレープ素材のハイウエスト。軽量。｜天猫の中価格帯で実績'),
    { name: 'リラックス・テーラリング（ジャンプスーツ）', description: 'ドレープ素材のハイウエスト。軽量。', recommendation: '天猫の中価格帯で実績', imagePrompt: '' });
  assert.deepEqual(parseAgentDirection('アーバン・リネン：麻混の通勤着'), { name: 'アーバン・リネン', description: '麻混の通勤着', recommendation: '', imagePrompt: '' });
  const research = { requestId: 'r', state: 'completed' as const, content: formatAgentResearchContent({ text: '## トレンド\n- <script>alert(1)</script>', sources: [{ title: 'A"<b>', url: 'https://example.com/?q="x"' }], searchUsed: true, searchErrors: [] }) };
  const html = buildAgentResearchReportHtml(conversationTask({ research, rounds: [{ step: { requestId: 't', state: 'completed' }, summary: '', themes: ['名前｜説明｜理由'] }] }));
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /href="https:\/\/example\.com\/\?q=&quot;x&quot;"/);
  assert.match(html, /<h3>名前<\/h3><p>説明<\/p><p class="muted">理由<\/p>/);
});

test('the task page follows Light\'s conversation and lists the research sources', () => {
  const page = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');
  for (const text of ['問題ありません、続行', '調査範囲を確認', '選択をリセット', '確認して調査を開始', '条件を追加、または続けて質問…', 'Enterで送信・Shift+Enterで改行',
    'その他のECプラットフォームや独立サイト名をカンマで区切って入力してください', 'data-testid="agent-research-sources"', '今回の要件の理解：',
    'オンラインで表示', 'ダウンロード', 'ビジュアル方向性を選択', '全選択', '修正・補足する', '確認して続行', 'タスク成果物'])
    assert.ok(page.includes(text), text);
  // Light's words per scene live with the steps (agentMerch.ts).
  const merch = readFileSync(new URL('../src/features/agent/agentMerch.ts', import.meta.url), 'utf8');
  for (const text of ['条件を補足する', '調査が完了しました。続いて調査結果をHTMLレポートに整理して表示します。', '商品構成計画に進む方向性を1つ以上選択してください'])
    assert.ok(merch.includes(text), text);
  assert.match(page, /\{!roundSources && <p className="mt-2 text-xs leading-5 text-neutral-500">\{agentThemeSearches\(task\)/);
  assert.match(page, /runAssistant\('theme', step, prompt, applyRound\(requestId\), themeMode\(saved\.task\)\)/);
  assert.match(page, /guard\(startResearch, '調査を開始できませんでした。', 'research'\)/);
  assert.match(page, /'agent-research'\)/);
  // Light 2026-11-12: two directions to a row, each line cut short, select circle top right, 全選択 at the bottom left,
  // and no summary paragraph between the report card and the form.
  assert.match(page, /className="grid gap-2 sm:grid-cols-2" data-testid="agent-directions"/);
  assert.match(page, /line-clamp-1 text-sm font-medium text-white">\{direction\.name\}/);
  assert.match(page, /line-clamp-2 text-xs leading-5 text-neutral-300">\{direction\.description\}/);
  assert.match(page, /flex flex-wrap items-center justify-between gap-2/);
  // `block` overrode the clamp's display (-webkit-box) in production, so no clamped line may carry it.
  assert.doesNotMatch(page, /line-clamp-\d block/);
  // An attempt that a retry replaced is not shown again; only the last round reports a failure.
  assert.match(page, /\{last && \(round\.step\.state === 'failed' \|\| round\.step\.state === 'unknown'\) && \(/);
  assert.match(page, /\{round\.summary && !conversation && <div className="whitespace-pre-wrap" data-testid="agent-summary">/);
  const tasks = readFileSync(new URL('../src/features/agent/agentTasks.ts', import.meta.url), 'utf8');
  assert.match(tasks, /AGENT_CONVERSATION_SUBTYPES: readonly string\[\] = \['新商品企画', '顧客提案'\]/);
  assert.match(tasks, /AGENT_CONVERSATION_SUBTYPES\.includes\(input\.subtype\) \? \{ flow: 'conversation' as const, requirements: null, notes: \[\], aligned: null, scope: null, research: null \}/);
});

// Light (2026-11-11): 新商品企画 runs the conversation; テーマ企画 goes straight to the themes with web sources under 参考資料.
test('テーマ企画 themes search the web and keep their sources apart from the themes', () => {
  const themeTask = { ...conversationTask(), flow: undefined, subtype: 'テーマ企画' } as AgentTask;
  assert.equal(agentThemeSearches(themeTask), true);
  assert.equal(agentThemeSearches(conversationTask()), false);
  assert.equal(agentThemeSearches({ ...themeTask, subtype: '新商品企画' }), false);
  assert.match(themePrompt(themeTask), /キーエレメント：…」「インスピレーション：…」「カラーパレット：…/);
  const content = formatAgentResearchContent({ text: '[概要]\n傾向。\n[テーマ]\n- A：a\n- B：b\n- C：c\n- D：d', sources: [{ title: 'hypebeast', url: 'https://hypebeast.com/x' }], searchUsed: true, searchErrors: [] });
  assert.deepEqual(parseThemeResponse(content), { summary: '傾向。', themes: ['A：a', 'B：b', 'C：c', 'D：d'] });
  const withRound = { ...themeTask, rounds: [{ step: { requestId: 'r', state: 'completed' as const, content }, summary: '', themes: [] }] };
  assert.deepEqual(agentRoundSources(withRound)?.sources, [{ title: 'hypebeast', url: 'https://hypebeast.com/x' }]);
  assert.equal(agentRoundSources({ ...themeTask, rounds: [{ step: { requestId: 'r', state: 'completed' as const, content: '[概要]\nx\n[テーマ]\n- A：a' }, summary: '', themes: [] }] }), null);
});
