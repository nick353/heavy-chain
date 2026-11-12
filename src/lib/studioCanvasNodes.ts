import type { StudioFunctionId } from './fashionStudioExamples.ts';
import { readStudioLayout, withStudioLayout, type StudioPoint, type StudioPositions, type StudioRect } from './studioCanvas.ts';

/**
 * One Fashion Studio project holds several nodes on one canvas, like Light's React Flow board (2026-11-12):
 * - the project's own main image → form → results (the roles in snapshot.objects, unchanged since the first version);
 * - free image nodes (クリッピングの抽出, 画像をアップロード, 画像検索の「キャンバスに送信」, 画像編集の結果): image objects in
 *   the same snapshot with layerRole STUDIO_CANVAS_IMAGE_ROLE, so the role readers never take them for a role;
 * - more forms (the image toolbar's テキストで生成 etc., Light's addFormEdgeNode): each form is its own canvas document (the
 *   same document shape and save / generation paths as a project) listed in the parent's snapshot.studioForms and marked
 *   with snapshot.studioParent, so the project list shows only the parent.
 * A project saved before this (no studioForms, no canvas images) reads as before: no extra nodes.
 */
export const STUDIO_CANVAS_IMAGE_ROLE = 'studio-canvas-image';
export const STUDIO_CANVAS_IMAGE_FEATURE = 'fashion-studio-canvas-image';
/** Light refuses new image nodes past its MAX_IMAGE_NUM (the number lives in a chunk Light did not load for us); Heavy keeps
 * every node's position in one saved layout of at most 200 nodes, so images and forms stay under that together. */
export const STUDIO_MAX_CANVAS_IMAGES = 100;
export const STUDIO_MAX_CHILD_FORMS = 40;
/** Light's 已超出画布元素上限，请删除部分画布元素或新建项目 in Japanese. */
export const STUDIO_CANVAS_LIMIT_MESSAGE = 'キャンバスの要素上限を超えました。一部の要素を削除するか、新しいプロジェクトを作成してください';

export type StudioCanvasImageKind = 'upload' | 'clip' | 'search' | 'edit';
export type StudioCanvasImageCredit = { title: string; creator?: string; license: string; licenseUrl?: string; pageUrl: string; source?: string };
export type StudioCanvasImage = {
  id: string;
  /** The node key on the canvas (studioCanvasImageKey). */
  key: string;
  candidates: string[];
  status: 'available' | 'missing';
  kind: StudioCanvasImageKind;
  /** The node it came from (an edge is drawn from it), or null for a free node (Light's addImageNode). */
  sourceKey: string | null;
  /** The 画像編集 tool that made it (upscale, remove-background, clipping, crop). */
  tool: string | null;
  credit: StudioCanvasImageCredit | null;
};
export type StudioServerEditTool = 'repair' | 'partial' | 'expand' | 'erase';
export type StudioEditRequest = { tool: StudioServerEditTool; prompt: string; editOptions?: { aspectRatio?: string; resolution?: '1k' | '4k' } };
export type StudioChildForm = {
  id: string;
  documentId: string;
  fn: StudioFunctionId;
  /** The image node the form was opened from (Light's sourceImageId; the edge into the form). */
  sourceKey: string;
  /** A 画像編集 tool that runs on the generation route (画像修復・部分編集・AI拡張・AI削除): the form is not drawn and its
   * results hang straight off the source node, as Light's addImageEdgeDirect does. */
  edit: StudioEditRequest | null;
};
export type StudioParentLink = { documentId: string; formId: string };
export type StudioSnapshot = { objects: Record<string, unknown>[]; [key: string]: unknown };

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const text = (value: unknown, max: number) => (typeof value === 'string' && value.trim() && value.length <= max ? value : null);
const FORM_ID = /^[A-Za-z0-9_-]{1,40}$/;
const FUNCTIONS: readonly StudioFunctionId[] = ['text', 'region', 'underwear', '3d'];
const SERVER_TOOLS: readonly StudioServerEditTool[] = ['repair', 'partial', 'expand', 'erase'];
const KINDS: readonly StudioCanvasImageKind[] = ['upload', 'clip', 'search', 'edit'];

export const studioCanvasImageKey = (id: string) => `node:${id}`;
export const studioChildFormKey = (formId: string) => `${formId}/form`;
export const studioChildNodeKey = (formId: string, key: string) => `${formId}/${key}`;
/** The child form a node key belongs to (`<formId>/...`), or null for the project's own and free nodes. */
export const studioChildFormIdOf = (key: string | null | undefined) => {
  if (!key || key.startsWith('node:')) return null;
  const slash = key.indexOf('/');
  return slash > 0 ? key.slice(0, slash) : null;
};
export const isStudioFormKey = (key: string | null | undefined) => key === 'form' || Boolean(key?.endsWith('/form'));
export const newStudioFormId = (random: () => string = () => crypto.randomUUID()) => `f${random().replace(/-/g, '').slice(0, 12)}`;

const editRequestOf = (value: unknown): StudioEditRequest | null => {
  const edit = record(value);
  const tool = SERVER_TOOLS.find(item => item === edit.tool);
  const prompt = text(edit.prompt, 4000);
  if (!tool || !prompt) return null;
  const options = record(edit.editOptions);
  const aspectRatio = text(options.aspectRatio, 20);
  const resolution: '1k' | '4k' | null = options.resolution === '1k' || options.resolution === '4k' ? options.resolution : null;
  const editOptions: NonNullable<StudioEditRequest['editOptions']> = { ...(aspectRatio ? { aspectRatio } : {}), ...(resolution ? { resolution } : {}) };
  return { tool, prompt, ...(Object.keys(editOptions).length ? { editOptions } : {}) };
};

/** The forms added to a project (snapshot.studioForms); anything malformed is left out, never thrown. */
export const readStudioForms = (snapshot: unknown): StudioChildForm[] => {
  const forms = record(record(snapshot).studioForms).forms;
  if (!Array.isArray(forms)) return [];
  const seen = new Set<string>();
  const result: StudioChildForm[] = [];
  for (const item of forms) {
    const form = record(item);
    const id = typeof form.id === 'string' && FORM_ID.test(form.id) ? form.id : null;
    const documentId = text(form.documentId, 120);
    const fn = FUNCTIONS.find(value => value === form.fn);
    const sourceKey = text(form.sourceKey, 200);
    if (!id || !documentId || !fn || !sourceKey || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, documentId, fn, sourceKey, edit: editRequestOf(form.edit) });
    if (result.length >= STUDIO_MAX_CHILD_FORMS) break;
  }
  return result;
};
export const withStudioForm = <T extends StudioSnapshot>(snapshot: T, form: StudioChildForm, positions?: StudioPositions): T => {
  const forms = readStudioForms(snapshot).filter(item => item.id !== form.id);
  if (forms.length >= STUDIO_MAX_CHILD_FORMS) throw new Error('studio_canvas_form_limit');
  const entry = { id: form.id, documentId: form.documentId, fn: form.fn, sourceKey: form.sourceKey, ...(form.edit ? { edit: form.edit } : {}) };
  const next = { ...snapshot, studioForms: { version: 1, forms: [...forms, entry] } };
  return positions ? withExtraPositions(next, positions) : next;
};

/** A form document's link back to its project (snapshot.studioParent). */
export const readStudioParent = (snapshot: unknown): StudioParentLink | null => {
  const parent = record(record(snapshot).studioParent);
  const documentId = text(parent.documentId, 120);
  const formId = typeof parent.formId === 'string' && FORM_ID.test(parent.formId) ? parent.formId : null;
  return documentId && formId ? { documentId, formId } : null;
};
export const withStudioParent = <T extends StudioSnapshot>(snapshot: T, parent: StudioParentLink): T => ({ ...snapshot, studioParent: { documentId: parent.documentId, formId: parent.formId } });
/** A form that lives on another project's canvas (the project list shows only the project). */
export const isStudioChildDocument = (snapshot: unknown) => readStudioParent(snapshot) !== null;

const creditOf = (value: unknown): StudioCanvasImageCredit | null => {
  const credit = record(value);
  const title = text(credit.title, 300), license = text(credit.license, 80), pageUrl = text(credit.pageUrl, 1000);
  if (!title || !license || !pageUrl || !/^https:\/\//i.test(pageUrl)) return null;
  const creator = text(credit.creator, 200), licenseUrl = text(credit.licenseUrl, 1000), source = text(credit.source, 40);
  return { title, license, pageUrl, ...(creator ? { creator } : {}), ...(licenseUrl && /^https:\/\//i.test(licenseUrl) ? { licenseUrl } : {}), ...(source ? { source } : {}) };
};
const sourcesOf = (image: Record<string, unknown>) => {
  const metadata = record(image.metadata);
  const values = [metadata.storagePath, image.src].filter((value): value is string => typeof value === 'string' && Boolean(value.trim()) && !/^(?:blob|data):/i.test(value));
  return [...new Set(values)];
};

/** Free image nodes on the project's canvas, in the order they were added. */
export const readStudioCanvasImages = (snapshot: unknown): StudioCanvasImage[] => {
  const objects = record(snapshot).objects;
  if (!Array.isArray(objects)) return [];
  const seen = new Set<string>();
  const result: StudioCanvasImage[] = [];
  for (const item of objects) {
    const image = record(item);
    const parameters = record(record(image.metadata).parameters);
    if (image.type !== 'image' || parameters.layerRole !== STUDIO_CANVAS_IMAGE_ROLE) continue;
    const id = typeof image.id === 'string' && FORM_ID.test(image.id) ? image.id : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const candidates = sourcesOf(image);
    result.push({ id, key: studioCanvasImageKey(id), candidates, status: candidates.length ? 'available' : 'missing',
      kind: KINDS.find(value => value === parameters.studioNodeKind) ?? 'upload', sourceKey: text(parameters.studioSourceKey, 200),
      tool: text(parameters.studioEditTool, 40), credit: creditOf(parameters.studioCredit) });
    if (result.length >= STUDIO_MAX_CANVAS_IMAGES) break;
  }
  return result;
};
export type StudioCanvasImageInput = {
  id: string;
  remote: { jobId: string; imageId: string; storagePath: string };
  kind: StudioCanvasImageKind;
  sourceKey?: string | null;
  tool?: string | null;
  credit?: StudioCanvasImageCredit | null;
  operationId: string;
};
/** The saved object of a free image node (the same shape as the project's role images, so the server's feedback and
 * library readers find its storage path). */
export const studioCanvasImageObject = (input: StudioCanvasImageInput) => {
  if (!input.remote.jobId || !input.remote.imageId || !input.remote.storagePath || /^(?:blob|data):/i.test(input.remote.storagePath)) throw new Error('studio_canvas_image_invalid');
  const credit = input.credit ? creditOf(input.credit) : null;
  return {
    id: input.id, type: 'image', x: 0, y: 0, width: 360, height: 480, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, visible: true, locked: false,
    src: input.remote.storagePath,
    metadata: { feature: STUDIO_CANVAS_IMAGE_FEATURE, prompt: '', jobId: input.remote.jobId, imageId: input.remote.imageId, storagePath: input.remote.storagePath,
      persistenceStatus: 'completed',
      parameters: { layerRole: STUDIO_CANVAS_IMAGE_ROLE, studioNodeKind: input.kind, inputOperationId: input.operationId,
        ...(input.sourceKey ? { studioSourceKey: input.sourceKey } : {}), ...(input.tool ? { studioEditTool: input.tool } : {}), ...(credit ? { studioCredit: credit } : {}) } },
  };
};
export const withStudioCanvasImage = <T extends StudioSnapshot>(snapshot: T, object: ReturnType<typeof studioCanvasImageObject>, positions?: StudioPositions): T => {
  if (readStudioCanvasImages(snapshot).length >= STUDIO_MAX_CANVAS_IMAGES) throw new Error('studio_canvas_image_limit');
  const next = { ...snapshot, objects: [...snapshot.objects.filter(item => record(item).id !== object.id), object] };
  return positions ? withExtraPositions(next, positions) : next;
};

/** New nodes keep the place they were given: their positions join the saved layout in the same write. */
const withExtraPositions = <T extends StudioSnapshot>(snapshot: T, positions: StudioPositions): T => withStudioLayout(snapshot, { ...readStudioLayout(snapshot), ...positions });

const overlaps = (a: Omit<StudioRect, 'id'>, b: Omit<StudioRect, 'id'>, margin: number) => a.x < b.x + b.width + margin && a.x + a.width + margin > b.x
  && a.y < b.y + b.height + margin && a.y + a.height + margin > b.y;
/** Light's addFormEdgeNode puts a new node 100 units right of its source and a random 0-300 units lower (Heavy draws at
 * 0.45 of Light's units); Heavy then steps it down past any node it would cover, so nothing lands on top of another. */
export const studioNodeBeside = (source: Omit<StudioRect, 'id'> | null, others: readonly Omit<StudioRect, 'id'>[], size: { width: number; height: number },
  random: () => number = Math.random): StudioPoint => {
  const gap = 100 * 0.45, step = 45;
  let point: StudioPoint = source
    ? { x: source.x + source.width + gap, y: source.y + Math.round(random() * 300 * 0.45) }
    : { x: others.length ? Math.max(...others.map(rect => rect.x + rect.width)) + gap : 0, y: others.length ? Math.min(...others.map(rect => rect.y)) : 0 };
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const hit = others.find(rect => overlaps({ ...point, ...size }, rect, 12));
    if (!hit) break;
    point = { x: point.x, y: hit.y + hit.height + step };
  }
  return { x: Math.round(point.x), y: Math.round(point.y) };
};
