import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatAgentResearchContent } from '../cloudflare/heavy-api/src/designAssistant.ts';
import {
  AGENT_PROMPT_BUDGET, agentAttachmentLines, agentNotePrompt, agentReferenceImages, agentRequirementsPrompt, parseAgentDirection, parseAgentResearch, themePrompt, type AgentTask,
} from '../src/features/agent/agentFlow.ts';
import {
  AGENT_STYLE_COUNT, agentBuildDesignImages, agentBuildDirectionImages, agentChosenCodes, agentDesignProgress, agentDesignPrompt, agentFinalPrompt, agentSeriesName,
  agentStructurePrompt, agentStyleImagePrompt, agentUsesMerchFlow, agentWording, buildAgentDesignHtml, buildAgentFinalHtml, buildAgentStructureHtml, parseAgentDesign,
  parseAgentFinal, parseAgentStructure,
} from '../src/features/agent/agentMerch.ts';

const base = (extra: Partial<AgentTask> = {}): AgentTask => ({
  kind: 'heavy-agent-task', version: 1, scene: '商品企画', subtype: '新商品企画', prompt: '北米市場向けに2027年春のレディース企画', profile: '', project: null,
  createdAt: '2026-11-12T00:00:00.000Z', rounds: [], choice: null, plan: null, image: null, flow: 'conversation', requirements: null, notes: [], aligned: null, scope: null, research: null, ...extra,
});
const directions = ['リラックス・テーラリング（ドレープジャンプスーツ）｜ドレープ素材のハイウエスト。｜天猫で実績｜draped high-waist wide-leg jumpsuit in sand tencel',
  'モダン・ワークウェア｜ポケットとフロントタイ。｜個性付け｜cotton twill utility jumpsuit in taupe', 'ソフト・ボリューム｜量感袖のシャツワンピース。｜季節感｜', '長袖ベーシック｜重ね着の土台。｜数量の土台'];
const round = { step: { requestId: 'round-1', state: 'completed' as const }, summary: '', themes: directions };
const STRUCTURE = [
  '[概要]', 'D1を中軸に10スタイルで構成します。',
  '[基本]', 'シリーズ名：Soft Structure', '確定方向：リラックス・テーラリング', '総スタイル数：10（規定値・変更可）', '投入計画：2ドロップ（2月／4月）', '市場・ターゲット：北米・28–40歳',
  '[カテゴリ]', '- ジャンプスーツ｜4｜40%｜中軸', '- ワンピース｜3｜30%｜季節感', '- 長袖トップス｜3｜30%｜土台',
  '[スタイル]',
  ...['JS-01', 'JS-02', 'JS-03', 'JS-04'].map((code, index) => `- ${code}｜ジャンプスーツ${index + 1}｜ジャンプスーツ｜コア｜Drop1（2月）｜$148–178｜ハイウエスト`),
  ...['DR-01', 'DR-02', 'DR-03'].map((code, index) => `- ${code}｜ワンピース${index + 1}｜ワンピース｜コア｜Drop2（4月）｜$138–168｜ラップ`),
  ...['TP-01', 'TP-02', 'TP-03'].map((code, index) => `- ${code}｜トップス${index + 1}｜長袖トップス｜エントリー｜Drop1（2月）｜$68–88｜ボートネック`),
  '[ドロップ]', '- Drop 1（2月）｜JS-01、JS-02｜春の立ち上がり',
  '[価格]', '- アイコン層｜$148–198｜JS-01｜シリーズの顔',
  '[カラー]', '- オフホワイト｜#F4F0E6', '- <b>サンド</b>｜#D8C3A0',
  '[カラーの根拠]', 'IGで高反応のニュートラル。',
  '[素材]', '- 布帛｜Tencel混のドレープ素材',
  '[デザイン言語]', '- シルエット｜緩いテーラード',
  '[マッピング]', '- ドレープジャンプスーツが主力｜4型・40%｜天猫¥150–300の実績',
  '[リスク]', '- サイズ展開が未設計',
  '[未決事項]', '- 販売チャネル',
].join('\n');
const DESIGN = ['[シリーズ共通言語]', '緩いテーラードとドレープで統一。', '[スタイル設計]',
  ...['JS-01', 'JS-02', 'JS-03', 'JS-04', 'DR-01', 'DR-02', 'DR-03', 'TP-01', 'TP-02', 'TP-03'].map(code => `- ${code}｜差別化 ${code}｜a draped garment ${code.toLowerCase()} in a soft style, sand color`)].join('\n');

// Light 2026-11-12: 顧客提案 runs the same conversation as 新商品企画 with its own words and numbered requirements.
test('顧客提案 numbers the requirements, names the collection and uses Light\'s client wording', () => {
  const client = base({ scene: '顧客提案', subtype: '顧客提案' });
  const prompt = agentRequirementsPrompt(client);
  assert.match(prompt, /シリーズ名：/);
  assert.match(prompt, /R01 ブランドの位置づけ：…/);
  const requirements = { requestId: 'q', state: 'completed' as const, content: '[要件]\nシリーズ名：2027SSレディースコレクション\nR01 ブランドの位置づけ：手の届くラグジュアリー\nR03 通勤での実用性：…\n[補足が必要]\n①価格帯' };
  const task = base({ ...client, requirements, scope: { regions: ['日本'], ec: ['ZOZOTOWN'], sns: ['Instagram'], other: '', at: 'x' } });
  assert.equal(agentSeriesName(task), '2027SSレディースコレクション');
  const wording = agentWording(task);
  assert.deepEqual(wording.intakeSteps, ['顧客要件の整理と要件IDの付与', '要件確認フォームの提示と確認取得', 'リサーチ範囲確認フォームの提示と確認取得']);
  assert.equal(wording.supplement, '情報を補足する');
  assert.equal(wording.regionTitle, '調査地域（複数選択）');
  assert.deepEqual(wording.researchSteps(task.scope!), ['ZOZOTOWN・Instagramの双方からトレンド素材・商品エビデンスを取得・抽出する', '収集エビデンスに基づき市場判断・4方向と参照画像を検証し最終成果を作成する']);
  assert.equal(wording.researchDone, '調査が完了しました。結果をレポートに整理します。');
  assert.equal(wording.researchReport.title, '2027SSレディースコレクション 顧客要件調査・ビジュアル方向性レポート');
  assert.equal(wording.directionHint, '要件とスタイルの対応付けに用いる方向性を1つ以上選択してください');
  assert.equal(wording.structureReport.title, '2027SSレディースコレクション スタイルマッピング計画');
  // After 「AIデザイン修正の生成へ進む」 Light's 顧客提案 says AI改款, numbers styles S01…, and ends with the 正式顧客提案書.
  assert.equal(wording.proceedMessage(10), '');
  assert.deepEqual(wording.designSteps(10, 'D01'), ['10スタイルのAI改款イメージ生成(D01・確認済みマッピング範囲内)', '生成結果の検収(失敗・重複・不一致・範囲外の除外)', 'AI改款結果HTMLの生成・表示', '画像選択フォームの提示']);
  assert.equal(wording.designReport.title, '2027SSレディースコレクション AI改款結果');
  assert.equal(wording.pickTitle, '正式な顧客提案に使用するスタイル画像を選択');
  assert.equal(wording.pickButton, '顧客提案を生成');
  assert.deepEqual(agentWording({ ...task, styleChoice: { keys: ['S01', 'S02'], at: 'x' } }).finalSteps, ['最終提案書コンテンツの統合(要件・根拠・方向・選択済み2スタイル・訴求ポイント)', '正式提案書HTMLの生成・表示']);
  assert.deepEqual(wording.finalReport, { title: '2027SSレディースコレクション 正式顧客提案書', note: 'トレンドと要件の整合後に生成した提案内容' });
  const chosen = base({ ...task, rounds: [round], choice: { theme: 'x', themes: [directions[0]], at: 'x' } });
  assert.equal(agentChosenCodes(chosen), 'D01');
  assert.deepEqual(agentWording(chosen).structureSteps('D01'), ['確認方向(D01)に基づく要件→スタイル割付(10スタイル・作業デフォルト)の作成', 'マッピングHTMLの生成・表示', '継続確認フォームの提示']);
  assert.match(themePrompt(chosen), /対応する要件ID（例: 通勤実用性\(R03\)）/);
  const tasks = readFileSync(new URL('../src/features/agent/agentTasks.ts', import.meta.url), 'utf8');
  assert.match(tasks, /\['新商品企画', '顧客提案'\]/);
});

test('新商品企画 keeps Light\'s words for every step after the directions', () => {
  const task = base({ rounds: [round], choice: { theme: 'x', themes: [directions[0], directions[2]], at: 'x' } });
  const wording = agentWording(task);
  assert.equal(agentChosenCodes(task), 'D1・D3');
  assert.deepEqual(wording.structureSteps('D1'), ['確定方向（D1）に基づく商品構成案の作成（カテゴリ・数量・価格・ドロップ計画）', '商品構成レポート（HTML）の表示', '商品構成確認フォームの表示']);
  assert.deepEqual(wording.structureReport, { title: '商品構成計画', note: 'カテゴリー、型数、価格、投入時期、色、素材、シルエット、チャネル差' });
  assert.equal(wording.proceed, 'AIデザイン修正の生成へ進む');
  assert.equal(wording.proceedMessage(10), '商品構成が確定しました。続いて、確定した10スタイルのAIデザイン案を生成します。');
  assert.deepEqual(wording.designSteps(10, 'D1'), ['シリーズ共通言語と10スタイルの個別設計（型番・役割・差別化）', '10スタイルのAIデザイン画像生成', 'AIデザイン結果レポート（HTML）の表示', 'スタイル画像選択フォームの表示']);
  assert.equal(wording.pickTitle, '最終の新商品企画に使用するスタイル画像を選択');
  assert.equal(wording.pickHint, '今回のAIスタイル画像を1枚以上選択してください');
  assert.deepEqual(wording.finalSteps, ['調査・方向・商品構成・選択スタイルの統合と最終企画書の作成', '最終商品企画書（HTML）の表示']);
  assert.deepEqual(wording.finalReport, { title: '新商品企画書', note: 'トレンドと要件の整合後に生成した企画内容' });
  // Tasks that already made the older plan keep it; テーマ企画 never runs these steps.
  assert.equal(agentUsesMerchFlow(task), true);
  assert.equal(agentUsesMerchFlow({ ...task, plan: { requestId: 'p', state: 'completed' } }), false);
  assert.equal(agentUsesMerchFlow({ ...task, flow: undefined }), false);
});

test('directions carry an English product description for their reference picture, and each direction gets one image', () => {
  assert.deepEqual(parseAgentDirection(directions[0]), { name: 'リラックス・テーラリング（ドレープジャンプスーツ）', description: 'ドレープ素材のハイウエスト。', recommendation: '天猫で実績', imagePrompt: 'draped high-waist wide-leg jumpsuit in sand tencel' });
  assert.match(themePrompt(base({ research: { requestId: 'r', state: 'completed', content: '## a\n- b' } })), /代表的な商品1点の写真を作るための英語の短い説明/);
  const images = agentBuildDirectionImages(base(), directions, (() => { let n = 0; return () => `id-${++n}`; })());
  assert.deepEqual(images.map(image => [image.key, image.code, image.state, image.requestId]), [['d1', 'D1', 'pending', 'id-1'], ['d2', 'D2', 'pending', 'id-2'], ['d3', 'D3', 'pending', 'id-3'], ['d4', 'D4', 'pending', 'id-4']]);
  assert.equal(images[0].prompt, 'draped high-waist wide-leg jumpsuit in sand tencel');
  // A direction without the English part still gets a picture from its name and description.
  assert.equal(images[3].prompt, '長袖ベーシック. 重ね着の土台。');
  // The image service refuses "style" phrasing; every image prompt asks for one garment on a plain background.
  const prompt = agentStyleImagePrompt('a draped dress in a soft style');
  assert.doesNotMatch(prompt, /\bstyle\b/i);
  assert.match(prompt, /single garment only.*plain warm light-gray studio background.*no person/);
});

test('the 商品構成計画 reply is read into the report, and the report escapes what it shows', () => {
  const plan = parseAgentStructure(STRUCTURE);
  assert.equal(plan.styles.length, AGENT_STYLE_COUNT);
  assert.deepEqual(plan.categories[0], { name: 'ジャンプスーツ', count: '4', share: '40%', note: '中軸' });
  assert.deepEqual(plan.styles[0], { code: 'JS-01', name: 'ジャンプスーツ1', category: 'ジャンプスーツ', role: 'コア', drop: 'Drop1（2月）', price: '$148–178', elements: 'ハイウエスト', requirement: '' });
  assert.deepEqual(plan.colors[0], { name: 'オフホワイト', hex: '#F4F0E6' });
  assert.equal(plan.basics.find(entry => entry.label === 'シリーズ名')?.value, 'Soft Structure');
  const task = base({ rounds: [round], choice: { theme: 'x', themes: [directions[0]], at: 'x' }, structure: { requestId: 's', state: 'completed', content: STRUCTURE } });
  const html = buildAgentStructureHtml(task);
  assert.match(html, /MERCHANDISE STRUCTURE PLAN/);
  assert.match(html, /Soft Structure 商品構成計画/);
  assert.match(html, /<td>JS-01<\/td><td>ジャンプスーツ1<\/td>/);
  assert.doesNotMatch(html, /<b>サンド<\/b>/);
  assert.match(html, /&lt;b&gt;サンド&lt;\/b&gt;/);
});

test('the AI designs follow the structure in order, one prompt per style, and report progress category by category', () => {
  let n = 0;
  const task = base({ rounds: [round], choice: { theme: 'x', themes: [directions[0]], at: 'x' }, structure: { requestId: 's', state: 'completed', content: STRUCTURE },
    design: { requestId: 'd', state: 'completed', content: DESIGN } });
  assert.match(agentDesignPrompt(task), /- JS-01｜ジャンプスーツ1｜ジャンプスーツ｜コア｜ハイウエスト/);
  assert.equal(parseAgentDesign(DESIGN).styles['DR-02'].point, '差別化 DR-02');
  const images = agentBuildDesignImages(task, () => `img-${++n}`);
  assert.equal(images.length, 10);
  assert.deepEqual(images.map(image => image.key).slice(0, 5), ['JS-01', 'JS-02', 'JS-03', 'JS-04', 'DR-01']);
  assert.equal(images[0].prompt, 'a draped garment js-01 in a soft style, sand color');
  assert.ok(images.every(image => image.state === 'pending'));
  const done = (count: number) => images.map((image, index) => ({ ...image, state: index < count ? 'completed' as const : 'running' as const }));
  assert.deepEqual(agentDesignProgress(done(3)), []);
  assert.deepEqual(agentDesignProgress(done(4)), ['ジャンプスーツ4型の生成に成功しました。続いてワンピース3型を生成します。']);
  assert.deepEqual(agentDesignProgress(done(10)), ['ジャンプスーツ4型の生成に成功しました。続いてワンピース3型を生成します。', 'ワンピース3型の生成に成功しました。続いて長袖トップス3型を生成します。',
    '長袖トップス3型の生成に成功しました。', '全10スタイルの生成に成功しました。結果をHTMLレポートにまとめて表示します。']);
  const oneFailed = done(10).map((image, index) => (index === 9 ? { ...image, state: 'failed' as const } : image));
  assert.match(agentDesignProgress(oneFailed).at(-1)!, /10スタイル中9スタイルの生成に成功しました/);
  const html = buildAgentDesignHtml({ ...task, designs: done(10) }, { 'JS-01': 'https://img.example/a.png?x="1"' });
  assert.match(html, /src="https:\/\/img\.example\/a\.png\?x=&quot;1&quot;"/);
  assert.match(html, /JS-01 · ジャンプスーツ1/);
});

test('the final plan reads its title, document and summary, and its report shows only the chosen styles', () => {
  const content = ['[企画名]', '2027年春 北米レディース通勤 新商品企画', '[企画書]', '## テーマとコンセプト', '- Soft Structure', '## 商品構成', '- 全10型', '[要点]',
    '最終企画書をお届けしました。全工程完了しています。', 'テーマ：「Soft Structure」', '商品構成：全10型・2ドロップ'].join('\n');
  const parsed = parseAgentFinal(content);
  assert.equal(parsed.title, '2027年春 北米レディース通勤 新商品企画');
  assert.deepEqual(parsed.sections, [{ heading: 'テーマとコンセプト', items: ['Soft Structure'] }, { heading: '商品構成', items: ['全10型'] }]);
  assert.deepEqual(parsed.summary, ['最終企画書をお届けしました。全工程完了しています。', 'テーマ：「Soft Structure」', '商品構成：全10型・2ドロップ']);
  let n = 0;
  const task = base({ rounds: [round], choice: { theme: 'x', themes: [directions[0]], at: 'x' }, structure: { requestId: 's', state: 'completed', content: STRUCTURE },
    design: { requestId: 'd', state: 'completed', content: DESIGN }, final: { requestId: 'f', state: 'completed', content } });
  const designs = agentBuildDesignImages(task, () => `img-${++n}`).map(image => ({ ...image, state: 'completed' as const, storagePath: `p/${image.key}` }));
  const chosen = { ...task, designs, styleChoice: { keys: ['JS-01', 'DR-02'], at: 'x' } };
  assert.match(agentFinalPrompt(chosen), /選択したスタイル画像（AIデザイン）:\n- JS-01｜ジャンプスーツ1[^\n]*\n- DR-02｜ワンピース2[^\n]*\n(?!- )/);
  const html = buildAgentFinalHtml(chosen, { 'JS-01': 'https://img.example/1.png', 'JS-02': 'https://img.example/2.png' });
  assert.match(html, /NEW PRODUCT PLAN/);
  assert.match(html, /https:\/\/img\.example\/1\.png/);
  assert.doesNotMatch(html, /https:\/\/img\.example\/2\.png/);
});

test('every new request stays under the cap with the longest parts and twelve attachments', () => {
  const huge = 'あ'.repeat(20000);
  const attachments = Array.from({ length: 12 }, (_, index) => ({ id: `a${index}`, kind: index % 2 ? 'image' as const : 'file' as const, name: huge, size: 1, at: 'x', text: huge, imageId: `i${index}`, storagePath: `p${index}` }));
  const notes = Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, text: huge, at: 'x', stage: (['structure', 'designs', 'themes'] as const)[index % 3], reply: { requestId: `r${index}`, state: 'completed' as const, content: '[返答]\nok' } }));
  const hugeStructure = `${STRUCTURE}\n${huge}`;
  const task = base({ prompt: huge, profile: huge, attachments, notes, rounds: [{ ...round, themes: [huge, huge, huge, huge] }],
    requirements: { requestId: 'q', state: 'completed', content: `[要件]\n目標：${huge}` }, research: { requestId: 'r', state: 'completed', content: formatAgentResearchContent({ text: `## a\n- ${huge}`, sources: [], searchUsed: true, searchErrors: [] }) },
    choice: { theme: huge, themes: [huge, huge], at: 'x' }, structure: { requestId: 's', state: 'completed', content: hugeStructure }, design: { requestId: 'd', state: 'completed', content: `${DESIGN}\n${huge}` },
    styleChoice: { keys: ['JS-01', 'JS-02', 'JS-03'], at: 'x' } });
  const prompts = { structure: agentStructurePrompt(task), design: agentDesignPrompt(task), final: agentFinalPrompt(task), note: agentNotePrompt(task, { text: huge, stage: 'structure' }),
    requirements: agentRequirementsPrompt(task), client: agentRequirementsPrompt({ ...task, subtype: '顧客提案' }) };
  Object.entries(prompts).forEach(([name, prompt]) => assert.ok(prompt.length <= AGENT_PROMPT_BUDGET, `${name}: ${prompt.length}`));
  // Files are quoted within their budget; only the newest four images go along as references.
  assert.ok(agentAttachmentLines(task, 1800).join('\n').length <= 1800 + 400);
  assert.deepEqual(agentReferenceImages(task).map(ref => ref.imageId), ['i5', 'i7', 'i9', 'i11']);
  assert.deepEqual(agentReferenceImages(task).map(ref => ref.order), [0, 1, 2, 3]);
});

test('research sources keep the sentence they were cited for, and older two-column sources still read', () => {
  const content = formatAgentResearchContent({ text: '## a\n- b', sources: [{ title: 'ZOZO | 春', url: 'https://zozo.example/a', quote: '春は | リネンが\n伸びた' }, { title: 'B', url: 'https://b.example/' }], searchUsed: true, searchErrors: [] });
  assert.deepEqual(parseAgentResearch(content).sources, [{ title: 'ZOZO 春', url: 'https://zozo.example/a', quote: '春は リネンが 伸びた' }, { title: 'B', url: 'https://b.example/' }]);
  assert.deepEqual(parseAgentResearch('## a\n- b\n\n[出典]\n- Old | https://old.example/x\n\n[検索] ok').sources, [{ title: 'Old', url: 'https://old.example/x' }]);
});

test('the task page runs Light\'s steps after the directions with Heavy\'s own images and shows reports in a window', () => {
  const page = readFileSync(new URL('../src/pages/HeavyAgentTaskPage.tsx', import.meta.url), 'utf8');
  // Each request identity is stored before it is sent; images are marked sent first and use their request id as the idempotency key.
  assert.match(page, /if \(image\.state === 'pending'\) \{\n\s+await applyStyleImage\(image\.requestId, \(current\) => \(\{ \.\.\.current, state: 'running'/);
  assert.match(page, /idempotencyKey: image\.requestId, retainUntilAcknowledged: true/);
  assert.match(page, /if \(imageSlots\.current\.size >= 2\) break;/);
  assert.match(page, /const saved = await commit\(\(task\) => \(\{ \.\.\.task, structure: step \}\)\);\n\s+await runAssistant\('structure', step, agentStructurePrompt\(saved\.task\)/);
  assert.match(page, /note\.stage === 'structure' && note\.reply\.state === 'completed' && note\.at > structure\.at!/);
  // オンラインで表示 opens a window over the page with the report in a sandboxed frame (no scripts).
  assert.match(page, /<iframe title=\{report\.title\} srcDoc=\{report\.html\} sandbox="allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(page, /window\.open\(/);
  // 概要 lists only the results; 参考資料 (テーマ企画) shows the site and the cited sentence.
  for (const text of ['タスク成果物', '参考スタイル', 'スタイルを生成', 'すべて表示', 'data-testid="agent-style-picker"', 'data-testid="agent-design-images"', 'data-testid="agent-final-summary"', '企画の要点'])
    assert.ok(page.includes(text), text);
  assert.doesNotMatch(page, /<dt className="text-xs text-neutral-500">業務シーン<\/dt>/);
  assert.match(page, /\{source\.quote \? <SourceQuote text=\{source\.quote\} \/> : source\.title\}/);
  // Attached images go with every step as references, except the slides, which are written from the research's text only.
  assert.match(page, /const references = docRef\.current && kind !== 'report' \? agentReferenceImages\(docRef\.current\.task\) : \[\];/);
});
