export type FashionStudioPinState = {
  brandId: string | null;
  ids: ReadonlySet<string>;
  readStatus: 'pending' | 'success' | 'failure';
};

type PinStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type PinStorageAccessor = () => PinStorage;
const browserStorage: PinStorageAccessor = () => window.localStorage;
const pinKey = (brandId: string) => `heavy-fashion-studio-pins:${brandId}`;

export const readPins = (
  brandId: string | null,
  getStorage: PinStorageAccessor = browserStorage,
): FashionStudioPinState => {
  if (!brandId) return { brandId, ids: new Set(), readStatus: 'pending' };
  try {
    const saved = getStorage().getItem(pinKey(brandId));
    const parsed: unknown = saved === null ? [] : JSON.parse(saved);
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
      return { brandId, ids: new Set(), readStatus: 'failure' };
    }
    return { brandId, ids: new Set(parsed), readStatus: 'success' };
  } catch {
    return { brandId, ids: new Set(), readStatus: 'failure' };
  }
};

export const writePins = (
  state: FashionStudioPinState,
  getStorage: PinStorageAccessor = browserStorage,
): boolean => {
  if (!state.brandId || state.readStatus !== 'success') return false;
  try {
    const ids = [...state.ids];
    if (!ids.every((id) => typeof id === 'string')) return false;
    getStorage().setItem(pinKey(state.brandId), JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
};

/** An event from a previous brand cannot change the current brand's pins. */
export const changePin = (
  state: FashionStudioPinState,
  eventBrandId: string | null,
  currentBrandId: string | null,
  projectId: string,
  pinned: boolean,
): { state: FashionStudioPinState; changed: boolean; shouldPersist: boolean } => {
  if (!currentBrandId || eventBrandId !== currentBrandId || state.brandId !== currentBrandId
    || state.readStatus === 'pending' || state.ids.has(projectId) === pinned) {
    return { state, changed: false, shouldPersist: false };
  }
  const ids = new Set(state.ids);
  if (pinned) ids.add(projectId);
  else ids.delete(projectId);
  return {
    state: { ...state, ids },
    changed: true,
    shouldPersist: state.readStatus === 'success',
  };
};
