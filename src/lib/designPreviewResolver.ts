/** Inputs are structural so this helper stays safe to execute in Node tests. */
export type DesignPreviewRequest = {
  artifactId: string;
  userId: string | null;
  brandId: string | null;
  imageUrl: string | null | undefined;
  canonicalStoragePath: string | null;
};

export type DesignPreviewResolution =
  | { status: 'ready'; url: string }
  | { status: 'none' }
  | { status: 'failed' };

export type DesignPreviewResolver = (source: string) => Promise<{ ok: boolean; url?: string }>;

export type DesignPreviewState = {
  scopeKey: string;
  requestToken: number;
  status: 'idle' | 'loading' | 'ready' | 'none' | 'failed';
  url: string | null;
};

export type DesignPreviewLiveScope = { userId: string | null; brandId: string | null };

export const designPreviewScopeKey = (request: DesignPreviewRequest) => JSON.stringify([
  request.userId,
  request.brandId,
  request.artifactId,
  request.imageUrl ?? null,
  request.canonicalStoragePath,
]);

/** Prefer an already available URL; only resolve a validated canonical path. */
export const resolveDesignPreview = async (
  request: Pick<DesignPreviewRequest, 'imageUrl' | 'canonicalStoragePath'>,
  resolve: DesignPreviewResolver,
): Promise<DesignPreviewResolution> => {
  const imageUrl = request.imageUrl?.trim();
  if (imageUrl) return { status: 'ready', url: imageUrl };

  const canonicalStoragePath = request.canonicalStoragePath?.trim();
  if (!canonicalStoragePath) return { status: 'none' };

  try {
    const result = await resolve(canonicalStoragePath);
    return result.ok && typeof result.url === 'string' && result.url.trim()
      ? { status: 'ready', url: result.url }
      : { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
};

let nextRequestToken = 0;

/** Local-only request controller; tokens and live auth scope fence every completion. */
export const createDesignPreviewController = (
  resolve: DesignPreviewResolver,
  getLiveScope: () => DesignPreviewLiveScope,
  publish: (state: DesignPreviewState) => void,
) => {
  let active = true;
  let generation = 0;
  let request: DesignPreviewRequest | null = null;
  let state: DesignPreviewState = { scopeKey: '', requestToken: 0, status: 'idle', url: null };

  const emit = (next: DesignPreviewState) => {
    state = next;
    if (active) publish(next);
  };

  const matchesLiveScope = (captured: DesignPreviewRequest) => {
    const live = getLiveScope();
    return live.userId === captured.userId && live.brandId === captured.brandId;
  };

  const stillCurrent = (captured: DesignPreviewRequest, token: number, expectedGeneration: number) => {
    if (!active || generation !== expectedGeneration || state.requestToken !== token) return false;
    return matchesLiveScope(captured);
  };

  const run = async (expectedGeneration: number): Promise<void> => {
    if (!active || !request) return;
    const captured = request;
    const scopeKey = designPreviewScopeKey(captured);
    const requestToken = ++nextRequestToken;
    emit({ scopeKey, requestToken, status: 'loading', url: null });

    if (!captured.userId || !captured.brandId) {
      if (stillCurrent(captured, requestToken, expectedGeneration)) {
        emit({ scopeKey, requestToken, status: 'none', url: null });
      }
      return;
    }

    // Avoid even starting a read/signing request when the component's captured
    // auth props have already fallen behind the live store between render/effect.
    if (!matchesLiveScope(captured)) return;
    const result = await resolveDesignPreview(captured, resolve);
    if (!stillCurrent(captured, requestToken, expectedGeneration)) return;
    emit({
      scopeKey,
      requestToken,
      status: result.status,
      url: result.status === 'ready' ? result.url : null,
    });
  };

  return {
    reset(nextRequest: DesignPreviewRequest): Promise<void> {
      if (!active) return Promise.resolve();
      request = { ...nextRequest };
      generation += 1;
      return run(generation);
    },
    retry(): Promise<void> {
      if (!active || !request) return Promise.resolve();
      generation += 1;
      return run(generation);
    },
    onImageError(requestToken: number) {
      if (!active || state.status !== 'ready' || state.requestToken !== requestToken || !request) return false;
      const live = getLiveScope();
      if (live.userId !== request.userId || live.brandId !== request.brandId) return false;
      emit({ ...state, status: 'failed', url: null });
      return true;
    },
    dispose() {
      active = false;
      generation += 1;
    },
  };
};
