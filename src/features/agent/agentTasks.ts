import { cloudflareDataPlane, type CloudflareCanvasDocument, type CloudflareDesignAssistantReceipt } from '../../lib/cloudflareApi';

/**
 * Heavy's planning agent (/agent). Light runs a multi-step planner: a market/trend summary, a set of design themes
 * the user confirms (確認待ち), then the planning document. Heavy keeps the same steps on its own services: each task
 * is one canvas document whose snapshot carries `agentTask`; text steps are design-assistant requests and the visual
 * is an image job. Request identities are written to the document before they are sent, so a reload re-reads the
 * same request instead of sending another one.
 */
export * from './agentFlow';
import { AGENT_DIALOGUE_SCENES } from './agentDialogue';
import { AGENT_TASK_CONVERSATION_PREFIX, AGENT_TASK_KIND, readAgentTask, type AgentAssistantStep, type AgentAttachment, type AgentScene, type AgentTask, type AgentTaskDocument } from './agentFlow';
export * from './agentMerch';
export * from './agentDialogue';
export * from './agentReport';
export * from './agentProducts';

const api = () => { if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured'); return cloudflareDataPlane; };


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

export const AGENT_CONVERSATION_SUBTYPES: readonly string[] = ['新商品企画', '顧客提案'];
export async function createAgentTask(input: { brandId: string; scene: AgentScene; subtype: string; prompt: string; profile: string; project: string | null; attachments?: AgentAttachment[] }): Promise<AgentTaskDocument> {
  const id = crypto.randomUUID();
  const title = promptAgentTaskTitle(input.prompt);
  const task: AgentTask = { kind: AGENT_TASK_KIND, version: 1, scene: input.scene, subtype: input.subtype, prompt: input.prompt.slice(0, 2400),
    profile: input.profile.slice(0, 800), project: input.project, createdAt: new Date().toISOString(), rounds: [], choice: null, plan: null, image: null,
    // Light runs the conversation (requirements → research scope → research → directions → 商品構成 → AI designs → plan) for
    // 新商品企画 (planMode=newProduct) and 顧客提案 (planMode=clientProposal, 2026-11-12); its テーマ企画 (planMode=plan) goes
    // straight to the themes, with web sources under 参考資料.
    // Its インスピレーション and AIグラフィックデザイン are one chat (questions → directions → reference images → 執行書 → 開始).
    ...(AGENT_CONVERSATION_SUBTYPES.includes(input.subtype) ? { flow: 'conversation' as const, requirements: null, notes: [], aligned: null, scope: null, research: null }
      : AGENT_DIALOGUE_SCENES.includes(input.scene) ? { flow: 'dialogue' as const, turns: [], dialogueStart: null, notes: [] } : { notes: [] }),
    ...(input.attachments?.length ? { attachments: input.attachments.slice(0, 12) } : {}) };
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

/** Light's task menu: 名前を変更 keeps the task and only changes its title. */
export async function renameAgentTask(document: AgentTaskDocument, title: string): Promise<AgentTaskDocument> {
  return updateAgentTask(document, (task) => task, { title: title.trim().slice(0, 120) });
}
/** Light's task menu: 削除 removes the task's document. */
export async function deleteAgentTask(taskId: string): Promise<void> {
  await api().deleteCanvasDocument(taskId);
}

/**
 * How much of a reply the task keeps. The research (report, sources, cited sentences, shop products) and the AI's slides
 * are longer than the other replies: production 2026-11-12 kept the first 12,000 characters of 13,467- and 16,952-character
 * slides, so they lost their last pages and the page showed the fixed report; the research's `[引用]` block at its end was
 * at risk the same way. The task document holds up to 512 KB.
 */
export const AGENT_STEP_CONTENT_MAX = 12000;
export const agentStepContentMax = (kind: string) => (kind === 'report' ? 120_000 : kind === 'research' ? 40_000 : AGENT_STEP_CONTENT_MAX);
export function assistantStepFrom(receipt: CloudflareDesignAssistantReceipt, requestId: string, maxChars = AGENT_STEP_CONTENT_MAX): AgentAssistantStep {
  return { requestId, state: receipt.state, ...(receipt.content ? { content: receipt.content.slice(0, maxChars) } : {}), ...(receipt.errorCode ? { errorCode: receipt.errorCode } : {}) };
}

export const agentConversationId = (taskId: string, step: string) => `${AGENT_TASK_CONVERSATION_PREFIX}${taskId.slice(0, 36)}-${step}`;

export function agentProfileKey(userId: string, brandId: string) { return `heavy:agent-profile:v1:${userId}:${brandId}`; }
export function readAgentProfile(userId: string, brandId: string): string {
  try { return (localStorage.getItem(agentProfileKey(userId, brandId)) ?? '').slice(0, 800); } catch { return ''; }
}
export function writeAgentProfile(userId: string, brandId: string, value: string) {
  try { localStorage.setItem(agentProfileKey(userId, brandId), value.slice(0, 800)); } catch { /* storage unavailable */ }
}

/** Light's 業務プリファレンスプロファイル (/agent/profiles): named business scopes; the chosen one is added to every planning request. */
export type AgentPreferenceProfile = {
  id: string; name: string; categories: string[]; priceMin: string; priceMax: string; currency: string;
  countries: string[]; ages: string[]; channels: string[]; brands: string[]; visual: string; updatedAt: string;
  /** Light's 資料ファイル: the names of the analysed materials and the planning facts read from them. */
  materials?: Array<{ name: string; size: number }>; materialsSummary?: string;
};
export const AGENT_PROFILE_CATEGORIES = ['メンズ', 'レディース', 'キッズ'] as const;
export const AGENT_PROFILE_COUNTRIES = ['中国', '日本', '北米', 'ヨーロッパ', 'アフリカ'] as const;
export const AGENT_PROFILE_AGES = ['0〜18歳', '19〜24歳', '25〜34歳', '35〜44歳', '45〜65歳'] as const;
export const AGENT_PROFILE_CURRENCIES = ['JPY', 'CNY', 'USD', 'EUR'] as const;
export function agentProfilesKey(userId: string, brandId: string) { return `heavy:agent-profiles:v1:${userId}:${brandId}`; }
export function agentActiveProfileKey(userId: string, brandId: string) { return `heavy:agent-profile-active:v1:${userId}:${brandId}`; }
const stringList = (value: unknown, limit: number) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.slice(0, 60)).slice(0, limit) : [];
export function readAgentProfiles(userId: string, brandId: string): AgentPreferenceProfile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(agentProfilesKey(userId, brandId)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string').map((item) => ({
      id: item.id, name: String(item.name).slice(0, 60), categories: stringList(item.categories, 3), priceMin: String(item.priceMin ?? '').slice(0, 12),
      priceMax: String(item.priceMax ?? '').slice(0, 12), currency: String(item.currency ?? '').slice(0, 3), countries: stringList(item.countries, 5),
      ages: stringList(item.ages, 5), channels: stringList(item.channels, 20), brands: stringList(item.brands, 20), visual: String(item.visual ?? '').slice(0, 500),
      updatedAt: String(item.updatedAt ?? ''),
      materials: Array.isArray(item.materials) ? item.materials.filter((file: { name?: unknown }) => typeof file?.name === 'string').slice(0, 8)
        .map((file: { name: string; size?: unknown }) => ({ name: file.name.slice(0, 120), size: Number(file.size) || 0 })) : [],
      materialsSummary: String(item.materialsSummary ?? '').slice(0, 300),
    }));
  } catch { return []; }
}
/** The planning request reads one plain-text profile; this is the chosen profile written out. */
export function describeAgentProfile(profile: AgentPreferenceProfile): string {
  return [
    `プロファイル：${profile.name}`,
    profile.categories.length ? `カテゴリー：${profile.categories.join('・')}` : '',
    profile.priceMin || profile.priceMax ? `価格帯：${profile.priceMin || '—'}〜${profile.priceMax || '—'} ${profile.currency}`.trim() : '',
    profile.countries.length ? `国：${profile.countries.join('・')}` : '',
    profile.ages.length ? `年齢層：${profile.ages.join('・')}` : '',
    profile.channels.length ? `チャネル：${profile.channels.join('・')}` : '',
    profile.brands.length ? `参考ブランド：${profile.brands.join('・')}` : '',
    profile.visual ? `ビジュアルの好み：${profile.visual}` : '',
    profile.materialsSummary ? `資料の要点：${profile.materialsSummary}` : '',
  ].filter(Boolean).join('\n').slice(0, 800);
}
export function readActiveAgentProfileId(userId: string, brandId: string): string | null {
  try { return localStorage.getItem(agentActiveProfileKey(userId, brandId)); } catch { return null; }
}
/** Chooses the profile used for new tasks (null clears it). */
export function selectAgentProfile(userId: string, brandId: string, profile: AgentPreferenceProfile | null) {
  try {
    if (profile) localStorage.setItem(agentActiveProfileKey(userId, brandId), profile.id); else localStorage.removeItem(agentActiveProfileKey(userId, brandId));
  } catch { /* storage unavailable */ }
  writeAgentProfile(userId, brandId, profile ? describeAgentProfile(profile) : '');
  try { window.dispatchEvent(new Event('heavy-agent-profiles')); } catch { /* no window */ }
}
export function saveAgentProfile(userId: string, brandId: string, profile: AgentPreferenceProfile) {
  const next = [profile, ...readAgentProfiles(userId, brandId).filter((item) => item.id !== profile.id)].slice(0, 50);
  try { localStorage.setItem(agentProfilesKey(userId, brandId), JSON.stringify(next)); } catch { /* storage unavailable */ }
  // A new or edited profile becomes the one used for new tasks, like Light applying it at task start.
  selectAgentProfile(userId, brandId, profile);
}
export function deleteAgentProfile(userId: string, brandId: string, profileId: string) {
  const next = readAgentProfiles(userId, brandId).filter((item) => item.id !== profileId);
  try { localStorage.setItem(agentProfilesKey(userId, brandId), JSON.stringify(next)); } catch { /* storage unavailable */ }
  if (readActiveAgentProfileId(userId, brandId) === profileId) selectAgentProfile(userId, brandId, null);
  else try { window.dispatchEvent(new Event('heavy-agent-profiles')); } catch { /* no window */ }
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
