/** Shared runtime identity for the Heavy deployment and its /heavy aliases. */
export const isHeavyWorkspaceRuntime = (): boolean => {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname.toLowerCase();
  return hostname.includes('heavy-chain')
    || window.location.pathname === '/heavy'
    || window.location.pathname.startsWith('/heavy/');
};

export const isHeavyWorkspaceBrandName = (name: unknown): boolean => {
  if (typeof name !== 'string') return false;
  const normalized = name.trim();
  return normalized.toLocaleLowerCase() === 'heavy chain workspace'
    || /^heavy\s*chain(?:\s+workspace)?$/i.test(normalized);
};

/**
 * User-facing Heavy routes keep the Light-shaped implementation, but must not
 * send a Heavy-domain user back to the legacy `/lightchain/*` namespace.
 * Persisted records may still contain the legacy path; this helper only
 * changes the runtime navigation target.
 */
export const toHeavyWorkspacePath = (path: string): string => (
  isHeavyWorkspaceRuntime()
    ? path.replace(/^\/lightchain(?=\/|$)/, '/heavy')
    : path
);

/**
 * `/heavy/:toolId` is a compatibility envelope for canonical Light-shaped
 * routes. Normalize common human-facing aliases before the workbench resolves
 * its catalog entry so every Heavy URL lands on a real feature screen.
 */
const HEAVY_TOOL_ID_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  marketing: 'marketing-home',
  model: 'ai-fitting',
  fitting: 'ai-fitting',
  'virtual-fitting': 'ai-fitting',
  'model-reference': 'ai-fitting-reference',
  studio: 'fashion-studio',
  'graphic-design': 'print-design-project',
});

export const resolveHeavyWorkspaceToolId = (toolId: string): string => (
  HEAVY_TOOL_ID_ALIASES[toolId] ?? toolId
);

/** Canonical paths select the destination pages' route-specific presentation. */
const HEAVY_CANONICAL_PATHS: Readonly<Record<string, string>> = Object.freeze({
  'wear-design-lab': '/flow/orientedDesign',
  'wear-design-detail': '/flow/orientedDesign/detail',
  'model-library': '/model-library/model-custom-form',
  'model-custom': '/model-library/model-custom-form',
  'fashion-studio': '/flow/integration',
  studio: '/flow/integration',
  lab: '/flow/laboratory',
  'pattern-vector': '/tools/pattern-to-vector',
  'pattern-vector-pro': '/tools/vector-special',
  'printing-image': '/tools/printing',
  'model-face': '/model-library/head-form',
  'model-change': '/model-library/model-change-form',
  'body-shape': '/model-library/body-form',
  'clothing-size': '/model-library/size-form',
  'pose-change': '/model-library/pose-form',
  'background-change': '/model-library/background-form',
  'angle-change': '/model-library/perspective-form',
});

export const resolveHeavyCanonicalLocation = (
  toolId: string | undefined,
  search: string,
  hash: string,
): { pathname: string; search: string; hash: string } | null => {
  if (toolId === undefined || !Object.prototype.hasOwnProperty.call(HEAVY_CANONICAL_PATHS, toolId)) {
    return null;
  }
  return { pathname: HEAVY_CANONICAL_PATHS[toolId], search, hash };
};
