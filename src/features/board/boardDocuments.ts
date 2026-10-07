/**
 * Design documents (Light's /board): one server canvas document per design document. The snapshot keeps the
 * required `objects: []` and carries the pages under `boardDocument`; images are stored by storage path (signed when
 * shown), never as data or blob URLs, so a document reopens the same on any device.
 */
export const BOARD_DOCUMENT_KIND = 'heavy-board-document';
export const BOARD_DEFAULT_TITLE = '名称未設定ドキュメント';
export const BOARD_PAGE_WIDTH = 1280;
export const BOARD_PAGE_HEIGHT = 960;

export type BoardShapeType = 'circle' | 'rect' | 'arrow';
export type BoardItem =
  | { id: string; type: 'text'; x: number; y: number; rotation: number; text: string; fontSize: number; fill: string; width: number }
  | { id: string; type: 'image'; x: number; y: number; rotation: number; storagePath: string; width: number; height: number }
  | { id: string; type: 'path'; x: number; y: number; rotation: number; points: number[]; stroke: string; strokeWidth: number }
  | { id: string; type: BoardShapeType; x: number; y: number; rotation: number; width: number; height: number; stroke: string; strokeWidth: number };
export type BoardPage = { id: string; items: BoardItem[] };
export type BoardDocumentData = { kind: typeof BOARD_DOCUMENT_KIND; version: 1; pages: BoardPage[] };

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

const readItem = (value: unknown): BoardItem | null => {
  if (!record(value) || !text(value.id, 80) || !finite(value.x) || !finite(value.y)) return null;
  const rotation = finite(value.rotation) ? value.rotation : 0;
  const base = { id: value.id, x: value.x, y: value.y, rotation };
  switch (value.type) {
    case 'text':
      return text(value.text, 5000) && finite(value.fontSize) && text(value.fill, 32) && finite(value.width)
        ? { ...base, type: 'text', text: value.text, fontSize: value.fontSize, fill: value.fill, width: value.width } : null;
    case 'image':
      // Only stored objects: a data/blob URL would not survive a reload or another device.
      return text(value.storagePath, 512) && value.storagePath && !/^(?:data|blob):/i.test(value.storagePath) && finite(value.width) && finite(value.height)
        ? { ...base, type: 'image', storagePath: value.storagePath, width: value.width, height: value.height } : null;
    case 'path':
      return Array.isArray(value.points) && value.points.length <= 20_000 && value.points.every(finite) && text(value.stroke, 32) && finite(value.strokeWidth)
        ? { ...base, type: 'path', points: value.points as number[], stroke: value.stroke, strokeWidth: value.strokeWidth } : null;
    case 'circle': case 'rect': case 'arrow':
      return finite(value.width) && finite(value.height) && text(value.stroke, 32) && finite(value.strokeWidth)
        ? { ...base, type: value.type, width: value.width, height: value.height, stroke: value.stroke, strokeWidth: value.strokeWidth } : null;
    default:
      return null;
  }
};

/** The design document stored in a canvas snapshot, or null for any other canvas document (projects, agent tasks). */
export function readBoardDocument(snapshot: unknown): BoardDocumentData | null {
  if (!record(snapshot) || !record(snapshot.boardDocument)) return null;
  const data = snapshot.boardDocument;
  if (data.kind !== BOARD_DOCUMENT_KIND || data.version !== 1 || !Array.isArray(data.pages) || data.pages.length === 0 || data.pages.length > 50) return null;
  const pages: BoardPage[] = [];
  for (const page of data.pages) {
    if (!record(page) || !text(page.id, 80) || !Array.isArray(page.items)) return null;
    pages.push({ id: page.id, items: page.items.map(readItem).filter((item): item is BoardItem => item !== null) });
  }
  return { kind: BOARD_DOCUMENT_KIND, version: 1, pages };
}

export const newBoardId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const emptyBoardDocument = (): BoardDocumentData => ({ kind: BOARD_DOCUMENT_KIND, version: 1, pages: [{ id: newBoardId(), items: [] }] });
export const boardSnapshot = (data: BoardDocumentData) => ({ objects: [], boardDocument: data });

/** Light shows document dates as `2025.11.28 18:23`. */
export const formatBoardDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** Storage paths of the images on a page (signed together for previews). */
export const pageImagePaths = (page: BoardPage | undefined) => (page?.items ?? []).flatMap((item) => item.type === 'image' ? [item.storagePath] : []);

/** Fit zoom for the page in the editor area (Light opens a 1280-wide page at 81% in a 1440×850 area). */
export const fitBoardZoom = (width: number, height: number) => {
  const zoom = Math.min((width - 400) / BOARD_PAGE_WIDTH, (height - 72) / BOARD_PAGE_HEIGHT);
  return Math.max(0.1, Math.floor(zoom * 100) / 100);
};
