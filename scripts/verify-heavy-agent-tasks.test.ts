import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] } });
const agent = await vite.ssrLoadModule('/src/features/agent/agentTasks.ts');
test.after(async () => { await vite.close(); });
const page = await readFile(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');

const task = {
  kind: agent.AGENT_TASK_KIND, version: 1, scene: '商品企画', subtype: '新商品企画', prompt: '北米向け2027年春のレディースウェア',
  profile: '30代女性向け', project: null, createdAt: '2026-10-07T00:00:00.000Z', rounds: [], choice: null, plan: null, image: null,
};

test('theme response yields the summary and four themes', () => {
  const parsed = agent.parseThemeResponse('[概要]\n都市部の通勤需要が伸びている。\nリラックス感が鍵。\n[テーマ]\n- 都会のオアシス：軽やかな素材\n- ネオ・クラシック：端正な仕立て\n- 2. ソフトミニマル：柔らかい色\n- アーバンリゾート：抜け感\n- 余分な行');
  assert.equal(parsed.summary, '都市部の通勤需要が伸びている。\nリラックス感が鍵。');
  assert.deepEqual(parsed.themes, ['都会のオアシス：軽やかな素材', 'ネオ・クラシック：端正な仕立て', '2. ソフトミニマル：柔らかい色', 'アーバンリゾート：抜け感']);
});

test('plan response yields title, sections and the image prompt', () => {
  const parsed = agent.parsePlanResponse('## タイトル\n- 都会のオアシス 2027SS\n## コンセプト\n- 通勤と休日をつなぐ\n## カラーパレット\n- セージ\n- アイボリー\n[画像プロンプト]\nurban oasis spring collection mood board');
  assert.equal(parsed.title, '都会のオアシス 2027SS');
  assert.deepEqual(parsed.sections.map((section: { heading: string }) => section.heading), ['コンセプト', 'カラーパレット']);
  assert.equal(parsed.imagePrompt, 'urban oasis spring collection mood board');
});

test('prompts carry the scene, profile and the rejected themes of earlier rounds', () => {
  const first = agent.themePrompt(task);
  assert.match(first, /商品企画（新商品企画）/);
  assert.match(first, /30代女性向け/);
  assert.match(first, /出典やURLは書かない/);
  const second = agent.themePrompt({ ...task, rounds: [{ step: { requestId: 'r1', state: 'completed' }, summary: 's', themes: ['A', 'B'] }] });
  assert.match(second, /前回提案したテーマ（A \/ B）は採用されませんでした/);
  assert.match(agent.planPrompt(task, 'A'), /採用されたテーマ: A/);
});

test('visual prompts avoid phrasing the image service reads as a named likeness', () => {
  assert.equal(agent.agentImagePrompt('Urban outdoor fashion style for women, "Brand" Styles'), 'Urban outdoor fashion aesthetic for women, Brand aesthetic');
  assert.match(agent.planPrompt(task, 'A'), /「style」という単語を使わない/);
});

test('snapshots without a valid agent task are ignored; titles follow Light\'s naming', () => {
  assert.equal(agent.readAgentTask({ objects: [] }), null);
  assert.equal(agent.readAgentTask({ objects: [], agentTask: { ...task, scene: 'other' } }), null);
  assert.equal(agent.readAgentTask({ objects: [], agentTask: task })?.subtype, '新商品企画');
  assert.equal(agent.defaultAgentTaskTitle(new Date(2026, 9, 7, 9)), 'クリエイティブ企画2026100709');
  assert.match(agent.agentConversationId('11111111-2222-3333-4444-555555555555', 'plan'), /^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
});

test('task page stores each request identity before sending and only reads back steps in flight', () => {
  // Theme round: the running step is committed first, then sent.
  assert.match(page, /const saved = await commit\(\(task\) => \(\{ \.\.\.task, rounds: \[\.\.\.task\.rounds, \{ step, summary: '', themes: \[\] \}\] \}\)\);\n\s+const prompt = themePrompt/);
  assert.match(page, /const saved = await commit\(\(task\) => \(\{ \.\.\.task, plan: step \}\)\);\n\s+await runAssistant\('plan', step, planPrompt/);
  assert.match(page, /await commit\(\(task\) => \(\{ \.\.\.task, image: step \}\)\);[\s\S]{0,80}inFlight\.current\.add\(step\.requestId\)/);
  // A running step found on load is polled with no prompt (never re-sent); a running image is reconciled by id.
  assert.match(page, /lastRound\.step\.state === 'running'\) \{\n\s+guard\(\(\) => runAssistant\('theme', lastRound\.step, null/);
  assert.match(page, /task\.plan\.state === 'running'\) \{ const step = task\.plan; guard\(\(\) => runAssistant\('plan', step, null/);
  assert.match(page, /readImageAIRequest\(step\.requestId\)/);
  // Honest sourcing: no invented reference links.
  assert.match(page, /Heavy Chainはウェブ検索を行いません/);
  assert.doesNotMatch(page, /linkaigc\.com|aliyuncs\.com/);
});
