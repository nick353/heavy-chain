import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  root: process.cwd(),
  configFile: false,
  envFile: false,
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
  define: {
    'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': '"false"',
  },
});

const artifacts = await vite.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts');
const videoPersistence = await vite.ssrLoadModule('/src/lib/videoWorkspacePersistence.ts');
const videoWorkstationSource = await readFile(new URL('../src/pages/VideoWorkstationPage.tsx', import.meta.url), 'utf8');
const originalWindow = globalThis.window;
const values = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  },
};

after(async () => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  await vite.close();
});

test('video source-editor save uses durable Cloudflare persistence and fails closed without a receipt', () => {
  assert.match(videoWorkstationSource, /saveWorkspaceArtifactBestEffort/);
  assert.match(videoWorkstationSource, /persistVideoEditorBestEffort/);
  assert.match(videoWorkstationSource, /video_workspace_remote_persistence_unverified/);
  assert.match(videoWorkstationSource, /await onPersist\(currentValues\)/);
  assert.match(videoWorkstationSource, /onPersist\?: .*Promise<WorkspaceArtifactPersistenceResult>/);
  assert.match(videoWorkstationSource, /data-testid="video-draft-save" disabled=\{isSaving\}/);
});

test('video source editor draft persists and reopens through the shared workspace artifact boundary', () => {
  const brandId = 'brand-video-editor-persistence';
  const scopeId = 'user-video-editor-persistence';
  const artifactId = 'local-video-draft-persistence';
  const href = '/flow/GenerateShortVideo/detail?boardProjectCode=local-video-draft-persistence&boardProjectType=GenerateShortVideoCustom';
  const generationIntent = {
    feature: 'video-workstation',
    prompt: 'Local video editor persistence proof',
    href,
    label: '動画を再利用',
    sourceWorkspace: 'video',
    workflowVersion: 'video-storyboard-local-v1',
    sourceLabel: 'Video Workstation',
    sourceResumePath: '/flow/GenerateShortVideo/detail',
    sourceMode: 'local-workflow-intake',
  };
  const input = {
    id: artifactId,
    brandId,
    scopeId,
    featureType: 'video-workstation',
    title: 'Untitled',
    imageUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
    prompt: generationIntent.prompt,
    metadata: {
      feature: 'video-workstation',
      videoProjectCode: artifactId,
      videoSourceEditorVersion: 'video-source-editor-parity-v1',
      videoEditPrompt: generationIntent.prompt,
      videoDuration: '10秒',
      videoResolution: '1080P',
      videoReferenceName: 'reference.png',
      videoReferencePreview: 'data:image/png;base64,cmVm',
      sourceWorkspace: 'video',
      sourceLabel: 'Video Workstation',
      sourceResumePath: '/flow/GenerateShortVideo/detail',
      sourceMode: 'local-workflow-intake',
      workflowVersion: 'video-storyboard-local-v1',
      providerRoute: 'unsupported',
      providerBlocker: 'video_provider_not_admitted',
      generationIntent,
    },
  };

  const saved = artifacts.saveWorkspaceArtifactPersisted(input);
  assert.equal(saved.ok, true);
  const storageKey = artifacts.getWorkspaceArtifactStorageKey(brandId, scopeId);
  assert.equal(JSON.parse(values.get(storageKey)).length, 1);

  const reloaded = artifacts.findWorkspaceArtifactPersisted(brandId, artifactId, scopeId);
  assert.equal(reloaded.ok, true);
  assert.equal(reloaded.artifact.metadata.videoDuration, '10秒');
  assert.equal(reloaded.artifact.metadata.videoResolution, '1080P');
  assert.equal(reloaded.artifact.metadata.generationIntent.href, href);

  const deleted = artifacts.deleteWorkspaceArtifact(brandId, artifactId, scopeId);
  assert.deepEqual(deleted, { ok: true });
  assert.deepEqual(artifacts.listWorkspaceArtifacts(brandId, scopeId), []);
});

test('video project matching never rehydrates a previous project when its stable code differs', () => {
  const artifact = {
    id: 'local-video-draft-a',
    featureType: 'video-workstation',
    metadata: { videoProjectCode: 'project-a' },
  };

  assert.equal(videoPersistence.matchesVideoProjectArtifact(artifact, 'project-a', 'local-video-draft-a'), true);
  assert.equal(videoPersistence.matchesVideoProjectArtifact(artifact, 'project-b', 'local-video-draft-a'), false);
  assert.equal(videoPersistence.matchesVideoProjectArtifact({
    ...artifact,
    metadata: {},
  }, 'project-b', 'local-video-draft-a'), true);
  assert.equal(videoPersistence.matchesVideoProjectArtifact({
    ...artifact,
    featureType: 'image-generation',
  }, 'project-a', 'local-video-draft-a'), false);
});

test('video source image hydration replaces only the project placeholder', () => {
  const defaultImage = 'https://example.invalid/light-placeholder.webp';
  const savedImage = 'data:image/png;base64,saved';
  assert.equal(videoPersistence.shouldHydrateVideoSourceImage('', savedImage, defaultImage), true);
  assert.equal(videoPersistence.shouldHydrateVideoSourceImage(defaultImage, savedImage, defaultImage), true);
  assert.equal(videoPersistence.shouldHydrateVideoSourceImage('data:image/png;base64,user', savedImage, defaultImage), false);
  assert.equal(videoPersistence.shouldHydrateVideoSourceImage(defaultImage, '', defaultImage), false);
});
