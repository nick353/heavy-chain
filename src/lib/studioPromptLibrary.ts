/** 本家のプロンプトライブラリの中身（この端末の localStorage に残す。窓は components/lightchain/StudioPromptLibrary.tsx）。 */
export type StudioPromptEntry = { id: string; title: string; text: string; cover?: string; updatedAt: number };
export const STUDIO_PROMPT_LIBRARY_KEY = 'heavy-studio-prompt-library:v1';
/** 前の形（文字だけの一覧）。初めて開いたときに題を付けて移す。 */
export const STUDIO_LEGACY_SAVED_PROMPTS_KEY = 'heavy-fashion-studio-saved-prompts';
export const STUDIO_PROMPT_TITLE_MAX = 50;
export const STUDIO_PROMPT_TEXT_MAX = 2000;
const LIBRARY_MAX = 200;

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;
const entryOf = (value: unknown): StudioPromptEntry | null => {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const text = typeof item.text === 'string' ? item.text.slice(0, STUDIO_PROMPT_TEXT_MAX) : '';
  if (typeof item.id !== 'string' || !item.id || !text.trim()) return null;
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.slice(0, STUDIO_PROMPT_TITLE_MAX) : studioPromptDefaultTitle(text);
  const cover = typeof item.cover === 'string' && /^data:image\//.test(item.cover) ? item.cover : undefined;
  return { id: item.id, title, text, ...(cover ? { cover } : {}), updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0 };
};
/** 題が無いときの題（本文の最初の行の20字）。 */
export const studioPromptDefaultTitle = (text: string) => (text.trim().split('\n')[0] ?? '').slice(0, 20) || 'Untitled';
export function readStudioPromptLibrary(store: KeyValueStore = window.localStorage): StudioPromptEntry[] {
  try {
    const saved = JSON.parse(store.getItem(STUDIO_PROMPT_LIBRARY_KEY) ?? 'null');
    if (Array.isArray(saved)) return saved.map(entryOf).filter((item): item is StudioPromptEntry => item !== null).slice(0, LIBRARY_MAX);
    const legacy = JSON.parse(store.getItem(STUDIO_LEGACY_SAVED_PROMPTS_KEY) ?? '[]');
    const moved = (Array.isArray(legacy) ? legacy : []).filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .slice(0, LIBRARY_MAX).map((text, index) => ({ id: `legacy-${index}`, title: studioPromptDefaultTitle(text), text: text.slice(0, STUDIO_PROMPT_TEXT_MAX), updatedAt: 0 }));
    if (moved.length) writeStudioPromptLibrary(moved, store);
    return moved;
  } catch { return []; }
}
export function writeStudioPromptLibrary(entries: readonly StudioPromptEntry[], store: KeyValueStore = window.localStorage) {
  try { store.setItem(STUDIO_PROMPT_LIBRARY_KEY, JSON.stringify(entries.slice(0, LIBRARY_MAX))); return true; } catch { return false; }
}
/** 1件を足すか直す（新しいものが上）。 */
export const withStudioPrompt = (entries: readonly StudioPromptEntry[], entry: StudioPromptEntry) => [entry, ...entries.filter(item => item.id !== entry.id)].slice(0, LIBRARY_MAX);

