import type { DialogueAttempt } from './dialogueStore';

/**
 * Light rewrites a request into a detailed brief before drawing (its reply opens with a title line such as
 * 「キャメル色のオーバーサイズトレンチコート｜白背景・平置き・正面商品画像」, 2026-10-29). Heavy draws from the user's words
 * plus the assistant's design direction (its reply without the → follow-up lines), so details like a trench coat's
 * belt and epaulettes are asked for, not left to chance.
 */
export const imagePrompt = (attempt: Pick<DialogueAttempt, 'input' | 'assistant'>) => {
  const direction = attempt.assistant.state === 'completed' && typeof attempt.assistant.content === 'string'
    ? attempt.assistant.content.split('\n').filter((line) => !/^\s*(?:→|->)\s*\S/.test(line)).join('\n').trim() : '';
  return direction ? `${attempt.input.prompt}\n\nDesign direction:\n${direction}`.slice(0, 4000) : attempt.input.prompt;
};
