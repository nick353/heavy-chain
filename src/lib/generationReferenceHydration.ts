import {
  decodeGenerationSourceReferences,
  type GenerationSourceReference,
} from './generationSourceReferences.ts';

export interface GenerationReferenceHydrationScope {
  userId: string | null;
  brandId: string | null;
  featureId: string | null;
  navigationKey: string;
  requestGeneration: number;
}

export interface HydratedGenerationSourceReference extends GenerationSourceReference {
  order: number;
  canonicalPath: string;
  imageUrl: string;
}

export type GenerationReferenceHydrationResult =
  | { status: 'resolved'; references: HydratedGenerationSourceReference[] }
  | { status: 'failed'; reason: string; failedIndex?: number }
  | { status: 'stale' };

/**
 * Authentication is an independent fence, not merely another value implied by
 * the route sequence. In particular, a logout can render before the effect
 * that increments requestGeneration runs.
 */
export const isGenerationReferenceHydrationScopeCurrent = (
  captured: GenerationReferenceHydrationScope,
  current: GenerationReferenceHydrationScope,
): boolean => Boolean(captured.userId && captured.brandId && captured.featureId)
  && captured.userId === current.userId
  && captured.brandId === current.brandId
  && captured.featureId === current.featureId
  && captured.navigationKey === current.navigationKey
  && captured.requestGeneration === current.requestGeneration;

const canonicalPathForReference = (reference: GenerationSourceReference): string | null => (
  reference.sourceStoragePath
  ?? (reference.sourceImageId ? `generated-images/${reference.sourceImageId}` : null)
);

/**
 * Resolve an opaque, ordered handoff manifest through the caller's existing
 * authenticated resolver. Results are published atomically: one failed item
 * never returns a partial URL list, and a scope change discards all URLs.
 */
export async function hydrateGenerationSourceReferences({
  manifestValues,
  legacyReference,
  scope,
  getCurrentScope,
  resolveImageUrl,
}: {
  manifestValues: readonly string[];
  legacyReference?: GenerationSourceReference;
  scope: GenerationReferenceHydrationScope;
  getCurrentScope: () => GenerationReferenceHydrationScope;
  resolveImageUrl: (canonicalPath: string) => Promise<string>;
}): Promise<GenerationReferenceHydrationResult> {
  if (!scope.userId || !scope.brandId || !scope.featureId) {
    return { status: 'failed', reason: 'generation_reference_scope_unavailable' };
  }
  if (!isGenerationReferenceHydrationScopeCurrent(scope, getCurrentScope())) {
    return { status: 'stale' };
  }

  const decoded = manifestValues.length > 1
    ? { ok: false as const, reason: 'duplicate_manifest' }
    : decodeGenerationSourceReferences(manifestValues.length === 1 ? manifestValues[0] : null, legacyReference);
  if (!decoded.ok) return { status: 'failed', reason: decoded.reason };
  if (decoded.references.length === 0) return { status: 'resolved', references: [] };

  const outcomes = await Promise.all(decoded.references.map(async (reference, index) => {
    if (!isGenerationReferenceHydrationScopeCurrent(scope, getCurrentScope())) {
      return { status: 'stale' as const };
    }
    const canonicalPath = canonicalPathForReference(reference);
    if (!canonicalPath) return { status: 'failed' as const, index, reason: 'missing_canonical_path' };
    try {
      const imageUrl = await resolveImageUrl(canonicalPath);
      if (!/^https?:\/\//i.test(imageUrl)) {
        return { status: 'failed' as const, index, reason: 'resolved_url_invalid' };
      }
      return {
        status: 'resolved' as const,
        reference: { ...reference, order: index, canonicalPath, imageUrl },
      };
    } catch {
      return { status: 'failed' as const, index, reason: 'image_resolution_failed' };
    }
  }));

  if (!isGenerationReferenceHydrationScopeCurrent(scope, getCurrentScope())
    || outcomes.some((outcome) => outcome.status === 'stale')) {
    return { status: 'stale' };
  }

  const failure = outcomes.find((outcome) => outcome.status === 'failed');
  if (failure?.status === 'failed') {
    return { status: 'failed', reason: failure.reason, failedIndex: failure.index };
  }

  return {
    status: 'resolved',
    references: outcomes.flatMap((outcome) => outcome.status === 'resolved' ? [outcome.reference] : []),
  };
}
