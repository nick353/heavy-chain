export type ClothModelWarmupProgress = {
  step: string;
  progress: number;
  message: string;
};

export type ClothModelWarmupResult = {
  status: 'ready';
  reused: boolean;
};

export type ClothModelWarmupStatus = 'idle' | 'warming' | 'ready' | 'timed-out';

export const createClothModelWarmupController = <Session>({
  createSession,
  initializeSession,
  initializationTimeoutMilliseconds = 75_000,
}: {
  createSession: (onProgress?: (progress: ClothModelWarmupProgress) => void) => Promise<Session>;
  initializeSession: (session: Session) => Promise<void>;
  initializationTimeoutMilliseconds?: number;
}) => {
  let sessionPromise: Promise<Session> | null = null;
  let rawInitializationPromise: Promise<void> | null = null;
  let boundedInitializationPromise: Promise<void> | null = null;
  let status: ClothModelWarmupStatus = 'idle';
  let latestProgress: ClothModelWarmupProgress | null = null;
  const progressListeners = new Set<(progress: ClothModelWarmupProgress) => void>();

  const publishProgress = (progress: ClothModelWarmupProgress) => {
    latestProgress = progress;
    progressListeners.forEach((listener) => listener(progress));
  };

  const subscribe = (listener?: (progress: ClothModelWarmupProgress) => void) => {
    if (!listener) return () => undefined;
    progressListeners.add(listener);
    if (latestProgress) listener(latestProgress);
    return () => progressListeners.delete(listener);
  };

  const getSession = () => {
    if (!sessionPromise) {
      sessionPromise = createSession(publishProgress).catch((error) => {
        sessionPromise = null;
        throw error;
      });
    }
    return sessionPromise;
  };

  const startInitialization = () => {
    status = 'warming';
    rawInitializationPromise = (async () => {
      const session = await getSession();
      await initializeSession(session);
      status = 'ready';
    })().catch((error) => {
      status = 'idle';
      sessionPromise = null;
      throw error;
    }).finally(() => {
      rawInitializationPromise = null;
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('rembg_timeout:initialize_cloth_model_warmup')),
        initializationTimeoutMilliseconds,
      );
    });
    boundedInitializationPromise = Promise.race([rawInitializationPromise, timeout])
      .catch((error) => {
        if (
          error instanceof Error
          && error.message === 'rembg_timeout:initialize_cloth_model_warmup'
          && rawInitializationPromise
        ) {
          status = 'timed-out';
        }
        throw error;
      })
      .finally(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        boundedInitializationPromise = null;
      });
    return boundedInitializationPromise;
  };

  const warmup = async (
    onProgress?: (progress: ClothModelWarmupProgress) => void,
  ): Promise<ClothModelWarmupResult> => {
    const unsubscribe = subscribe(onProgress);
    try {
      if (status === 'ready') return { status: 'ready', reused: true };
      if (status === 'timed-out' && rawInitializationPromise) {
        throw new Error('rembg_timeout:initialize_cloth_model_warmup');
      }
      const reused = rawInitializationPromise !== null;
      await (boundedInitializationPromise ?? startInitialization());
      return { status: 'ready', reused };
    } finally {
      unsubscribe();
    }
  };

  return {
    getSession,
    warmup,
    getInitializationPromise: () => rawInitializationPromise,
    getStatus: () => status,
    isReady: () => status === 'ready',
  };
};
