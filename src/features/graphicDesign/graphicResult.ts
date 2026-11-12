/**
 * The AIグラフィックデザイン result view (独自: 本家は生成が権限なしで、生成後の画面を比べられない). Laid out after
 * Light's own demo video of this tool (graphic-design.mp4, 2026-11-12): 「‹ 戻る」 at the top left, ◀ ☆
 * 「デザインドキュメントの作成」 and a green download button at the top right, the chosen proposal large in the middle and
 * the run's four proposals as thumbnails below it.
 */
export type CellSize = { width: number; height: number };
export type Cell = { x: number; y: number; width: number; height: number };

/** The proposals in a grid on a design-document page (2 columns from 2 images), each fitted inside its cell and centered. */
export function candidateGrid(sizes: readonly CellSize[], pageWidth: number, pageHeight: number, margin = 48, gap = 32): Cell[] {
  if (sizes.length === 0) return [];
  const columns = sizes.length === 1 ? 1 : 2;
  const rows = Math.ceil(sizes.length / columns);
  const cellWidth = (pageWidth - margin * 2 - gap * (columns - 1)) / columns;
  const cellHeight = (pageHeight - margin * 2 - gap * (rows - 1)) / rows;
  return sizes.map((size, index) => {
    const column = index % columns; const row = Math.floor(index / columns);
    const scale = Math.min(cellWidth / Math.max(1, size.width), cellHeight / Math.max(1, size.height));
    const width = Math.round(size.width * scale); const height = Math.round(size.height * scale);
    return {
      x: Math.round(margin + column * (cellWidth + gap) + (cellWidth - width) / 2),
      y: Math.round(margin + row * (cellHeight + gap) + (cellHeight - height) / 2),
      width, height,
    };
  });
}

/** File names for downloads: 「AIグラフィックデザイン-案2-背景なし.png」. */
export function graphicFileName(index: number, suffix = '', extension = 'png'): string {
  return `AIグラフィックデザイン-案${index + 1}${suffix ? `-${suffix}` : ''}.${extension}`;
}
