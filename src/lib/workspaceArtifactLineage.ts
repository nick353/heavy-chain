import type { Json } from '../types/database';

export type WorkspaceArtifactLineageRole = 'workspace-handoff' | 'generated-result' | 'source-material';
export type WorkspaceArtifactProviderGeneration = 'completed' | 'not-run' | 'unknown';

export interface WorkspaceArtifactLineage extends Record<string, Json | undefined> {
  schemaVersion: 'heavy-chain-workspace-lineage.v1';
  artifactId: string;
  featureType: string;
  role: WorkspaceArtifactLineageRole;
  workflowVersion: string | null;
  sourceArtifactId: string | null;
  sourceJobId: string | null;
  canvasProjectId: string | null;
  canonicalStoragePath: string | null;
  providerGeneration: WorkspaceArtifactProviderGeneration;
  destinations: {
    galleryArtifactId: string;
    historyArtifactId: string;
    jobsJobId: string | null;
    canvasProjectId: string | null;
  };
  persistenceContract: 'workspace-artifact-readback-v1';
}

type LineageInput = {
  id: string;
  featureType: string;
  canvasProjectId?: string;
  sourceJobId?: string;
  canonicalStoragePath?: string | null;
  metadata: Record<string, Json | undefined>;
};

const stringMetadata = (metadata: Record<string, Json | undefined>, ...keys: string[]) => {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
};

const booleanMetadata = (metadata: Record<string, Json | undefined>, key: string) => (
  metadata[key] === true
);

const isProviderResult = (input: LineageInput) => (
  booleanMetadata(input.metadata, 'providerResultArtifact')
  || input.metadata.resultKind === 'provider'
  || input.metadata.generationMode === 'provider'
  || input.featureType.endsWith('-provider-result')
  || input.featureType === 'lightchain-material-provider'
);

/**
 * Build the one metadata contract shared by Gallery, History, Jobs, and Canvas
 * handoffs. It stores IDs and canonical storage paths only; signed URLs and
 * provider secrets are intentionally excluded.
 */
export const buildWorkspaceArtifactLineage = (input: LineageInput): WorkspaceArtifactLineage => {
  const providerResult = isProviderResult(input);
  const sourceArtifactId = stringMetadata(
    input.metadata,
    'sourceArtifactId',
    'sourceProviderResultArtifactId',
  );
  const sourceJobId = input.sourceJobId
    ?? stringMetadata(input.metadata, 'sourceJobId', 'remoteJobId');
  const canvasProjectId = input.canvasProjectId
    ?? stringMetadata(input.metadata, 'canvasProjectId');
  const localHandoff = input.metadata.handoffKind === 'local-workflow-intake'
    || input.metadata.providerBlocker !== undefined;

  return {
    schemaVersion: 'heavy-chain-workspace-lineage.v1',
    artifactId: input.id,
    featureType: input.featureType,
    role: providerResult ? 'generated-result' : localHandoff ? 'workspace-handoff' : 'source-material',
    workflowVersion: stringMetadata(input.metadata, 'workflowVersion'),
    sourceArtifactId,
    sourceJobId,
    canvasProjectId,
    canonicalStoragePath: input.canonicalStoragePath ?? null,
    providerGeneration: providerResult ? 'completed' : localHandoff ? 'not-run' : 'unknown',
    destinations: {
      galleryArtifactId: input.id,
      historyArtifactId: input.id,
      jobsJobId: sourceJobId,
      canvasProjectId,
    },
    persistenceContract: 'workspace-artifact-readback-v1',
  };
};
