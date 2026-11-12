import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callClaudeResearch } from '../cloudflare/heavy-api/src/claude-text.ts';
import { formatAgentResearchContent } from '../cloudflare/heavy-api/src/designAssistant.ts';
import { agentResearchPrompt, agentRoundSources, agentThemeRoundSearches, agentThemeSearches, themePrompt, type AgentTask } from '../src/features/agent/agentFlow.ts';

const flow = readFileSync(new URL('../src/features/agent/agentFlow.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');

const themeTask = (extra: Partial<AgentTask> = {}): AgentTask => ({
  kind: 'heavy-agent-task', version: 1, scene: '商品企画', subtype: 'テーマ企画', prompt: '30代女性向けの2027年秋冬ニットのテーマ企画', profile: '', project: null,
  createdAt: '2026-11-12T00:00:00.000Z', rounds: [], choice: null, plan: null, image: null, notes: [], ...extra,
});
const researched = (sources: { title: string; url: string; quote?: string }[]) => ({ requestId: 'research-1', state: 'completed' as const,
  content: formatAgentResearchContent({ text: '## トレンド\n- WGSNとColoroは2027-28年秋冬の主要カラーにディープグリーンを選んだ', sources, searchUsed: true, searchErrors: [] }) });

// Production 2026-11-12 (requests 9158a953 and 4fbb38f4): the theme round searched inside the short theme format and came
// back with no citation at all, even with every line stating a page's fact, while every research report carried them.
// Light's テーマ企画 lists under 参考資料 the pages it cited, each with the sentence. Heavy now searches in a research step
// written as a report, like 新商品企画's research, and writes the themes from that report.
test('テーマ企画 researches first as a report, without a scope, and writes its themes from the report without searching again', () => {
  const fresh = themeTask();
  assert.equal(agentThemeSearches(fresh), true);
  const research = agentResearchPrompt(fresh);
  assert.match(research, /ウェブ検索で最新の情報/);
  assert.match(research, /「\[調査結果\]」の行のあとに、次の見出しを順に使い、各見出しの下は「- 」で始まる箇条書きで、数字や具体例を入れて書いてください（URLは書かない）/);
  assert.match(research, /依頼: 30代女性向けの2027年秋冬ニットのテーマ企画/);
  assert.doesNotMatch(research, /出典/);
  assert.doesNotMatch(research, /調査範囲: /);
  // Until the research is done a round would search itself (tasks made before the research step); after it, it does not.
  assert.equal(agentThemeRoundSearches(fresh), true);
  const done = themeTask({ research: researched([]) });
  assert.equal(agentThemeRoundSearches(done), false);
  const theme = themePrompt(done);
  assert.match(theme, /ウェブ調査の結果:\n## トレンド\n- WGSNとColoroは/);
  assert.match(theme, /キーエレメント：…」「インスピレーション：…」「カラーパレット：…」の3行を書く。傾向の文と各テーマの「インスピレーション：」の行は、調査結果の具体的な事実/);
  assert.match(theme, /- テーマ名：一文の説明/);
  // The citations are what 参考資料 lists, so no theme prompt forbids 出典 for a web-searching テーマ企画 any more.
  assert.doesNotMatch(theme, /出典/);
  assert.doesNotMatch(themePrompt(fresh), /出典/);
});

test('参考資料 of テーマ企画 lists the research sources; a round that searched itself (older tasks) still wins', () => {
  const cited = [{ title: 'WGSNとColoro', url: 'https://fashionunited.jp/news/x', quote: 'WGSNとColoroは主要カラーとしてDeep Greenを発表した。' }];
  const task = themeTask({ research: researched(cited), rounds: [{ step: { requestId: 't1', state: 'completed', content: '[概要]\nx\n[テーマ]\n- A：a' }, summary: 'x', themes: ['A：a'] }] });
  assert.deepEqual(agentRoundSources(task)?.sources, cited);
  const own = formatAgentResearchContent({ text: '[概要]\ny\n[テーマ]\n- B：b', sources: [{ title: 'hypebeast', url: 'https://hypebeast.com/x', quote: 'q' }], searchUsed: true, searchErrors: [] });
  const older = themeTask({ rounds: [{ step: { requestId: 't0', state: 'completed', content: own }, summary: 'y', themes: ['B：b'] }] });
  assert.deepEqual(agentRoundSources(older)?.sources, [{ title: 'hypebeast', url: 'https://hypebeast.com/x', quote: 'q' }]);
  // 新商品企画 keeps its research in its own report card, not under the theme 参考資料.
  assert.equal(agentRoundSources({ ...themeTask({ research: researched(cited) }), subtype: '新商品企画' }), null);
});

// 4fbb38f4 listed 17 pages for 0 citations: walmart products and an anime filled in from the search hits.
test('search hits Claude did not cite are never listed: only cited pages, each with its cited sentence', async () => {
  const env = { ANTHROPIC_API_KEY: 'server-only-test-key' } as any;
  const result = await callClaudeResearch(env, { system: 's', messages: [{ role: 'user', content: 'q' }] }, async () => Response.json({
    id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
    content: [
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [
        { url: 'https://fashionunited.jp/news/x', title: 'WGSNとColoroが発表' },
        { url: 'https://www.walmart.com/ip/17485620516', title: 'Sweater Turtleneck' },
        { url: 'https://en.wikipedia.org/wiki/Iroduku', title: 'Iroduku: The World in Colors' },
      ] },
      { type: 'text', text: '[調査結果]\n## トレンド\n- ディープグリーンが主要カラー', citations: [
        { type: 'web_search_result_location', url: 'https://fashionunited.jp/news/x', title: 'WGSNとColoroが発表', cited_text: 'WGSNとColoroは主要カラーとしてDeep Greenを発表した。' },
      ] },
    ],
  }));
  assert.deepEqual(result.sources, [{ url: 'https://fashionunited.jp/news/x', title: 'WGSNとColoroが発表', quote: 'WGSNとColoroは主要カラーとしてDeep Greenを発表した。' }]);
  // No citation at all lists nothing rather than the hits; the page then says no page was referred to.
  const none = await callClaudeResearch(env, { system: 's', messages: [{ role: 'user', content: 'q' }] }, async () => Response.json({
    id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
    content: [
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ url: 'https://www.walmart.com/ip/1', title: 'Sweater' }] },
      { type: 'text', text: '[調査結果]\n## トレンド\n- 一般論' },
    ],
  }));
  assert.deepEqual(none.sources, []);
  assert.equal(none.searchUsed, true);
});

test('the task page runs テーマ企画\'s research before its first round and lists only 参考資料 for it', () => {
  assert.match(page, /if \(agentThemeSearches\(task\) && !task\.rounds\.length\) \{\n\s+if \(!task\.research\) \{ guard\(startResearch, '調査を開始できませんでした。', 'research'\); return; \}/);
  assert.match(page, /const themeMode = \(task: AgentTask\): AssistantMode => \(agentThemeRoundSearches\(task\) \? 'agent-research' : agentThemeSearches\(task\) \? 'agent' : textMode\(task\)\);/);
  // A failed research shows a retry instead of a spinner that never ends.
  assert.match(page, /!conversation && agentThemeSearches\(task\) && task\.rounds\.length === 0 && stepFailed\(task\.research\?\.state\) && <ErrorRow onRetry=\{retryResearch\}>/);
  // Light's テーマ企画 panel has 概要 and 参考資料 only: its research is not a タスク成果物.
  assert.match(page, /\.\.\.\(research && !agentThemeSearches\(task\) \? \[\{ key: 'research'/);
  // 参考資料 shows the site, then the cited sentence (the title only when there is none).
  assert.match(page, /\{source\.quote \?\? source\.title\}/);
  assert.match(flow, /if \(agentThemeSearches\(task\)\) return agentThemeResearchPrompt\(task\);/);
});
