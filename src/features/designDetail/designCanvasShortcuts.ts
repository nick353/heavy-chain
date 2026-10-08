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
