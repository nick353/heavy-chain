/**
 * The planning agent's task model, Light's conversation (scope options, prompts) and the reply parsers. Pure: no
 * runtime imports, so tests read it directly. `agentTasks.ts` re-exports everything here.
 */
import { AGENT_PRODUCT_LINE, YAHOO_ATTRIBUTION_HTML, agentJapanMarket, agentYen, parseAgentProducts, type AgentProduct } from './agentProducts.ts';

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
/** `at`: when the step was asked for; a 「修正・補足する」 note written after it asks for a revised one. */
export type AgentAssistantStep = { requestId: string; state: AgentStepState; content?: string; errorCode?: string; at?: string };
/**
 * `at`: when the round was asked for; a 「修正・補足する」 note written after it asks for a revised round. `evidence`: the
 * research sources the round's prompt numbered 〔1〕〔2〕… (テーマ企画 since 2026-11-12), in that order; the answer marks its
 * sentences with those numbers and 参考資料 lists each marked sentence under its source (Light: its answer's sentence).
 */
export type AgentRound = { step: AgentAssistantStep; summary: string; themes: string[]; at?: string; evidence?: string[] };
export type AgentImageStep = { requestId: string; state: AgentStepState; prompt: string; jobId?: string; imageId?: string; storagePath?: string; errorCode?: string };
/** Where in the conversation a note was written; it is shown after that stage's block. */
export type AgentNoteStage = 'requirements' | 'scope' | 'research' | 'themes' | 'plan' | 'structure' | 'designs' | 'final';
/** The bottom input (「条件を追加、または続けて質問…」): the user's text and the assistant's answer; `attachments` are ids in `task.attachments`. */
export type AgentNote = { id: string; text: string; at: string; stage: AgentNoteStage; reply: AgentAssistantStep; attachments?: string[] };
/** An image the task generates with Heavy's own image service: one per direction (参考スタイル) or per style (スタイルを生成). `pending` is not sent yet. */
export type AgentImageState = AgentStepState | 'pending';
export type AgentStyleImage = {
  key: string; code: string; name: string; category: string; prompt: string; requestId: string; state: AgentImageState;
  jobId?: string; imageId?: string; storagePath?: string; errorCode?: string; at?: string;
  /** A real product shown instead of a generated picture (Yahoo!ショッピング, plans of the Japanese market): never generated or stored. */
  product?: AgentProduct;
};
/** Light's 添付を追加 (ファイル / 画像): a file keeps the text read from it, an image is stored and sent to the assistant as a reference. */
export type AgentAttachment = { id: string; kind: 'file' | 'image'; name: string; size: number; at: string; text?: string; imageId?: string; storagePath?: string };
/** One message of the インスピレーション / AIグラフィックデザイン chat. A user turn's `prompt` is what the assistant reads when it
 * differs from the bubble (form answers, picked images); an assistant turn's `mode` says whether it searched the web. */
export type AgentTurn = {
  id: string; role: 'user' | 'assistant'; at: string;
  text?: string; prompt?: string; attachments?: string[];
  step?: AgentAssistantStep; mode?: 'agent' | 'agent-research';
};
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
  flow?: 'conversation' | 'dialogue';
  requirements?: AgentAssistantStep | null;
  notes?: AgentNote[];
  aligned?: { at: string } | null;
  scope?: AgentResearchScope | null;
  research?: AgentAssistantStep | null;
  /** Light's steps after the directions (2026-11-12): 商品構成計画 (顧客提案: スタイルマッピング計画) → 「AIデザイン修正の生成へ進む」 →
   * series language and per-style design → one AI image per style → 「最終の…に使用するスタイル画像を選択」 → the final plan. */
  directionImages?: { round: string; images: AgentStyleImage[] } | null;
  structure?: AgentAssistantStep | null;
  proceed?: { at: string } | null;
  design?: AgentAssistantStep | null;
  designs?: AgentStyleImage[] | null;
  styleChoice?: { keys: string[]; at: string } | null;
  final?: AgentAssistantStep | null;
  attachments?: AgentAttachment[];
  /** Light's インスピレーション / AIグラフィックデザイン (2026-11-12, `flow: 'dialogue'`): the chat, and the generation 「開始」 started
   * (`after`: the turn it follows, `plan`: the 執行書 turn whose styles are generated into `designs`). */
  turns?: AgentTurn[];
  dialogueStart?: { after: string; plan: string; at: string } | null;
  /** Light's research report as slides its AI writes (2026-11-12): one per directions round (`round` is its request). */
  report?: { round: string; step: AgentAssistantStep } | null;
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
/**
 * Light's sources are mostly real products (its 顧客提案 index starts with 「EC実商品」; 6 of its 新商品企画 report's links are
 * product pages). Heavy's research came from one broad web search: in production 2026-11-12 only 14% of its sources were
 * shop pages, 8% had a price, and 3 were single product pages. So the research also searches the shops of the scope (the
 * server runs that search only on these domains, beside the broad one). Shops whose pages a web search cannot reach
 * (TikTok Shop, Shopee's seller pages) have none.
 */
const AGENT_SHOP_DOMAINS: Record<string, string[]> = {
  淘宝: ['taobao.com'], 天猫: ['tmall.com'], 京东: ['jd.com'], 唯品会: ['vip.com'], 小红书: ['xiaohongshu.com'],
  ZOZOTOWN: ['zozo.jp'], 'Rakuten Fashion': ['rakuten.co.jp'], 'Amazon Japan': ['amazon.co.jp'], Mercari: ['mercari.com'], 'Yahoo! Shopping': ['shopping.yahoo.co.jp'],
  MAGASEEK: ['magaseek.com'], SHOPLIST: ['shop-list.com'],
  'Amazon Fashion': ['amazon.com'], Walmart: ['walmart.com'], SHEIN: ['shein.com'], Temu: ['temu.com'], Nordstrom: ['nordstrom.com'], 'Macy’s': ['macys.com'],
  Poshmark: ['poshmark.com'], Depop: ['depop.com'], ThredUp: ['thredup.com'], eBay: ['ebay.com'],
  Zalando: ['zalando.co.uk'], Vinted: ['vinted.com'], ASOS: ['asos.com'], 'ABOUT YOU': ['aboutyou.com'], Farfetch: ['farfetch.com'],
  Jumia: ['jumia.com.ng'], Takealot: ['takealot.com'], Konga: ['konga.com'], Superbalist: ['superbalist.com'], Jiji: ['jiji.ng'],
};
/** No shop chosen: the region's large fashion shops. */
const AGENT_REGION_SHOPS: Record<string, string[]> = {
  中国: ['tmall.com', 'taobao.com', 'jd.com'], 日本: ['zozo.jp', 'rakuten.co.jp', 'shopping.yahoo.co.jp', 'amazon.co.jp'],
  北美: ['nordstrom.com', 'amazon.com', 'shein.com'], 欧洲: ['zalando.co.uk', 'asos.com', 'farfetch.com'], 非洲: ['jumia.com.ng', 'takealot.com'],
};
/** テーマ企画 has no scope: the shops Light's テーマ企画 参考資料 listed (rakuten.co.jp, net-a-porter.com, minne.com…) and the large Japanese ones. */
const AGENT_THEME_SHOPS = ['zozo.jp', 'rakuten.co.jp', 'shopping.yahoo.co.jp', 'minne.com', 'net-a-porter.com', 'ssense.com'];
export const AGENT_SHOP_DOMAINS_MAX = 8;
/** The shops the research also searches, as domains (the server reads them from the 「通販サイトの検索先:」 line). */
export function agentShopDomains(task: Pick<AgentTask, 'flow' | 'subtype' | 'scope'>): string[] {
  if (agentThemeSearches(task)) return AGENT_THEME_SHOPS.slice(0, AGENT_SHOP_DOMAINS_MAX);
  if (!task.scope) return [];
  const chosen = task.scope.ec.flatMap(value => AGENT_SHOP_DOMAINS[value] ?? []);
  const domains = chosen.length ? chosen : task.scope.regions.flatMap(region => AGENT_REGION_SHOPS[region] ?? []);
  return [...new Set(domains)].slice(0, AGENT_SHOP_DOMAINS_MAX);
}
const shopLine = (task: AgentTask) => { const domains = agentShopDomains(task); return domains.length ? `通販サイトの検索先: ${domains.join(', ')}` : ''; };
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

/** Every planning request stays under the server's cap for agent requests (16,000 characters): each part is bounded. */
export const AGENT_PROMPT_BUDGET = 15000;
/** What the attached files say and which images are attached; the images themselves go with the request as references. */
export function agentAttachmentLines(task: Pick<AgentTask, 'attachments'>, budget = 3000): string[] {
  const list = task.attachments ?? [];
  if (!list.length) return [];
  // The newest files first, each with an equal share of the budget; the whole block never passes the budget.
  const files = list.filter(item => item.kind === 'file' && item.text).slice(-4);
  const each = files.length ? Math.floor(budget / files.length) - 60 : 0;
  const images = list.filter(item => item.kind === 'image').map(item => item.name.slice(0, 60));
  return [
    ...files.map(item => `添付資料「${item.name.slice(0, 40)}」の内容（抜粋）:\n${item.text!.slice(0, Math.max(100, each))}`),
    images.length ? `添付画像（参考として一緒に送っています）: ${images.slice(-AGENT_REFERENCE_IMAGES).join('、').slice(0, 260)}` : '',
  ].filter(Boolean);
}
/** The newest attached images are sent with every request as references (the server allows up to 16). */
export const AGENT_REFERENCE_IMAGES = 4;
export function agentReferenceImages(task: Pick<AgentTask, 'attachments'>) {
  return (task.attachments ?? []).filter(item => item.kind === 'image' && item.imageId && item.storagePath).slice(-AGENT_REFERENCE_IMAGES)
    .map((item, order) => ({ order, kind: 'upload' as const, imageId: item.imageId!, storagePath: item.storagePath!, name: item.name.slice(0, 120) || '添付画像' }));
}
const contextLines = (task: AgentTask) => [
  `業務シーン: ${task.scene}（${task.subtype}）。目的: ${sceneGuide[task.scene]}。`,
  task.profile ? `会社・ブランドの業務プリファレンス: ${task.profile.slice(0, 1000)}` : '',
  `依頼: ${task.prompt.slice(0, 2000)}`,
  ...agentAttachmentLines(task, 1800),
];
/**
 * A request the server turned away (bad or oversized input, a conflicting resend) or a request it never stored (404 on
 * reading it back) will not settle by waiting: the step fails with a retry instead of polling forever. Dropped
 * connections, timeouts, an expired session, rate limits and server errors return null and stay "interrupted".
 */
export function agentRequestRejection(error: unknown): string | null {
  const match = /^cloudflare_api_(\d{3})_(.*)$/.exec(error instanceof Error ? error.message : '');
  if (!match) return null;
  const status = Number(match[1]);
  if (status < 400 || status >= 500 || [401, 403, 408, 429].includes(status)) return null;
  return match[2] || `http_${status}`;
}
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
/** Light's 顧客提案 numbers the client's requirements (「顧客要件の整理と要件IDの付与」) and its directions cite them (R03). */
const CLIENT_REQUIREMENT_FORMAT = [
  '[要件]',
  'シリーズ名：…（提案するコレクションの短い名前。例: 2027SSレディースコレクション）',
  'R01 ブランドの位置づけ：…', 'R02 市場・ターゲット：…', 'R03 …：…',
  '（クライアントの要望・重点アイテム・提案に含める項目を、R01から順に要件IDを付けて1行ずつ書く。要望が複数あれば1つずつ別の行にする。依頼にない項目は「未指定」、参考画像がなければ「参考画像：未アップロード（画像・参考資料なし）」と書く）',
  '[補足が必要]',
  '①… ②… ③…（提案の結果を大きく左右するのに依頼に書かれていない確認事項を最大3つ、1行で。例: 価格帯（通貨・上下限）、販売チャネル、総スタイル数・ローンチ時期）',
].join('\n');
const requirementFormat = (task: Pick<AgentTask, 'subtype'>) => task.subtype === '顧客提案' ? CLIENT_REQUIREMENT_FORMAT : REQUIREMENT_FORMAT;
export function agentRequirementsPrompt(task: AgentTask): string {
  return [...contextLines(task), 'この依頼を読み、企画の要件を整理してください。次の形式だけで答えてください。', requirementFormat(task)].filter(Boolean).join('\n');
}
export function agentNotePrompt(task: AgentTask, note: Pick<AgentNote, 'text' | 'stage'>): string {
  const requirements = effectiveAgentRequirements(task);
  const updating = note.stage === 'requirements';
  return [
    ...contextLines(task),
    requirements ? `現在の要件:\n${requirements.slice(0, 2400)}` : '',
    task.research?.state === 'completed' && task.research.content ? `ウェブ調査の結果（抜粋）:\n${parseAgentResearch(task.research.content).report.slice(0, 1500)}` : '',
    task.choice ? `選択した方向性: ${task.choice.theme.slice(0, 400)}` : '',
    task.structure?.state === 'completed' && task.structure.content && ['structure', 'designs', 'final'].includes(note.stage) ? `商品構成計画（抜粋）:\n${task.structure.content.slice(0, 2000)}` : '',
    note.stage === 'structure' ? '（この書き込みのあと商品構成計画を作り直します。修正の依頼なら、どう反映するかを書いてください）' : '',
    `ユーザーの追加の書き込み: ${note.text.slice(0, 2000)}`,
    updating
      ? `最初に「[返答]」の行のあとに、追加の内容を受け取ったことや質問への答えを1〜3文で書き、続けて要件を更新して次の形式で書いてください。\n${requirementFormat(task)}`
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
    .map(line => { const match = /^([^：:]{1,20})[：:]\s*(.*)$/.exec(line); return match ? { label: match[1].trim(), value: match[2].trim() } : { label: '', value: line }; });
  const missing = missingText.split(/\n|(?=[①②③④⑤])/).map(item => item.trim().replace(/^[-・*]\s*/, '')).filter(Boolean).slice(0, 5);
  return { reply: reply || (reqAt < 0 && missAt < 0 ? text.trim() : ''), lines, missing };
}
/** 「【価格帯／販売チャネル／…】を確認してください」: the names of the missing items without their notes. */
export const agentMissingNames = (missing: string[]) => missing.map(item => item.replace(/^[①②③④⑤\d.、)\s]+/, '').replace(/[（(].*$/, '').trim()).filter(Boolean).join('／');

export function agentResearchPrompt(task: AgentTask): string {
  if (agentThemeSearches(task)) return agentThemeResearchPrompt(task);
  const scope = task.scope!;
  const requirements = effectiveAgentRequirements(task);
  return [
    ...contextLines(task),
    requirements ? `確認済みの要件:\n${requirements.slice(0, 2400)}` : '',
    ...noteLines(task),
    `調査範囲: 地域=${scope.regions.map(agentScopeLabel).join('・')} / ECプラットフォーム=${scope.ec.map(agentScopeLabel).join('・')} / SNS=${scope.sns.map(agentScopeLabel).join('・')}${scope.other.trim() ? ` / その他=${scope.other.trim().slice(0, 500)}` : ''}`,
    'この調査範囲について、ウェブ検索で最新の情報（市場・気候、トレンド、各プラットフォームの売れ筋や価格帯、SNSで話題の着こなし、着用シーン）を集めてください。',
    '調べ終えたら「[調査結果]」の行のあとに、次の見出しを順に使い、各見出しの下は「- 」で始まる箇条書きで、数字や具体例を入れて書いてください（URLは書かない）:',
    '「## 市場と気候」「## トレンド」「## プラットフォームと競合の動き」「## ターゲットと着用シーン」「## 価格と販売ポテンシャル」「## 企画への示唆」。',
    shopLine(task),
    agentJapanMarket(task) ? AGENT_PRODUCT_LINE : '',
  ].filter(Boolean).join('\n');
}
/** `quote`: the sentence the report cited from the page (Light shows it under the source in 参考資料). */
export type AgentSource = { title: string; url: string; quote?: string };
/** A run of the cited sentence: `bold` is a `**…**` pair, shown in bold. */
export type AgentQuotePart = { text: string; bold: boolean };
/**
 * The cited sentence as Light shows it, in runs. Light renders 参考資料 as Markdown (read 2026-11-12 from its テーマ企画
 * 「Okinawa風 2024年」: each sentence is a <blockquote>, and 「**気候適応と快適性の追求:** 沖縄の…」 has the label in
 * <strong class="font-semibold text-text-primary">), so a `**` pair is a bold run. Like Markdown, an opening `**` is not
 * followed by a space and a closing one does not follow a space; a `**` with no partner (the search tool's Markdown cut
 * mid-way: 「** The key directions…」) is dropped, as are `__` and heading marks (# ) (production 2026-11-12:
 * 「# 9 Trends … ## Spring/Summer 2027」). `***` counts as `**`. Hashtags (#リネン, no space after #) stay.
 */
export function agentQuoteParts(value: string): AgentQuotePart[] {
  const pieces = value.replace(/__/g, '').replace(/(^|\s)#{1,6}(?=\s|$)/g, '$1').replace(/\s+/g, ' ').trim()
    .replace(/\*{3,}/g, '**').split('**');
  // Marker i sits between pieces[i] and pieces[i + 1]; pairs nest, so a stack matches each closer with the last opener.
  const open: number[] = [];
  const pairs: [number, number][] = [];
  for (let index = 0; index < pieces.length - 1; index += 1) {
    const before = pieces[index].slice(-1), after = pieces[index + 1].charAt(0);
    if (before && !/\s/.test(before) && open.length) pairs.push([open.pop()!, index]);
    else if (after && !/\s/.test(after)) open.push(index);
  }
  const join = (into: AgentQuotePart[], text: string, bold: boolean) => {
    if (!text) return;
    const last = into[into.length - 1];
    if (last && last.bold === bold) last.text += text; else into.push({ text, bold });
  };
  const runs: AgentQuotePart[] = [];
  pieces.forEach((piece, index) => join(runs, piece, pairs.some(([start, end]) => start < index && index <= end)));
  const parts: AgentQuotePart[] = [];
  for (const run of runs) {
    if (!run.bold) { join(parts, run.text, false); continue; }
    // A bold run starts and ends with a letter, so its spaces stay outside it.
    const core = run.text.trim();
    join(parts, run.text.slice(0, run.text.length - run.text.trimStart().length), false);
    join(parts, core, true);
    join(parts, core ? run.text.slice(run.text.trimEnd().length) : '', false);
  }
  for (const part of parts) if (!part.bold) part.text = part.text.replace(/\s+/g, ' ');
  if (parts[0] && !parts[0].bold) parts[0].text = parts[0].text.trimStart();
  const last = parts[parts.length - 1];
  if (last && !last.bold) last.text = last.text.trimEnd();
  return parts.filter(part => part.text);
}
/** The cited sentence kept as text: only the `**` pairs that {@link agentQuoteParts} shows in bold are left. */
export const cleanAgentQuote = (value: string) => agentQuoteParts(value).map(part => (part.bold ? `**${part.text}**` : part.text)).join('');
/**
 * `claims`: the `[引用]` block (research made since 2026-11-12): the report's cited sentences, each with its first source.
 * Light's テーマ企画 lists these (its sentence, not the page's text; a site again for another sentence). `null` when the
 * content has no such block (older research), which keeps the `[出典]` list.
 */
export type ParsedResearch = {
  report: string; sections: ParsedPlan['sections']; sources: AgentSource[]; claims: AgentSource[] | null; search: 'ok' | 'unavailable' | 'error';
  /** Yahoo!ショッピング's products (the `[商品]` block), with their images, for the report's evidence cards. */
  products?: AgentProduct[];
};
const sourceLines = (block: string, stop: RegExp): AgentSource[] => {
  const sources: AgentSource[] = [];
  for (const line of block.split('\n').slice(1)) {
    const match = /^-\s*(.*?)\s*\|\s*(https?:\/\/\S+?)\s*(?:\|\s*(.*?))?\s*$/.exec(line.trim());
    if (match) sources.push({ title: match[1] || match[2], url: match[2], ...(match[3] && cleanAgentQuote(match[3]) ? { quote: cleanAgentQuote(match[3]) } : {}) });
    else if (stop.test(line.trim())) break;
  }
  return sources;
};
export function parseAgentResearch(content: string): ParsedResearch {
  const text = content.replace(/\r/g, '');
  const sourcesAt = text.search(/^\[出典\]$/m);
  const claimsAt = text.search(/^\[引用\]$/m);
  const statusMatch = /^\[検索\]\s*(\S+)\s*$/m.exec(text);
  const report = (sourcesAt >= 0 ? text.slice(0, sourcesAt) : statusMatch ? text.slice(0, statusMatch.index) : text).trim();
  const sources = sourcesAt >= 0 ? sourceLines(text.slice(sourcesAt), /^\[(検索|引用|商品)\]/) : [];
  const claims = claimsAt >= 0 ? sourceLines(text.slice(claimsAt), /^\[(検索|出典|商品)\]/) : null;
  const products = parseAgentProducts(text);
  const status = statusMatch?.[1] ?? 'unavailable';
  const search = status === 'ok' ? 'ok' : status.startsWith('error') ? 'error' : 'unavailable';
  return { report, sections: parsePlanResponse(report).sections, sources, claims, search, ...(products.length ? { products } : {}) };
}

// Second-level labels under a country code that are not a site of their own (rakuten.co.jp, cao.go.jp, rollingstone.co.uk),
// and Japan's prefecture labels (pref.okinawa.jp). Light shows the site this way: wikipedia.org for ja.wikipedia.org.
const COUNTRY_SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'or', 'ne', 'go', 'gov', 'govt', 'gob', 'ac', 'edu', 'ed', 'ad', 'gr', 'lg', 'ltd', 'plc', 'sch', 'idv', 'nic', 'mil']);
const JP_PREFECTURES = new Set(('hokkaido aomori iwate miyagi akita yamagata fukushima ibaraki tochigi gunma saitama chiba tokyo kanagawa niigata toyama '
  + 'ishikawa fukui yamanashi nagano gifu shizuoka aichi mie shiga kyoto osaka hyogo nara wakayama tottori shimane okayama hiroshima '
  + 'yamaguchi tokushima kagawa ehime kochi fukuoka saga nagasaki kumamoto oita miyazaki kagoshima okinawa').split(' '));
/** The site of a source as Light names it in テーマ企画's 参考資料: the registered domain (item.rakuten.co.jp → rakuten.co.jp). */
export function agentSourceSite(url: string): string {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch { return url; }
  if (/^[\d.]+$/.test(host) || host.includes(':')) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return labels.join('.').replace(/^www\./, '');
  const [second, top] = labels.slice(-2);
  const keep = top.length === 2 && (COUNTRY_SECOND_LEVEL.has(second) || (top === 'jp' && JP_PREFECTURES.has(second))) ? 3 : 2;
  return labels.slice(-keep).join('.');
}
/**
 * Where テーマ企画's 参考資料 links go, as in Light: the site's entrance, `https://` and the site name, with no www, path or
 * trailing slash (read 2026-11-12 from its テーマ企画: https://wikipedia.org, https://pref.okinawa.jp, https://cao.go.jp,
 * https://youtube.com, opened in a new tab). An address that has no site name of that kind keeps its own URL.
 */
export function agentSourceHome(url: string): string {
  const site = agentSourceSite(url);
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(site) ? `https://${site}` : url;
}
const researchContext = (task: AgentTask) => task.research?.state === 'completed' && task.research.content
  ? `ウェブ調査の結果:\n${parseAgentResearch(task.research.content).report.slice(0, 3500)}` : '';

/** Light's テーマ企画 researches the web for its themes (its 参考資料 lists the sites with the sentence each was cited for). */
export const agentThemeSearches = (task: Pick<AgentTask, 'flow' | 'subtype'>) => task.flow !== 'conversation' && task.subtype === 'テーマ企画';
/**
 * Heavy runs テーマ企画's web search as its own research step (like 新商品企画's) and writes the themes from the report.
 * Claude cites a page only in report sentences: searching inside the short theme format came back with no citation at all
 * twice in production (2026-11-12, even when its lines stated the pages' facts), while every research report carried them.
 */
function agentThemeResearchPrompt(task: AgentTask): string {
  return [
    ...contextLines(task),
    ...noteLines(task),
    'この依頼のテーマを考えるために、ウェブ検索で最新の情報（シーズンのトレンド、色・素材・柄、注目のアイテムとディテール、コレクションや店頭の事例、SNSで話題の着こなし）を集めてください。',
    '調べ終えたら「[調査結果]」の行のあとに、次の見出しを順に使い、各見出しの下は「- 」で始まる箇条書きで、数字や具体例を入れて書いてください（URLは書かない）:',
    '「## トレンド」「## 色と素材」「## アイテムとディテール」「## 事例と着用シーン」「## テーマへの示唆」。',
    shopLine(task),
  ].filter(Boolean).join('\n');
}
/**
 * The sources of a web-searching テーマ企画: a round that searched itself (its content carries the `[出典]` block; rounds
 * made before the research step) or else the task's research.
 */
export function agentRoundSources(task: AgentTask) {
  // Light lists one entry per cited sentence (the `[引用]` block, at most 25); research written before it keeps `[出典]`.
  const listed = (parsed: ParsedResearch): ParsedResearch => parsed.claims ? { ...parsed, sources: parsed.claims } : parsed;
  for (const round of [...task.rounds].reverse()) {
    if (round.step.state === 'completed' && round.step.content && /^\[検索\]/m.test(round.step.content)) return listed(parseAgentResearch(round.step.content));
  }
  const research = agentThemeSearches(task) && task.research?.state === 'completed' && task.research.content ? parseAgentResearch(task.research.content) : null;
  if (!research) return null;
  // A round written with numbered evidence lists the answer's own sentences (Light: the sentence on screen, its source's
  // site): an unmarked sentence is not listed, so an answer that marked none lists none.
  const cited = [...task.rounds].reverse().find(round => round.step.state === 'completed' && round.step.content);
  if (cited?.evidence) return { ...research, sources: agentAnswerSources(cited.step.content!, cited.evidence, research) };
  return listed(research);
}
/** A テーマ企画 round searches the web itself only when the task has no research to write from (tasks made before it). */
export const agentThemeRoundSearches = (task: AgentTask) => agentThemeSearches(task) && task.research?.state !== 'completed';

/**
 * The research a テーマ企画 answer may cite, numbered for its prompt: the report's cited sentences with their source (`[引用]`,
 * at most 25) or, for research written before them, the cited pages (`[出典]`). Each has a site, so 参考資料 can name it.
 */
export const AGENT_THEME_EVIDENCE_MAX = 25;
export function agentThemeEvidence(task: AgentTask): AgentSource[] {
  if (!agentThemeSearches(task) || task.research?.state !== 'completed' || !task.research.content) return [];
  const research = parseAgentResearch(task.research.content);
  return (research.claims ?? research.sources).filter(source => /^https?:\/\//i.test(source.url)).slice(0, AGENT_THEME_EVIDENCE_MAX);
}
/** 〔3〕 or 〔1〕〔3〕 or 〔1、3〕: the evidence numbers the theme answer puts after a sentence (never shown on screen). */
const CITE_MARKS = /(?:\s*〔\s*\d{1,2}(?:\s*[,，、・]\s*\d{1,2})*\s*〕)+/g;
export const stripAgentCiteMarks = (value: string) => value.replace(CITE_MARKS, '');
/**
 * Light's テーマ企画 参考資料 (read 2026-11-12, 23 tasks): one entry per sentence of its answer that a source backs, under
 * that sentence, in the answer's order, the same site again for another sentence, never one sentence twice, at most 25.
 * The answer marks a sentence with the evidence numbers; the entry is the sentence without its marks, under the first
 * number's source. A sentence with no valid number is not listed (no sentence is made up).
 */
export function agentAnswerSources(content: string, evidence: string[], research: Pick<ParsedResearch, 'sources' | 'claims'>): AgentSource[] {
  const raw = content.replace(/\r/g, '');
  const tail = raw.search(/^\[出典\]$|^\[検索\]/m);
  const body = tail >= 0 ? raw.slice(0, tail) : raw;
  const themeAt = body.search(/\[テーマ\]|【テーマ】/);
  const summary = (themeAt >= 0 ? body.slice(0, themeAt) : body).replace(/\[概要\]|【概要】/g, '');
  const titles = new Map([...(research.claims ?? []), ...research.sources].map(source => [source.url, source.title]));
  const entries: AgentSource[] = [];
  const seen = new Set<string>();
  let from = 0;
  for (const match of summary.matchAll(CITE_MARKS)) {
    const at = match.index!;
    const before = summary.slice(from, at);
    from = at + match[0].length;
    // The sentence runs from the last end of a sentence (or line) before it; its own closing 。 stays with it.
    const trimmed = before.replace(/\s+$/, '');
    const closing = /[。！？!?]$/.test(trimmed) ? 1 : 0;
    const head = trimmed.slice(0, trimmed.length - closing);
    const start = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('\n')) + 1;
    const sentence = trimmed.slice(start).replace(/^\s*(?:[-・*•]\s*|\d+[.)．]\s+)/, '').replace(/\s+/g, ' ').trim();
    const numbers = [...match[0].matchAll(/\d{1,2}/g)].map(number => Number(number[0]));
    const url = numbers.map(number => evidence[number - 1]).find(Boolean);
    const plain = sentence.replace(/\*\*/g, '').trim();
    if (!url || !plain || seen.has(plain)) continue;
    seen.add(plain);
    const quote = sentence.length > 160 ? `${sentence.slice(0, 159).replace(/(^|[^*])\*$/, '$1')}…` : sentence;
    entries.push({ title: titles.get(url) ?? url, url, quote: cleanAgentQuote(quote) });
    if (entries.length >= AGENT_THEME_SOURCES_LIMIT) break;
  }
  return entries;
}
const AGENT_THEME_SOURCES_LIMIT = 25;

export function themePrompt(task: AgentTask): string {
  const previous = task.rounds.flatMap((round) => round.themes);
  const evidence = researchContext(task) ? agentThemeEvidence(task) : [];
  return [
    `あなたはアパレル企業の企画担当アシスタントです。業務シーン: ${task.scene}（${task.subtype}）。目的: ${sceneGuide[task.scene]}。`,
    task.profile ? `会社・ブランドの業務プリファレンス: ${task.profile.slice(0, 1000)}` : '',
    `依頼: ${task.prompt.slice(0, 2000)}`,
    effectiveAgentRequirements(task) ? `確認済みの要件:\n${effectiveAgentRequirements(task).slice(0, 2000)}` : '',
    ...noteLines(task),
    researchContext(task),
    researchContext(task) ? 'テーマはウェブ調査の結果を根拠に考えてください。' : '',
    // Light's 参考資料 quotes its answer's own sentences: the answer marks each sentence with the evidence it rests on.
    ...(evidence.length ? [
      `調査の根拠（〔番号〕サイト：調査で分かったこと）:\n${evidence.map((source, index) => `〔${index + 1}〕${agentSourceSite(source.url)}：${cut(stripAgentCiteMarks(source.quote ?? source.title).replace(/\*\*/g, ''), 110)}`).join('\n')}`,
      '[概要] の文のうち、上の「調査の根拠」に基づく文には、文の終わり（句点の直後）にその根拠の番号を〔1〕のように付ける（2つ以上なら〔1〕〔3〕）。一覧に無い内容の文と、[テーマ] の行には番号を付けない。番号は一覧にあるものだけを使う。',
    ] : []),
    previous.length ? `前回提案したテーマ（${previous.join(' / ').slice(0, 1500)}）は採用されませんでした。方向性の違う新しいテーマを提案してください。` : '',
    '次の形式だけで、日本語で答えてください。',
    '[概要]',
    // Light's テーマ企画 answer: what the search found, then the four themes with キーエレメント / インスピレーション / カラーパレット.
    researchContext(task) && agentThemeSearches(task)
      ? 'ウェブ調査で分かった傾向を2〜3文で書き、続けて4つのテーマそれぞれについて、テーマ名の行と「キーエレメント：…」「インスピレーション：…」「カラーパレット：…」の3行を書く。傾向の文と各テーマの「インスピレーション：」の行は、調査結果の具体的な事実（色名・アイテム・数字・事例）を根拠にして書く。URLは書かない。'
      : researchContext(task) ? 'ウェブ調査から読み取れる、4つのデザイン方向を考える上での要点を3〜5文で書く。出典やURLは書かない。'
        : agentThemeSearches(task)
          // A round that searches itself (tasks made before the research step). "出典" is not forbidden here: the citations
          // are what 参考資料 lists.
          ? 'ウェブ検索で分かった傾向を2〜3文で書き、続けて4つのテーマそれぞれについて、テーマ名の行と「キーエレメント：…」「インスピレーション：…」「カラーパレット：…」の3行を書く。傾向の文と各テーマの「インスピレーション：」の行は、検索結果のページに書かれた具体的な事実（色名・アイテム・数字・事例）を1つずつ根拠にして書く。URLは書かない。'
          : '依頼に関係する市場・トレンド・着用シーンの要点を4〜6文で書く。あなたの知識に基づいて書き、出典やURLは書かない。',
    '[テーマ]',
    ...(task.flow === 'conversation'
      ? ['- 方向性の名前（主なアイテム）｜特徴を2文で（素材・シルエット・色・ディテール）｜採用をすすめる理由を1文で（調査の根拠を入れる）｜この方向の代表的な商品1点の写真を作るための英語の短い説明（服の種類・色・素材・ディテール。人物・ブランド名・「style」という単語は使わない）',
        'の形式でちょうど4行。区切りは全角の「｜」。',
        task.subtype === '顧客提案' ? '特徴と理由では、対応する要件ID（例: 通勤実用性(R03)）を括弧で示す。' : '']
      : ['- テーマ名：一文の説明', 'の形式でちょうど4行。']),
  ].filter(Boolean).join('\n');
}

export function planPrompt(task: AgentTask, theme: string): string {
  return [
    `あなたはアパレル企業の企画担当アシスタントです。業務シーン: ${task.scene}（${task.subtype}）。`,
    task.profile ? `会社・ブランドの業務プリファレンス: ${task.profile.slice(0, 1000)}` : '',
    `依頼: ${task.prompt.slice(0, 2000)}`,
    effectiveAgentRequirements(task) ? `確認済みの要件:\n${effectiveAgentRequirements(task).slice(0, 2000)}` : '',
    ...noteLines(task),
    researchContext(task),
    `採用されたテーマ: ${theme.slice(0, 2000)}`,
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
  const raw = content.replace(/\r/g, '');
  const tail = raw.search(/^\[出典\]$/m);
  // The evidence numbers (〔1〕) only tie the sentences to 参考資料; the screen shows the answer without them.
  const normalized = stripAgentCiteMarks(tail >= 0 ? raw.slice(0, tail) : raw.replace(/^\[検索\].*$/m, '')).trim();
  const themeIndex = normalized.search(/\[テーマ\]|【テーマ】/);
  const summaryPart = (themeIndex >= 0 ? normalized.slice(0, themeIndex) : normalized).replace(/\[概要\]|【概要】/g, '').trim();
  const themePart = themeIndex >= 0 ? normalized.slice(themeIndex) : normalized;
  const themes = themePart.split('\n').map((line) => line.trim()).filter((line) => /^([-・*]|\d+[.)．])\s*/.test(line))
    .map((line) => line.replace(/^([-・*]|\d+[.)．])\s*/, '').replace(/\*\*/g, '').trim()).filter(Boolean).slice(0, 4);
  return { summary: summaryPart.slice(0, 2400), themes };
}

/**
 * Light's direction card: name, what it is, why it is recommended and (since 2026-11-12) an English description of one
 * product for its reference image (「名前｜説明｜推奨｜image」, the older 「名前｜説明｜推奨」 or 「名前：説明」).
 */
export function parseAgentDirection(theme: string): { name: string; description: string; recommendation: string; imagePrompt: string } {
  const parts = theme.split('｜').map(part => part.trim());
  if (parts.length >= 4) return { name: parts[0], description: parts[1], recommendation: parts[2], imagePrompt: parts.slice(3).join(' ') };
  if (parts.length >= 2) return { name: parts[0], description: parts[1], recommendation: parts.slice(2).join(' '), imagePrompt: '' };
  const match = /^([^：:]{1,60})[：:]\s*(.+)$/.exec(theme.trim());
  return match ? { name: match[1].trim(), description: match[2].trim(), recommendation: '', imagePrompt: '' } : { name: theme.trim(), description: '', recommendation: '', imagePrompt: '' };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/**
 * Light's 新商品企画 / 顧客提案 show their sources only inside the research report (read 2026-11-12, tasks of 2026-11-12): no
 * list in the chat or in 概要. The report ends with a source index table (顧客提案: 「ソース一覧」 SOURCE INDEX, columns
 * ID / ソース / 内容 / 区分, rows S01–S11, the first 区分 「EC実商品(収集 2026-11-11)」) and each evidence card has
 * 「ソースを見る」 to the page itself (target="_blank" rel="noopener noreferrer"; 15 links, 6 in the 新商品企画 report). Heavy
 * has no product cards, so the link sits in the row. At most 15 rows: the most links seen in Light's reports.
 */
export const AGENT_REPORT_SOURCES_MAX = 15;
/** Light's 新商品企画 report linked 6 product pages; at most that many of the 15 rows are kept for shop pages. */
export const AGENT_REPORT_SHOP_ROWS = 6;
/**
 * The report's rows: the research's shop search adds its product pages after the broad search's pages, so up to 6 shop
 * pages keep their place among the 15 rows (the evidence can show real products, as Light's does), in the research's order.
 */
export function agentReportSourceList<T extends { url: string }>(sources: readonly T[], products: readonly { url: string }[] = []): T[] {
  // Yahoo!ショッピング's products come first, as Light's index starts with its real products (「EC実商品」); then the shop pages.
  const real = new Set(products.map(product => product.url));
  const listed = sources.filter(source => real.has(source.url)).slice(0, AGENT_REPORT_SHOP_ROWS);
  const shops = sources.filter(source => !real.has(source.url) && agentSourceKind(source.url) === 'EC').slice(0, listed.length ? Math.ceil(AGENT_REPORT_SHOP_ROWS / 2) : AGENT_REPORT_SHOP_ROWS);
  const rest = sources.filter(source => !real.has(source.url) && !shops.includes(source));
  return [...listed, ...[...shops, ...rest].slice(0, AGENT_REPORT_SOURCES_MAX - listed.length).sort((a, b) => sources.indexOf(a) - sources.indexOf(b))];
}
/** The 区分 of a row: 「EC実商品(収集 YYYY-MM-DD)」 for Yahoo!ショッピング's products, as Light writes its own, else the site's kind. */
export function agentReportRowKind(url: string, products: readonly AgentProduct[] = []): string {
  const product = products.find(item => item.url === url);
  return product ? `EC実商品${product.at ? `(収集 ${product.at})` : ''}` : agentSourceKind(url);
}
const EC_SITES = new Set(['rakuten.co.jp', 'amazon.co.jp', 'amazon.com', 'zozo.jp', 'tmall.com', 'taobao.com', 'jd.com', 'vip.com', 'shein.com', 'temu.com',
  'nordstrom.com', 'macys.com', 'poshmark.com', 'depop.com', 'thredup.com', 'ebay.com', 'walmart.com', 'etsy.com', 'minne.com', 'creema.jp', 'qoo10.jp',
  'mercari.com', 'buyma.com', 'magaseek.com', 'locondo.jp', 'asos.com', 'farfetch.com', 'net-a-porter.com', 'mytheresa.com', 'ssense.com', 'revolve.com',
  'dhgate.com', 'aliexpress.com', 'kakaku.com', 'brandear.jp', 'thebase.in', 'tsuku2.jp', 'modaoperandi.com']);
const SNS_SITES = new Set(['instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'pinterest.com', 'pinterest.jp', 'threads.net', 'threads.com', 'facebook.com',
  'reddit.com', 'youtube.com', 'youtu.be', 'xiaohongshu.com', 'weibo.com', 'douyin.com', 'kuaishou.com', 'wear.jp', 'lemon8-app.com']);
const cut = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
// Shops that live under a site that is not a shop as a whole (shopping.yahoo.co.jp under yahoo.co.jp).
const EC_HOSTS = new Set(['shopping.yahoo.co.jp', 'paypaymall.yahoo.co.jp', 'store.shopping.yahoo.co.jp']);
/** The 区分 of a source in the report's index, from its site (Light: EC実商品 / SNS / トレンド予測 …; Heavy's research is a web search). */
export function agentSourceKind(url: string): 'EC' | 'SNS' | 'ウェブ' {
  const site = agentSourceSite(url);
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { /* not a URL */ }
  return EC_SITES.has(site) || EC_HOSTS.has(host) ? 'EC' : SNS_SITES.has(site) ? 'SNS' : 'ウェブ';
}
/**
 * The ソース cell as Light writes it: the site, then where on it in parentheses (「ZOZOTOWN IEDIT(goods/102817265)」). Heavy
 * writes the registered site and the page's path (「zozo.jp(ranking/category/tops/vest/all-sales-women.html)」).
 */
export function agentSourceLabel(url: string): string {
  const site = agentSourceSite(url);
  let path = '';
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`.replace(/^\/+|\/+$/g, '');
    try { path = decodeURIComponent(path); } catch { /* keep it encoded */ }
  } catch { return url; }
  return path ? `${site}(${cut(path, 48)})` : site;
}
const localDate = (value?: string) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
function reportSourceIndex(research: ParsedResearch | null, collectedAt?: string): string {
  const head = '<div class="index-head"><h2>ソース一覧</h2><span class="index-label">SOURCE INDEX</span></div>';
  if (!research?.sources.length) return `<section class="index">${head}<p class="muted">${research?.search === 'ok' ? '参照した資料はありません。' : 'ウェブ検索を使えませんでした。この調査結果はAIモデルの知識に基づいています。'}</p></section>`;
  const collected = localDate(collectedAt);
  const rows = agentReportSourceList(research.sources, research.products).map((source, index) => {
    // 内容: the sentence the research cited from the page (the search tool's Markdown, so its escapes such as \\ are undone),
    // or else the page's title.
    const content = source.quote ? cleanAgentQuote(source.quote).replace(/\*\*/g, '').replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, '$1')
      : source.title !== source.url ? source.title : '';
    const product = research.products?.some(item => item.url === source.url);
    const kind = product ? agentReportRowKind(source.url, research.products) : `${agentSourceKind(source.url)}${index === 0 && collected ? `(収集 ${collected})` : ''}`;
    return `<tr><td>S${String(index + 1).padStart(2, '0')}</td><td>${escapeHtml(agentSourceLabel(source.url))}<br><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">ソースを見る</a></td>`
      + `<td>${escapeHtml(cut(content, 160))}</td><td>${escapeHtml(kind)}</td></tr>`;
  }).join('');
  return `<section class="index">${head}<table><thead><tr><th>ID</th><th>ソース</th><th>内容</th><th>区分</th></tr></thead><tbody>${rows}</tbody></table>`
    + `${collected ? '<p class="muted">※ 収集日はウェブ検索でページを集めた日であり、各ページの公開日ではありません。</p>' : ''}</section>`;
}

/** Light's 「調査とビジュアル方向」 HTML report (オンラインで表示 / ダウンロード): built from the stored research, every value escaped. */
export function buildAgentResearchReportHtml(task: AgentTask): string {
  const research = task.research?.state === 'completed' && task.research.content ? parseAgentResearch(task.research.content) : null;
  const round = [...task.rounds].reverse().find(entry => entry.step.state === 'completed' && entry.themes.length);
  const scope = task.scope ? agentScopeSummary(task.scope) : '';
  const sections = (research?.sections.length ? research.sections : research ? [{ heading: '調査結果', items: research.report.split('\n').filter(Boolean) }] : [])
    .map(section => `<section><h2>${escapeHtml(section.heading)}</h2><ul>${section.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`).join('');
  const directions = round ? `<section><h2>ビジュアル方向性の候補</h2>${round.themes.map(theme => { const d = parseAgentDirection(theme);
    return `<div class="card"><h3>${escapeHtml(d.name)}</h3>${d.description ? `<p>${escapeHtml(d.description)}</p>` : ''}${d.recommendation ? `<p class="muted">${escapeHtml(d.recommendation)}</p>` : ''}</div>`; }).join('')}</section>` : '';
  // The research runs as soon as the scope is confirmed; its step keeps no time of its own.
  const sources = reportSourceIndex(research, task.research?.at ?? task.scope?.at);
  // Yahoo!ショッピング's products as Light's evidence cards: the image on Yahoo!'s address, the price, 「ソースを見る」 to the page,
  // and Yahoo!'s credit unchanged at the bottom.
  const products = research?.products?.length ? `<section><h2>EC実商品</h2><div class="products">${research.products.map(product =>
    `<figure class="product"><a href="${escapeHtml(product.url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy"></a>`
    + `<figcaption><b>${escapeHtml(product.name)}</b>${product.price !== null ? `<br>${escapeHtml(agentYen(product.price))}` : ''}<br><span class="muted">${escapeHtml([product.store, product.at ? `収集 ${product.at}` : ''].filter(Boolean).join(' / '))}</span>`
    + `<br><a href="${escapeHtml(product.url)}" target="_blank" rel="noopener noreferrer">ソースを見る</a></figcaption></figure>`).join('')}</div></section>` : '';
  const credit = research?.products?.length ? `<footer class="credit">${YAHOO_ATTRIBUTION_HTML}</footer>` : '';
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>調査とビジュアル方向レポート</title>
<style>:root{color-scheme:light dark;--bg:#ffffff;--fg:#1d2324;--muted:#5d6869;--line:#dfe5e5;--accent:#078e85}@media (prefers-color-scheme:dark){:root{--bg:#171b1c;--fg:#e8eeee;--muted:#9aa6a7;--line:#2f3537;--accent:#5fe3d8}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}main{max-width:760px;margin:0 auto;padding:32px 16px 64px}h1{font-size:24px;margin:0 0 8px}h2{font-size:17px;color:var(--accent);margin:28px 0 8px}h3{font-size:15px;margin:0 0 4px}.muted{color:var(--muted)}.card{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:10px 0}a{color:var(--accent)}ul,ol{padding-left:20px}.index-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:2px solid var(--accent);margin:28px 0 12px;padding-bottom:6px}.index-head h2{margin:0}.index-label{font-size:12px;letter-spacing:.12em;color:var(--accent)}table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px;line-height:1.6}th{background:var(--accent);color:var(--bg);text-align:left;font-weight:600}th,td{border:1px solid var(--line);padding:6px 8px;vertical-align:top;overflow-wrap:anywhere}td:first-child{white-space:nowrap}th:nth-child(1){width:7%}th:nth-child(2){width:31%}th:nth-child(3){width:42%}th:nth-child(4){width:20%}.products{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}.product{margin:0;font-size:13px;line-height:1.6}.product img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:#fff}.credit{margin-top:32px}</style></head>
<body><main><h1>調査とビジュアル方向レポート</h1><p class="muted">${escapeHtml(task.prompt)}</p>${scope ? `<p class="muted">調査範囲：${escapeHtml(scope)}</p>` : ''}${sections}${products}${directions}${sources}${credit}</main></body></html>`;
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
