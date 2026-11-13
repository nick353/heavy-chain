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

/** Results line up to the right of their form like Light's (touching, no gap). A result that has no saved place yet and
 * would land on top of another node (a free image or form placed there earlier) steps down past it, the way a node added
 * from the toolbar does (studioNodeBeside). Found in production on 2026-11-12: a form's second result covered the
 * クリッピング image that had been put beside the first. Nodes with a saved place never move; results touching each
 * other in their row are not an overlap. */
export const studioSettleNewNodes = (positions: StudioPositions, sizes: Readonly<Record<string, { width: number; height: number }>>,
  order: readonly string[], moving: ReadonlySet<string>): StudioPositions => {
  const rectAt = (key: string): Omit<StudioRect, 'id'> | null => {
    const size = sizes[key], point = positions[key];
    return size && size.height > 0 && point ? { x: point.x, y: point.y, width: size.width, height: size.height } : null;
  };
  const placed = order.filter(key => !moving.has(key)).map(rectAt).filter((rect): rect is Omit<StudioRect, 'id'> => rect !== null);
  const settled: StudioPositions = { ...positions };
  for (const key of order) {
    if (!moving.has(key)) continue;
    let rect = rectAt(key);
    if (!rect) continue;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const current: Omit<StudioRect, 'id'> = rect;
      const hit = placed.find(other => overlaps(current, other, 0));
      if (!hit) break;
      rect = { ...current, y: hit.y + hit.height + 45 };
    }
    settled[key] = { x: rect.x, y: rect.y };
    placed.push(rect);
  }
  return settled;
};

// ── Deleting nodes (Light: select a node and press Delete / Backspace, or 右クリック → 削除; 取り消し brings it back) ─────
/**
 * A deleted node first joins snapshot.studioHidden in the same write, so it leaves the canvas at once and 取り消し can bring
 * it back while the page is open (Light's undo covers deletions too, 2026-11-13). The next time the project opens,
 * studioPurgeHidden tidies the document: a deleted free image leaves snapshot.objects, and a deleted form whose results
 * are all deleted (or that has none) leaves studioForms and its own document is deleted. The project's own main image,
 * form and results stay saved (they are the project's roles) and are only hidden.
 */
export const STUDIO_MAX_HIDDEN = 400;
export const readStudioHidden = (snapshot: unknown): string[] => {
  const hidden = record(record(snapshot).studioHidden);
  if (hidden.version !== 1 || !Array.isArray(hidden.keys)) return [];
  return [...new Set(hidden.keys.filter((key): key is string => typeof key === 'string' && key.length > 0 && key.length <= 200))].slice(0, STUDIO_MAX_HIDDEN);
};
export const withStudioHidden = <T extends StudioSnapshot>(snapshot: T, keys: readonly string[]): T => {
  const unique = [...new Set(keys)].filter(key => key.length > 0 && key.length <= 200).slice(0, STUDIO_MAX_HIDDEN);
  if (unique.length) return { ...snapshot, studioHidden: { version: 1, keys: unique } };
  const next: Record<string, unknown> = { ...snapshot };
  delete next.studioHidden;
  return next as T;
};
/** Deleting a node leaves the nodes joined to it in place (Light removes only the node and its edges). */
export const withStudioNodesDeleted = <T extends StudioSnapshot>(snapshot: T, keys: readonly string[]): T => withStudioHidden(snapshot, [...readStudioHidden(snapshot), ...keys]);
export const withStudioNodesRestored = <T extends StudioSnapshot>(snapshot: T, keys: readonly string[]): T => {
  const restore = new Set(keys);
  return withStudioHidden(snapshot, readStudioHidden(snapshot).filter(key => !restore.has(key)));
};
/**
 * Tidies the deleted nodes out of the document. `childResults` holds each added form's result node keys as its own
 * document reports them; a form whose results are not known yet is left for a later tidy. Returns the next snapshot and
 * the form documents to delete (null when nothing changes).
 */
export const studioPurgeHidden = <T extends StudioSnapshot>(snapshot: T, childResults: Readonly<Record<string, readonly string[] | undefined>>): { snapshot: T; deleteDocuments: string[] } | null => {
  const hidden = new Set(readStudioHidden(snapshot));
  if (!hidden.size) return null;
  const images = readStudioCanvasImages(snapshot).filter(image => hidden.has(image.key));
  const forms = readStudioForms(snapshot).filter(form => {
    const results = childResults[form.id];
    if (!results) return false;
    const visibleResults = results.filter(key => !key.endsWith('/pending') && !hidden.has(key));
    if (visibleResults.length) return false;
    // A 画像編集 form is never drawn: it goes once its waiting node or all its results were deleted (one still running
    // with nothing deleted stays).
    if (form.edit) return results.some(key => hidden.has(key)) || hidden.has(studioChildNodeKey(form.id, 'pending'));
    return hidden.has(studioChildFormKey(form.id));
  });
  if (!images.length && !forms.length) return null;
  const imageIds = new Set(images.map(image => image.id)), formIds = new Set(forms.map(form => form.id));
  const gone = (key: string) => (key.startsWith('node:') && imageIds.has(key.slice(5))) || formIds.has(studioChildFormIdOf(key) ?? '');
  let next: T = { ...snapshot, objects: snapshot.objects.filter(item => !imageIds.has(String(record(item).id))) };
  const keptForms = readStudioForms(snapshot).filter(form => !formIds.has(form.id))
    .map(form => ({ id: form.id, documentId: form.documentId, fn: form.fn, sourceKey: form.sourceKey, ...(form.edit ? { edit: form.edit } : {}) }));
  if (record(snapshot).studioForms) next = { ...next, studioForms: { version: 1, forms: keptForms } };
  const layout = readStudioLayout(snapshot);
  next = withStudioLayout(next, Object.fromEntries(Object.entries(layout).filter(([key]) => !gone(key))));
  next = withStudioHidden(next, [...hidden].filter(key => !gone(key)));
  return { snapshot: next, deleteDocuments: forms.map(form => form.documentId) };
};
