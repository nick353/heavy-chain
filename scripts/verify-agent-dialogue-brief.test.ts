import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatAgentResearchContent } from '../cloudflare/heavy-api/src/designAssistant.ts';
import { agentClipTitle, parsePlanResponse, type AgentStyleImage, type AgentTask, type AgentTurn } from '../src/features/agent/agentFlow.ts';
import { agentDialogueBriefTitle, buildAgentDialogueBriefHtml, parseAgentFinal } from '../src/features/agent/agentMerch.ts';

// Light's インスピレーション and AIグラフィックデザイン show the chat alone (no 概要, no report), and they cannot be run on this
// account. Heavy's own deliverable after 「開始」: デザイン執行書 / 図案執行書, the approved 執行書, every style with its wave and
// design logic, and the directions' trend sources, on one page to show or download.

const reply = (id: string, content: string, mode: AgentTurn['mode'] = 'agent'): AgentTurn => ({ id, role: 'assistant', at: '2026-11-12T00:00:00.000Z', mode, step: { requestId: `r-${id}`, state: 'completed', content } });
const user = (id: string, text: string): AgentTurn => ({ id, role: 'user', at: '2026-11-12T00:00:00.000Z', text });
const PLAN = [
  '【最終デザイン執行書：濃藍の縫い目 - Indigo Seam Spring】',
  '1. 策略綜述',
  'Phase 1 実穿基礎款（01〜02）: 30〜40代が毎日着られる核を作る。',
  '2. 設計推演',
  '原始需求→確認方向: 濃藍のステッチを主役にする。',
  '[SKU] 01｜ステッチ・ワークジャケット｜Phase 1：実穿基礎款｜《細部移植法》で胸のステッチを残し、色彩は濃藍。｜indigo cotton work jacket with contrast stitching',
  '[SKU] 02｜テーパードパンツ｜Phase 1：実穿基礎款｜《簡素化法》で装飾を減らし、色彩はインクネイビー。｜ink navy tapered trousers',
  '[SKU] 03｜色落ちシャツ｜Phase 2：展開改款｜《色彩置換法》で淡いブルーに。｜faded blue cotton shirt',
  '[シリーズ] 濃藍の縫い目 - Indigo Seam Spring',
  'この内容で問題ございませんか？修正のご要望があればお知らせください。確認いただければ、直ちに生成を開始いたします。',
].join('\n');
const image = (index: number, code: string, name: string, category: string, state: AgentStyleImage['state'] = 'completed'): AgentStyleImage =>
  ({ key: `k${index}`, code, name, category, prompt: name, requestId: `img-${index}`, state });
const research = formatAgentResearchContent({ text: '[調査結果]\nトレンド検索結果と需要分析に基づき、以下4つのデザイン方向を策定いたしました：\n方案 A：【濃藍ワーク】',
  sources: [{ title: 'Vogue', url: 'https://www.vogue.com/article/denim', quote: '**濃いインディゴ**のワークウェアが復活' }], searchUsed: true, searchErrors: [] });
const task = (extra: Partial<AgentTask> = {}): AgentTask => ({
  kind: 'heavy-agent-task', version: 1, scene: 'インスピレーション', subtype: 'インスピレーション', prompt: '濃藍のステッチを生かしたデイリーウェアに広げて', profile: '',
  project: null, createdAt: '2026-11-12T00:00:00.000Z', rounds: [], choice: null, plan: null, image: null, flow: 'dialogue', notes: [],
  turns: [reply('a1', 'ご依頼を確認しました。'), user('u1', '通勤'), reply('a2', research, 'agent-research'), user('u2', '方案A'), reply('a3', PLAN), user('u3', '開始'), reply('a4', '[開始]')],
  dialogueStart: { after: 'u3', plan: 'a3', at: '2026-11-12T00:00:00.000Z' },
  designs: [image(1, '01', 'ステッチ・ワークジャケット', 'Phase 1：実穿基礎款'), image(2, '02', 'テーパードパンツ', 'Phase 1：実穿基礎款'), image(3, '03', '色落ちシャツ', 'Phase 2：展開改款', 'failed')],
  ...extra,
});

test('デザイン執行書 holds the approved 執行書, every style with its wave and logic, and the trend sources', () => {
  assert.equal(agentDialogueBriefTitle(task()), 'デザイン執行書');
  const html = buildAgentDialogueBriefHtml(task(), { k1: 'https://img.example/1.png', k2: 'https://img.example/2.png' });
  assert.match(html, /<title>デザイン執行書<\/title>/);
  assert.match(html, /<h1>濃藍の縫い目 - Indigo Seam Spring<\/h1>/);
  assert.match(html, /依頼：濃藍のステッチを生かしたデイリーウェアに広げて/);
  // The 執行書's text without its first line, the style lines or the closing question.
  assert.match(html, /<h3>1\. 策略綜述<\/h3><p>Phase 1 実穿基礎款/);
  assert.match(html, /<h3>2\. 設計推演<\/h3>/);
  assert.doesNotMatch(html, /\[SKU\]|\[シリーズ\]|問題ございませんか|【最終デザイン執行書/);
  // Every style by wave, with its picture when it has one and its design logic.
  assert.match(html, /デザイン 全3款/);
  assert.match(html, /<h3>【Phase 1：実穿基礎款】<\/h3><div class="grid"><figure><img src="https:\/\/img\.example\/1\.png" alt="SKU #01：ステッチ・ワークジャケット">/);
  assert.match(html, /《細部移植法》で胸のステッチを残し、色彩は濃藍。/);
  assert.match(html, /<h3>【Phase 2：展開改款】<\/h3><div class="grid"><figure><figcaption><b>SKU #03：色落ちシャツ<\/b>/);
  // The directions' sources, by site, without the bold marks.
  assert.match(html, /参考資料（トレンド検索）/);
  assert.match(html, /<td>vogue\.com<\/td><td>濃いインディゴのワークウェアが復活<\/td>/);
  assert.match(html, /AI画像はデザインの参考案/);
  // Text from the chat is escaped.
  assert.match(buildAgentDialogueBriefHtml(task({ prompt: '<script>alert(1)</script>' }), {}), /依頼：&lt;script&gt;/);
});

test('図案執行書 for AIグラフィックデザイン: square prints by proposal', () => {
  const graphic = task({
    scene: 'AIグラフィックデザイン', subtype: 'AIグラフィックデザイン',
    turns: [reply('g1', ['【図案執行書：柑橘の市松】', '方案A【経典市松】: 5枚の配置と配色。', '[SKU] A-01｜レモンの市松｜方案A【経典市松】｜黄と白の市松に葉を散らす。｜lemon checker repeat pattern', '[シリーズ] 柑橘の市松'].join('\n'))],
    dialogueStart: { after: 'x', plan: 'g1', at: '2026-11-12T00:00:00.000Z' },
    designs: [image(1, 'A-01', 'レモンの市松', '方案A【経典市松】')],
  });
  assert.equal(agentDialogueBriefTitle(graphic), '図案執行書');
  const html = buildAgentDialogueBriefHtml(graphic, { k1: 'https://img.example/a1.png' });
  assert.match(html, /<title>図案執行書<\/title>/);
  assert.match(html, /PRINT BRIEF/);
  assert.match(html, /図案 全1枚/);
  assert.match(html, /alt="A-01：レモンの市松" style="aspect-ratio:1\/1"/);
  assert.doesNotMatch(html, /参考資料（トレンド検索）/);
});

test('the page offers the 執行書 under the results once every style has settled', () => {
  const page = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /dialogue && designsSettled && designs\.some\(\(image\) => image\.state === 'completed'\) \? \[\{ key: 'brief'/);
  assert.match(page, /testId="agent-dialogue-brief-report"/);
  assert.match(page, /onOpen=\{\(\) => showDeliverable\('brief'\)\} onDownload=\{\(\) => saveDeliverable\('brief'\)\}/);
});

test('a plan\'s name is kept whole up to 100 characters and cut with 「…」 past it', () => {
  // 2026-11-12, テーマ企画 5f5f71f6: a bare cut at 60 showed 「…天気が変わっても快適に着回せる SS2」.
  const name = '「パックして出かける、雨の日通勤セット」：バッグに入る撥水の軽アウターとパンツで、天気が変わっても快適に着回せる SS2027 ウィメンズ企画';
  assert.equal(parsePlanResponse(`## タイトル\n- ${name}\n## コンセプト\n- 雨の日の準備を楽にする`).title, name);
  const long = 'あ'.repeat(120);
  assert.equal(agentClipTitle(long), `${'あ'.repeat(99)}…`);
  assert.equal(agentClipTitle(long).length, 100);
  assert.equal(parseAgentFinal(`[企画名]\n${name}\n[企画書]\n## コンセプト\n- 雨の日`).title, name);
});
