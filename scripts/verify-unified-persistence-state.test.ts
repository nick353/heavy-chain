import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildWorkspaceArtifactLineage } from '../src/lib/workspaceArtifactLineage.ts';

const persistenceSurfaces = [
  'src/pages/FashionStudioPage.tsx',
  'src/pages/ModelLibraryPage.tsx',
  'src/pages/PatternWorkspacePage.tsx',
  'src/pages/LabPage.tsx',
];

test('auxiliary apparel workspaces promote completed only after persisted artifact readback', () => {
  persistenceSurfaces.forEach((path) => {
    const source = fs.readFileSync(path, 'utf8');
    assert.match(source, /listWorkspaceArtifacts/);
    assert.match(source, /savedArtifactId/);
    assert.match(source, /completed: Boolean\(savedArtifactId\)/);
    assert.match(source, /persisted: Boolean\(savedArtifactId\)/);
    assert.match(source, /const \{ artifact, projectId \} = handoffWorkspaceToCanvas/);
    assert.match(source, /setSavedArtifactId\(artifact\.id\)/);
    assert.doesNotMatch(source, /completed: history\.length > 0/);
    assert.doesNotMatch(source, /persisted: history\.length > 0/);
  });
});

test('marketing workspace does not promote a local job to completed before artifact persistence', () => {
  const source = fs.readFileSync('src/pages/MarketingWorkspacePage.tsx', 'utf8');
  assert.match(source, /listWorkspaceArtifacts/);
  assert.match(source, /savedArtifactId/);
  assert.match(source, /completed: Boolean\(savedArtifactId\)/);
  assert.match(source, /persisted: Boolean\(savedArtifactId\)/);
  assert.match(source, /setSavedArtifactId\(result\.artifact\.id\)/);
  assert.doesNotMatch(source, /completed: job\.status === 'succeeded'/);
});

test('workspace lineage separates provider results from local handoffs and stores IDs only', () => {
  const handoff = buildWorkspaceArtifactLineage({
    id: 'local-handoff-1',
    featureType: 'fashion-studio',
    canvasProjectId: 'canvas-1',
    metadata: {
      handoffKind: 'local-workflow-intake',
      workflowVersion: 'studio-selection-local-v1',
      sourceJobId: 'not-a-provider-job',
      signedPreviewUrl: 'https://signed.example.test/preview.png?token=ephemeral',
    },
  });
  assert.equal(handoff.role, 'workspace-handoff');
  assert.equal(handoff.providerGeneration, 'not-run');
  assert.equal(handoff.destinations.galleryArtifactId, 'local-handoff-1');
  assert.equal(handoff.destinations.canvasProjectId, 'canvas-1');
  assert.equal(JSON.stringify(handoff).includes('signed.example.test'), false);

  const provider = buildWorkspaceArtifactLineage({
    id: 'provider-artifact-1',
    featureType: 'lightchain-fabric-image-provider-result',
    sourceJobId: 'job-1',
    canonicalStoragePath: 'brand-1/provider-1.png',
    metadata: {
      providerResultArtifact: true,
      workflowVersion: 'fabric-provider-v1',
      sourceProviderResultArtifactId: 'source-artifact-1',
    },
  });
  assert.equal(provider.role, 'generated-result');
  assert.equal(provider.providerGeneration, 'completed');
  assert.equal(provider.sourceArtifactId, 'source-artifact-1');
  assert.equal(provider.destinations.jobsJobId, 'job-1');
  assert.equal(provider.canonicalStoragePath, 'brand-1/provider-1.png');
  assert.equal(provider.persistenceContract, 'workspace-artifact-readback-v1');
});

test('Gallery, History, and Jobs source summaries consume the shared workspace lineage', () => {
  const source = fs.readFileSync('src/lib/sourceContextSummary.ts', 'utf8');
  assert.match(source, /workspaceLineage/);
  assert.match(source, /成果物系譜/);
  assert.match(source, /生成状態/);
  assert.match(source, /再利用先/);
  assert.match(source, /heavy-chain-workspace-lineage\.v1/);
});
