import type { AgentAssistantStep, AgentTask } from './agentFlow';

/**
 * Light's テーマ企画 asks for what its plan needs before it searches (read 2026-11-12 from its past tasks, which cannot be run
 * again on this account): 「デザイン企画書を作成するにあたり、以下の情報が必要です。お手数ですが、補足をお願いいたします。」 with
 * these four items, under a 「デザイン依頼」 card the user answers in words; then it asks again only for what the answer left
 * out (「デザイン企画書作成のために、以下の情報が必要です。追加情報をお願いいたします。」), and searches once all four are known.
 * A request that names them all goes straight to the search (its ZIMMERMANN task). The task is then named after them:
 * 「ZIMMERMANN風 2026年 Womenデザイン企画」, 「Kariyushi風 2026年 デザイン企画」 (no field); without a brand it keeps its name.
 */
export const AGENT_HEARING_ITEMS = [
  'デザインするアイテムのカテゴリー範囲（例：ジャケット、パンツ、スウェット、シャツ、セーター、スカート、コートなど）',
  'アパレル分野（例：ウィメンズ、メンズ、ボーイズ、ガールズ、キッズなど）',
  'アパレルブランド（特定のブランドがない場合は、「指定なし」とご記入ください）',
  'シーズン・年（例：RESORT 2025、SPRING-SUMMER 2025、PRE-FALL 2025、FALL/WINTER 2025など）',
] as const;
export const AGENT_HEARING_FIRST = 'デザイン企画書を作成するにあたり、以下の情報が必要です。お手数ですが、補足をお願いいたします。';
export const AGENT_HEARING_AGAIN = 'デザイン企画書作成のために、以下の情報が必要です。追加情報をお願いいたします。';
/** Light asked three times in its longest task; after the third answer the search starts with what is known. */
export const AGENT_HEARING_MAX_ASKS = 3;
const FIELDS = ['Women', 'Men', 'Kids', 'Boys', 'Girls', 'Unisex'] as const;

/** `title`: set once the hearing is done (null: the task keeps its name). Tasks made before it have no `hearing`. */
export type AgentHearing = { steps: AgentAssistantStep[]; answers: Array<{ text: string; at: string }>; title?: string | null };
export type ParsedHearing = { missing: number[]; brand: string; year: string; field: string };
export type AgentHearingState =
  | { kind: 'none' } | { kind: 'start' } | { kind: 'running'; step: AgentAssistantStep } | { kind: 'failed'; step: AgentAssistantStep }
  | { kind: 'ask'; missing: number[]; index: number } | { kind: 'done'; parsed: ParsedHearing };

export function agentHearingPrompt(task: Pick<AgentTask, 'prompt' | 'hearing'>): string {
  const answers = task.hearing?.answers ?? [];
  return [
    'あなたはアパレル企業のデザイン企画アシスタントです。ユーザーからテーマ企画（デザイン企画書）の依頼がありました。',
    `依頼: ${task.prompt.slice(0, 2000)}`,
    answers.length ? `これまでのユーザーの補足:\n${answers.map((answer, index) => `${index + 1}. ${answer.text.slice(0, 600)}`).join('\n')}` : '',
    'デザイン企画書を作るには、次の4つの情報が必要です。',
    '1. デザインするアイテムのカテゴリー範囲',
    '2. アパレル分野（ウィメンズ・メンズ・キッズ・ユニセックスなど、性別や年齢層）',
    '3. アパレルブランド（特定のブランドが無いなら「指定なし」でよい。「指定なし」「ブランドは指定しない」と書かれていれば分かったものとする）',
    '4. シーズン・年',
    '依頼と補足から読み取れるものは分かったものとし、次の4行だけを答えてください。',
    '[不足] 分からない項目の番号を「|」で区切って（例: 1|4）。すべて分かれば「なし」',
    '[ブランド] 依頼にあるブランド名（指定なし・分からないときは空）',
    '[年] シーズンの西暦4桁（分からないときは空）',
    `[分野] ${FIELDS.join('・')} のどれか（分からないときは空）`,
  ].filter(Boolean).join('\n');
}

const line = (content: string, label: string) => new RegExp(`^\\s*\\[${label}\\][^\\S\\n]*(.*)$`, 'm').exec(content)?.[1]?.trim() ?? '';
/** The answer's four lines. An answer without the [不足] line counts as nothing missing, so a stray reply never blocks the task. */
export function parseAgentHearing(content: string): ParsedHearing {
  const missing = [...new Set([...line(content, '不足').matchAll(/[1-4１-４]/g)].map(match => Number(match[0].normalize('NFKC'))))].sort((a, b) => a - b);
  const brand = line(content, 'ブランド').replace(/^(指定なし|なし|不明|空)$/, '').replace(/["「」『』]/g, '').slice(0, 40);
  const year = /(?:19|20)\d{2}/.exec(line(content, '年').normalize('NFKC'))?.[0] ?? '';
  const fieldText = line(content, '分野');
  const field = FIELDS.find(value => new RegExp(`^${value}$`, 'i').test(fieldText)) ?? '';
  return { missing, brand, year, field };
}

export function agentHearingState(task: Pick<AgentTask, 'hearing'>): AgentHearingState {
  const hearing = task.hearing;
  if (!hearing) return { kind: 'none' };
  const last = hearing.steps.at(-1);
  if (!last) return { kind: 'start' };
  if (last.state === 'running') return { kind: 'running', step: last };
  if (last.state !== 'completed') return { kind: 'failed', step: last };
  const parsed = parseAgentHearing(last.content ?? '');
  if (parsed.missing.length && hearing.answers.length < hearing.steps.length) return { kind: 'ask', missing: parsed.missing, index: hearing.steps.length - 1 };
  if (parsed.missing.length && hearing.steps.length < AGENT_HEARING_MAX_ASKS) return { kind: 'start' };
  return { kind: 'done', parsed };
}

/** Light's name for the task: 「<ブランド>風 <年>年 <分野>デザイン企画」; null without a brand (it keeps its name). */
export function agentHearingTitle(parsed: ParsedHearing): string | null {
  if (!parsed.brand) return null;
  return `${parsed.brand}風 ${parsed.year ? `${parsed.year}年 ` : ''}${parsed.field}デザイン企画`;
}

/** The user's answers, for the research, theme and plan requests. */
export function agentHearingLines(task: Pick<AgentTask, 'hearing'>): string[] {
  const answers = task.hearing?.answers ?? [];
  return answers.length ? [`ユーザーが補足した企画の条件（カテゴリー範囲・分野・ブランド・シーズン）:\n${answers.map(answer => `- ${answer.text.slice(0, 600)}`).join('\n')}`] : [];
}
