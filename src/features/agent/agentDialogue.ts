/**
 * Light's インスピレーション and AIグラフィックデザイン run as one chat (recorded 2026-11-11/12): the assistant analyses the
 * request and reference images and asks, the user answers in the chat or in a form, reference images are searched and
 * picked, a 執行書 lists every style, and 「開始」 generates one image per style (Light: 15). Heavy keeps each turn in the
 * task, sends the earlier turns as the chat history and generates the styles with its own image service. Pure: no
 * runtime imports, so tests read it directly.
 */
import { agentAttachmentLines, agentImagePrompt, AGENT_PROMPT_BUDGET, type AgentSource, type AgentStyleImage, type AgentTask, type AgentTurn } from './agentFlow.ts';
import type { AssistantQuestion } from '../designDetail/assistantQuestions';

export type { AgentTurn } from './agentFlow.ts';
export type AgentDialogueSearch = { title: string; query: string };
export type AgentDialogueSku = { code: string; name: string; group: string; logic: string; prompt: string };
export type AgentDialogueReply = {
  body: string; questions: AssistantQuestion[]; searches: AgentDialogueSearch[]; skus: AgentDialogueSku[]; series: string; start: boolean;
  sources: AgentSource[]; search: 'ok' | 'unavailable' | 'error' | null;
};

export const AGENT_DIALOGUE_SCENES: readonly string[] = ['インスピレーション', 'AIグラフィックデザイン'];
export const AGENT_DIALOGUE_SKU_LIMIT = 15;
export const AGENT_DIALOGUE_TURN_LIMIT = 40;
export const agentUsesDialogue = (task: Pick<AgentTask, 'flow'>) => task.flow === 'dialogue';
const isGraphic = (task: Pick<AgentTask, 'scene'>) => task.scene === 'AIグラフィックデザイン';

const SKU_LINE = '｜';
const INSPIRATION_STAGES = [
  '1. 依頼と参考画像の解析: 参考画像があれば「ご提供いただいた参考画像を解析いたしました。」で始め、デザインの特徴（シルエット・ディテール・素材・色）を2〜3文でまとめる（画像がなければ依頼の要点をまとめる）。続けて「これらの特徴を残しつつ…、以下の点を確認させてください：」のように1文書き、結果を大きく左右する確認の質問を3〜4問、1問1行で「[Q single] 質問 | 選択肢 | 選択肢 …」（1つ選ぶ）または「[Q multi] 質問（複数選択可） | 選択肢 | …」（選択肢は2〜5個、短く）の形式で書く。例: 商業定位（独自性重視・量産・その中間）、参考画像の特徴をどの程度残すか（A: 核心のディテールを残しシルエットを簡素化／B: シルエットを残し装飾を減らす／C: 全体をシンプルにしエッセンスだけ残す）、ターゲット層・着用シーン、季節。',
  '2. デザイン方向の提案: 回答を踏まえてトレンドを調べ、「トレンド検索結果と需要分析に基づき、以下4つのデザイン方向を策定いたしました：」のあとに 方案A〜D を書く。各方案は「方案 A：【方向名 - 副題】」の行と「トレンド適合: …」「デザイン思路: …」「次段階の素材収集重点: …」の3行。最後に「どの方向がご希望に最も近いですか？複数選択や組み合わせも可能です。」と、例（「方案Aをメインに」「方案AとCを組み合わせて」）を書く。',
  '3. 参考素材の検索: 選ばれた方案を1文で確かめ（例:「方案C・Dに基づき、ジャケット・スウェットの参考素材を検索します」）、「[S] 話題（日本語） | 無料の写真ライブラリで探す英語の1〜3語」の行を2〜3行書く（例: [S] ドレープのトップス | draped blouse）。',
  '4. 最終デザイン執行書: 参考画像の選択を受けて書く。選択がなければ、先に「再検索を希望」「自分で画像を補充」「お任せで進行」の3つを1行ずつ説明して「どちらをご希望ですか？」と聞き、返事を受けてから書く。執行書は「【最終デザイン執行書：シリーズ名】」の行から始め、「1. 策略綜述」（15款を3つの波段 Phase 1〜3 に分け、各波段の目標・主に使う改款の手法・品類配分）、「2. 設計推演」（原始需求→確認方向→素材特性→衝突点と解決策を2〜3つ）、「3. 執行矩陣」（SKUごとに 素材調度・公式適用・商業目的・色彩 を1行ずつ短く）を書く。全体で3500字以内。',
  `   続けて生成用に、ちょうど15行の「[SKU] 01${SKU_LINE}スタイル名${SKU_LINE}区分（例: Phase 1：実穿基礎款）${SKU_LINE}設計ロジック（日本語1〜2文。使った手法と色彩を含める）${SKU_LINE}その商品1点の写真を作る英語の説明（服の種類・色・素材・シルエット・ディテール。人物・ブランド名・style という語は使わない）」と、「[シリーズ] シリーズ名」の1行を書く。最後に「この内容で問題ございませんか？修正のご要望があればお知らせください。確認いただければ、直ちに生成を開始いたします。」と聞く。`,
  '5. 生成の開始: 執行書のあとにユーザーが承認したら（開始・はい・お願いします など）「[開始]」の1行だけを書く。修正の依頼なら、直した執行書を4.の形式で全部書き直す。',
];
const GRAPHIC_STAGES = [
  '1. 図案の詳細の確認: 依頼を読み、「〇〇の詳細を確認させてください：」のあとに、モチーフの具体的な種類、用途（テキスタイル・Tシャツの配置プリントなど）、配色の具体的なイメージ、参考画像の有無を、それぞれ「例：…」つきで1問ずつ質問する。[Q] の行は使わない。',
  '2. 方向性の確認: 回答を受けて「デザインの方向性を確認させてください：」のあとに「A. シンプル実用デザイン」「B. 創造的抽象デザイン」を、それぞれこの依頼に合わせた1〜2行の説明つきで書き、「どちらの方向性をご希望されますか？（A または B でお答えください）」と聞く。',
  '3. 方案の提案: 「📋 デザイン方案提案」の行のあとに 方案A〜E を書く。各方案は「方案 A【方案名】」の行と「コンセプト：…」「モチーフ：…」「配色：…」「構図：…」「質感：…」の5行。最後に「ご希望の方案を1〜3つお選びください。選ばれた方案をベースに、各案5枚ずつの図案を生成いたします。」と、例（「A、B、C」「AとC」「Bのみ」）を書く。',
  '4. 参考画像の検索: 選ばれた方案を1文で確かめ、「[S] 話題（日本語。例: 青海波パターン） | 無料の写真ライブラリで探す英語の1〜3語（例: seigaiha pattern）」の行を2〜3行書く（モチーフの柄・質感・技法など）。',
  '5. 図案の執行書: 参考画像の選択を受けて書く。選択がなければ、先に「再検索を希望」「自分で画像を補充」「お任せで進行」の3つを1行ずつ説明して「どちらをご希望ですか？」と聞き、返事を受けてから書く。執行書は「【図案執行書：シリーズ名】」の行から始め、選ばれた方案ごとに、5枚の図案それぞれのモチーフの配置・配色・構図・リピートの種類を1行ずつ短く書く。全体で3000字以内。',
  `   続けて生成用に、選ばれた方案の数×5行の「[SKU] A-01${SKU_LINE}図案名${SKU_LINE}方案A【方案名】${SKU_LINE}設計ポイント（日本語1文）${SKU_LINE}その図案を作る英語の説明（モチーフ・配色・構図・リピートの種類・質感。人物・ブランド名・style という語は使わない）」と、「[シリーズ] シリーズ名」の1行を書く。最後に「この内容で問題ございませんか？修正のご要望があればお知らせください。確認いただければ、直ちに生成を開始いたします。」と聞く。`,
  '6. 生成の開始: 執行書のあとにユーザーが承認したら（開始・はい・お願いします など）「[開始]」の1行だけを書く。修正の依頼なら、直した執行書を5.の形式で全部書き直す。',
];
const RULES = [
  'これまでの会話を読み、いまの段階の返答だけを書いてください。段階を飛ばさないでください。ユーザーが途中で質問や修正を書いたときは、それに答えて同じ段階をやり直してください。',
  '日本語で、Markdown の見出し（#）・太字（**）・表は使わずに書いてください。[Q] [S] [SKU] [シリーズ] [開始] の行は、指示した段階でだけ使ってください。',
];

const contextLines = (task: AgentTask) => [
  isGraphic(task)
    ? 'あなたはアパレルブランドのグラフィックデザイナーのアシスタントです。業務: AIグラフィックデザイン（衣服やテキスタイル向けのプリント図案を、確認しながら作る）。'
    : 'あなたはアパレルブランドのデザイン企画のアシスタントです。業務: インスピレーション（参考画像やテーマから、商業的に使えるデザインへ広げる）。',
  task.profile ? `会社・ブランドの業務プリファレンス: ${task.profile.slice(0, 1000)}` : '',
  `最初の依頼: ${task.prompt.slice(0, 2000)}`,
  ...agentAttachmentLines(task, 1800),
];
const stageLines = (task: AgentTask) => ['この業務は次の段階で進みます。', ...(isGraphic(task) ? GRAPHIC_STAGES : INSPIRATION_STAGES), ...RULES];

/** The user's message as the assistant reads it. */
const turnText = (turn: AgentTurn) => (turn.prompt ?? turn.text ?? '').trim();
/** Light searches the web for the trends behind its four directions: the turn that answers the first form searches. */
export function agentDialogueMode(task: AgentTask): 'agent' | 'agent-research' {
  if (isGraphic(task)) return 'agent';
  const turns = task.turns ?? [];
  const lastAssistant = [...turns].reverse().find(turn => turn.role === 'assistant' && turn.step?.state === 'completed');
  const answeringForm = Boolean(lastAssistant?.step?.content && parseAgentDialogueReply(lastAssistant.step.content).questions.length);
  const researched = turns.some(turn => turn.role === 'assistant' && turn.mode === 'agent-research' && turn.step?.state === 'completed');
  return answeringForm && !researched ? 'agent-research' : 'agent';
}

/**
 * The request for the next reply: the role, the stages, and the user's newest message (`latest`, absent for the first
 * reply). Earlier turns travel as the chat history (`agentDialogueHistory`). Bounded under the server's cap.
 */
export function agentDialoguePrompt(task: AgentTask, latest: AgentTurn | null, mode: 'agent' | 'agent-research' = 'agent'): string {
  const parts = [
    ...contextLines(task), ...stageLines(task),
    latest ? `ユーザーの新しい書き込み:\n${turnText(latest).slice(0, 2400)}` : 'これは最初の依頼です。段階1の返答を書いてください。',
    mode === 'agent-research' ? 'web_search で最新のトレンド（売れ筋・SNSで話題の要素・素材や色）を調べ、調べ終えたら「[調査結果]」の行のあとに、段階2の返答だけを書いてください。' : '',
  ].filter(Boolean);
  return parts.join('\n').slice(0, AGENT_PROMPT_BUDGET);
}

/** What an assistant turn said, as it goes back into the history (without the source list the app keeps apart). */
const assistantText = (content: string) => {
  const text = content.replace(/\r/g, '');
  const sourcesAt = text.search(/^\[出典\]$/m);
  const statusAt = text.search(/^\[検索\]/m);
  const cut = [sourcesAt, statusAt].filter(at => at >= 0);
  const body = (cut.length ? text.slice(0, Math.min(...cut)) : text);
  const marker = body.search(/\[調査結果\]/);
  return (marker >= 0 ? body.slice(marker).replace(/\[調査結果\]/, '') : body).trim();
};

/**
 * The earlier turns as chat history for the server (at most 8 messages and 16,000 characters, starting with the user):
 * the first message is the request; same-role neighbours are joined; older replies are cut first. `upTo` leaves the
 * newest user turn out (it goes in the prompt).
 */
export function agentDialogueHistory(task: AgentTask, upTo?: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  const turns = task.turns ?? [];
  const end = upTo ? turns.findIndex(turn => turn.id === upTo) : turns.length;
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'user', content: `最初の依頼: ${task.prompt.slice(0, 2000)}` }];
  for (const turn of turns.slice(0, end < 0 ? turns.length : end)) {
    const content = turn.role === 'user' ? turnText(turn) : turn.step?.state === 'completed' && turn.step.content ? assistantText(turn.step.content) : '';
    if (!content) continue;
    const last = messages[messages.length - 1];
    if (last.role === turn.role) last.content = `${last.content}\n\n${content}`;
    else messages.push({ role: turn.role, content });
  }
  // The history ends with the assistant: the newest request is the prompt itself.
  while (messages.length && messages[messages.length - 1].role === 'user') messages.pop();
  let kept = messages.slice(-8);
  if (kept[0]?.role === 'assistant') kept = kept.slice(1);
  // Newest first, each message within its share; older ones are shortened before the newest reply is.
  const out: typeof kept = [];
  let room = 15000;
  for (let index = kept.length - 1; index >= 0; index -= 1) {
    const message = kept[index];
    const cap = message.role === 'assistant' ? (index === kept.length - 1 ? 7000 : 3000) : 1500;
    const content = message.content.slice(0, Math.min(cap, room));
    if (!content) break;
    out.unshift({ role: message.role, content });
    room -= content.length;
  }
  return out[0]?.role === 'assistant' ? out.slice(1) : out;
}

const split = (line: string) => line.split(/[|｜]/).map(part => part.trim()).filter(Boolean);
/** Reads a reply: its text, a question form ([Q]), an image search ([S]), the styles to generate ([SKU], [シリーズ]) and [開始]. */
export function parseAgentDialogueReply(content: string): AgentDialogueReply {
  const raw = content.replace(/\r/g, '');
  const sourcesAt = raw.search(/^\[出典\]$/m);
  const statusMatch = /^\[検索\]\s*(\S+)\s*$/m.exec(raw);
  const sources: AgentSource[] = [];
  if (sourcesAt >= 0) {
    for (const line of raw.slice(sourcesAt).split('\n').slice(1)) {
      const match = /^-\s*(.*?)\s*\|\s*(https?:\/\/\S+?)\s*(?:\|\s*(.*?))?\s*$/.exec(line.trim());
      if (match) sources.push({ title: match[1] || match[2], url: match[2], ...(match[3] ? { quote: match[3] } : {}) });
      else if (/^\[検索\]/.test(line.trim())) break;
    }
  }
  const status = statusMatch?.[1];
  const search = !status ? null : status === 'ok' ? 'ok' : status.startsWith('error') ? 'error' : 'unavailable';
  const questions: AssistantQuestion[] = [];
  const searches: AgentDialogueSearch[] = [];
  const skus: AgentDialogueSku[] = [];
  const body: string[] = [];
  let series = '';
  let start = false;
  for (const line of assistantText(raw).split('\n')) {
    const question = /^\s*\[Q (multi|single|text)\]\s*(.+)$/.exec(line);
    const found = /^\s*\[S\]\s*(.+)$/.exec(line);
    const sku = /^\s*\[SKU\]\s*(.+)$/.exec(line);
    const name = /^\s*\[シリーズ\]\s*(.+)$/.exec(line);
    if (question) {
      const kind = question[1] as AssistantQuestion['kind'];
      const [title, ...options] = split(question[2]);
      if (title && (kind === 'text' || options.length >= 2) && questions.length < 5) questions.push({ kind, title, options: kind === 'text' ? options.slice(0, 1) : options.slice(0, 8) });
    } else if (found) {
      const [title, query] = split(found[1]);
      if (title && query && searches.length < 3) searches.push({ title: title.slice(0, 40), query: query.slice(0, 80) });
    } else if (sku) {
      const parts = split(sku[1]);
      if (parts.length >= 4 && skus.length < AGENT_DIALOGUE_SKU_LIMIT) {
        const [code, styleName, group, ...rest] = parts;
        const logic = rest.length >= 2 ? rest[0] : '';
        const prompt = rest.length >= 2 ? rest.slice(1).join(' ') : rest[0];
        skus.push({ code: code.replace(/^#/, '').slice(0, 12), name: styleName.slice(0, 60), group: group.slice(0, 60), logic: logic.slice(0, 300), prompt: prompt.slice(0, 600) });
      }
    } else if (name) series = name[1].trim().slice(0, 60);
    else if (/^\s*\[開始\]\s*$/.test(line)) start = true;
    else body.push(line.replace(/\*\*/g, '').replace(/^#{1,4}\s*/, ''));
  }
  return { body: body.join('\n').replace(/\n{3,}/g, '\n\n').trim(), questions, searches, skus, series, start, sources, search };
}

/** The newest 執行書: the latest completed reply that lists styles. */
export function agentDialoguePlan(task: AgentTask): { turn: AgentTurn; reply: AgentDialogueReply } | null {
  for (const turn of [...(task.turns ?? [])].reverse()) {
    if (turn.role !== 'assistant' || turn.step?.state !== 'completed' || !turn.step.content) continue;
    const reply = parseAgentDialogueReply(turn.step.content);
    if (reply.skus.length) return { turn, reply };
  }
  return null;
}
/** The newest research reply's sources (Light's 参考資料). */
export function agentDialogueSources(task: AgentTask) {
  for (const turn of [...(task.turns ?? [])].reverse()) {
    if (turn.role === 'assistant' && turn.mode === 'agent-research' && turn.step?.state === 'completed' && turn.step.content) return parseAgentDialogueReply(turn.step.content);
  }
  return null;
}
/** Typing 「開始」 (or a short yes) under the 執行書 starts the generation at once, as Light does. */
export function agentDialogueIsStart(text: string) {
  const value = text.trim().replace(/[。！!、\s]/g, '');
  return value.length <= 12 && /^(開始|開始して(ください)?|はい|ok|OK|オーケー|お願いします|お願い|問題ありません|問題ない|進めて(ください)?|生成して(ください)?|生成開始|スタート)$/.test(value);
}

/** The styles to generate from the 執行書, in its order. */
export function agentBuildDialogueImages(task: AgentTask, newId: () => string): AgentStyleImage[] {
  const plan = agentDialoguePlan(task);
  return (plan?.reply.skus ?? []).map((sku, index) => ({
    key: `k${index + 1}`, code: sku.code, name: sku.name, category: sku.group, prompt: sku.prompt || sku.name, requestId: newId(), state: 'pending' as const,
  }));
}
/** A print is drawn flat and square; an inspiration style is one garment on a plain background. */
export function agentDialogueImagePrompt(task: Pick<AgentTask, 'scene'>, prompt: string): string {
  if (isGraphic(task)) {
    return `${agentImagePrompt(prompt)}. Flat textile print design artwork filling the whole square frame, seen straight on, crisp clean motifs, no garment, no mockup, no person, no text, no logo, no watermark.`.replace(/\.\.\s/g, '. ');
  }
  return `${agentImagePrompt(prompt)}. Product photo of this single garment only, front view, centered, on an invisible mannequin, plain warm light-gray studio background, soft even lighting, no person, no text, no logo.`.replace(/\.\.\s/g, '. ');
}
export const agentDialogueAspect = (task: Pick<AgentTask, 'scene'>) => (isGraphic(task) ? '1:1' : '3:4');

/** Light's progress while it generates: 「SKU 01-04を生成しています」, four at a time. */
export function agentDialogueProgress(images: AgentStyleImage[]): Array<{ label: string; status: '完了' | '進行中' | '待機中' }> {
  const groups: AgentStyleImage[][] = [];
  for (let at = 0; at < images.length; at += 4) groups.push(images.slice(at, at + 4));
  const settled = (image: AgentStyleImage) => image.state !== 'pending' && image.state !== 'running';
  let current = false;
  return groups.map(group => {
    const first = group[0].code; const last = group[group.length - 1].code;
    const label = `${first === last ? first : `${first}-${last}`}を生成しています`;
    const finished = group.every(settled);
    const status = finished ? '完了' as const : !current ? '進行中' as const : '待機中' as const;
    if (!finished) current = true;
    return { label: /^[A-Z]-\d/.test(first) ? label : `SKU ${label}`, status };
  });
}
/** The result block's lead (Light: 「【…】デザイン成果展示 全 15款 のデザインが生成完了いたしました。」). */
export function agentDialogueResultLead(task: Pick<AgentTask, 'scene'>, series: string, count: number, groups: number) {
  const title = `【${series || (isGraphic(task) ? '図案' : 'デザイン')}】${isGraphic(task) ? '図案成果展示' : 'デザイン成果展示'}`;
  const lead = isGraphic(task) ? `全 ${count}枚 の図案が生成完了いたしました。${groups > 1 ? `以下、${groups}つの方案に分けてご呈示いたします。` : ''}`
    : `全 ${count}款 のデザインが生成完了いたしました。${groups > 1 ? `以下、${groups}つのデザイン波段に分けてご呈示いたします。` : ''}`;
  return { title, lead, logicLabel: isGraphic(task) ? '設計ポイント' : '設計ロジック回溯' };
}
/** What the spinner says while a reply is written (Light's step lines). */
export function agentDialogueWaiting(task: AgentTask, turn: AgentTurn): string {
  const turns = task.turns ?? [];
  const index = turns.findIndex(entry => entry.id === turn.id);
  const previous = index > 0 ? turns[index - 1] : null;
  if (index === 0) return (task.attachments ?? []).some(item => item.kind === 'image') ? '参考画像を解析し、デザイン要素を抽出しています…' : '依頼内容を確認しています…';
  if (turn.mode === 'agent-research') return 'トレンドを検索しています…（ウェブ検索で資料を集めています。1〜3分かかります）';
  if (previous?.prompt?.startsWith('【参考画像の選択】')) return '選択した画像を選定し、デザイン要素を解析しています…';
  return '考え中…';
}
