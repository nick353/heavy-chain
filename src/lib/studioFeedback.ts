/**
 * ファッションスタジオの生成結果の 👍👎「フィードバックする」。本家（jp.linkaigc.com）の部品（スクリプトの 841152、2026-11-12 に読んだ）
 * と同じ動き:
 * - 👍（GOOD）: 押した瞬間に保存（向き 1・理由なし）。もう押してあれば何もしない。👎と理由は外す。お知らせなし。
 * - 👎（BAD）: 理由の窓を開き、まだ👎でなければ押した瞬間に保存（向き 0・今の理由）。窓の「送信」で理由を付けて保存し、お知らせ。
 * - フィードバックする: 要望の窓。「送信」で保存し、お知らせ。
 * 本家は理由の札を機能ごとにサーバーの設定から読む（こちらからは読めない）。札の言葉は本家の言葉の束にある札の言葉から、機能が
 * 間違えうるものだけを選んだ（人が写らない 3D には顔・体の札を出さない）。最後はいつも「その他」。
 */
export type StudioFeedbackFunction = 'text' | 'region' | 'underwear' | '3d';
export type StudioFeedbackDirection = 0 | 1 | null;
export type StudioFeedbackState = { direction: StudioFeedbackDirection; reasons: string[]; remark: string; improve: string };
export type StudioFeedbackSave = { studio_function: StudioFeedbackFunction | null; direction: StudioFeedbackDirection; reasons: string[]; remark: string; improve: string };

/** 本家の日本語（言葉の束 ja.json の 赞 / 踩 / 帮我改进 / … の訳）。 */
export const STUDIO_FEEDBACK_TEXT = {
  good: 'GOOD',
  bad: 'BAD',
  improve: 'フィードバックする',
  improvePlaceholder: '効果に満足していませんか？新しい機能が必要ですか？ご要望をお知らせください、実現します！',
  remarkPlaceholder: '理由を説明してください...',
  send: '送信',
  cancel: 'キャンセル',
  sent: 'フィードバックを送信しました',
  failed: 'フィードバックを送信できませんでした。もう一度お試しください。',
  regenerate: '再生成',
} as const;
export const STUDIO_FEEDBACK_OTHER = 'その他';
export const STUDIO_FEEDBACK_REMARK_MAX = 50;
export const STUDIO_FEEDBACK_IMPROVE_MAX = 1000;

/** 本家の言葉の束にある札（未参考原图颜色 → 元の色が参照されていない など）。 */
const REASONS: Record<StudioFeedbackFunction | 'default', readonly string[]> = {
  // テキストで生成（一键融合）: 服と参考画像を合わせてモデルの写真を作る。
  text: ['素材の相性が悪い', 'ディテールが不明', '元の色が参照されていない', '元の生地が参照されていない', '構造が不合理', '顔の歪み/不自然', '身体のバランスが悪い', 'いびつ/ずれ/重複', 'エッジがぼやけている'],
  // 範囲指定で生成（定向融合）: 印の所だけ参考画像の形を取り込み、元の色・生地・人はそのまま。
  region: ['素材の相性が悪い', 'ディテールが不明', '元の色が参照されていない', '元の生地が参照されていない', '構造が不合理', 'エッジがぼやけている', '元画像の顔と一致しない', '元画像と体つきが合わない'],
  // 下着のフィッティング（内衣试衣）: モデルの写真に服を着せる。
  underwear: ['元の色が参照されていない', '元の生地が参照されていない', '生地の質感が悪い', 'ディテールが不明', '元画像の顔と一致しない', '元画像と体つきが合わない', '身体のバランスが悪い', 'いびつ/ずれ/重複'],
  // 3D画像に変換（转3D平铺）: 着た写真から服だけの立体の商品画像。人は写らない。
  '3d': ['元の色が参照されていない', '元の色調が参照されていない', '元の生地が参照されていない', '生地の質感が悪い', 'ディテールが不明', '構造が不明', '服装の構造/技術が不合理である', 'エッジがぼやけている'],
  default: ['素材が不明', 'ディテールが不明', '構造が不合理', 'エッジがぼやけている'],
};
export const studioFeedbackReasons = (fn: StudioFeedbackFunction | null | undefined): string[] => [...REASONS[fn ?? 'default'] ?? REASONS.default, STUDIO_FEEDBACK_OTHER];

export const emptyStudioFeedback = (): StudioFeedbackState => ({ direction: null, reasons: [], remark: '', improve: '' });

const saveOf = (state: StudioFeedbackState, fn: StudioFeedbackFunction | null, direction: StudioFeedbackDirection): StudioFeedbackSave => {
  const reasons = [...new Set(state.reasons.map(reason => reason.trim()).filter(Boolean))].slice(0, 20);
  return {
    studio_function: fn, direction, reasons,
    // その他の文は「その他」を選んだときだけ残す。
    remark: reasons.includes(STUDIO_FEEDBACK_OTHER) ? state.remark.slice(0, STUDIO_FEEDBACK_REMARK_MAX) : '',
    improve: state.improve.slice(0, STUDIO_FEEDBACK_IMPROVE_MAX),
  };
};
export type StudioFeedbackStep = { state: StudioFeedbackState; save: StudioFeedbackSave | null };

/** 👍: もう押してあれば何もしない。押すと理由を外して向き 1 で保存（要望の文は残す）。 */
export const likeStudioFeedback = (state: StudioFeedbackState, fn: StudioFeedbackFunction | null): StudioFeedbackStep => {
  if (state.direction === 1) return { state, save: null };
  const next = { ...state, direction: 1 as const, reasons: [], remark: '' };
  return { state: next, save: saveOf(next, fn, 1) };
};
/** 👎: まだ👎でなければ向き 0 で保存（今の理由のまま）。窓は呼ぶ側がいつも開く。 */
export const dislikeStudioFeedback = (state: StudioFeedbackState, fn: StudioFeedbackFunction | null): StudioFeedbackStep => {
  if (state.direction === 0) return { state, save: null };
  const next = { ...state, direction: 0 as const };
  return { state: next, save: saveOf(next, fn, 0) };
};
/** 理由の札を押す: 選ぶ／外す（保存は「送信」のとき）。 */
export const toggleStudioFeedbackReason = (state: StudioFeedbackState, reason: string): StudioFeedbackState => ({
  ...state, reasons: state.reasons.includes(reason) ? state.reasons.filter(item => item !== reason) : [...state.reasons, reason],
});
/** 理由の窓の「送信」: 向き 0 と理由で保存。 */
export const submitStudioFeedbackReasons = (state: StudioFeedbackState, fn: StudioFeedbackFunction | null): StudioFeedbackStep => {
  const next = { ...state, direction: 0 as const };
  return { state: next, save: saveOf(next, fn, 0) };
};
/** 要望の窓の「送信」: 今の👍👎のまま要望を付けて保存（空でも送れる）。 */
export const submitStudioFeedbackImprove = (state: StudioFeedbackState, fn: StudioFeedbackFunction | null): StudioFeedbackStep => (
  { state, save: saveOf(state, fn, state.direction) }
);

/** サーバーの行（GET /v1/canvas-documents/:id/studio-feedback）から結果ごとの状態へ。 */
export const studioFeedbackFromRows = (rows: readonly unknown[]): Map<string, StudioFeedbackState> => {
  const states = new Map<string, StudioFeedbackState>();
  for (const value of rows) {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    if (typeof row.object_id !== 'string' || states.has(row.object_id)) continue;
    states.set(row.object_id, {
      direction: row.direction === 0 || row.direction === 1 ? row.direction : null,
      reasons: Array.isArray(row.reasons) ? row.reasons.filter((item): item is string => typeof item === 'string') : [],
      remark: typeof row.remark === 'string' ? row.remark : '',
      improve: typeof row.improve === 'string' ? row.improve : '',
    });
  }
  return states;
};

/** 本家は理由の窓を👎の上に出し、上に余白が無いときだけ下に出す（窓の高さ＋88px が要る）。 */
export const studioFeedbackPopoverBelow = (anchorTop: number, popoverHeight: number) => anchorTop - 88 - popoverHeight < 0;
