import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import {
  lightchainUnifiedFeatureCatalog,
  getLightchainUnifiedRouteAliases,
} from '../../lib/lightchainUnifiedFeatureCatalog';
import type { LightchainFeature } from '../../lib/lightchainParityCatalog';
import { useAuthStore } from '../../stores/authStore';
import {
  getUnifiedWorkspaceFlowScopeKey,
  readUnifiedWorkspaceFlowState,
  resolveUnifiedWorkspaceFlowStateForScope,
  writeUnifiedWorkspaceFlowState,
  type FlowScope,
} from '../../lib/unifiedWorkspaceFlowPersistence';
import type { UnifiedWorkspaceFlowState } from '../../lib/unifiedWorkspaceFlow';

type LightchainUnifiedWorkspaceShellProps = {
  children: ReactNode;
};

type UnifiedWorkspaceFlowContextValue = {
  flowState: UnifiedWorkspaceFlowState;
  setFlowState: (state: UnifiedWorkspaceFlowState) => void;
};

const UnifiedWorkspaceFlowContext = createContext<UnifiedWorkspaceFlowContextValue | null>(null);

export function useUnifiedWorkspaceFlow() {
  const context = useContext(UnifiedWorkspaceFlowContext);
  if (!context) throw new Error('useUnifiedWorkspaceFlow must be used inside LightchainUnifiedWorkspaceShell');
  return context;
}

const isBetaFeature = (feature: LightchainFeature) => feature.betaIncluded !== false;
const routeBase = (route: string) => route.split('?')[0];

const featureMatchesLocation = (feature: LightchainFeature, pathname: string, search: string) => {
  const params = new URLSearchParams(search);
  const featureParam = params.get('feature') || params.get('lcFeature');
  if (featureParam === feature.id) return true;
  if (getLightchainUnifiedRouteAliases(feature.id).includes(pathname)) return true;
  return pathname === routeBase(feature.route);
};

/**
 * Provides the shared flow state without adding Heavy-specific visual chrome.
 *
 * Lightchain production is the visual authority for every parity route. The
 * provider stays mounted so feature pages retain scoped persistence, rights
 * gates, and Gallery/Canvas/History/Jobs handoffs, while the rendered frame
 * remains the canonical Lightchain frame supplied by Layout and each page.
 */
export function LightchainUnifiedWorkspaceShell({ children }: LightchainUnifiedWorkspaceShellProps) {
  const location = useLocation();
  const { user, currentBrand } = useAuthStore();
  const activeFlowKey = useMemo(
    () => lightchainUnifiedFeatureCatalog.find((feature) => (
      isBetaFeature(feature) && featureMatchesLocation(feature, location.pathname, location.search)
    ))?.id ?? 'workspace-hub',
    [location.pathname, location.search],
  );
  const userId = user?.id?.trim() || null;
  const brandId = currentBrand?.id?.trim() || null;
  const flowScope = useMemo<FlowScope>(() => ({
    userId,
    brandId,
    feature: activeFlowKey,
  }), [activeFlowKey, brandId, userId]);
  const flowScopeKey = getUnifiedWorkspaceFlowScopeKey(flowScope);
  const [flowStateSnapshot, setFlowStateSnapshot] = useState(() => ({
    scopeKey: flowScopeKey,
    state: readUnifiedWorkspaceFlowState(flowScope),
  }));
  const flowState = resolveUnifiedWorkspaceFlowStateForScope(
    flowScope,
    flowStateSnapshot.scopeKey,
    flowStateSnapshot.state,
  );

  useEffect(() => {
    setFlowStateSnapshot({
      scopeKey: flowScopeKey,
      state: readUnifiedWorkspaceFlowState(flowScope),
    });
  }, [flowScope, flowScopeKey]);

  const setFlowState = useCallback((state: UnifiedWorkspaceFlowState) => {
    setFlowStateSnapshot({
      scopeKey: flowScopeKey,
      state: flowScopeKey ? state : 'draft',
    });
    writeUnifiedWorkspaceFlowState(flowScope, state);
  }, [flowScope, flowScopeKey]);

  return (
    <UnifiedWorkspaceFlowContext.Provider value={{ flowState, setFlowState }}>
      <div data-testid="lightchain-parity-shell" data-flow-state={flowState} className="contents">
        {children}
      </div>
    </UnifiedWorkspaceFlowContext.Provider>
  );
}
