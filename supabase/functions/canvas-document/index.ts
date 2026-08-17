import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  clientError,
  createUserClient,
  requireBrandRole,
  requireUser,
} from '../_shared/auth.ts';
import type { Json } from '../../../src/types/database.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_REQUEST_BYTES = 640 * 1024;
const MAX_CANONICAL_BYTES = 512 * 1024;
const MAX_OBJECTS = 200;
const MAX_DEPTH = 8;
const MAX_ARRAY_LENGTH = 500;
const MAX_STRING_LENGTH = 16_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor', 'innerHTML', 'outerHTML']);
const SNAPSHOT_KEYS = new Set(['version', 'projectId', 'localProjectId', 'name', 'objects', 'view']);
const VIEW_KEYS = new Set(['zoom', 'panX', 'panY', 'gridVisible', 'snapToGrid', 'gridSize']);
const OBJECT_KEYS = new Set([
  'id', 'type', 'x', 'y', 'width', 'height', 'rotation', 'scaleX', 'scaleY', 'opacity',
  'locked', 'visible', 'zIndex', 'src', 'text', 'fontSize', 'fontFamily', 'fill', 'stroke',
  'strokeWidth', 'shapeType', 'parentId', 'derivedFrom', 'label', 'metadata',
]);
const METADATA_KEYS = new Set([
  'feature', 'prompt', 'parentId', 'generation', 'parameters', 'parentObjectId', 'maskApplied',
  'protectedRegionComposited', 'backendProvider', 'provider', 'status', 'jobId', 'imageId',
  'storagePath', 'persistenceStatus', 'lightchainCompat', 'galleryStoragePath', 'galleryImageId',
  'galleryImageUrl', 'parityRuntime', 'legalSafety', 'sourceIdentity', 'sourceRevision',
  'sourceReadback', 'lightchainEditStages', 'timestamp',
]);

type CanonicalSnapshot = {
  version: number;
  projectId?: string | null;
  localProjectId?: string | null;
  name?: string;
  objects: Array<Record<string, unknown>>;
  view?: Record<string, unknown>;
};

type CanvasDocumentRequest = {
  action?: 'get' | 'upsert';
  brandId?: string;
  documentId?: string;
  title?: string;
  snapshot?: unknown;
  expectedRevision?: number;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
);

const badRequest = (message: string, status = 400) => jsonResponse({ success: false, error: message }, status);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const assertSafeString = (value: string, path: string) => {
  if (value.length > MAX_STRING_LENGTH) throw new Error(`${path}_too_long`);
  if (/data\s*:/i.test(value) || /blob\s*:/i.test(value) || /(?:java|vb)script\s*:/i.test(value)) {
    throw new Error(`${path}_unsafe_scheme`);
  }
  if (/<\/?(?:svg|script)\b/i.test(value)) throw new Error(`${path}_unsafe_markup`);
};

const canonicalizeDynamic = (value: unknown, path: string, depth: number): Json => {
  if (depth > MAX_DEPTH) throw new Error(`${path}_too_deep`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string') assertSafeString(value, path);
    return value as Json;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path}_non_finite_number`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) throw new Error(`${path}_too_many_items`);
    return value.map((item, index) => canonicalizeDynamic(item, `${path}.${index}`, depth + 1));
  }
  if (!isRecord(value)) throw new Error(`${path}_invalid_value`);
  const output: Record<string, Json> = {};
  for (const key of Object.keys(value).sort()) {
    if (FORBIDDEN_KEYS.has(key) || key.toLowerCase().startsWith('on')) {
      throw new Error(`${path}.${key}_forbidden_key`);
    }
    output[key] = canonicalizeDynamic(value[key], `${path}.${key}`, depth + 1);
  }
  return output;
};

const canonicalizeSnapshot = (input: unknown): CanonicalSnapshot => {
  if (!isRecord(input)) throw new Error('snapshot_invalid');
  for (const key of Object.keys(input)) {
    if (!SNAPSHOT_KEYS.has(key) || FORBIDDEN_KEYS.has(key)) throw new Error(`snapshot.${key}_not_allowed`);
  }
  const objects = input.objects;
  if (!Array.isArray(objects)) throw new Error('snapshot.objects_required');
  if (objects.length > MAX_OBJECTS) throw new Error('snapshot.too_many_objects');

  const canonicalObjects = objects.map((rawObject, index) => {
    if (!isRecord(rawObject)) throw new Error(`snapshot.objects.${index}_invalid`);
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(rawObject).sort()) {
      if (!OBJECT_KEYS.has(key) || FORBIDDEN_KEYS.has(key) || key.toLowerCase().startsWith('on')) {
        throw new Error(`snapshot.objects.${index}.${key}_not_allowed`);
      }
      if (key === 'metadata' && rawObject[key] !== undefined) {
        if (!isRecord(rawObject[key])) throw new Error(`snapshot.objects.${index}.metadata_invalid`);
        const metadata: Record<string, Json> = {};
        for (const metadataKey of Object.keys(rawObject[key]).sort()) {
          if (!METADATA_KEYS.has(metadataKey) || FORBIDDEN_KEYS.has(metadataKey)) {
            throw new Error(`snapshot.objects.${index}.metadata.${metadataKey}_not_allowed`);
          }
          metadata[metadataKey] = canonicalizeDynamic(rawObject[key][metadataKey], `snapshot.objects.${index}.metadata.${metadataKey}`, 2);
        }
        output[key] = metadata;
      } else {
        output[key] = canonicalizeDynamic(rawObject[key], `snapshot.objects.${index}.${key}`, 2);
      }
    }
    return output;
  });

  const result: CanonicalSnapshot = {
    version: typeof input.version === 'number' && Number.isInteger(input.version) ? input.version : 1,
    objects: canonicalObjects,
  };
  if (input.projectId !== undefined) result.projectId = input.projectId === null ? null : String(input.projectId);
  if (input.localProjectId !== undefined) result.localProjectId = input.localProjectId === null ? null : String(input.localProjectId);
  if (input.name !== undefined) {
    if (typeof input.name !== 'string') throw new Error('snapshot.name_invalid');
    assertSafeString(input.name, 'snapshot.name');
    result.name = input.name.slice(0, 160);
  }
  if (input.view !== undefined) {
    if (!isRecord(input.view)) throw new Error('snapshot.view_invalid');
    for (const key of Object.keys(input.view)) {
      if (!VIEW_KEYS.has(key) || FORBIDDEN_KEYS.has(key)) throw new Error(`snapshot.view.${key}_not_allowed`);
    }
    result.view = canonicalizeDynamic(input.view, 'snapshot.view', 1) as Record<string, unknown>;
  }

  const canonicalBytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
  if (canonicalBytes > MAX_CANONICAL_BYTES) throw new Error('snapshot_canonical_too_large');
  return result;
};

const normalizeDocumentId = (value: unknown) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error('document_id_invalid');
  return value;
};

const normalizeBrandId = (value: unknown) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error('brand_id_invalid');
  return value;
};

const serializeDocument = (document: Record<string, unknown>) => ({
  id: document.id,
  ownerId: document.owner_id,
  brandId: document.brand_id,
  title: document.title,
  snapshot: document.snapshot,
  snapshotVersion: document.snapshot_version,
  revision: document.revision,
  createdAt: document.created_at,
  updatedAt: document.updated_at,
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse({ ok: true });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method Not Allowed' }, 405);

  const declaredLength = Number(req.headers.get('content-length') || 0);
  if (declaredLength > MAX_REQUEST_BYTES) return badRequest('request_too_large', 413);

  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) return badRequest('request_too_large', 413);
    const body = JSON.parse(rawBody) as CanvasDocumentRequest;
    const action = body.action || 'get';
    const supabase = createUserClient(req);
    const user = await requireUser(supabase);

    if (action === 'get') {
      const documentId = normalizeDocumentId(body.documentId);
      const brandId = body.brandId ? normalizeBrandId(body.brandId) : undefined;
      if (brandId) await requireBrandRole(supabase, brandId, user.id, 'viewer');
      const query = supabase.from('canvas_documents').select('*').eq('id', documentId);
      if (brandId) query.eq('brand_id', brandId);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse({ success: false, error: 'document_not_found' }, 404);
      return jsonResponse({ success: true, document: serializeDocument(data) });
    }

    if (action !== 'upsert') return badRequest('action_invalid');
    const brandId = normalizeBrandId(body.brandId);
    await requireBrandRole(supabase, brandId, user.id, 'editor');
    const snapshot = canonicalizeSnapshot(body.snapshot);
    const title = typeof body.title === 'string' && body.title.trim()
      ? body.title.trim().slice(0, 160)
      : (snapshot.name || '無題のプロジェクト');
    assertSafeString(title, 'title');

    if (!body.documentId) {
      const { data, error } = await supabase
        .from('canvas_documents')
        .insert({
          owner_id: user.id,
          brand_id: brandId,
          title,
          snapshot,
          snapshot_version: 1,
          revision: 0,
        })
        .select('*')
        .single();
      if (error) throw error;
      return jsonResponse({ success: true, document: serializeDocument(data), readbackRequired: true });
    }

    const documentId = normalizeDocumentId(body.documentId);
    if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) {
      return badRequest('expected_revision_required', 409);
    }
    const { data, error } = await supabase.rpc('update_canvas_document_snapshot', {
      p_document_id: documentId,
      p_brand_id: brandId,
      p_title: title,
      p_snapshot: snapshot,
      p_expected_revision: body.expectedRevision as number,
    });
    if (error) throw error;
    const updated = Array.isArray(data) ? data[0] : data;
    if (!updated) return jsonResponse({ success: false, error: 'document_conflict_or_not_found' }, 409);
    return jsonResponse({ success: true, document: serializeDocument(updated as Record<string, unknown>), readbackRequired: true });
  } catch (error) {
    const message = clientError(error);
    const status = message === 'Unauthorized'
      ? 401
      : /permissions|access denied/i.test(message)
        ? 403
        : /too_large|canonical|forbidden|not_allowed|invalid|unsafe|too_deep|too_many|non_finite|required/.test(message)
          ? 400
          : 500;
    return jsonResponse({ success: false, error: message }, status);
  }
});
