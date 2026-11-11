import { extractFashionStudioThumbnailCandidates } from './fashionStudioThumbnails.ts';

export type FashionStudioDetailRole = 'main' | 'reference' | 'result';
export type FashionStudioDetailAsset = {
  status: 'missing' | 'ambiguous' | 'available';
  objectId: string | null;
  candidates: string[];
};
/**
 * Light keeps up to nine reference images (テキストで生成: 最大9枚) and up to three fusion points (範囲指定で生成: 最大3か所),
 * and lists every result beside the sample. The first reference stays the `reference` role; references 2-9 are
 * `material-reference-extra` layers keyed by `referenceSlot` (1-8), and earlier results are `generated-result-history`
 * layers. Neither label matches the main/reference/result roles, so those roles stay unique.
 */
export const FASHION_STUDIO_EXTRA_REFERENCE_ROLE = 'material-reference-extra';
export const FASHION_STUDIO_RESULT_HISTORY_ROLE = 'generated-result-history';
export const FASHION_STUDIO_MAX_EXTRA_REFERENCES = 8;
export type FashionStudioExtraReference = FashionStudioDetailAsset & { slot: number };
export type FashionStudioSavedDetail = {
  roles: Record<FashionStudioDetailRole, FashionStudioDetailAsset>;
  prompt: string;
  /** References 2-9 in slot order; a slot saved twice is left out as ambiguous. */
  extraReferences: FashionStudioExtraReference[];
  /** Earlier results, oldest first; the current result stays `roles.result`. */
  history: FashionStudioDetailAsset[];
};
const record = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);
const emptyAsset = (): FashionStudioDetailAsset => ({ status: 'missing', objectId: null, candidates: [] });
export const emptyFashionStudioDetail = (): FashionStudioSavedDetail => ({
  roles: { main: emptyAsset(), reference: emptyAsset(), result: emptyAsset() }, prompt: '', extraReferences: [], history: [],
});
const assetOf = (image: Record<string, unknown>): FashionStudioDetailAsset => {
  const candidates = extractFashionStudioThumbnailCandidates({ objects: [image] });
  return { status: candidates.length ? 'available' : 'missing', objectId: typeof image.id === 'string' ? image.id : null, candidates };
};
export const fashionStudioExtraSlot = (image: Record<string, unknown>): number | null => {
  const parameters = record(record(image.metadata).parameters);
  const slot = parameters.referenceSlot;
  return parameters.layerRole === FASHION_STUDIO_EXTRA_REFERENCE_ROLE && typeof slot === 'number' && Number.isInteger(slot)
    && slot >= 1 && slot <= FASHION_STUDIO_MAX_EXTRA_REFERENCES ? slot : null;
};
const explicitRoles = (image: Record<string, unknown>): FashionStudioDetailRole[] => {
  const metadata = record(image.metadata);
  const parameters = record(metadata.parameters);
  const roles = new Set<FashionStudioDetailRole>();
  const role = parameters.layerRole;
  if (role === 'main' || role === 'main-image' || role === 'original-base') roles.add('main');
  if (role === 'reference' || role === 'material-reference' || role === 'extracted-cutout') roles.add('reference');
  if (role === 'result' || role === 'generated-result') roles.add('result');
  if (typeof metadata.feature === 'string') {
    if (metadata.feature.endsWith('-original-base-layer')) roles.add('main');
    if (metadata.feature.endsWith('-material-reference')) roles.add('reference');
    if (metadata.feature.endsWith('-generated-result')) roles.add('result');
  }
  return [...roles];
};

/** A missing/conflicting role never borrows another role's image or array position. */
export const extractFashionStudioSavedDetail = (snapshot: unknown): FashionStudioSavedDetail => {
  const detail = emptyFashionStudioDetail();
  const objects = record(snapshot).objects;
  if (!Array.isArray(objects)) return detail;
  const matches: Record<FashionStudioDetailRole, Record<string, unknown>[]> = { main: [], reference: [], result: [] };
  const conflicts = new Set<FashionStudioDetailRole>();
  const extras = new Map<number, Record<string, unknown>[]>();
  for (const item of objects) {
    const image = record(item);
    if (image.type !== 'image') continue;
    const slot = fashionStudioExtraSlot(image);
    if (slot !== null) { extras.set(slot, [...(extras.get(slot) ?? []), image]); continue; }
    if (record(record(image.metadata).parameters).layerRole === FASHION_STUDIO_RESULT_HISTORY_ROLE) { detail.history.push(assetOf(image)); continue; }
    const roles = explicitRoles(image);
    if (roles.length > 1) { roles.forEach((role) => conflicts.add(role)); continue; }
    if (roles.length === 1) matches[roles[0]].push(image);
  }
  const prompts = new Set<string>();
  for (const role of ['main', 'reference', 'result'] as const) {
    const images = matches[role];
    if (conflicts.has(role) || images.length > 1) {
      detail.roles[role] = { ...emptyAsset(), status: 'ambiguous' };
      continue;
    }
    if (images.length === 0) continue;
    const image = images[0];
    const candidates = extractFashionStudioThumbnailCandidates({ objects: [image] });
    detail.roles[role] = {
      status: candidates.length ? 'available' : 'missing',
      objectId: typeof image.id === 'string' ? image.id : null,
      candidates,
    };
    const metadata = record(image.metadata);
    const parameters = record(metadata.parameters);
    for (const value of [metadata.prompt, parameters.prompt]) {
      if (typeof value === 'string' && value.trim()) prompts.add(value);
    }
  }
  detail.prompt = prompts.size === 1 ? [...prompts][0] : '';
  detail.extraReferences = [...extras.entries()].filter(([, images]) => images.length === 1).sort(([a], [b]) => a - b)
    .map(([slot, images]) => ({ ...assetOf(images[0]), slot }));
  return detail;
};

export type FashionStudioDetailScope = { userId: string; brandId: string; documentId: string; generation: number };
export const fashionStudioDetailScopeKey = (scope: FashionStudioDetailScope) => JSON.stringify(scope);
export const validateFashionStudioDetailDocument = (document: unknown, scope: FashionStudioDetailScope): boolean => {
  const value = record(document);
  if (value.ownerId !== undefined && value.owner_id !== undefined && value.ownerId !== value.owner_id) return false;
  if (value.brandId !== undefined && value.brand_id !== undefined && value.brandId !== value.brand_id) return false;
  return value.id === scope.documentId
    && (value.ownerId ?? value.owner_id) === scope.userId
    && (value.brandId ?? value.brand_id) === scope.brandId;
};
export const fashionStudioRemainingUnits = (usage: unknown): number | null => {
  const value = record(usage).remainingUnits;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
};

export type FashionStudioDetailHydrationState = {
  scopeKey: string;
  status: 'pending' | 'success' | 'failure';
  title: string;
  detail: FashionStudioSavedDetail;
  remainingUnits: number | null;
};
type DetailDependencies = {
  getDocument: (documentId: string, context: { userId: string; assertContext: () => void }) => Promise<unknown>;
  getUsage: (brandId: string) => Promise<unknown>;
  assertScope: (scope: FashionStudioDetailScope) => void;
  publish: (state: FashionStudioDetailHydrationState) => void;
};
export const createFashionStudioDetailHydration = (dependencies: DetailDependencies) => {
  let active = true;
  let invocation = 0;
  return {
    async load(scope: FashionStudioDetailScope) {
      if (!active) return;
      const token = ++invocation;
      let state: FashionStudioDetailHydrationState = {
        scopeKey: fashionStudioDetailScopeKey(scope), status: 'pending', title: '',
        detail: emptyFashionStudioDetail(), remainingUnits: null,
      };
      const assertContext = () => {
        if (!active || invocation !== token) throw new Error('fashion_studio_detail_scope_stale');
        dependencies.assertScope(scope);
      };
      const emit = (patch: Partial<FashionStudioDetailHydrationState>) => {
        assertContext(); state = { ...state, ...patch }; dependencies.publish(state);
      };
      try { emit({}); } catch { return; }
      await Promise.all([
        (async () => {
          try {
            assertContext();
            const document = await dependencies.getDocument(scope.documentId, { userId: scope.userId, assertContext });
            assertContext();
            if (!validateFashionStudioDetailDocument(document, scope)) throw new Error('fashion_studio_detail_owner_mismatch');
            const value = record(document);
            emit({ status: 'success', title: typeof value.title === 'string' ? value.title : '',
              detail: extractFashionStudioSavedDetail(value.snapshot) });
          } catch {
            try { emit({ status: 'failure', title: '', detail: emptyFashionStudioDetail() }); } catch { /* stale scope */ }
          }
        })(),
        (async () => {
          try { assertContext(); emit({ remainingUnits: fashionStudioRemainingUnits(await dependencies.getUsage(scope.brandId)) }); }
          catch { try { emit({ remainingUnits: null }); } catch { /* stale scope */ } }
        })(),
      ]);
    },
    dispose() { active = false; invocation += 1; },
  };
};
