/**
 * Light's planning steps after the directions (observed 2026-11-12 on 新商品企画 and 顧客提案): 商品構成計画 (顧客提案:
 * スタイルマッピング計画) → 「AIデザイン修正の生成へ進む」 → series language and per-style design → one AI image per style
 * → 「最終の…に使用するスタイル画像を選択」 → the final plan with its summary. Light's wording per scene, the prompts, the
 * reply parsers and the HTML deliverables. Pure: no runtime imports, so tests read it directly.
 */
import {
  agentImagePrompt, agentScopeLabel, effectiveAgentRequirements, parseAgentDirection, parseAgentRequirements, parseAgentResearch, parsePlanResponse,
  agentAttachmentLines, agentPaletteColors, agentRoundSources, agentSourceSite, parsePlanItemImages, type AgentResearchScope, type AgentStyleImage, type AgentTask,
} from './agentFlow.ts';
import type { AgentProduct } from './agentProducts.ts';

/** Light's 商品構成 defaults to 10 styles (「総スタイル数 10（規定値・変更可）」). */
export const AGENT_STYLE_COUNT = 10;
const isClient = (task: Pick<AgentTask, 'subtype'>) => task.subtype === '顧客提案';

/** The tasks that run Light's steps after the directions: conversation tasks that did not already make the older plan. */
export const agentUsesMerchFlow = (task: Pick<AgentTask, 'flow' | 'plan'>) => task.flow === 'conversation' && !task.plan;

/** 顧客提案 names the collection in its requirements (「シリーズ名：2027SSレディースコレクション」). */
export function agentSeriesName(task: AgentTask): string {
  const requirements = effectiveAgentRequirements(task);
  const line = requirements ? parseAgentRequirements(requirements).lines.find(entry => entry.label.replace(/\s/g, '') === 'シリーズ名') : undefined;
  const name = line?.value.replace(/[（(].*$/, '').trim() ?? '';
  return name && name !== '未指定' ? name.slice(0, 40) : '';
}

/** Light numbers the directions D1… (新商品企画) or D01… (顧客提案). */
export const agentDirectionCode = (task: Pick<AgentTask, 'subtype'>, index: number) => isClient(task) ? `D${String(index + 1).padStart(2, '0')}` : `D${index + 1}`;
export function agentChosenCodes(task: AgentTask): string {
  const round = [...task.rounds].reverse().find(entry => entry.step.state === 'completed' && entry.themes.length);
  const chosen = task.choice?.themes ?? [];
  const codes = round ? chosen.map(theme => round.themes.indexOf(theme)).filter(index => index >= 0).map(index => agentDirectionCode(task, index)) : [];
  return codes.length ? codes.join('・') : agentDirectionCode(task, 0);
}

export type AgentReportName = { title: string; note: string };
export type AgentWording = {
  supplement: string; regionTitle: string; intakeSteps: readonly string[]; researchSteps: (scope: Pick<AgentResearchScope, 'regions' | 'ec' | 'sns'>) => string[];
  researchDone: string; researchReport: AgentReportName; directionHint: string;
  structureSteps: (codes: string) => string[]; structureReport: AgentReportName; proceed: string; proceedMessage: (count: number) => string;
  designSteps: (count: number, codes: string) => string[]; designReport: AgentReportName; pickTitle: string; pickHint: string; pickButton: string;
  finalSteps: string[]; finalReport: AgentReportName;
};
const NEW_PRODUCT_INTAKE = [
  '入力内容（市場・ターゲット・カテゴリ・シーズン・スタイル方向）の確認と要件整理',
  '要件理解サマリーの提示と確認フォーム（要件アライメント）の表示',
  '調査範囲フォーム（リサーチスコープ）の表示',
] as const;
const CLIENT_INTAKE = ['顧客要件の整理と要件IDの付与', '要件確認フォームの提示と確認取得', 'リサーチ範囲確認フォームの提示と確認取得'] as const;
const REPORT_EVIDENCE_NOTE = '確認待ちの複数方向 · 情報源別のエビデンス充足度とデータ不足';
const STRUCTURE_NOTE = 'カテゴリー、型数、価格、投入時期、色、素材、シルエット、チャネル差';

/** Light's words per scene (its 新商品企画 and 顧客提案 tasks, 2026-11-12). Light's leftover Chinese subtitles are written in Japanese. */
export function agentWording(task: AgentTask): AgentWording {
  const client = isClient(task);
  const series = client ? agentSeriesName(task) : '';
  const named = (title: string) => (series ? `${series} ${title}` : title);
  return {
    supplement: client ? '情報を補足する' : '条件を補足する',
    regionTitle: client ? '調査地域（複数選択）' : '地域（複数選択）',
    intakeSteps: client ? CLIENT_INTAKE : NEW_PRODUCT_INTAKE,
    researchSteps: (scope) => {
      if (!client) {
        const regions = scope.regions.map(agentScopeLabel).join('・');
        const platforms = [...scope.ec, ...scope.sns].join('・');
        return [`調査要件の組み立てと市場調査の実施（${regions}${platforms ? `／${platforms}` : ''}）`, '調査結果の整理とリサーチ・ビジュアル方向レポート（HTML）の表示', 'デザイン方向選択フォームの表示'];
      }
      const platforms = [...scope.ec, ...scope.sns].map(agentScopeLabel);
      const from = platforms.length === 2 ? `${platforms.join('・')}の双方から` : platforms.length ? `${platforms.join('・')}から` : '';
      return [`${from}トレンド素材・商品エビデンスを取得・抽出する`, '収集エビデンスに基づき市場判断・4方向と参照画像を検証し最終成果を作成する'];
    },
    researchDone: client ? '調査が完了しました。結果をレポートに整理します。' : '調査が完了しました。続いて調査結果をHTMLレポートに整理して表示します。',
    researchReport: { title: client ? named('顧客要件調査・ビジュアル方向性レポート') : '調査とビジュアル方向', note: REPORT_EVIDENCE_NOTE },
    directionHint: client ? '要件とスタイルの対応付けに用いる方向性を1つ以上選択してください' : '商品構成計画に進む方向性を1つ以上選択してください',
    structureSteps: (codes) => client
      ? [`確認方向(${codes})に基づく要件→スタイル割付(${AGENT_STYLE_COUNT}スタイル・作業デフォルト)の作成`, 'マッピングHTMLの生成・表示', '継続確認フォームの提示']
      : [`確定方向（${codes}）に基づく商品構成案の作成（カテゴリ・数量・価格・ドロップ計画）`, '商品構成レポート（HTML）の表示', '商品構成確認フォームの表示'],
    structureReport: { title: client ? named('スタイルマッピング計画') : '商品構成計画', note: STRUCTURE_NOTE },
    proceed: 'AIデザイン修正の生成へ進む',
    // 顧客提案 goes straight from the button to its steps (no confirmation line), 2026-11-12.
    proceedMessage: (count) => client ? '' : `商品構成が確定しました。続いて、確定した${count}スタイルのAIデザイン案を生成します。`,
    designSteps: (count, codes) => client
      ? [`${count}スタイルのAI改款イメージ生成(${codes}・確認済みマッピング範囲内)`, '生成結果の検収(失敗・重複・不一致・範囲外の除外)', 'AI改款結果HTMLの生成・表示', '画像選択フォームの提示']
      : [`シリーズ共通言語と${count}スタイルの個別設計（型番・役割・差別化）`, `${count}スタイルのAIデザイン画像生成`, 'AIデザイン結果レポート（HTML）の表示', 'スタイル画像選択フォームの表示'],
    designReport: client ? { title: named('AI改款結果'), note: '' } : { title: 'AIデザイン結果', note: '専門的な服装プロンプトの整合性チェック済み · AIコンセプト表現' },
    pickTitle: client ? '正式な顧客提案に使用するスタイル画像を選択' : '最終の新商品企画に使用するスタイル画像を選択',
    pickHint: '今回のAIスタイル画像を1枚以上選択してください',
    pickButton: client ? '顧客提案を生成' : '企画を生成',
    finalSteps: client
      ? [`最終提案書コンテンツの統合(要件・根拠・方向・選択済み${task.styleChoice?.keys.length ?? AGENT_STYLE_COUNT}スタイル・訴求ポイント)`, '正式提案書HTMLの生成・表示']
      : ['調査・方向・商品構成・選択スタイルの統合と最終企画書の作成', '最終商品企画書（HTML）の表示'],
    finalReport: client ? { title: named('正式顧客提案書'), note: 'トレンドと要件の整合後に生成した提案内容' } : { title: '新商品企画書', note: 'トレンドと要件の整合後に生成した企画内容' },
  };
}

// ---------------------------------------------------------------------------
// Replies come back as [ブロック] sections; rows inside them are 「- a｜b｜c」.
export function parseAgentBlocks(content: string): Record<string, string[]> {
  const blocks: Record<string, string[]> = {};
  let current = '';
  for (const raw of content.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const header = /^(?:\[([^\]]{1,20})\]|【([^】]{1,20})】)\s*(.*)$/.exec(line);
    if (header) { current = (header[1] ?? header[2]).trim(); blocks[current] = blocks[current] ?? []; if (header[3]) blocks[current].push(header[3]); continue; }
    if (current && line) blocks[current].push(line);
  }
  return blocks;
}
const rows = (lines: string[] = []) => lines.filter(line => /^[-・*]\s*/.test(line)).map(line => line.replace(/^[-・*]\s*/, '').replace(/\*\*/g, '').split('｜').map(cell => cell.trim()));
const plain = (lines: string[] = []) => lines.map(line => line.replace(/^[-・*]\s*/, '').replace(/\*\*/g, '').trim()).filter(Boolean);
const labelled = (lines: string[] = []) => plain(lines).map(line => { const match = /^([^：:]{1,16})[：:]\s*(.*)$/.exec(line); return match ? { label: match[1].trim(), value: match[2].trim() } : { label: '', value: line }; });

export type AgentStructureStyle = { code: string; name: string; category: string; role: string; drop: string; price: string; elements: string; requirement: string };
export type ParsedAgentStructure = {
  summary: string; basics: Array<{ label: string; value: string }>; categories: Array<{ name: string; count: string; share: string; note: string }>;
  styles: AgentStructureStyle[]; drops: Array<{ name: string; codes: string; note: string }>; prices: Array<{ tier: string; range: string; codes: string; intent: string }>;
  colors: Array<{ name: string; hex: string }>; colorNote: string; materials: Array<{ target: string; text: string }>; language: Array<{ item: string; rule: string }>;
  mapping: Array<{ element: string; reflection: string; evidence: string }>; risks: string[]; open: string[];
};
export function parseAgentStructure(content: string): ParsedAgentStructure {
  const blocks = parseAgentBlocks(content);
  const hex = (value: string) => (/#[0-9a-f]{6}\b/i.exec(value)?.[0] ?? '');
  return {
    summary: plain(blocks['概要']).join(''),
    basics: labelled(blocks['基本']),
    categories: rows(blocks['カテゴリ']).map(([name = '', count = '', share = '', ...note]) => ({ name, count, share, note: note.join(' ') })),
    styles: rows(blocks['スタイル']).filter(cells => cells.length >= 3).slice(0, 20)
      .map(([code = '', name = '', category = '', role = '', drop = '', price = '', elements = '', requirement = '']) => ({ code, name, category, role, drop, price, elements, requirement })),
    drops: rows(blocks['ドロップ']).map(([name = '', codes = '', ...note]) => ({ name, codes, note: note.join(' ') })),
    prices: rows(blocks['価格']).map(([tier = '', range = '', codes = '', ...intent]) => ({ tier, range, codes, intent: intent.join(' ') })),
    colors: rows(blocks['カラー']).map(([name = '', value = '']) => ({ name, hex: hex(value) || hex(name) })).filter(color => color.name),
    colorNote: plain(blocks['カラーの根拠']).join(''),
    materials: rows(blocks['素材']).map(([target = '', ...text]) => (text.length ? { target, text: text.join(' ') } : { target: '', text: target })),
    language: rows(blocks['デザイン言語']).map(([item = '', ...rule]) => (rule.length ? { item, rule: rule.join(' ') } : { item: '', rule: item })),
    mapping: rows(blocks['マッピング']).map(([element = '', reflection = '', ...evidence]) => ({ element, reflection, evidence: evidence.join(' ') })),
    risks: plain(blocks['リスク']),
    open: plain(blocks['未決事項']),
  };
}

const contextFor = (task: AgentTask) => [
  `業務シーン: ${task.scene}（${task.subtype}）。`,
  task.profile ? `会社・ブランドの業務プリファレンス: ${task.profile.slice(0, 800)}` : '',
  `依頼: ${task.prompt.slice(0, 1600)}`,
  ...agentAttachmentLines(task, 1500),
];
const notesFor = (task: AgentTask, stages: string[]) => {
  const notes = (task.notes ?? []).filter(note => stages.includes(note.stage)).map(note => `- ${note.text}`);
  return notes.length ? [`ユーザーが追加した条件・修正の依頼:\n${notes.join('\n').slice(0, 1500)}`] : [];
};
const chosenDirections = (task: AgentTask, max = 2000) => (task.choice?.themes ?? [task.choice?.theme ?? '']).filter(Boolean)
  .map(theme => { const direction = parseAgentDirection(theme); return `- ${direction.name}：${direction.description} ${direction.recommendation}`.trim(); }).join('\n').slice(0, max);
const researchExcerpt = (task: AgentTask, max: number) => task.research?.state === 'completed' && task.research.content ? `ウェブ調査の結果（抜粋）:\n${parseAgentResearch(task.research.content).report.slice(0, max)}` : '';

/** 商品構成計画 (顧客提案: 要件→スタイル割付). Every row is short and cut by 「｜」 so Heavy can lay it out like Light's report. */
export function agentStructurePrompt(task: AgentTask): string {
  const client = isClient(task);
  const requirements = effectiveAgentRequirements(task);
  return [
    ...contextFor(task),
    requirements ? `確認済みの要件:\n${requirements.slice(0, 2000)}` : '',
    researchExcerpt(task, 2500),
    `確定方向（${agentChosenCodes(task)}）:\n${chosenDirections(task)}`,
    ...notesFor(task, ['requirements', 'scope', 'research', 'themes', 'structure']),
    client
      ? `この方向で、要件→スタイル割付（スタイルマッピング計画、総スタイル数${AGENT_STYLE_COUNT}・作業デフォルト）を作成してください。各スタイルがどの要件IDに応えるかを示してください。`
      : `この方向で、総スタイル数${AGENT_STYLE_COUNT}（規定値）の商品構成計画を作成してください。`,
    '次の形式だけで、日本語で答えてください。各行は短く、区切りは全角の「｜」。数字（型数・シェア・価格）は調査の根拠に沿った目安とし、推定であることは[未決事項]に書く。',
    '[概要]', '計画の要点を2〜3文。',
    '[基本]', 'シリーズ名：…', '確定方向：…', `総スタイル数：${AGENT_STYLE_COUNT}（規定値・変更可）`, '投入計画：…（例: 2ドロップ（2月／4月））', '市場・ターゲット：…',
    '[カテゴリ]', '- カテゴリ名｜型数｜シェア（%）｜役割を1文',
    '[スタイル]', `- 型番（例 JS-01）｜スタイル名｜カテゴリ｜役割（アイコン／コア／エントリー）｜ドロップ｜想定価格帯｜主要デザイン要素${client ? '｜対応する要件ID' : ''}`,
    client ? `（ちょうど${AGENT_STYLE_COUNT}行。型番は S01 から順に）` : `（ちょうど${AGENT_STYLE_COUNT}行。型番はカテゴリの英字2文字＋番号）`,
    '[ドロップ]', '- ドロップ名（時期）｜型番を「、」区切り｜狙いを1文',
    '[価格]', '- 価格層｜レンジ｜対象の型番｜設計意図',
    '[カラー]', '- 色名｜#RRGGBB（全型共通の6色前後）',
    '[カラーの根拠]', '1〜2文。',
    '[素材]', '- 対象｜素材と理由',
    '[デザイン言語]', '- シルエット｜…', '- ディテール｜…', '- 機能｜…', '- コーディネート｜…',
    '[マッピング]', client ? '- 要件ID と要件｜対応するスタイル（型番）｜反映の仕方' : '- 方向の要素｜構成への反映｜根拠（調査の事実）',
    '[リスク]', '- …',
    '[未決事項]', '- …',
  ].filter(Boolean).join('\n');
}

export type ParsedAgentDesign = { language: string; styles: Record<string, { point: string; prompt: string }> };
/** 「シリーズ共通言語と10スタイルの個別設計」: one English garment description per style for its AI image. */
export function agentDesignPrompt(task: AgentTask): string {
  const structure = task.structure?.content ? parseAgentStructure(task.structure.content) : null;
  const styles = structure?.styles ?? [];
  return [
    `業務シーン: ${task.scene}（${task.subtype}）。依頼: ${task.prompt.slice(0, 800)}`,
    `確定方向（${agentChosenCodes(task)}）:\n${chosenDirections(task)}`,
    structure?.language.length ? `デザイン言語:\n${structure.language.map(entry => `- ${entry.item}：${entry.rule}`).join('\n').slice(0, 1200)}` : '',
    structure?.colors.length ? `カラーパレット: ${structure.colors.map(color => `${color.name}${color.hex ? `(${color.hex})` : ''}`).join('、')}` : '',
    structure?.materials.length ? `推奨素材:\n${structure.materials.map(entry => `- ${entry.target}：${entry.text}`).join('\n').slice(0, 800)}` : '',
    `確定したスタイル:\n${styles.map(style => `- ${style.code}｜${style.name}｜${style.category}｜${style.role}｜${style.elements}`).join('\n').slice(0, 2500)}`,
    ...notesFor(task, ['structure']),
    '各スタイルのAIデザイン画像を作るための設計を書いてください。次の形式だけで答えてください。',
    '[シリーズ共通言語]', '2〜3文（シリーズ全体のシルエット・色・素材・ディテールの統一ルール）。',
    '[スタイル設計]',
    '- 型番｜差別化のポイントを1文（日本語）｜English image prompt for this one garment: garment type, silhouette, length, neckline, sleeves, closures, details, fabric and its drape, one exact color from the palette (40-70 words; no person, no brand names, no word "style")',
    `（型番は上の確定したスタイルと同じものを同じ順でちょうど${styles.length || AGENT_STYLE_COUNT}行）`,
  ].filter(Boolean).join('\n');
}
export function parseAgentDesign(content: string): ParsedAgentDesign {
  const blocks = parseAgentBlocks(content);
  const styles: ParsedAgentDesign['styles'] = {};
  for (const [code = '', point = '', ...prompt] of rows(blocks['スタイル設計'])) if (code) styles[code] = { point, prompt: prompt.join(' ') };
  return { language: plain(blocks['シリーズ共通言語']).join(''), styles };
}

/** Heavy's image service gets a plain product photo of one garment, like Light's AI design results. */
export function agentStyleImagePrompt(prompt: string): string {
  return `${agentImagePrompt(prompt)}. Product photo of this single garment only, front view, centered, on an invisible mannequin, plain warm light-gray studio background, soft even lighting, no person, no text, no logo.`.replace(/\.\.\s/g, '. ');
}
/** The style images to generate, in the structure's order (Light generates category by category). */
export function agentBuildDesignImages(task: AgentTask, newId: () => string): AgentStyleImage[] {
  const structure = task.structure?.content ? parseAgentStructure(task.structure.content) : null;
  const design = task.design?.content ? parseAgentDesign(task.design.content) : { language: '', styles: {} as ParsedAgentDesign['styles'] };
  return (structure?.styles ?? []).slice(0, AGENT_STYLE_COUNT * 2).map((style, index) => {
    const planned = design.styles[style.code]?.prompt;
    const prompt = planned || `${style.category} ${style.name}. ${style.elements}`;
    return { key: style.code || `S${index + 1}`, code: style.code || `S${index + 1}`, name: style.name, category: style.category, prompt: prompt.slice(0, 700), requestId: newId(), state: 'pending' as const };
  });
}
/**
 * One reference product image per direction (参考スタイル), from the direction's English description. With real products
 * (Yahoo!ショッピング, plans of the Japanese market: `found[i]` for the i-th direction) the direction shows its first product
 * instead, as Light shows real products; a direction without one is generated as before.
 */
export function agentBuildDirectionImages(task: AgentTask, themes: string[], newId: () => string, found: Array<{ products: AgentProduct[] } | undefined> = []): AgentStyleImage[] {
  return themes.map((theme, index) => {
    const direction = parseAgentDirection(theme);
    const base = { key: `d${index + 1}`, code: agentDirectionCode(task, index), name: direction.name, category: '', requestId: newId(),
      prompt: (direction.imagePrompt || `${direction.name}. ${direction.description}`).slice(0, 700) };
    const product = found[index]?.products[0];
    return product ? { ...base, state: 'completed' as const, product, at: new Date().toISOString() } : { ...base, state: 'pending' as const };
  });
}
export const agentImageLabel = (image: Pick<AgentStyleImage, 'code' | 'name'>) => `${image.code} · ${image.name}`;
/**
 * テーマ企画's main items, one design picture each (Heavy's own continuation: Light's テーマ企画 cannot be run past the themes
 * on this account, and its 新商品企画 draws one picture per style). Codes I1… so they never meet a style code.
 */
export function agentBuildPlanItemImages(task: AgentTask, newId: () => string): AgentStyleImage[] {
  const items = task.plan?.state === 'completed' && task.plan.content ? parsePlanItemImages(task.plan.content) : [];
  return items.map((item, index) => ({ key: `I${index + 1}`, code: `I${index + 1}`, name: item.name, category: '', prompt: item.prompt.slice(0, 700), requestId: newId(), state: 'pending' as const }));
}

/** Light reports progress category by category: 「ジャンプスーツ4型の生成に成功しました。続いてワンピース3型を生成します。」 */
export function agentDesignProgress(images: AgentStyleImage[]): string[] {
  const groups: Array<{ category: string; items: AgentStyleImage[] }> = [];
  for (const image of images) {
    const group = groups.find(entry => entry.category === image.category);
    if (group) group.items.push(image); else groups.push({ category: image.category, items: [image] });
  }
  const settled = (image: AgentStyleImage) => image.state === 'completed' || image.state === 'failed' || image.state === 'unknown';
  const messages: string[] = [];
  for (const [index, group] of groups.entries()) {
    if (!group.items.every(settled)) break;
    const failed = group.items.filter(image => image.state !== 'completed').length;
    const next = groups[index + 1];
    const label = group.category || 'スタイル';
    const head = failed ? `${label}${group.items.length}型のうち${failed}型の生成に失敗しました。` : `${label}${group.items.length}型の生成に成功しました。`;
    messages.push(next ? `${head}続いて${next.category || 'スタイル'}${next.items.length}型を生成します。` : head);
  }
  if (images.length && images.every(settled)) {
    const failed = images.filter(image => image.state !== 'completed').length;
    messages.push(failed ? `${images.length}スタイル中${images.length - failed}スタイルの生成に成功しました。失敗した画像は再生成できます。` : `全${images.length}スタイルの生成に成功しました。結果をHTMLレポートにまとめて表示します。`);
  }
  return messages;
}

export type ParsedAgentFinal = { title: string | null; sections: Array<{ heading: string; items: string[] }>; summary: string[] };
/** The final plan: the document (「## 」 headings, 「- 」 bullets) and the chat summary under 「企画の要点」. */
export function agentFinalPrompt(task: AgentTask): string {
  const client = isClient(task);
  const requirements = effectiveAgentRequirements(task);
  const chosen = new Set(task.styleChoice?.keys ?? []);
  const design = task.design?.content ? parseAgentDesign(task.design.content) : null;
  const structure = task.structure?.content ? parseAgentStructure(task.structure.content) : null;
  const selected = (structure?.styles ?? []).filter(style => chosen.has(style.code))
    .map(style => `- ${style.code}｜${style.name}｜${style.category}｜${style.role}｜${style.price}｜${style.elements}${design?.styles[style.code]?.point ? `｜${design.styles[style.code].point}` : ''}`);
  return [
    ...contextFor(task),
    requirements ? `確認済みの要件:\n${requirements.slice(0, 1400)}` : '',
    researchExcerpt(task, 1500),
    `確定方向（${agentChosenCodes(task)}）:\n${chosenDirections(task, 1200)}`,
    task.structure?.content ? `${client ? 'スタイルマッピング計画' : '商品構成計画'}:\n${task.structure.content.slice(0, 3000)}` : '',
    design?.language ? `シリーズ共通言語: ${design.language.slice(0, 500)}` : '',
    selected.length ? `選択したスタイル画像（AIデザイン）:\n${selected.join('\n').slice(0, 1500)}` : '',
    ...notesFor(task, ['structure', 'designs']),
    client ? '調査・方向・スタイル割付・選択スタイルを統合し、クライアントとの商談に使える最終の顧客提案書を作成してください。' : '調査・方向・商品構成・選択スタイルを統合し、最終の新商品企画書を作成してください。',
    '次の形式だけで、日本語で答えてください。',
    '[企画名]', '1行（例: 2027年春 北米レディース通勤ウェア 新商品企画）',
    '[企画書]',
    `「## 」の見出しと「- 」の箇条書きで、次の見出しを順に書く: ${client ? '「## ブランドの位置づけ」' : ''}「## テーマとコンセプト」「## 市場機会と根拠」「## 商品構成」「## 重点アイテム」「## カラーパレット」「## 推奨素材」「## デザイン要素」「## コーディネート」「## 販売上の訴求ポイント」「## リスクと検証ニーズ」「## 次のアクション」。`,
    '[要点]',
    `チャットに表示する報告。1行目は「最終${client ? '提案書' : '企画書'}をお届けしました。」で始め、全工程が完了したことを1文で。続けて「テーマ：…」「商品構成：…」「カラーパレット：…」「推奨素材：…」「エビデンスの根拠：…」「正直な開示：…」の行（各1〜2文、調査の件数や推定の範囲を正直に）、最後に次の推奨アクションを1文。Markdownの記号は使わない。`,
  ].filter(Boolean).join('\n');
}
export function parseAgentFinal(content: string): ParsedAgentFinal {
  const text = content.replace(/\r/g, '');
  const titleMatch = /(?:\[企画名\]|【企画名】)\s*\n?\s*([^\n]+)/.exec(text);
  const docAt = text.search(/\[企画書\]|【企画書】/);
  const summaryAt = text.search(/\[要点\]|【要点】/);
  const doc = docAt >= 0 ? text.slice(docAt, summaryAt > docAt ? summaryAt : undefined).replace(/^(\[企画書\]|【企画書】)/, '')
    : (summaryAt >= 0 ? text.slice(0, summaryAt) : text).replace(/(\[企画名\]|【企画名】)[^\n]*\n?[^\n]*/, '');
  const summary = summaryAt >= 0 ? text.slice(summaryAt).replace(/^(\[要点\]|【要点】)/, '').split('\n').map(line => line.replace(/^[-・*#]+\s*/, '').replace(/\*\*/g, '').trim()).filter(Boolean) : [];
  const plan = parsePlanResponse(doc);
  return { title: titleMatch?.[1].trim().slice(0, 60) ?? plan.title, sections: plan.sections, summary };
}

// ---------------------------------------------------------------------------
// The deliverables (オンラインで表示 / ダウンロード): standalone HTML, every value escaped, laid out like Light's paper reports.
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const REPORT_STYLE = `:root{color-scheme:light;--paper:#f6f1e8;--card:#fffdf8;--ink:#2b2622;--muted:#776c62;--line:#e4d9c8;--accent:#8a6d4b}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.75 "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif}
main{max-width:980px;margin:0 auto;padding:48px 20px 72px}header{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:8px}
.eyebrow{font:600 12px/1.4 system-ui,-apple-system,"Hiragino Sans",sans-serif;letter-spacing:.18em;color:var(--accent);text-transform:uppercase;margin:0 0 8px}
h1{font-size:30px;line-height:1.35;margin:0 0 12px}h2{font-size:20px;margin:0 0 4px}h3{font-size:16px;margin:0 0 6px}.lead{margin:0;color:var(--ink)}
section{padding:28px 0;border-bottom:1px solid var(--line)}.num{font:600 12px/1.4 system-ui,-apple-system,sans-serif;letter-spacing:.14em;color:var(--accent);margin:0 0 6px}
.muted{color:var(--muted)}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:18px}
.fact,.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.fact b{display:block;font-size:12px;color:var(--muted);font-weight:500}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:14px}.big{font-size:28px;font-weight:700;color:var(--accent)}
table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px;background:var(--card)}th,td{border:1px solid var(--line);padding:7px 9px;text-align:left;vertical-align:top}th{background:#efe6d6;font-weight:600}
.swatches{display:flex;flex-wrap:wrap;gap:12px;margin-top:14px}.swatch{width:110px}.swatch i{display:block;height:64px;border-radius:8px;border:1px solid var(--line)}.swatch span{display:block;font-size:12px;margin-top:4px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-top:14px}.grid figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.grid img{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;background:#ece6dc}.grid figcaption{padding:8px 10px;font-size:12px}ul{padding-left:20px;margin:8px 0}
.quote{margin-top:16px;font-size:16px;color:var(--accent)}@media (max-width:640px){h1{font-size:24px}main{padding:32px 16px 56px}}`;
function shell(title: string, eyebrow: string, heading: string, lead: string, body: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${REPORT_STYLE}</style></head>
<body><main><header><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(heading)}</h1>${lead ? `<p class="lead">${escapeHtml(lead)}</p>` : ''}</header>${body}</main></body></html>`;
}
const section = (num: string, label: string, title: string, inner: string) => `<section><p class="num">${escapeHtml(num)} — ${escapeHtml(label)}</p><h2>${escapeHtml(title)}</h2>${inner}</section>`;
const table = (head: string[], body: string[][]) => body.length ? `<table><thead><tr>${head.map(cell => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${body.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
const list = (items: string[]) => items.length ? `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
const swatches = (colors: ParsedAgentStructure['colors']) => colors.length ? `<div class="swatches">${colors.map(color => `<div class="swatch"><i style="background:${/^#[0-9a-f]{6}$/i.test(color.hex) ? color.hex : '#ddd'}"></i><span>${escapeHtml(color.name)}${color.hex ? ` ${escapeHtml(color.hex)}` : ''}</span></div>`).join('')}</div>` : '';

export function buildAgentStructureHtml(task: AgentTask): string {
  const wording = agentWording(task);
  const plan = task.structure?.content ? parseAgentStructure(task.structure.content) : null;
  if (!plan) return shell(wording.structureReport.title, 'MERCHANDISE STRUCTURE PLAN', wording.structureReport.title, '', '');
  const client = isClient(task);
  const series = plan.basics.find(entry => entry.label === 'シリーズ名')?.value ?? '';
  const body = [
    plan.basics.length ? `<div class="facts">${plan.basics.map(entry => `<div class="fact"><b>${escapeHtml(entry.label)}</b>${escapeHtml(entry.value)}</div>`).join('')}</div>` : '',
    section('01', 'STRUCTURE OVERVIEW', client ? 'カテゴリ構成・型数と要件→スタイル割付' : 'カテゴリ構成・数量・シェアと商品マトリクス',
      `<div class="cards">${plan.categories.map(entry => `<div class="card"><div class="big">${escapeHtml(entry.count)}</div><h3>${escapeHtml(entry.name)} ${escapeHtml(entry.share)}</h3><p class="muted">${escapeHtml(entry.note)}</p></div>`).join('')}</div>`
      + table(['型番', 'スタイル名', 'カテゴリ', '役割', 'ドロップ', '想定価格帯', '主要デザイン要素', ...(client ? ['対応する要件'] : [])],
        plan.styles.map(style => [style.code, style.name, style.category, style.role, style.drop, style.price, style.elements, ...(client ? [style.requirement] : [])]))),
    section('02', 'DROPS & PRICE ARCHITECTURE', '投入計画と価格アーキテクチャ',
      `<div class="cards">${plan.drops.map(drop => `<div class="card"><h3>${escapeHtml(drop.name)}</h3><p>${escapeHtml(drop.codes)}</p><p class="muted">${escapeHtml(drop.note)}</p></div>`).join('')}</div>`
      + table(['価格層', 'レンジ', '対象スタイル', '設計意図'], plan.prices.map(price => [price.tier, price.range, price.codes, price.intent]))),
    section('03', 'COLOR / MATERIAL / DESIGN LANGUAGE', 'カラーパレット・推奨素材・共通デザイン言語',
      swatches(plan.colors) + (plan.colorNote ? `<p class="muted">根拠：${escapeHtml(plan.colorNote)}</p>` : '')
      + (plan.materials.length ? `<h3 style="margin-top:18px">推奨素材</h3>${list(plan.materials.map(entry => (entry.target ? `${entry.target}：${entry.text}` : entry.text)))}` : '')
      + table(['項目', 'ルール'], plan.language.map(entry => [entry.item, entry.rule]))),
    section('04', 'DIRECTION MAPPING & RISKS', client ? '要件マッピング・リスク・未決事項' : '方向マッピング・根拠とリスク・未決事項',
      table(client ? ['要件', '対応するスタイル', '反映の仕方'] : ['方向の要素', '構成への反映', 'エビデンス'], plan.mapping.map(entry => [entry.element, entry.reflection, entry.evidence]))
      + (plan.risks.length ? `<h3 style="margin-top:18px">リスク</h3>${list(plan.risks)}` : '')
      + (plan.open.length ? `<h3 style="margin-top:18px">前提と未決事項</h3>${list(plan.open)}` : '')),
  ].join('');
  return shell(wording.structureReport.title, client ? 'STYLE MAPPING PLAN' : 'MERCHANDISE STRUCTURE PLAN', series ? `${series} ${client ? 'スタイルマッピング計画' : '商品構成計画'}` : wording.structureReport.title, plan.summary, body);
}

/** `urls`: the signed address of each style image by key (an image that is not available shows its name only). */
export function buildAgentDesignHtml(task: AgentTask, urls: Record<string, string>): string {
  const wording = agentWording(task);
  const design = task.design?.content ? parseAgentDesign(task.design.content) : null;
  const images = task.designs ?? [];
  const body = section('01', 'AI DESIGN RESULTS', `${images.length}スタイルのAIデザイン案`,
    (design?.language ? `<p>${escapeHtml(design.language)}</p>` : '')
    + `<div class="grid">${images.map(image => `<figure>${urls[image.key] ? `<img src="${escapeHtml(urls[image.key])}" alt="${escapeHtml(agentImageLabel(image))}">` : ''}<figcaption><b>${escapeHtml(agentImageLabel(image))}</b><br><span class="muted">${escapeHtml(design?.styles[image.code]?.point ?? image.category)}</span></figcaption></figure>`).join('')}</div>`
    + '<p class="muted">AI画像はデザインの参考案であり、生産仕様の事実ではありません。</p>');
  return shell(wording.designReport.title, 'AI DESIGN', wording.designReport.title, wording.designReport.note, body);
}

/**
 * テーマ企画書 (Heavy's own deliverable after the plan): the plan, its colors as swatches, the mood board, the main items'
 * designs and 参考資料 on one page to show or download. `visual`: the mood board's signed address; `urls`: the items' by key.
 */
export function buildAgentThemePlanHtml(task: AgentTask, title: string, visual: string | null, urls: Record<string, string>): string {
  const plan = task.plan?.state === 'completed' && task.plan.content ? parsePlanResponse(task.plan.content) : null;
  const theme = task.choice?.theme ?? '';
  if (!plan) return shell('テーマ企画書', 'THEME PLAN', title, theme, '');
  const items = (task.designs ?? []).filter(image => image.code.startsWith('I'));
  const sections = plan.sections.map((entry, index) => {
    const colors = /カラー/.test(entry.heading) ? entry.items.flatMap(agentPaletteColors) : [];
    const pictures = /主力アイテム/.test(entry.heading) && items.some(image => urls[image.key])
      ? `<div class="grid">${items.filter(image => urls[image.key]).map(image => `<figure><img src="${escapeHtml(urls[image.key])}" alt="${escapeHtml(image.name)}"><figcaption>${escapeHtml(image.name)}</figcaption></figure>`).join('')}</div>` : '';
    return section(String(index + 1).padStart(2, '0'), 'PLAN', entry.heading, swatches(colors) + list(entry.items) + pictures);
  });
  const next = plan.sections.length + 1;
  const board = visual ? section(String(next).padStart(2, '0'), 'MOOD BOARD', '企画ビジュアル', `<div class="grid" style="grid-template-columns:1fr"><figure><img src="${escapeHtml(visual)}" alt="企画ビジュアル" style="aspect-ratio:auto"></figure></div>`) : '';
  const sources = agentRoundSources(task)?.sources ?? [];
  const references = sources.length ? section(String(next + (visual ? 1 : 0)).padStart(2, '0'), 'REFERENCES', '参考資料',
    table(['サイト', '内容'], sources.map(source => [agentSourceSite(source.url), (source.quote ?? source.title).replace(/\*\*/g, '')]))) : '';
  return shell('テーマ企画書', 'THEME PLAN', plan.title ?? title, theme ? `採用テーマ：${theme}` : '', sections.join('') + board + references
    + '<section><p class="muted">AI画像はデザインの参考案であり、生産仕様の事実ではありません。</p></section>');
}

export function buildAgentFinalHtml(task: AgentTask, urls: Record<string, string>): string {
  const wording = agentWording(task);
  const final = task.final?.content ? parseAgentFinal(task.final.content) : null;
  const chosen = new Set(task.styleChoice?.keys ?? []);
  const images = (task.designs ?? []).filter(image => chosen.has(image.key) && image.state === 'completed');
  const sections = (final?.sections ?? []).map((entry, index) => section(String(index + 1).padStart(2, '0'), 'PLAN', entry.heading, list(entry.items))).join('');
  const gallery = images.length ? section(String((final?.sections.length ?? 0) + 1).padStart(2, '0'), 'SELECTED STYLES', '選択したスタイル',
    `<div class="grid">${images.map(image => `<figure>${urls[image.key] ? `<img src="${escapeHtml(urls[image.key])}" alt="${escapeHtml(agentImageLabel(image))}">` : ''}<figcaption>${escapeHtml(agentImageLabel(image))}</figcaption></figure>`).join('')}</div>`) : '';
  return shell(wording.finalReport.title, isClient(task) ? 'CLIENT PROPOSAL' : 'NEW PRODUCT PLAN', final?.title ?? wording.finalReport.title, wording.finalReport.note, sections + gallery);
}
