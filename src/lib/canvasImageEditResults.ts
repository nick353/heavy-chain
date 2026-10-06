import type { ImageEditResult } from './imageApi';
import { validateCanvasProtectedBatchBinding } from './nativePrintFinalFrame.ts';
import { PROTECTED_IMAGE_EDIT_MODE } from './protectedImageEditContract.ts';

export type CanvasImageEditCandidate = {
  imageUrl: string;
  jobId: string;
  imageId: string;
  storagePath: string;
  candidateIndex: number;
  persistenceStatus: 'completed';
  batchId?: string;
};

export function normalizeCanvasImageEditCandidates(
  result: ImageEditResult,
  limit = 4,
): CanvasImageEditCandidate[] {
  // OpenAI protected finals have independent saved wa job IDs. Their shared
  // identity is the verified original provider job, never the first saved job.
  const final = result as ImageEditResult & {
    canvasProtectedBatchBinding?: unknown;
    requiresProtectedComposite?: boolean;
    failedCandidateIndices?: number[];
  };
  // A Canvas binding does not reclassify the established Workers path.
  if (final.canvasProtectedBatchBinding !== undefined && final.provider !== 'workers_ai' && final.provider !== 'openai') return [];
  const openAIClaim = final.provider === 'openai' && (final.canvasProtectedBatchBinding !== undefined ||
    final.protectedRegionComposited === true && final.requestedCandidateCount === 4);
  if (openAIClaim) {
    let binding;
    try { binding = validateCanvasProtectedBatchBinding(final.canvasProtectedBatchBinding); }
    catch { return []; }
    const batchId = final.batchId;
    if (!final.success || final.provider !== 'openai' || final.protectedRegionComposited !== true ||
      final.requiresProtectedComposite !== false || final.persistenceStatus !== 'completed' ||
      final.requestedCandidateCount !== 4 || final.persistedCandidateCount !== 4 ||
      final.failedCandidates?.length || final.failedCandidateIndices?.length ||
      final.requestId !== binding.requestId || !batchId || batchId !== final.providerJobId ||
      batchId !== `ai-${binding.requestId}` || !Array.isArray(final.images) || final.images.length !== 4) return [];
    const imageIds = new Set<string>(), paths = new Set<string>(), urls = new Set<string>();
    const candidates: CanvasImageEditCandidate[] = [];
    for (const [index, raw] of final.images.entries()) {
      const candidate = raw as typeof raw & { provider?: string; providerJobId?: string; protectedRegionComposited?: boolean };
      const { imageId, jobId, imageUrl, storagePath } = candidate;
      if (candidate.provider !== 'openai' || candidate.protectedRegionComposited !== true ||
        candidate.batchId !== batchId || candidate.providerJobId !== batchId ||
        candidate.persistenceStatus !== 'completed' || candidate.candidateIndex !== index ||
        typeof imageId !== 'string' || !/^wa-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(imageId) ||
        jobId !== imageId || storagePath !== `generated-images/${imageId}` ||
        typeof imageUrl !== 'string' || !imageUrl.trim() || imageIds.has(imageId) ||
        paths.has(storagePath) || urls.has(imageUrl)) return [];
      imageIds.add(imageId); paths.add(storagePath); urls.add(imageUrl);
      candidates.push({ imageUrl, jobId, imageId, storagePath, candidateIndex:index, persistenceStatus:'completed', batchId });
    }
    return candidates.slice(0, Math.max(1, Math.min(4, Math.trunc(limit))));
  }
  const rawCandidates = result.images?.length
    ? result.images
    : result.imageUrl
      ? [{
          imageUrl: result.imageUrl,
          jobId: result.jobId,
          imageId: result.imageId,
          storagePath: result.storagePath,
          persistenceStatus: result.persistenceStatus,
          candidateIndex: 0,
          batchId:result.batchId,
        }]
      : [];
  const seenImageIds = new Set<string>();
  const seenStoragePaths = new Set<string>();
  const seenUrls = new Set<string>();
  const seenCandidateIndices = new Set<number>();
  let batchJobId = '';
  const protectedBatch = result.provider === 'workers_ai' && result.protectedRegionComposited === true &&
    result.maskTreatment === PROTECTED_IMAGE_EDIT_MODE && typeof result.batchId === 'string' && !!result.batchId;

  return rawCandidates.flatMap((candidate, responseIndex) => {
    const imageUrl = typeof candidate.imageUrl === 'string' ? candidate.imageUrl.trim() : '';
    const jobId = typeof candidate.jobId === 'string' ? candidate.jobId.trim() : '';
    const imageId = typeof candidate.imageId === 'string' ? candidate.imageId.trim() : '';
    const storagePath = typeof candidate.storagePath === 'string' ? candidate.storagePath.trim() : '';
    const candidateIndex = Number.isSafeInteger(candidate.candidateIndex) && Number(candidate.candidateIndex) >= 0
      ? Number(candidate.candidateIndex)
      : responseIndex;
    if (!imageUrl || !jobId || !imageId || !storagePath || candidate.persistenceStatus !== 'completed') {
      return [];
    }
    const candidateBatch = protectedBatch ? candidate.batchId : jobId;
    if (!candidateBatch || protectedBatch && candidateBatch !== result.batchId || batchJobId && candidateBatch !== batchJobId) return [];
    if (
      seenImageIds.has(imageId)
      || seenStoragePaths.has(storagePath)
      || seenUrls.has(imageUrl)
      || seenCandidateIndices.has(candidateIndex)
    ) {
      return [];
    }
    batchJobId = candidateBatch;
    seenImageIds.add(imageId);
    seenStoragePaths.add(storagePath);
    seenUrls.add(imageUrl);
    seenCandidateIndices.add(candidateIndex);
    return [{
      imageUrl,
      jobId,
      imageId,
      storagePath,
      candidateIndex,
      persistenceStatus: 'completed' as const,
      ...(protectedBatch ? { batchId:candidateBatch } : {}),
    }];
  }).slice(0, Math.max(1, Math.min(4, Math.trunc(limit))));
}

export function buildCanvasImageEditBatchProof(params: {
  batchId: string;
  parentObjectId: string | null;
  preResultCount: number;
  candidates: CanvasImageEditCandidate[];
}) {
  const preResultCount = Math.max(0, Math.trunc(params.preResultCount));
  const indices = params.candidates.map((candidate) => candidate.candidateIndex);
  return {
    schema: 'heavy-chain.canvas-image-edit-batch.v1',
    batchId: params.batchId,
    parentObjectId: params.parentObjectId,
    preZero: preResultCount === 0,
    preResultCount,
    postResultCount: preResultCount + params.candidates.length,
    postDelta: params.candidates.length,
    indices,
    edges: params.candidates.map((candidate) => ({
      from: params.parentObjectId,
      to: candidate.imageId,
      candidateIndex: candidate.candidateIndex,
    })),
  };
}

export async function addCanvasImageEditCandidatesSequentially<T>(
  candidates: CanvasImageEditCandidate[],
  addCandidate: (candidate: CanvasImageEditCandidate, placementIndex: number) => Promise<T>,
): Promise<T[]> {
  const added: T[] = [];
  for (const [placementIndex, candidate] of candidates.entries()) {
    added.push(await addCandidate(candidate, placementIndex));
  }
  return added;
}

export async function settleCanvasImageEditCandidatesSequentially<T>(
  candidates: CanvasImageEditCandidate[],
  addCandidate: (candidate: CanvasImageEditCandidate, placementIndex: number) => Promise<T>,
): Promise<{
  placed: Array<{ candidate: CanvasImageEditCandidate; placementIndex: number; value: T }>;
  failed: Array<{ candidate: CanvasImageEditCandidate; placementIndex: number; error: unknown }>;
}> {
  const placed: Array<{ candidate: CanvasImageEditCandidate; placementIndex: number; value: T }> = [];
  const failed: Array<{ candidate: CanvasImageEditCandidate; placementIndex: number; error: unknown }> = [];
  for (const [placementIndex, candidate] of candidates.entries()) {
    try {
      placed.push({ candidate, placementIndex, value: await addCandidate(candidate, placementIndex) });
    } catch (error) {
      failed.push({ candidate, placementIndex, error });
    }
  }
  return { placed, failed };
}
