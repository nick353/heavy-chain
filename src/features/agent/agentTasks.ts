import { cloudflareDataPlane, type CloudflareCanvasDocument, type CloudflareDesignAssistantReceipt } from '../../lib/cloudflareApi';

/**
 * Heavy's planning agent (/agent). Light runs a multi-step planner: a market/trend summary, a set of design themes
 * the user confirms (確認待ち), then the planning document. Heavy keeps the same steps on its own services: each task
 * is one canvas document whose snapshot carries `agentTask`; text steps are design-assistant requests and the visual
 * is an image job. Request identities are written to the document before they are sent, so a reload re-reads the
 * same request instead of sending another one.
 */
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
export type AgentRound = { step: AgentAssistantStep; summary: string; themes: string[] };
export type AgentImageStep = { requestId: string; state: AgentStepState; prompt: string; jobId?: string; imageId?: string; storagePath?: string; errorCode?: string };
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
  choice: { theme: string; at: string } | null;
  plan: AgentAssistantStep | null;
  image: AgentImageStep | null;
};
export type AgentTaskDocument = { id: string; title: string; revision: number; updatedAt: string; task: AgentTask; snapshot: Record<string, unknown> };

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const api = () => { if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured'); return cloudflareDataPlane; };

export function readAgentTask(snapshot: unknown): AgentTask | null {
  if (!record(snapshot) || !record(snapshot.agentTask)) return null;
  const task = snapshot.agentTask;
  if (task.kind !== AGENT_TASK_KIND || task.version !== 1 || typeof task.prompt !== 'string') return null;
  if (!AGENT_SCENES.includes(task.scene as AgentScene) || typeof task.subtype !== 'string' || !Array.isArray(task.rounds)) return null;
  return task as unknown as AgentTask;
}

export function toAgentTaskDocument(document: CloudflareCanvasDocument): AgentTaskDocument | null {
  const task = readAgentTask(document.snapshot);
  if (!task) return null;
  return { id: document.id, title: document.title, revision: document.revision, updatedAt: document.updated_at, task, snapshot: document.snapshot as Record<string, unknown> };
}

/** Light names a task 「クリエイティブ企画YYYYMMDDHH」 until the plan names it. */
export function defaultAgentTaskTitle(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `クリエイティブ企画${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}`;
}

const PROMPT_TITLE_LENGTH = 24;

/** Until the plan names the task, the start of the request tells tasks apart better than the hour it was made. */
export function promptAgentTaskTitle(prompt: string, now = new Date()) {
  const text = prompt.replace(/\s+/g, ' ').trim();
  if (!text) return defaultAgentTaskTitle(now);
  return text.length > PROMPT_TITLE_LENGTH ? `${text.slice(0, PROMPT_TITLE_LENGTH)}…` : text;
}

/** True while the title is still the automatic one, so the plan's title may replace it. */
export function isAutomaticAgentTaskTitle(title: string, task: Pick<AgentTask, 'prompt'>) {
  return title.startsWith('クリエイティブ企画') || title === promptAgentTaskTitle(task.prompt);
}

export async function listAgentTasks(brandId: string): Promise<AgentTaskDocument[]> {
  const documents = await api().listCanvasDocuments(brandId);
  return documents.map(toAgentTaskDocument).filter((value): value is AgentTaskDocument => Boolean(value))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadAgentTask(taskId: string): Promise<AgentTaskDocument | null> {
  return toAgentTaskDocument(await api().getCanvasDocument(taskId));
}

export async function createAgentTask(input: { brandId: string; scene: AgentScene; subtype: string; prompt: string; profile: string; project: string | null }): Promise<AgentTaskDocument> {
  const id = crypto.randomUUID();
  const title = promptAgentTaskTitle(input.prompt);
  const task: AgentTask = { kind: AGENT_TASK_KIND, version: 1, scene: input.scene, subtype: input.subtype, prompt: input.prompt.slice(0, 2400),
    profile: input.profile.slice(0, 800), project: input.project, createdAt: new Date().toISOString(), rounds: [], choice: null, plan: null, image: null };
  const created = await api().createCanvasDocument({ id, brand_id: input.brandId, title, snapshot: { version: 1, name: title, objects: [], agentTask: task } });
  const document = toAgentTaskDocument(created);
  if (!document) throw new Error('agent_task_create_failed');
  return document;
}

/** Applies `change` to the stored task, re-reading once on a revision conflict so concurrent writes are not lost. */
export async function updateAgentTask(document: AgentTaskDocument, change: (task: AgentTask) => AgentTask, extra?: { title?: string; objects?: unknown[] }): Promise<AgentTaskDocument> {
  let current = document;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const task = change(current.task);
    const snapshot = { ...current.snapshot, ...(extra?.objects ? { objects: extra.objects } : {}), agentTask: task, name: extra?.title ?? current.title };
    try {
      const saved = await api().updateCanvasDocument({ documentId: current.id, expected_revision: current.revision, title: extra?.title ?? current.title, snapshot });
      const next = toAgentTaskDocument(saved);
      if (!next) throw new Error('agent_task_update_failed');
      return next;
    } catch (error) {
      if (attempt === 2 || !String((error as Error)?.message ?? error).includes('conflict')) throw error;
      const fresh = await loadAgentTask(current.id);
      if (!fresh) throw error;
      current = fresh;
    }
  }
  throw new Error('agent_task_update_failed');
}

const sceneGuide: Record<AgentScene, string> = {
  商品企画: '市場・顧客・トレンドを踏まえた商品企画',
  顧客提案: 'クライアント向けの商品提案',
  インスピレーション: 'デザインのインスピレーションと方向性',
  AIグラフィックデザイン: '衣服向けのプリント・グラフィックデザイン',
};

export function themePrompt(task: AgentTask): string {
  const previous = task.rounds.flatMap((round) => round.themes);
  return [
    `あなたはアパレル企業の企画担当アシスタントです。業務シーン: ${task.scene}（${task.subtype}）。目的: ${sceneGuide[task.scene]}。`,
    task.profile ? `会社・ブランドの業務プリファレンス: ${task.profile}` : '',
    `依頼: ${task.prompt}`,
    previous.length ? `前回提案したテーマ（${previous.join(' / ')}）は採用されませんでした。方向性の違う新しいテーマを提案してください。` : '',
    '次の形式だけで、日本語で答えてください。',
    '[概要]',
    '依頼に関係する市場・トレンド・着用シーンの要点を4〜6文で書く。あなたの知識に基づいて書き、出典やURLは書かない。',
    '[テーマ]',
    '- テーマ名：一文の説明',
    'の形式でちょうど4行。',
  ].filter(Boolean).join('\n');
}

export function planPrompt(task: AgentTask, theme: string): string {
  return [
    `あなたはアパレル企業の企画担当アシスタントです。業務シーン: ${task.scene}（${task.subtype}）。`,
    task.profile ? `会社・ブランドの業務プリファレンス: ${task.profile}` : '',
    `依頼: ${task.prompt}`,
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

export function assistantStepFrom(receipt: CloudflareDesignAssistantReceipt, requestId: string): AgentAssistantStep {
  return { requestId, state: receipt.state, ...(receipt.content ? { content: receipt.content.slice(0, 12000) } : {}), ...(receipt.errorCode ? { errorCode: receipt.errorCode } : {}) };
}

export const agentConversationId = (taskId: string, step: string) => `${AGENT_TASK_CONVERSATION_PREFIX}${taskId.slice(0, 36)}-${step}`;

export function agentProfileKey(userId: string, brandId: string) { return `heavy:agent-profile:v1:${userId}:${brandId}`; }
export function readAgentProfile(userId: string, brandId: string): string {
  try { return (localStorage.getItem(agentProfileKey(userId, brandId)) ?? '').slice(0, 800); } catch { return ''; }
}
export function writeAgentProfile(userId: string, brandId: string, value: string) {
  try { localStorage.setItem(agentProfileKey(userId, brandId), value.slice(0, 800)); } catch { /* storage unavailable */ }
}

/** Projects group planning tasks (Light: 新規ファイル → プロジェクトを作成). Names are kept per user and brand. */
export function agentProjectsKey(userId: string, brandId: string) { return `heavy:agent-projects:v1:${userId}:${brandId}`; }
export function readAgentProjects(userId: string, brandId: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(agentProjectsKey(userId, brandId)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.slice(0, 40)).slice(0, 50) : [];
  } catch { return []; }
}
export function addAgentProject(userId: string, brandId: string, name: string): string[] {
  const trimmed = name.trim().slice(0, 40);
  const next = [trimmed, ...readAgentProjects(userId, brandId).filter((value) => value !== trimmed)].slice(0, 50);
  try { localStorage.setItem(agentProjectsKey(userId, brandId), JSON.stringify(next)); } catch { /* storage unavailable */ }
  try { window.dispatchEvent(new Event('heavy-agent-projects')); } catch { /* no window */ }
  return next;
}
