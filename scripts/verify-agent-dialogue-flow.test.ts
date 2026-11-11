import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatAgentResearchContent } from '../cloudflare/heavy-api/src/designAssistant.ts';
import { AGENT_PROMPT_BUDGET, type AgentTask, type AgentTurn } from '../src/features/agent/agentFlow.ts';
import {
  agentBuildDialogueImages, agentDialogueAspect, agentDialogueHistory, agentDialogueImagePrompt, agentDialogueIsStart, agentDialogueMode, agentDialoguePlan,
  agentDialogueProgress, agentDialoguePrompt, agentDialogueResultLead, agentDialogueSources, agentDialogueWaiting, parseAgentDialogueReply,
} from '../src/features/agent/agentDialogue.ts';

const base = (extra: Partial<AgentTask> = {}): AgentTask => ({
  kind: 'heavy-agent-task', version: 1, scene: 'インスピレーション', subtype: 'インスピレーション', prompt: '参考画像を基にデザインを拡張し、ジャケット、長袖スウェット、長袖Tシャツにする', profile: '',
  project: null, createdAt: '2026-11-12T00:00:00.000Z', rounds: [], choice: null, plan: null, image: null, flow: 'dialogue', turns: [], dialogueStart: null, notes: [], ...extra,
});
const reply = (id: string, content: string, mode: AgentTurn['mode'] = 'agent'): AgentTurn => ({ id, role: 'assistant', at: '2026-11-12T00:00:00.000Z', mode, step: { requestId: `r-${id}`, state: 'completed', content } });
const user = (id: string, text: string, prompt?: string): AgentTurn => ({ id, role: 'user', at: '2026-11-12T00:00:00.000Z', text, ...(prompt ? { prompt } : {}) });

const FORM = [
  'ご提供いただいた参考画像を解析いたしました。アシンメトリーとドレーピングが特徴です。',
  'これらの特徴を残しつつ、以下の点を確認させてください：',
  '[Q single] 商業定位 | デザイナーズブランド向け | 大衆向け量産品 | バランス型',
  '[Q single] 改款の方向性 | A: 核心のディテールを維持 | B: シルエットを維持 | C: エッセンスのみ',
  '[Q multi] ターゲット層・着用シーン（複数選択可） | 通勤 | カジュアル | ストリート',
  '[Q single] 季節 | 春夏（SS） | 秋冬（AW）',
].join('\n');
const SKUS = Array.from({ length: 15 }, (_, index) => {
  const code = String(index + 1).padStart(2, '0');
  const phase = index < 5 ? 'Phase 1：実穿基礎款' : index < 10 ? 'Phase 2：風格設計款' : 'Phase 3：形象創意款';
  return `[SKU] ${code}｜スタイル${code}｜${phase}｜《装飾減少法》を適用し、色彩はサンドベージュ。｜lightweight cotton jacket with draped shoulder in sand beige`;
});
const PLAN = ['【最終デザイン執行書：Sculptural Ease Collection】', '1. 策略綜述', '本シリーズ15款を3つの波段に規画いたします。', ...SKUS, '[シリーズ] Sculptural Ease Collection',
  'この内容で問題ございませんか？修正のご要望があればお知らせください。'].join('\n');

test('Light\'s inspiration chat: a form, four directions after a web search, a picker, the 執行書, then 開始', () => {
  const form = parseAgentDialogueReply(FORM);
  assert.equal(form.questions.length, 4);
  assert.deepEqual(form.questions[0], { kind: 'single', title: '商業定位', options: ['デザイナーズブランド向け', '大衆向け量産品', 'バランス型'] });
  assert.equal(form.questions[2].kind, 'multi');
  assert.match(form.body, /解析いたしました/);
  assert.doesNotMatch(form.body, /\[Q/);

  const research = formatAgentResearchContent({ text: '検索します。\n[調査結果]\nトレンド検索結果と需要分析に基づき、以下4つのデザイン方向を策定いたしました：\n方案 A：【ミニマル解構方向】',
    sources: [{ title: 'Vogue', url: 'https://www.vogue.com/a', quote: '不対称領口が注目' }], searchUsed: true, searchErrors: [] });
  const directions = parseAgentDialogueReply(research);
  assert.match(directions.body, /^トレンド検索結果/);
  assert.doesNotMatch(directions.body, /検索します|\[出典\]|\[検索\]/);
  assert.deepEqual(directions.sources, [{ title: 'Vogue', url: 'https://www.vogue.com/a', quote: '不対称領口が注目' }]);
  assert.equal(directions.search, 'ok');

  const picker = parseAgentDialogueReply('方案C・Dに基づき参考素材を検索します。\n[S] ドレープのトップス | draped blouse\n[S] カラーブロック | color block jacket\n[S] アースカラー | earth tone knit\n[S] 4件目 | ignored');
  assert.deepEqual(picker.searches.map((search) => search.query), ['draped blouse', 'color block jacket', 'earth tone knit']);

  const plan = parseAgentDialogueReply(PLAN);
  assert.equal(plan.skus.length, 15);
  assert.deepEqual(plan.skus[0], { code: '01', name: 'スタイル01', group: 'Phase 1：実穿基礎款', logic: '《装飾減少法》を適用し、色彩はサンドベージュ。', prompt: 'lightweight cotton jacket with draped shoulder in sand beige' });
  assert.equal(plan.series, 'Sculptural Ease Collection');
  assert.doesNotMatch(plan.body, /\[SKU\]|\[シリーズ\]/);
  assert.equal(parseAgentDialogueReply('[開始]').start, true);
  // A style line without the logic still has its picture description.
  assert.deepEqual(parseAgentDialogueReply('[SKU] A-01｜青海波｜方案A【経典藍染】｜indigo seigaiha wave repeat pattern').skus[0],
    { code: 'A-01', name: '青海波', group: '方案A【経典藍染】', logic: '', prompt: 'indigo seigaiha wave repeat pattern' });
});

test('the turn that answers the inspiration form searches the web; graphics and later turns do not', () => {
  const asked = base({ turns: [reply('a1', FORM)] });
  assert.equal(agentDialogueMode(asked), 'agent-research');
  assert.equal(agentDialogueMode(base({ scene: 'AIグラフィックデザイン', subtype: 'AIグラフィックデザイン', turns: [reply('a1', FORM)] })), 'agent');
  const researched = base({ turns: [reply('a1', FORM), user('u1', '大衆向け量産品', '【確認の回答】'), reply('a2', 'directions', 'agent-research'), user('u2', 'C,D'), reply('a3', '[S] 素材 | knit')] });
  assert.equal(agentDialogueMode(researched), 'agent');
  assert.equal(agentDialogueMode(base({ turns: [reply('a1', '和柄の種類は？')] })), 'agent');
  const prompt = agentDialoguePrompt(asked, user('u1', '大衆向け量産品，春夏（SS）', '【確認の回答】\n商業定位: 大衆向け量産品'), 'agent-research');
  assert.match(prompt, /\[調査結果\]/);
  assert.match(prompt, /【確認の回答】\n商業定位: 大衆向け量産品/);
});

test('each request carries the stages and stays under the server cap; the history alternates and fits 8 messages / 16,000 characters', () => {
  const long = 'あ'.repeat(5000);
  const task = base({ prompt: long, profile: long, attachments: [{ id: 'f', kind: 'file', name: 'brief.docx', size: 1, at: '', text: long }] });
  const first = agentDialoguePrompt(task, null);
  assert.ok(first.length <= AGENT_PROMPT_BUDGET);
  assert.match(first, /段階1の返答/);
  assert.match(first, /最終デザイン執行書/);
  assert.match(agentDialoguePrompt(base({ scene: 'AIグラフィックデザイン', subtype: 'AIグラフィックデザイン' }), null), /A\. シンプル実用デザイン.*B\. 創造的抽象デザイン/s);
  assert.ok(agentDialoguePrompt(task, user('u', long)).length <= AGENT_PROMPT_BUDGET);

  const turns: AgentTurn[] = [];
  for (let index = 0; index < 8; index += 1) { turns.push(reply(`a${index}`, `${index}:${'い'.repeat(6000)}`)); turns.push(user(`u${index}`, `答え${index}`)); }
  turns.push({ id: 'failed', role: 'assistant', at: '', step: { requestId: 'x', state: 'failed' } });
  const history = agentDialogueHistory(base({ turns }));
  assert.ok(history.length <= 8);
  assert.equal(history[0].role, 'user');
  assert.equal(history[history.length - 1].role, 'assistant');
  assert.ok(history.every((message, index) => index === 0 || message.role !== history[index - 1].role));
  assert.ok(history.reduce((sum, message) => sum + message.content.length, 0) <= 16000);
  assert.ok(history.every((message) => message.content.length > 0));
  // The newest reply keeps the most (a revised 執行書 is read back whole).
  assert.ok(history[history.length - 1].content.startsWith('7:'));

  const short = agentDialogueHistory(base({ turns: [reply('a1', FORM), user('u1', '春夏', '【確認の回答】\n季節: 春夏')] }));
  assert.deepEqual(short.map((message) => message.role), ['user', 'assistant']);
  assert.match(short[0].content, /^最初の依頼: /);
  assert.deepEqual(agentDialogueHistory(base()), []);
  // A research reply goes back without its source list.
  const researched = agentDialogueHistory(base({ turns: [reply('a1', formatAgentResearchContent({ text: '[調査結果]\n方案 A', sources: [{ title: 't', url: 'https://e.com' }], searchUsed: true, searchErrors: [] }), 'agent-research'), user('u', 'A')] }));
  assert.equal(researched[1].content, '方案 A');
});

test('typing 開始 starts the generation; the styles come from the newest 執行書 in its order, four to a progress line', () => {
  for (const text of ['開始', '開始してください', 'はい', 'OK', 'お願いします。']) assert.equal(agentDialogueIsStart(text), true, text);
  for (const text of ['SKU 03の色を変えて', '修正して', 'もう少し明るい色で開始して']) assert.equal(agentDialogueIsStart(text), false, text);

  const task = base({ turns: [reply('a1', PLAN.replace(/スタイル/g, '旧')), user('u1', '色を明るく'), reply('a2', PLAN)] });
  assert.equal(agentDialoguePlan(task)?.turn.id, 'a2');
  let id = 0;
  const images = agentBuildDialogueImages(task, () => `req-${(id += 1)}`);
  assert.equal(images.length, 15);
  assert.deepEqual({ ...images[0] }, { key: 'k1', code: '01', name: 'スタイル01', category: 'Phase 1：実穿基礎款', prompt: 'lightweight cotton jacket with draped shoulder in sand beige', requestId: 'req-1', state: 'pending' });
  const progress = agentDialogueProgress(images.map((image, index) => ({ ...image, state: index < 4 ? 'completed' : index < 6 ? 'running' : 'pending' })));
  assert.deepEqual(progress.map((item) => item.label), ['SKU 01-04を生成しています', 'SKU 05-08を生成しています', 'SKU 09-12を生成しています', 'SKU 13-15を生成しています']);
  assert.deepEqual(progress.map((item) => item.status), ['完了', '進行中', '待機中', '待機中']);
  const graphic = agentDialogueProgress([{ ...images[0], code: 'A-01', state: 'completed' }, { ...images[1], code: 'A-02', state: 'completed' }]);
  assert.deepEqual(graphic, [{ label: 'A-01-A-02を生成しています', status: '完了' }]);
  const lead = agentDialogueResultLead(task, 'Sculptural Ease Collection', 15, 3);
  assert.equal(lead.title, '【Sculptural Ease Collection】デザイン成果展示');
  assert.equal(lead.lead, '全 15款 のデザインが生成完了いたしました。以下、3つのデザイン波段に分けてご呈示いたします。');
});

test('a print is drawn flat and square, an inspiration style as one garment; the spinner says what Light says', () => {
  const graphic = base({ scene: 'AIグラフィックデザイン', subtype: 'AIグラフィックデザイン' });
  assert.match(agentDialogueImagePrompt(graphic, 'indigo seigaiha "wave" style repeat'), /Flat textile print design artwork.*no garment/);
  assert.doesNotMatch(agentDialogueImagePrompt(graphic, 'indigo seigaiha style'), /\bstyle\b|"/);
  assert.equal(agentDialogueAspect(graphic), '1:1');
  assert.match(agentDialogueImagePrompt(base(), 'draped jacket'), /single garment only/);
  assert.equal(agentDialogueAspect(base()), '3:4');

  const running: AgentTurn = { id: 'a1', role: 'assistant', at: '', mode: 'agent', step: { requestId: 'r', state: 'running' } };
  assert.match(agentDialogueWaiting(base({ attachments: [{ id: 'i', kind: 'image', name: '1.jpg', size: 1, at: '' }], turns: [running] }), running), /参考画像を解析し、デザイン要素を抽出しています/);
  const research: AgentTurn = { ...running, id: 'a2', mode: 'agent-research' };
  assert.match(agentDialogueWaiting(base({ turns: [reply('a0', FORM), user('u', 'x'), research] }), research), /トレンドを検索しています/);
  const after: AgentTurn = { ...running, id: 'a3' };
  assert.match(agentDialogueWaiting(base({ turns: [reply('a0', 'x'), user('u', '参考画像を2枚選択しました', '【参考画像の選択】\nA、B'), after] }), after), /選定し、デザイン要素を解析/);
  assert.equal(agentDialogueSources(base({ turns: [reply('a1', formatAgentResearchContent({ text: '[調査結果]\nx', sources: [{ title: 't', url: 'https://e.com' }], searchUsed: true, searchErrors: [] }), 'agent-research')] }))?.sources.length, 1);
});

test('new インスピレーション / AIグラフィックデザイン tasks open the chat; the page draws it and generates its styles', () => {
  const tasks = readFileSync(new URL('../src/features/agent/agentTasks.ts', import.meta.url), 'utf8');
  assert.match(tasks, /AGENT_DIALOGUE_SCENES\.includes\(input\.scene\) \? \{ flow: 'dialogue' as const, turns: \[\], dialogueStart: null/);
  const page = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /<AgentDialogueView task=\{task\}/);
  assert.match(page, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); sendComposer\(\); \}\}/);
  assert.match(page, /dialogue \? agentDialogueImagePrompt\(current!, image\.prompt\) : agentStyleImagePrompt\(image\.prompt\)/);
  assert.match(page, /aspectRatio: dialogue \? agentDialogueAspect\(current!\) : '3:4'/);
  assert.match(page, /if \(task\.flow === 'dialogue'\) \{/);
  const view = readFileSync(new URL('../src/features/agent/AgentDialogueView.tsx', import.meta.url), 'utf8');
  assert.match(view, /'企画を生成' : '次へ'/);
  assert.match(view, /全選択/);
  assert.match(view, /素材を追加選択/);
});
