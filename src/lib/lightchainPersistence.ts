type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isLargeDataUrl = (value: unknown) => (
  typeof value === 'string'
  && /^data:image\//i.test(value)
  && value.length >= 100_000
);

/**
 * A provider result already has a durable Storage path when it was persisted
 * remotely. Keep that path as the source of truth and do not duplicate the
 * large returned data URL inside the resumable workbench metadata.
 *
 * Results without a canonical path (for example local preview fixtures) keep
 * their data URL so the current session can still be resumed honestly.
 */
export const compactLightchainWorkbenchStateForPersistence = <T extends UnknownRecord>(
  state: T,
): T => {
  const result = isRecord(state.lightchainResult) ? state.lightchainResult : null;
  if (!result || !isLargeDataUrl(result.imageUrl)) return state;

  const storagePath = [result.storagePath, state.generatedStoragePath]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (!storagePath) return state;

  return {
    ...state,
    lightchainResult: {
      ...result,
      imageUrl: '',
    },
  } as T;
};
