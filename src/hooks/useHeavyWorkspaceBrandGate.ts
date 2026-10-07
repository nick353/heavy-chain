import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { isHeavyWorkspaceBrandName, isHeavyWorkspaceRuntime } from '../lib/heavyWorkspace';

/**
 * On the Heavy host, canonical image workspaces must upload, generate and save in Heavy's private workspace
 * brand, never in a Light brand left in the shared auth store. Resolve it on entry and report `pending`
 * until it is current so callers can keep inputs disabled (an upload without the workspace fence is dropped).
 */
export function useHeavyWorkspaceBrandGate(): { pending: boolean; failed: boolean } {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const brandName = useAuthStore((state) => state.currentBrand?.name ?? null);
  const authReady = useAuthStore((state) => state.isInitialized && !state.isLoading);
  const [failed, setFailed] = useState(false);
  const heavy = isHeavyWorkspaceRuntime();
  const pending = heavy && Boolean(userId) && !isHeavyWorkspaceBrandName(brandName);

  useEffect(() => {
    if (!pending || !authReady) return;
    let cancelled = false;
    setFailed(false);
    void useAuthStore.getState().ensureHeavyWorkspace()
      .then((brand) => { if (!cancelled && !brand?.id) setFailed(true); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [authReady, pending, userId]);

  return { pending, failed: pending && failed };
}
