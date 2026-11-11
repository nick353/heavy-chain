/**
 * The planning agent's task model, Light's conversation (scope options, prompts) and the reply parsers. Pure: no
 * runtime imports, so tests read it directly. `agentTasks.ts` re-exports everything here.
 */
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const AGENT_TASK_KIND = 'heavy-agent-task';
export const AGENT_SCENES = ['商品企画', '顧客提案', 'インスピレーション', 'AIグラフィックデザイン'] as const;
export type AgentScene = typeof AGENT_SCENES[number];
export const AGENT_SUBTYPES: Record<AgentScene, readonly string[]> = {
  商品企画: ['新商品企画', 'テーマ企画'],
  顧客提案: ['顧客提案'],
  インスピレーション: ['インスピレーション'],
  AIグラフィックデザイン: ['AIグラフィックデザイン'],
};
export const AGENT_TASK_CONVERSATION_PREFIX = 'heavy-agent-';

export type AgentStepState = 'running' | 'completed' | 'failed' | 'unknown';
export type AgentAssistantStep = { requestId: string; state: AgentStepState; content?: string; errorCode?: string };
/** `at`: when the round was asked for; a 「修正・補足する」 note written after it asks for a revised round. */
export type AgentRound = { step: AgentAssistantStep; summary: string; themes: string[]; at?: string };
export type AgentImageStep = { requestId: string; state: AgentStepState; prompt: string; jobId?: string; imageId?: string; storagePath?: string; errorCode?: string };
/** Where in the conversation a note was written; it is shown after that stage's block. */
export type AgentNoteStage = 'requirements' | 'scope' | 'research' | 'themes' | 'plan';
/** The bottom input (「条件を追加、または続けて質問…」): the user's text and the assistant's answer. */
export type AgentNote = { id: string; text: string; at: string; stage: AgentNoteStage; reply: AgentAssistantStep };
/** Light's 「調査範囲を確認」: values are Light's (中国/日本/北美/欧洲/非洲 and platform names). */
export type AgentResearchScope = { regions: string[]; ec: string[]; sns: string[]; other: string; at: string };
export type AgentTask = {
  kind: typeof AGENT_TASK_KIND;
  version: 1;
  scene: AgentScene;
  subtype: string;
  prompt: string;
  profile: string;
  project: string | null;
  createdAt: string;
  rounds: AgentRound[];
  /** `theme` is what the plan reads (the chosen directions joined); `themes` lists them when several were chosen. */
  choice: { theme: string; at: string; themes?: string[] } | null;
  plan: AgentAssistantStep | null;
  image: AgentImageStep | null;
  /**
   * Light's conversation (2026-11-11): request → steps → requirement summary (「問題ありません、続行」) → research scope →
   * web research → themes. Tasks made before it have no `flow` and start at the themes.
   */
  flow?: 'conversation';
  requirements?: AgentAssistantStep | null;
  notes?: AgentNote[];
  aligned?: { at: string } | null;
  scope?: AgentResearchScope | null;
  research?: AgentAssistantStep | null;
};
export type AgentTaskDocument = { id: string; title: string; revision: number; updatedAt: string; task: AgentTask; snapshot: Record<string, unknown> };

export function readAgentTask(snapshot: unknown): AgentTask | null {
  if (!record(snapshot) || !record(snapshot.agentTask)) return null;
  const task = snapshot.agentTask;
  if (task.kind !== AGENT_TASK_KIND || task.version !== 1 || typeof task.prompt !== 'string') return null;
  if (!AGENT_SCENES.includes(task.scene as AgentScene) || typeof task.subtype !== 'string' || !Array.isArray(task.rounds)) return null;
  return task as unknown as AgentTask;
}

const sceneGuide: Record<AgentScene, string> = {
  商品企画: '市場・顧客・トレンドを踏まえた商品企画',
  顧客提案: 'クライアント向けの商品提案',
  インスピレーション: 'デザインのインスピレーションと方向性',
  AIグラフィックデザイン: '衣服向けのプリント・グラフィックデザイン',
};

// ---------------------------------------------------------------------------
// Light's research scope (its bundle, 2026-11-11): each region adds its own EC and SNS platforms, in region order.
export const AGENT_SCOPE_REGIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '中国', label: '中国' }, { value: '日本', label: '日本' }, { value: '北美', label: '北米' }, { value: '欧洲', label: 'ヨーロッパ' }, { value: '非洲', label: 'アフリカ' },
];
const AGENT_SCOPE_EC: Record<string, string[]> = {
  中国: ['淘宝', '天猫', '京东', '抖音', '快手', '小红书', '唯品会'],
  日本: ['ZOZOTOWN', 'Rakuten Fashion', 'Amazon Japan', 'Mercari', 'Yahoo! Shopping', 'MAGASEEK', 'SHOPLIST', 'Tiktok shop', 'shopee'],
  北美: ['Amazon Fashion', 'Walmart', 'SHEIN', 'Temu', 'Nordstrom', 'Macy’s', 'Poshmark', 'Depop', 'ThredUp', 'eBay', 'Tiktok shop'],
  欧洲: ['Zalando', 'Vinted', 'ASOS', 'ABOUT YOU', 'Farfetch', 'Amazon Fashion', 'SHEIN', 'Tiktok shop'],
  非洲: ['Jumia', 'Takealot', 'Konga', 'Superbalist', 'Jiji', 'SHEIN'],
};
const AGENT_SCOPE_SNS: Record<string, string[]> = {
  中国: ['抖音', '快手', '小红书', '微博'],
  日本: ['WEAR', 'Instagram', 'TikTok', 'X', 'YouTube'],
  北美: ['Instagram', 'TikTok', 'Pinterest', 'YouTube', 'Facebook', 'Reddit'],
  欧洲: ['Instagram', 'TikTok', 'Pinterest', 'YouTube', 'Facebook', 'Snapchat'],
  非洲: ['Facebook', 'Instagram', 'TikTok', 'YouTube', 'X'],
};
const AGENT_PLATFORM_LABELS: Record<string, string> = {
  淘宝: '淘宝（タオバオ）', 天猫: '天猫（Tmall）', 京东: '京东（JD.com）', 抖音: '抖音（Douyin）', 快手: '快手（Kuaishou）', 小红书: '小红书（Xiaohongshu）', 唯品会: '唯品会（Vipshop）', 微博: '微博（Weibo）',
};
export const agentScopeLabel = (value: string) => AGENT_SCOPE_REGIONS.find(region => region.value === value)?.label ?? AGENT_PLATFORM_LABELS[value] ?? value;
/** The platforms offered for the chosen regions (union, in region order, without repeats). */
export function agentScopeOptions(regions: readonly string[], kind: 'ec' | 'sns'): Array<{ value: string; label: string }> {
  const table = kind === 'ec' ? AGENT_SCOPE_EC : AGENT_SCOPE_SNS;
  const values: string[] = [];
  for (const region of regions) for (const value of table[region] ?? []) if (!values.includes(value)) values.push(value);
  return values.map(value => ({ value, label: agentScopeLabel(value) }));
}
/** Light pre-selects 中国 and nothing else. */
export const DEFAULT_AGENT_SCOPE = { regions: ['中国'], ec: [] as string[], sns: [] as string[], other: '' };
/** Dropping a region also drops the platforms only it offered. */
export function pruneAgentScope<T extends { regions: string[]; ec: string[]; sns: string[] }>(scope: T): T {
  const ec = agentScopeOptions(scope.regions, 'ec').map(option => option.value);
  const sns = agentScopeOptions(scope.regions, 'sns').map(option => option.value);
  return { ...scope, ec: scope.ec.filter(value => ec.includes(value)), sns: scope.sns.filter(value => sns.includes(value)) };
}
/** Light posts the confirmed scope as the user's message: 「中国、北米、天猫（Tmall）、Instagram」. */
export function agentScopeSummary(scope: Pick<AgentResearchScope, 'regions' | 'ec' | 'sns' | 'other'>) {
  const other = scope.other.split(/[,、，]/).map(value => value.trim()).filter(Boolean);
  return [...scope.regions, ...scope.ec, ...scope.sns].map(agentScopeLabel).concat(other).join('、');
}

// ---------------------------------------------------------------------------
// Light's conversation steps.
export const AGENT_INTAKE_STEPS = [
  '入力内容（市場・ターゲット・カテゴリ・シーズン・スタイル方向）の確認と要件整理',
  '要件理解サマリーの提示と確認フォーム（要件アライメント）の表示',
  '調査範囲フォーム（リサーチスコープ）の表示',
] as const;
/** Light's steps once the scope is confirmed (2026-11-11): research, the HTML report, the direction form. */
export function agentResearchSteps(scope: Pick<AgentResearchScope, 'regions' | 'ec' | 'sns'>) {
  const regions = scope.regions.map(agentScopeLabel).join('・');
  const platforms = [...scope.ec, ...scope.sns].join('・');
  return [`調査要件の組み立てと市場調査の実施（${regions}${platforms ? `／${platforms}` : ''}）`, '調査結果の整理とリサーチ・ビジュアル方向レポート（HTML）の表示', 'デザイン方向選択フォームの表示'];
}

const contextLines = (task: AgentTask) => [
  `業務シーン: ${task.scene}（${task.subtype}）。目的: ${sceneGuide[task.scene]}。`,
  task.profile ? `会社・ブランドの業務プリファレンス: ${task.profile}` : '',
  `依頼: ${task.prompt}`,
];
/** The requirement summary in force: the latest completed answer that carries a [要件] block. */
export function effectiveAgentRequirements(task: AgentTask): string {
  const candidates = [task.requirements, ...(task.notes ?? []).filter(note => note.stage === 'requirements').map(note => note.reply)];
  for (const step of candidates.reverse()) if (step?.state === 'completed' && step.content && /\[要件\]|【要件】/.test(step.content)) return step.content;
  return '';
}
const noteLines = (task: AgentTask) => {
  const notes = (task.notes ?? []).map(note => `- ${note.text}`);
  return notes.length ? [`ユーザーが追加した条件・質問:\n${notes.join('\n').slice(0, 2000)}`] : [];
};
const REQUIREMENT_FORMAT = [
  '[要件]',
  '目標：…', '市場：…', 'ターゲット：…', 'カテゴリ：…', 'シーズン：…', '価格：…', 'デザイン方向：…', '参考画像の特徴：…', '残す要素：…', '除く要素：…',
  '（各行は依頼から読み取れる内容を短く書き、依頼にない項目は「未指定」、参考画像がなければ「未アップロード（画像・参考資料なし）」と書く）',
  '[補足が必要]',
  '①… ②… ③…（企画の結果を大きく左右するのに依頼に書かれていない確認事項を最大3つ、1行で。例: 価格帯（通貨・上下限）、販売チャネル、総スタイル数・ローンチ時期）',
].join('\n');
export function agentRequirementsPrompt(task: AgentTask): string {
  return [...contextLines(task), 'この依頼を読み、企画の要件を整理してください。次の形式だけで答えてください。', REQUIREMENT_FORMAT].filter(Boolean).join('\n');
}
export function agentNotePrompt(task: AgentTask, note: Pick<AgentNote, 'text' | 'stage'>): string {
  const requirements = effectiveAgentRequirements(task);
  const updating = note.stage === 'requirements';
  return [
    ...contextLines(task),
    requirements ? `現在の要件:\n${requirements.slice(0, 2400)}` : '',
    task.research?.state === 'completed' && task.research.content ? `ウェブ調査の結果（抜粋）:\n${parseAgentResearch(task.research.content).report.slice(0, 1500)}` : '',
    `ユーザーの追加の書き込み: ${note.text}`,
    updating
      ? `最初に「[返答]」の行のあとに、追加の内容を受け取ったことや質問への答えを1〜3文で書き、続けて要件を更新して次の形式で書いてください。\n${REQUIREMENT_FORMAT}`
      : '「[返答]」の行のあとに、質問への答え、または追加の条件を以降の企画に反映することを1〜4文で書いてください。',
  ].filter(Boolean).join('\n');
}
export type ParsedRequirements = { reply: string; lines: Array<{ label: string; value: string }>; missing: string[] };
export function parseAgentRequirements(content: string): ParsedRequirements {
  const text = content.replace(/\r/g, '');
  const at = (pattern: RegExp) => { const match = pattern.exec(text); return match ? match.index : -1; };
  const replyAt = at(/\[返答\]|【返答】/), reqAt = at(/\[要件\]|【要件】/), missAt = at(/\[補足が必要\]|【補足が必要】/);
  const slice = (from: number, marker: RegExp, to: number) => from < 0 ? '' : text.slice(from, to >= 0 && to > from ? to : undefined).replace(marker, '').trim();
  const reply = slice(replyAt, /\[返答\]|【返答】/, reqAt >= 0 ? reqAt : missAt);
  const requirements = slice(reqAt, /\[要件\]|【要件】/, missAt);
  const missingText = slice(missAt, /\[補足が必要\]|【補足が必要】/, -1);
  const lines = requirements.split('\n').map(line => line.trim().replace(/^[-・*]\s*/, '')).filter(Boolean)
    .map(line => { const match = /^([^：:]{1,12})[：:]\s*(.*)$/.exec(line); return match ? { label: match[1].trim(), value: match[2].trim() } : { label: '', value: line }; });
  const missing = missingText.split(/\n|(?=[①②③④⑤])/).map(item => item.trim().replace(/^[-・*]\s*/, '')).filter(Boolean).slice(0, 5);
  return { reply: reply || (reqAt < 0 && missAt < 0 ? text.trim() : ''), lines, missing };
}
/** 「【価格帯／販売チャネル／…】を確認してください」: the names of the missing items without their notes. */
export const agentMissingNames = (missing: string[]) => missing.map(item => item.replace(/^[①②③④⑤\d.、)\s]+/, '').replace(/[（(].*$/, '').trim()).filter(Boolean).join('／');

export function agentResearchPrompt(task: AgentTask): string {
  const scope = task.scope!;
  const requirements = effectiveAgentRequirements(task);
  return [
    ...contextLines(task),
    requirements ? `確認済みの要件:\n${requirements.slice(0, 2400)}` : '',
    ...noteLines(task),
    `調査範囲: 地域=${scope.regions.map(agentScopeLabel).join('・')} / ECプラットフォーム=${scope.ec.map(agentScopeLabel).join('・')} / SNS=${scope.sns.map(agentScopeLabel).join('・')}${scope.other.trim() ? ` / その他=${scope.other.trim()}` : ''}`,
    'この調査範囲について、ウェブ検索で最新の情報（市場・気候、トレンド、各プラットフォームの売れ筋や価格帯、SNSで話題の着こなし、着用シーン）を集めてください。',
    '調べ終えたら「[調査結果]」の行のあとに、次の見出しを順に使い、各見出しの下は「- 」で始まる箇条書きで、数字や具体例を入れて書いてください（URLは書かない）:',
    '「## 市場と気候」「## トレンド」「## プラットフォームと競合の動き」「## ターゲットと着用シーン」「## 価格と販売ポテンシャル」「## 企画への示唆」。',
  ].filter(Boolean).join('\n');
}
export type ParsedResearch = { report: string; sections: ParsedPlan['sections']; sources: Array<{ title: string; url: string }>; search: 'ok' | 'unavailable' | 'error' };
export function parseAgentResearch(content: string): ParsedResearch {
  const text = content.replace(/\r/g, '');
  const sourcesAt = text.search(/^\[出典\]$/m);
  const statusMatch = /^\[検索\]\s*(\S+)\s*$/m.exec(text);
  const report = (sourcesAt >= 0 ? text.slice(0, sourcesAt) : statusMatch ? text.slice(0, statusMatch.index) : text).trim();
  const sources: ParsedResearch['sources'] = [];
  if (sourcesAt >= 0) {
    for (const line of text.slice(sourcesAt).split('\n').slice(1)) {
      const match = /^-\s*(.*?)\s*\|\s*(https?:\/\/\S+)\s*$/.exec(line.trim());
      if (match) sources.push({ title: match[1] || match[2], url: match[2] });
      else if (/^\[検索\]/.test(line.trim())) break;
    }
  }
  const status = statusMatch?.[1] ?? 'unavailable';
  const search = status === 'ok' ? 'ok' : status.startsWith('error') ? 'error' : 'unavailable';
  return { report, sections: parsePlanResponse(report).sections, sources, search };
}
const researchContext = (task: AgentTask) => task.research?.state === 'completed' && task.research.content
  ? `ウェブ調査の結果:\n${parseAgentResearch(task.research.content).report.slice(0, 3500)}` : '';

export function themePrompt(task: AgentTask): string {
  const previous = task.rounds.flatMap((round) => round.themes);
  return [
    `あなたはアパレル企業の企画担当アシスタントです。業務シーン: ${task.scene}（${task.subtype}）。目的: ${sceneGuide[task.scene]}。`,
    task.profile ? `会社・ブランドの業務プリファレンス: ${task.profile}` : '',
    `依頼: ${task.prompt}`,
    effectiveAgentRequirements(task) ? `確認済みの要件:\n${effectiveAgentRequirements(task).slice(0, 2000)}` : '',
    ...noteLines(task),
    researchContext(task),
    researchContext(task) ? 'テーマはウェブ調査の結果を根拠に考えてください。' : '',
    previous.length ? `前回提案したテーマ（${previous.join(' / ')}）は採用されませんでした。方向性の違う新しいテーマを提案してください。` : '',
    '次の形式だけで、日本語で答えてください。',
    '[概要]',
    researchContext(task) ? 'ウェブ調査から読み取れる、4つのデザイン方向を考える上での要点を3〜5文で書く。出典やURLは書かない。'
      : '依頼に関係する市場・トレンド・着用シーンの要点を4〜6文で書く。あなたの知識に基づいて書き、出典やURLは書かない。',
    '[テーマ]',
    ...(task.flow === 'conversation'
      ? ['- 方向性の名前（主なアイテム）｜特徴を2文で（素材・シルエット・色・ディテール）｜採用をすすめる理由を1文で（調査の根拠を入れる）', 'の形式でちょうど4行。区切りは全角の「｜」。']
      : ['- テーマ名：一文の説明', 'の形式でちょうど4行。']),
  ].filter(Boolean).join('\n');
}

export function planPrompt(task: AgentTask, theme: string): string {
  return [
    `あなたはアパレル企業の企画担当アシスタントです。業務シーン: ${task.scene}（${task.subtype}）。`,
    task.profile ? `会社・ブランドの業務プリファレンス: ${task.profile}` : '',
    `依頼: ${task.prompt}`,
    effectiveAgentRequirements(task) ? `確認済みの要件:\n${effectiveAgentRequirements(task).slice(0, 2000)}` : '',
    ...noteLines(task),
    researchContext(task),
    `採用されたテーマ: ${theme}`,
    `このテーマで${task.subtype}の企画書を日本語で作成してください。`,
    '次の見出しを順に使い、各見出しの下は「- 」で始まる箇条書きで書いてください: 「## タイトル」（1行の企画名）「## コンセプト」「## カラーパレット」「## 推奨素材」「## 主要デザイン要素」「## 主力アイテム」「## コーディネート提案」。',
    '最後に「[画像プロンプト]」と書いた行の次に、この企画のムードボード画像を生成するための英語のプロンプトを1行だけ書いてください。画像プロンプトにはブランド名・人名・「style」という単語を使わないでください。',
  ].filter(Boolean).join('\n');
}

/**
 * The image service refuses likeness/brand phrasing (e.g. "<word> <word> style" reads as a named person's style), so
 * the visual prompt is kept descriptive: no "style", no quoted names.
 */
export function agentImagePrompt(prompt: string): string {
  return prompt.replace(/["“”'‘’]/g, '').replace(/\bstyles?\b/gi, 'aesthetic').replace(/\s+/g, ' ').trim().slice(0, 600);
}

export function parseThemeResponse(content: string): { summary: string; themes: string[] } {
  const normalized = content.replace(/\r/g, '');
  const themeIndex = normalized.search(/\[テーマ\]|【テーマ】/);
  const summaryPart = (themeIndex >= 0 ? normalized.slice(0, themeIndex) : normalized).replace(/\[概要\]|【概要】/g, '').trim();
  const themePart = themeIndex >= 0 ? normalized.slice(themeIndex) : normalized;
  const themes = themePart.split('\n').map((line) => line.trim()).filter((line) => /^([-・*]|\d+[.)．])\s*/.test(line))
    .map((line) => line.replace(/^([-・*]|\d+[.)．])\s*/, '').replace(/\*\*/g, '').trim()).filter(Boolean).slice(0, 4);
  return { summary: summaryPart.slice(0, 2400), themes };
}

/** Light's direction card: name, what it is, why it is recommended (「名前｜説明｜推奨」, or the older 「名前：説明」). */
export function parseAgentDirection(theme: string): { name: string; description: string; recommendation: string } {
  const parts = theme.split('｜').map(part => part.trim());
  if (parts.length >= 2) return { name: parts[0], description: parts[1], recommendation: parts.slice(2).join(' ') };
  const match = /^([^：:]{1,60})[：:]\s*(.+)$/.exec(theme.trim());
  return match ? { name: match[1].trim(), description: match[2].trim(), recommendation: '' } : { name: theme.trim(), description: '', recommendation: '' };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
/** Light's 「調査とビジュアル方向」 HTML report (オンラインで表示 / ダウンロード): built from the stored research, every value escaped. */
export function buildAgentResearchReportHtml(task: AgentTask): string {
  const research = task.research?.state === 'completed' && task.research.content ? parseAgentResearch(task.research.content) : null;
  const round = [...task.rounds].reverse().find(entry => entry.step.state === 'completed' && entry.themes.length);
  const scope = task.scope ? agentScopeSummary(task.scope) : '';
  const sections = (research?.sections.length ? research.sections : research ? [{ heading: '調査結果', items: research.report.split('\n').filter(Boolean) }] : [])
    .map(section => `<section><h2>${escapeHtml(section.heading)}</h2><ul>${section.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`).join('');
  const directions = round ? `<section><h2>ビジュアル方向性の候補</h2>${round.themes.map(theme => { const d = parseAgentDirection(theme);
    return `<div class="card"><h3>${escapeHtml(d.name)}</h3>${d.description ? `<p>${escapeHtml(d.description)}</p>` : ''}${d.recommendation ? `<p class="muted">${escapeHtml(d.recommendation)}</p>` : ''}</div>`; }).join('')}</section>` : '';
  const sources = research?.sources.length ? `<section><h2>参考資料</h2><ol>${research.sources.map(source => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a></li>`).join('')}</ol></section>`
    : `<section><h2>参考資料</h2><p class="muted">${research?.search === 'ok' ? '参照した資料はありません。' : 'ウェブ検索を使えませんでした。この調査結果はAIモデルの知識に基づいています。'}</p></section>`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>調査とビジュアル方向レポート</title>
<style>:root{color-scheme:light dark;--bg:#ffffff;--fg:#1d2324;--muted:#5d6869;--line:#dfe5e5;--accent:#078e85}@media (prefers-color-scheme:dark){:root{--bg:#171b1c;--fg:#e8eeee;--muted:#9aa6a7;--line:#2f3537;--accent:#5fe3d8}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}main{max-width:760px;margin:0 auto;padding:32px 16px 64px}h1{font-size:24px;margin:0 0 8px}h2{font-size:17px;color:var(--accent);margin:28px 0 8px}h3{font-size:15px;margin:0 0 4px}.muted{color:var(--muted)}.card{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:10px 0}a{color:var(--accent)}ul,ol{padding-left:20px}</style></head>
<body><main><h1>調査とビジュアル方向レポート</h1><p class="muted">${escapeHtml(task.prompt)}</p>${scope ? `<p class="muted">調査範囲：${escapeHtml(scope)}</p>` : ''}${sections}${directions}${sources}</main></body></html>`;
}

export type ParsedPlan = { title: string | null; sections: { heading: string; items: string[] }[]; imagePrompt: string | null };
export function parsePlanResponse(content: string): ParsedPlan {
  const normalized = content.replace(/\r/g, '');
  const imageIndex = normalized.search(/\[画像プロンプト\]|【画像プロンプト】/);
  const body = imageIndex >= 0 ? normalized.slice(0, imageIndex) : normalized;
  const imagePrompt = imageIndex >= 0 ? normalized.slice(imageIndex).split('\n').slice(1).map((line) => line.trim()).find(Boolean) ?? null : null;
  const sections: ParsedPlan['sections'] = [];
  let title: string | null = null;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,4}\s*(.+)$/);
    if (heading) { sections.push({ heading: heading[1].replace(/\*\*/g, '').trim(), items: [] }); continue; }
    const item = line.replace(/^([-・*]|\d+[.)．])\s*/, '').replace(/\*\*/g, '').trim();
    if (!item) continue;
    if (!sections.length) sections.push({ heading: '企画内容', items: [] });
    sections[sections.length - 1].items.push(item);
  }
  const titleSection = sections.find((section) => section.heading === 'タイトル');
  if (titleSection) title = titleSection.items[0]?.slice(0, 60) ?? null;
  return { title, sections: sections.filter((section) => section.heading !== 'タイトル' && section.items.length), imagePrompt: imagePrompt?.slice(0, 600) ?? null };
}
