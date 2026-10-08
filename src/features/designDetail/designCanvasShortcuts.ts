/** Light's canvas shortcut panel (キーボード button), grouped as Light shows it. `mouse` marks rows Light draws with a mouse icon. */
export type CanvasShortcut = Readonly<{ label: string; keys: string; mouse?: boolean }>;
export const CANVAS_SHORTCUT_GROUPS: readonly Readonly<{ title: string; rows: readonly CanvasShortcut[] }>[] = [
  { title: 'キャンバス', rows: [
    { label: 'ドラッグ', keys: 'スペースキーを押しながらドラッグ / マウスの中ボタンを押しながらドラッグ', mouse: true },
    { label: '選択', keys: 'V / 左クリック', mouse: true },
    { label: '透過選択', keys: 'Ctrl + 左クリック', mouse: true },
    { label: 'キャンバスを拡大', keys: 'Ctrl + + / スクロールホイール', mouse: true },
    { label: 'キャンバスを縮小', keys: 'Ctrl + - / スクロールホイール', mouse: true },
    { label: '画面に合わせる', keys: 'Ctrl + 1' },
    { label: '実際のサイズ', keys: 'Ctrl + 0' },
  ] },
  { title: '要素', rows: [
    { label: 'コピー', keys: 'Ctrl + C' },
    { label: '画像としてコピー', keys: 'Ctrl + Shift + C' },
    { label: '貼り付け', keys: 'Ctrl + V' },
    { label: 'キャンバス内コピーして貼り付け', keys: 'Ctrl + D' },
    { label: '削除', keys: 'Delete / Backspace' },
    { label: 'カット', keys: 'Ctrl + X' },
    { label: '取り消し', keys: 'Ctrl + Z' },
    { label: 'やり直し', keys: 'Ctrl + Shift + Z' },
    { label: '全選択', keys: 'Ctrl + A' },
    { label: '複数選択', keys: '左クリックを押したままドラッグ', mouse: true },
    { label: 'キャンセル', keys: 'ESC' },
    { label: 'グループ化', keys: 'Ctrl + G' },
    { label: 'グループ解除', keys: 'Ctrl + Shift + G' },
  ] },
  { title: '新しいオブジェクトを作成', rows: [
    { label: 'テキスト', keys: 'T' }, { label: '矩形', keys: 'R' }, { label: '楕円', keys: 'O' }, { label: '線', keys: 'L' },
  ] },
  { title: 'レイヤー操作', rows: [
    { label: '最前面へ移動', keys: 'Ctrl + Shift + ↑' },
    { label: '1つ上のレイヤーに移動', keys: 'Ctrl + ↑' },
    { label: '1つ下のレイヤーに移動', keys: 'Ctrl + ↓' },
    { label: '最背面へ移動', keys: 'Ctrl + Shift + ↓' },
  ] },
];

/** Light's 初心者ガイド tabs (本のボタン). Light's Japanese guide currently shows データなし on every tab. */
export const BEGINNER_GUIDE_TABS = ['基本設定', 'ライブラリー', 'キャンバス編集', 'マーケティングワークスペース', 'デザインワークスペース', 'アイデアキャンバス', 'その他のAIツール'] as const;

export type CanvasLayerMove = 'front' | 'up' | 'down' | 'back';
/** Reorders by zIndex: returns the objects with the target's zIndex changed and the others renumbered in paint order. */
export function moveCanvasLayer<T extends Record<string, unknown>>(objects: readonly T[], id: string, move: CanvasLayerMove): T[] {
  const ordered = [...objects].sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0));
  const index = ordered.findIndex((object) => object.id === id);
  if (index < 0) return [...objects];
  const [target] = ordered.splice(index, 1);
  const next = move === 'front' ? ordered.length : move === 'back' ? 0 : move === 'up' ? Math.min(ordered.length, index + 1) : Math.max(0, index - 1);
  ordered.splice(next, 0, target);
  const zById = new Map(ordered.map((object, order) => [object.id, order + 1]));
  return objects.map((object) => ({ ...object, zIndex: zById.get(object.id) ?? object.zIndex }));
}

type CanvasItem = Record<string, unknown>;
type Box = Readonly<{ left: number; top: number; right: number; bottom: number }>;
const boxOf = (object: CanvasItem): Box => {
  const left = Number(object.x) || 0; const top = Number(object.y) || 0;
  return { left, top, right: left + (Number(object.width) || 440) * (Number(object.scaleX) || 1), bottom: top + (Number(object.height) || 440) * (Number(object.scaleY) || 1) };
};
const byZ = (a: CanvasItem, b: CanvasItem) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0);

/** Adds every member of each selected object's group, so a group is always selected as a whole. */
export function expandGroupSelection(objects: readonly CanvasItem[], ids: readonly string[]): string[] {
  const groups = new Set(objects.filter((object) => ids.includes(String(object.id)) && typeof object.groupId === 'string').map((object) => object.groupId));
  return objects.filter((object) => ids.includes(String(object.id)) || groups.has(object.groupId)).map((object) => String(object.id));
}

/** Objects whose box overlaps the marquee (world coordinates; the rect may be drawn in any direction). */
export function objectsInRect(objects: readonly CanvasItem[], rect: Readonly<{ x1: number; y1: number; x2: number; y2: number }>): string[] {
  const left = Math.min(rect.x1, rect.x2); const right = Math.max(rect.x1, rect.x2);
  const top = Math.min(rect.y1, rect.y2); const bottom = Math.max(rect.y1, rect.y2);
  return objects.filter((object) => { const box = boxOf(object); return box.left <= right && box.right >= left && box.top <= bottom && box.bottom >= top; })
    .map((object) => String(object.id));
}

/** 透過選択 (Ctrl + click): picks the next object under the point below the current one, topmost first, cycling. */
export function throughSelect(objects: readonly CanvasItem[], point: Readonly<{ x: number; y: number }>, current: string | null): string | null {
  const stack = [...objects].sort(byZ).reverse().filter((object) => { const box = boxOf(object); return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom; })
    .map((object) => String(object.id));
  if (!stack.length) return null;
  const index = current ? stack.indexOf(current) : -1;
  return index < 0 ? stack[Math.min(1, stack.length - 1)] : stack[(index + 1) % stack.length];
}

export function groupObjects<T extends CanvasItem>(objects: readonly T[], ids: readonly string[], groupId: string): T[] {
  return objects.map((object) => ids.includes(String(object.id)) ? { ...object, groupId } : object);
}
export function ungroupObjects<T extends CanvasItem>(objects: readonly T[], ids: readonly string[]): T[] {
  return objects.map((object) => { if (!ids.includes(String(object.id)) || !('groupId' in object)) return object; const { groupId: _removed, ...rest } = object; return rest as T; });
}

/** Copies for paste/duplicate: new ids, offset by 40, stacked on top in their original order, and pasted groups become new groups. */
export function cloneCanvasObjects(sources: readonly CanvasItem[], firstZ: number, makeId: () => string): CanvasItem[] {
  const groups = new Map<unknown, string>();
  return [...sources].sort(byZ).map((source, index) => {
    const clone: CanvasItem = { ...structuredClone(source), id: `${String(source.type)}-${makeId()}`, x: (Number(source.x) || 0) + 40, y: (Number(source.y) || 0) + 40, zIndex: firstZ + index };
    if (typeof source.groupId === 'string') { if (!groups.has(source.groupId)) groups.set(source.groupId, `group-${makeId()}`); clone.groupId = groups.get(source.groupId); }
    return clone;
  });
}

/** One undoable step: the changed objects before and after (null = absent). Only these ids are touched, so other changes (e.g. AI results) survive undo. */
export type CanvasPatch = Readonly<{ before: Readonly<Record<string, CanvasItem | null>>; after: Readonly<Record<string, CanvasItem | null>> }>;
export function diffCanvasObjects(before: readonly CanvasItem[], after: readonly CanvasItem[]): CanvasPatch | null {
  const old = new Map(before.map((object) => [String(object.id), object]));
  const next = new Map(after.map((object) => [String(object.id), object]));
  const patch = { before: {} as Record<string, CanvasItem | null>, after: {} as Record<string, CanvasItem | null> };
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(id) ?? null; const b = next.get(id) ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    patch.before[id] = a; patch.after[id] = b;
  }
  return Object.keys(patch.before).length ? patch : null;
}
export function applyCanvasPatch(objects: readonly CanvasItem[], side: Readonly<Record<string, CanvasItem | null>>): CanvasItem[] {
  const result = objects.filter((object) => !(String(object.id) in side) || side[String(object.id)] !== null)
    .map((object) => side[String(object.id)] ?? object);
  for (const [id, object] of Object.entries(side)) if (object && !result.some((item) => String(item.id) === id)) result.push(object);
  return result;
}
