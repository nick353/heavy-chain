export interface ImageEditReadbackResult {
  success: boolean;
  imageUrl?: string;
  persistenceStatus?: string;
  requestedCandidateCount?: number;
  persistedCandidateCount?: number;
  failedCandidates?: Array<unknown>;
  images?: Array<{
    imageUrl?: string;
    persistenceStatus?: string;
  }>;
  error?: string;
}

export function assertCompletedImageEditResult(
  result: ImageEditReadbackResult,
  code = 'provider_image_result',
): asserts result is ImageEditReadbackResult & { imageUrl: string; persistenceStatus: 'completed' } {
  if (!result.success) {
    throw new Error(result.error || `${code}_failed`);
  }
  if (typeof result.imageUrl !== 'string' || !result.imageUrl.trim()) {
    throw new Error(`${code}_image_missing`);
  }
  if (result.persistenceStatus !== 'completed') {
    throw new Error(`${code}_persistence_incomplete:${result.persistenceStatus ?? 'unknown'}`);
  }
  if (
    Number.isFinite(result.requestedCandidateCount)
    && Number.isFinite(result.persistedCandidateCount)
    && (result.persistedCandidateCount as number) < (result.requestedCandidateCount as number)
  ) {
    throw new Error([
      `${code}_persisted_candidate_count_incomplete`,
      `requested=${result.requestedCandidateCount}`,
      `persisted=${result.persistedCandidateCount}`,
    ].join(':'));
  }
  if ((result.failedCandidates?.length ?? 0) > 0) {
    throw new Error(`${code}_failed_candidates_present`);
  }
  if (result.images?.some((image) => (
    typeof image.imageUrl !== 'string'
    || !image.imageUrl.trim()
    || (image.persistenceStatus !== undefined && image.persistenceStatus !== 'completed')
  ))) {
    throw new Error(`${code}_image_batch_incomplete`);
  }
}

export interface ModelMatrixReadbackResult {
  success: boolean;
  persistenceStatus?: string;
  matrix?: Array<{
    imageUrl?: string;
    persistenceStatus?: string;
  }>;
  error?: string;
}

export function assertCompletedModelMatrixResult(
  result: ModelMatrixReadbackResult,
  code = 'provider_model_result',
): asserts result is ModelMatrixReadbackResult & {
  matrix: NonNullable<ModelMatrixReadbackResult['matrix']>;
  persistenceStatus: 'completed';
} {
  if (!result.success) {
    throw new Error(result.error || `${code}_failed`);
  }
  if (result.persistenceStatus !== 'completed') {
    throw new Error(`${code}_persistence_incomplete:${result.persistenceStatus ?? 'unknown'}`);
  }
  const matrix = result.matrix ?? [];
  if (matrix.length === 0) {
    throw new Error(`${code}_matrix_missing`);
  }
  if (matrix.some((item) => (
    typeof item.imageUrl !== 'string'
    || !item.imageUrl.trim()
    || item.persistenceStatus !== 'completed'
  ))) {
    throw new Error(`${code}_matrix_incomplete`);
  }
}
