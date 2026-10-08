import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import type { WorkspaceArtifact } from '../src/lib/localWorkspaceArtifacts.ts';

const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { MAX_INLINE_DATA_URL_CHARS, normalizeWorkspaceArtifactForPersistence } = await vite.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts') as typeof import('../src/lib/localWorkspaceArtifacts.ts');

const artifact = (imageUrl: string, metadata: WorkspaceArtifact['metadata']): WorkspaceArtifact => ({
  id: 'a1', brandId: 'b1', scopeId: 'u1', featureType: 'lightchain-fabric-image-provider-result', title: '生地イメージ AI生成',
  imageUrl, prompt: null, createdAt: new Date(0).toISOString(), metadata,
} as WorkspaceArtifact);

const bigDataUrl = `data:image/png;base64,${'A'.repeat(MAX_INLINE_DATA_URL_CHARS + 10)}`;
const storagePath = 'generated-images/7c7bdab3-c977-4125-b850-9853fd294da6';

test('a multi-MB result data URL is not written to browser storage once the result has its own server copy', () => {
  assert.equal(normalizeWorkspaceArtifactForPersistence(artifact(bigDataUrl, { storagePath })).imageUrl, '');
  assert.equal(normalizeWorkspaceArtifactForPersistence(artifact(bigDataUrl, { remoteStoragePath: storagePath })).imageUrl, '');
});

test('keeps the inline image when it is the only copy of the result', () => {
  assert.equal(normalizeWorkspaceArtifactForPersistence(artifact(bigDataUrl, {})).imageUrl, bigDataUrl);
  // An input path does not hold these pixels.
  assert.equal(normalizeWorkspaceArtifactForPersistence(artifact(bigDataUrl, { sourceStoragePath: storagePath })).imageUrl, bigDataUrl);
});

test('small inline images and existing remote URL handling are unchanged', () => {
  const small = 'data:image/png;base64,AAAA';
  assert.equal(normalizeWorkspaceArtifactForPersistence(artifact(small, { storagePath })).imageUrl, small);
  assert.equal(normalizeWorkspaceArtifactForPersistence(artifact('https://r2.example/x.png?sig=1', { storagePath })).imageUrl, '');
  assert.equal(normalizeWorkspaceArtifactForPersistence(artifact('https://r2.example/x.png?sig=1', {})).imageUrl, 'https://r2.example/x.png?sig=1');
});
