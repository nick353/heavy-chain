import type { CanvasObject } from '../stores/canvasStore';

const PREFIX = 'heavy-library-canvas:v1:';
export type LibraryCanvasClipboardScope = { origin: string; userId: string; brandId: string };
export type LibraryCanvasClipboardSource = { kind: 'artifact' | 'generated-image'; id: string };
export type LibraryCanvasClipboardReference = { scope: LibraryCanvasClipboardScope; source: LibraryCanvasClipboardSource };
export type LibraryCanvasClipboardImage = {
  userId: string; brandId: string; url: string; label: string;
  metadata: NonNullable<CanvasObject['metadata']>;
};

const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(id);
function validateScope(scope: LibraryCanvasClipboardScope) {
  if (!scope || !validId(scope.userId) || !validId(scope.brandId)) throw new Error('library_clipboard_scope_invalid');
  const url = new URL(scope.origin);
  if (url.origin !== scope.origin || url.username || url.password || !['https:', 'http:'].includes(url.protocol)) throw new Error('library_clipboard_scope_invalid');
}
export const isLibraryCanvasClipboard = (text: string) => text.startsWith(PREFIX);

/** A scoped reference, never an expiring media URL or image bytes. */
export function encodeLibraryCanvasClipboard(scope: LibraryCanvasClipboardScope, source: LibraryCanvasClipboardSource) {
  validateScope(scope);
  if (!source || !['artifact', 'generated-image'].includes(source.kind) || !validId(source.id)) throw new Error('library_clipboard_source_invalid');
  return PREFIX + JSON.stringify({ scope: { origin: scope.origin, userId: scope.userId, brandId: scope.brandId }, source: { kind: source.kind, id: source.id } });
}

export function readLibraryCanvasClipboard(text: string, expected: LibraryCanvasClipboardScope): LibraryCanvasClipboardReference | null {
  if (!isLibraryCanvasClipboard(text)) return null;
  if (text.length > 2000) throw new Error('library_clipboard_reference_invalid');
  validateScope(expected);
  const value = JSON.parse(text.slice(PREFIX.length)) as LibraryCanvasClipboardReference;
  if (!value || Object.keys(value).sort().join(',') !== 'scope,source'
    || !value.scope || Object.keys(value.scope).sort().join(',') !== 'brandId,origin,userId'
    || !value.source || Object.keys(value.source).sort().join(',') !== 'id,kind') throw new Error('library_clipboard_reference_invalid');
  // Re-encoding validates and detaches the reference before asynchronous lookup.
  const normalized = JSON.parse(encodeLibraryCanvasClipboard(value.scope, value.source).slice(PREFIX.length)) as LibraryCanvasClipboardReference;
  if (normalized.scope.origin !== expected.origin || normalized.scope.userId !== expected.userId || normalized.scope.brandId !== expected.brandId) throw new Error('library_clipboard_scope_mismatch');
  return normalized;
}

export async function copyLibraryCanvasReference(scope: LibraryCanvasClipboardScope, source: LibraryCanvasClipboardSource, options: {
  writeText: (text: string) => Promise<void>; assertCurrent: () => void;
}) {
  const text = encodeLibraryCanvasClipboard(scope, source);
  options.assertCurrent(); await options.writeText(text); options.assertCurrent();
}

/** Resolve only a same-owner record, then load and place once in the still-current document. */
export async function pasteLibraryCanvasReference(text: string, scope: LibraryCanvasClipboardScope, options: {
  resolve: (reference: LibraryCanvasClipboardReference) => Promise<LibraryCanvasClipboardImage>;
  loadImage: (url: string) => Promise<{ naturalWidth?: number; naturalHeight?: number; width?: number; height?: number }>;
  assertCurrent: () => void;
  place: (image: LibraryCanvasClipboardImage, size: { width: number; height: number }) => void;
}) {
  const reference = readLibraryCanvasClipboard(text, scope);
  if (!reference) return false;
  options.assertCurrent();
  const image = await options.resolve(reference); options.assertCurrent();
  if (image.userId !== reference.scope.userId || image.brandId !== reference.scope.brandId || !image.url) throw new Error('library_clipboard_record_scope_mismatch');
  const loaded = await options.loadImage(image.url); options.assertCurrent();
  const width = loaded.naturalWidth || loaded.width || 0, height = loaded.naturalHeight || loaded.height || 0;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('library_clipboard_image_invalid');
  options.place(image, { width, height });
  return true;
}

/** Text entry must keep its ordinary paste behavior. */
export function isLibraryCanvasPasteTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return true;
  return !target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
}
