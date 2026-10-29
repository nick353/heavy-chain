/**
 * Light confirms before drawing when a request comes with reference images (measured 2026-10-29 with プリント修正):
 * it analyses each image, then asks a short stepped form (「最適な結果を得るため、いくつか確認させてください。」 1/3 …
 * 複数選択 / 単一選択 / 任意のメモ), and only after 確認 continues — a summary and proposals, a second form, then the image.
 * The assistant writes each question as one "[Q kind] question | option | option" line; a reply with questions draws no image.
 */
export type AssistantQuestion = { kind: 'multi' | 'single' | 'text'; title: string; options: string[] };
/** Light's third step searches reference images on two topics ("[S] topic | search words"). */
export type AssistantImageSearch = { title: string; query: string };
/** Light's final step draws one image per proposal (#01〜#04, "[V] name | direction"). */
export type AssistantVariation = { name: string; direction: string };
export type AssistantReply = { body: string; suggestions: string[]; questions: AssistantQuestion[];
  searches: AssistantImageSearch[]; variations: AssistantVariation[] };

const SUGGESTION = /^\s*(?:→|->)\s*\S/;
const QUESTION = /^\s*\[Q (multi|single|text)\]\s*(.+)$/;
const SEARCH = /^\s*\[S\]\s*(.+)$/;
const VARIATION = /^\s*\[V\]\s*(.+)$/;
const pair = (line: string) => line.split('|').map((part) => part.trim()).filter(Boolean);
/** Marks the hidden user turn that carries the answers; Light shows no bubble for it. */
export const ANSWER_MARK = '【確認の回答】';

export const parseAssistantReply = (content: string): AssistantReply => {
  const lines = content.split('\n');
  const questions: AssistantQuestion[] = [];
  for (const line of lines) {
    const match = QUESTION.exec(line);
    if (!match) continue;
    const [title, ...options] = match[2].split('|').map((part) => part.trim()).filter(Boolean);
    const kind = match[1] as AssistantQuestion['kind'];
    if (title && (kind === 'text' || options.length >= 2)) questions.push({ kind, title, options: kind === 'text' ? options.slice(0, 1) : options.slice(0, 8) });
  }
  const searches: AssistantImageSearch[] = [];
  const variations: AssistantVariation[] = [];
  const body: string[] = [];
  for (const line of lines) {
    const search = SEARCH.exec(line);
    const variation = VARIATION.exec(line);
    if (search) {
      const [title, query] = pair(search[1]);
      if (title && query && searches.length < 2) searches.push({ title, query: query.slice(0, 80) });
    } else if (variation) {
      const [name, ...rest] = pair(variation[1]);
      if (name && rest.length && variations.length < 4) {
        variations.push({ name, direction: rest.join(' ').slice(0, 500) });
        // The proposals stay readable in the chat the way Light lists them under the four images.
        body.push(`#0${variations.length} ${name}`, rest.join(' '));
      }
    } else if (!SUGGESTION.test(line) && !QUESTION.test(line)) body.push(line);
  }
  const suggestions = lines.filter((line) => SUGGESTION.test(line)).map((line) => line.replace(/^\s*(?:→|->)\s*/, '').trim()).slice(0, 4);
  const asks = questions.length > 0 || searches.length > 0;
  return { body: body.join('\n').trim(), suggestions: asks ? [] : suggestions, questions: questions.slice(0, 4), searches,
    variations: asks || variations.length < 2 ? [] : variations };
};

/** A reply that asks (questions or an image search) draws no image; the answers come back as the next request. */
export const hasAssistantQuestions = (content: string | null | undefined) => {
  const reply = parseAssistantReply(content ?? '');
  return reply.questions.length > 0 || reply.searches.length > 0;
};

/** Each candidate's own direction for the final generation, or none for an ordinary one-image reply. */
export const variationDirections = (content: string | null | undefined) =>
  parseAssistantReply(content ?? '').variations.map((item) => `${item.name}: ${item.direction}`);

/** The answers go back as the next request: the earlier request stays in it so the final image keeps the whole brief. */
export const answerPrompt = (previousPrompt: string, questions: readonly AssistantQuestion[], answers: readonly (readonly string[])[]) => {
  const lines = questions.map((question, index) => `${question.title}: ${(answers[index] ?? []).filter(Boolean).join('、') || 'おまかせ'}`);
  const base = previousPrompt.slice(0, 3000);
  return `${base}\n\n${ANSWER_MARK}\n${lines.join('\n')}`.slice(0, 4000);
};

/** The image-search answer: which found images were attached (they travel as references of the same request). */
export const searchAnswerPrompt = (previousPrompt: string, chosen: readonly string[]) =>
  `${previousPrompt.slice(0, 3000)}\n\n${ANSWER_MARK}\n参考画像: ${chosen.length ? chosen.join('、') : 'スキップ'}`.slice(0, 4000);
