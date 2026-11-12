import { StudioMaskEditor } from './StudioMaskEditor';

/**
 * 本家のクリッピング（画像を選んで出る「クリッピング」）。簡易エディターの面の題が「保存したい範囲を選択してください」で、
 * 上の帯の右に キャンセル／抽出／お気に入り が並ぶ。
 * - 抽出: 元の大きさのまま、選んだ範囲の外を透明にした PNG（本家 getSynthesis → 新しい画像として置く）
 * - お気に入り: 選んだ範囲の外接矩形で切り出した透明 PNG（本家 imageAutoClip → 素材に保存）
 * 何も選ばずに押すと「調整したい部分を選択してください」。
 */
export const STUDIO_CLIPPING_TEXT = {
  paneTitle: '保存したい範囲を選択してください',
  extract: '抽出',
  collect: 'お気に入り',
} as const;

export function StudioClippingDialog({ imageUrl, fileBaseName, onClose, onExtract, onCollect }: {
  imageUrl: string;
  /** 書き出すファイル名の元（拡張子なし）。 */
  fileBaseName?: string;
  onClose: () => void;
  /** 抽出: 元の大きさ・範囲の外は透明。済んだら呼び出し側が onClose を呼ぶ（呼ばなければ窓は開いたまま）。 */
  onExtract: (file: File) => void | Promise<void>;
  /** お気に入り: 範囲の外接矩形で切り出した透明 PNG。 */
  onCollect: (file: File) => void | Promise<void>;
}) {
  return (
    <StudioMaskEditor
      ariaLabel="クリッピング"
      testId="studio-clipping-dialog"
      base={{ imageUrl, title: STUDIO_CLIPPING_TEXT.paneTitle, fileBaseName }}
      onCancel={onClose}
      actions={api => (
        <>
          <button
            type="button"
            data-testid="studio-clipping-extract"
            disabled={api.busy}
            onClick={() => void api.run(async () => {
              const file = await api.getCutout();
              if (!file) { api.notifyEmpty(); return; }
              await onExtract(file);
            })}
            className="h-8 rounded-lg bg-[#5fd0c8] px-4 text-sm text-slate-950 disabled:opacity-40"
          >{STUDIO_CLIPPING_TEXT.extract}</button>
          <button
            type="button"
            data-testid="studio-clipping-collect"
            disabled={api.busy}
            onClick={() => void api.run(async () => {
              const file = await api.getClip();
              if (!file) { api.notifyEmpty(); return; }
              await onCollect(file);
            })}
            className="h-8 rounded-lg border border-[#5fd0c8] px-4 text-sm text-[#5fd0c8] hover:bg-[#5fd0c8]/10 disabled:opacity-40"
          >{STUDIO_CLIPPING_TEXT.collect}</button>
        </>
      )}
    />
  );
}
