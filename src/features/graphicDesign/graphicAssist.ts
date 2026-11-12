/**
 * AIグラフィックデザインのアシスト機能（本家 jp.linkaigc.com/printing、2026-11-12 に本家で操作して確かめた）。
 * スイッチを入れると「デザイン要素解析中…」のあと、左の欄に「参考テキストを選びます 選択済み 0 / 14」と、
 * テーマ・表現形式・要素・色彩の札が並ぶ。札を押すと縁と文字が緑になり、右の欄の「デザイン要素の内容」に
 * 同じ見出しの下で × つきの札として出る（× で外す）。何も選んでいない間は右の欄に案内文だけが出る。
 *
 * 札は画面の入力（inputState）に「見出し:札」の形で残す。assistOptions は解析で出た全部、assistTags は選んだもの、
 * assistFor はどの参考画像の解析か（差し替えたら解析し直す）。どれも16件・256字までの文字で、URL は入れない。
 */
export const GRAPHIC_ASSIST_LABELS = ['テーマ', '表現形式', '要素', '色彩'] as const;
export const GRAPHIC_ASSIST_MAX_OPTIONS = 16;

export type GraphicAssistGroup = { label: string; tags: string[] };

const SEPARATOR = ':';

export const encodeAssistTag = (label: string, tag: string) => `${label}${SEPARATOR}${tag}`;

export function decodeAssistTag(value: string): { label: string; tag: string } | null {
  const at = value.indexOf(SEPARATOR);
  if (at <= 0) return null;
  const label = value.slice(0, at);
  const tag = value.slice(at + 1).trim();
  return (GRAPHIC_ASSIST_LABELS as readonly string[]).includes(label) && tag ? { label, tag } : null;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/** The server's groups as the stored list: each tag once, in the four groups' order, at most 16. */
export function assistOptionsFromGroups(groups: unknown): string[] {
  const list = Array.isArray(groups) ? groups : [];
  const out: string[] = [];
  for (const label of GRAPHIC_ASSIST_LABELS) {
    const group = list.find((item) => item && typeof item === 'object' && (item as GraphicAssistGroup).label === label) as GraphicAssistGroup | undefined;
    for (const tag of strings(group?.tags)) {
      const clean = tag.trim();
      // A tag that holds a URL-like text would be dropped by the input sanitizer, so it is not offered.
      if (!clean || clean.length > 40 || /(?:https?:|data:|blob:)/i.test(clean)) continue;
      const encoded = encodeAssistTag(label, clean);
      if (!out.includes(encoded) && out.length < GRAPHIC_ASSIST_MAX_OPTIONS) out.push(encoded);
    }
  }
  return out;
}

/** The stored list back as groups (empty groups left out), keeping the order. */
export function assistGroups(options: unknown): GraphicAssistGroup[] {
  const decoded = strings(options).map(decodeAssistTag).filter((item): item is { label: string; tag: string } => item !== null);
  return GRAPHIC_ASSIST_LABELS.map((label) => ({ label, tags: decoded.filter((item) => item.label === label).map((item) => item.tag) }))
    .filter((group) => group.tags.length > 0);
}

/** Selected tags that are still among the options (a new analysis drops the ones it no longer lists). */
export function selectedAssistTags(options: unknown, selected: unknown): string[] {
  const available = new Set(strings(options));
  return strings(selected).filter((value, index, list) => available.has(value) && list.indexOf(value) === index);
}

export function toggleAssistTag(options: unknown, selected: unknown, value: string): string[] {
  const current = selectedAssistTags(options, selected);
  if (current.includes(value)) return current.filter((item) => item !== value);
  return strings(options).includes(value) ? [...current, value] : current;
}

/** Which references an analysis belongs to: their names in order (blob URLs change on every reload). */
export function assistReferenceKey(references: ReadonlyArray<{ name: string }>): string {
  return references.map((reference, index) => `${index + 1}=${reference.name.replace(/[|:]/g, '_').slice(0, 100)}`).join('|').slice(0, 256);
}

/** The lines the generation request gets for the assist: the chosen tags by group, or Light's plain analyse line. */
export function assistPromptLines(assist: boolean, selected: readonly string[]): string[] {
  if (!assist) return [];
  const groups = assistGroups(selected);
  if (groups.length === 0) return ['アシスト: 参考画像のデザイン要素（モチーフ・配色・構図）を解析して反映してください。'];
  return [
    'アシスト: 参考画像から選んだ次のデザイン要素を、新しいグラフィックにはっきり反映してください。',
    ...groups.map((group) => `${group.label}: ${group.tags.join('、')}`),
  ];
}
