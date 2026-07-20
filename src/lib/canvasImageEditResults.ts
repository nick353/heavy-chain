import type { ImageEditResult } from './imageApi';

export type CanvasImageEditCandidate = {
  imageUrl: string;
  jobId: string;
  imageId: string;
  storagePath: string;
  candidateIndex: number;
  persistenceStatus: 'completed';
};

export function normalizeCanvasImageEditCandidates(
  result: ImageEditResult,
  limit = 4,
): CanvasImageEditCandidate[] {
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
        }]
      : [];
  const seenImageIds = new Set<string>();
  const seenStoragePaths = new Set<string>();
  const seenUrls = new Set<string>();
  const seenCandidateIndices = new Set<number>();
  let batchJobId = '';

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
    if (batchJobId && jobId !== batchJobId) return [];
    if (
      seenImageIds.has(imageId)
      || seenStoragePaths.has(storagePath)
      || seenUrls.has(imageUrl)
      || seenCandidateIndices.has(candidateIndex)
    ) {
      return [];
    }
    batchJobId = jobId;
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
