/**
 * Light confirms before drawing when a request comes with reference images (measured 2026-10-29 with プリント修正):
 * it analyses each image, then asks a short stepped form (「最適な結果を得るため、いくつか確認させてください。」 1/3 …
 * 複数選択 / 単一選択 / 任意のメモ), and only after 確認 continues — a summary and proposals, a second form, then the image.
 * The assistant writes each question as one "[Q kind] question | option | option" line; a reply with questions draws no image.
 */
export type AssistantQuestion = { kind: 'multi' | 'single' | 'text'; title: string; options: string[] };
export type AssistantReply = { body: string; suggestions: string[]; questions: AssistantQuestion[] };

const SUGGESTION = /^\s*(?:→|->)\s*\S/;
const QUESTION = /^\s*\[Q (multi|single|text)\]\s*(.+)$/;
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
  const suggestions = lines.filter((line) => SUGGESTION.test(line)).map((line) => line.replace(/^\s*(?:→|->)\s*/, '').trim()).slice(0, 4);
  const body = lines.filter((line) => !SUGGESTION.test(line) && !QUESTION.test(line)).join('\n').trim();
  return { body, suggestions: questions.length ? [] : suggestions, questions: questions.slice(0, 4) };
};

export const hasAssistantQuestions = (content: string | null | undefined) => parseAssistantReply(content ?? '').questions.length > 0;

/** The answers go back as the next request: the earlier request stays in it so the final image keeps the whole brief. */
export const answerPrompt = (previousPrompt: string, questions: readonly AssistantQuestion[], answers: readonly (readonly string[])[]) => {
  const lines = questions.map((question, index) => `${question.title}: ${(answers[index] ?? []).filter(Boolean).join('、') || 'おまかせ'}`);
  const base = previousPrompt.slice(0, 3000);
  return `${base}\n\n${ANSWER_MARK}\n${lines.join('\n')}`.slice(0, 4000);
};
