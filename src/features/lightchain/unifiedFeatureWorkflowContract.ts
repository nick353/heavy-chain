import {
  GOAL_CANDIDATE_ROW_IDS,
  type GoalCandidateRowId,
} from './parityContract.ts';
import {
  getLightchainParityExpectedInputRoles,
} from './parityRuntime.ts';
import {
  getLightchainProviderRoute,
  type LightchainProviderRoute,
} from './providerAdapter.ts';
import {
  lightchainUnifiedFeatureCatalog,
} from '../../lib/lightchainUnifiedFeatureCatalog.ts';

export const UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION = 'lightchain-unified-workflow.v1';

export const UNIFIED_RESULT_DESTINATIONS = Object.freeze([
  'gallery',
  'canvas',
  'history',
  'jobs',
] as const);

export const UNIFIED_WORKFLOW_LIFECYCLE = Object.freeze([
  'draft',
  'ready',
  'generating',
  'completed',
  'failed',
  'retry',
] as const);

export const UNIFIED_RIGHTS_GATE = 'generation-time-confirmation' as const;

export type UnifiedResultDestination = (typeof UNIFIED_RESULT_DESTINATIONS)[number];
export type UnifiedWorkflowLifecycle = (typeof UNIFIED_WORKFLOW_LIFECYCLE)[number];
export type NonVideoGoalCandidateRowId = Exclude<GoalCandidateRowId, 'video-workstation' | 'video-detail'>;

export interface UnifiedFeatureWorkflowContract {
  readonly contractVersion: typeof UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION;
  readonly rowId: NonVideoGoalCandidateRowId;
  readonly providerRoute: Exclude<LightchainProviderRoute, 'unsupported'>;
  readonly inputRoles: readonly string[];
  readonly resultDestinations: readonly UnifiedResultDestination[];
  readonly lifecycle: readonly UnifiedWorkflowLifecycle[];
  readonly sourceInputMode: 'library-or-upload';
  readonly rightsGate: typeof UNIFIED_RIGHTS_GATE;
  readonly retry: {
    readonly retainsLastCompletedResult: true;
    readonly preservesInputLineage: true;
    readonly blocksDuplicateSubmit: true;
  };
}

const videoRows = new Set(['video-workstation', 'video-detail']);
const nonVideoRowIds = GOAL_CANDIDATE_ROW_IDS.filter(
  (rowId): rowId is NonVideoGoalCandidateRowId => !videoRows.has(rowId),
);

if (lightchainUnifiedFeatureCatalog.length !== nonVideoRowIds.length) {
  throw new Error('unified_feature_workflow_catalog_count_mismatch');
}

const contracts = Object.fromEntries(
  lightchainUnifiedFeatureCatalog.map((feature) => {
    const rowId = feature.id as NonVideoGoalCandidateRowId;
    const providerRoute = getLightchainProviderRoute(rowId);
    if (providerRoute === 'unsupported') {
      throw new Error(`unified_feature_workflow_provider_route_missing:${rowId}`);
    }
    const contract: UnifiedFeatureWorkflowContract = Object.freeze({
      contractVersion: UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION,
      rowId,
      providerRoute,
      inputRoles: getLightchainParityExpectedInputRoles(rowId),
      resultDestinations: UNIFIED_RESULT_DESTINATIONS,
      lifecycle: UNIFIED_WORKFLOW_LIFECYCLE,
      sourceInputMode: 'library-or-upload',
      rightsGate: UNIFIED_RIGHTS_GATE,
      retry: Object.freeze({
        retainsLastCompletedResult: true,
        preservesInputLineage: true,
        blocksDuplicateSubmit: true,
      }),
    });
    return [rowId, contract];
  }),
) as Record<NonVideoGoalCandidateRowId, UnifiedFeatureWorkflowContract>;

export const LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT: Readonly<
  Record<NonVideoGoalCandidateRowId, UnifiedFeatureWorkflowContract>
> = Object.freeze(contracts);

export function getLightchainUnifiedFeatureWorkflowContract(
  rowId: string,
): UnifiedFeatureWorkflowContract | null {
  return LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT[
    rowId as NonVideoGoalCandidateRowId
  ] ?? null;
}
