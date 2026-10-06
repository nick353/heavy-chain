import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const pageSource = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const thumbnailSource = await readFile(new URL('../src/components/DesignArtifactThumbnail.tsx', import.meta.url), 'utf8');

test('Design cards use the local thumbnail component while preserving the same Canvas href and artifact identity', () => {
  assert.match(pageSource, /<DesignArtifactThumbnail artifact=\{artifact\} userId=\{designUserId\} brandId=\{designBrandId\} href=\{href\} onOpen=\{openProject\} \/>/);
  assert.match(pageSource, /const href = designEntryHref\(entry\);/);
  assert.match(pageSource, /const openProject = \(\) => \{ if \(href\) navigate\(href\); \};/);
  assert.match(pageSource, /sourceArtifactId=|designEntryHref\(entry\)/);
  assert.match(thumbnailSource, /useAuthStore\.getState\(\)/);
  assert.match(thumbnailSource, /getWorkspaceArtifactCanonicalStoragePath\(artifact\.metadata\)/);
  assert.match(thumbnailSource, /resolveGeneratedImageUrlWithStatus/);
  assert.match(thumbnailSource, /preview\.scopeKey === scopeKey/);
  assert.match(thumbnailSource, /controller\.dispose\(\)/);
  assert.match(thumbnailSource, /controllerRef\.current\?\.retry\(\)/);
  assert.match(thumbnailSource, /controllerRef\.current\?\.onImageError/);
  assert.doesNotMatch(thumbnailSource, /saveWorkspaceArtifact|generate-image|generation|localStorage/);
  const navigationButton = thumbnailSource.match(/<button([\s\S]*?)aria-label=\{`\$\{artifact\.title\}をCanvasで開く`\}([\s\S]*?)<\/button>/)?.[0] ?? '';
  assert.ok(navigationButton);
  assert.equal((navigationButton.match(/<button/g) ?? []).length, 1, 'navigation and retry controls are siblings, not nested');
});

test('preview signing controls only thumbnail state: retry is a sibling control and none/failure preserve card navigation', () => {
  assert.match(thumbnailSource, /<div className="relative h-36 bg-white\/10"/);
  assert.match(thumbnailSource, /<button[\s\S]*?aria-label=\{`\$\{artifact\.title\}をCanvasで開く`\}/);
  assert.match(thumbnailSource, /canRetry && \([\s\S]*?<button[\s\S]*?プレビューを再試行/);
  assert.match(thumbnailSource, /visiblePreview\?\.status === 'none'/);
  assert.match(thumbnailSource, /visiblePreview\?\.status === 'loading'/);
  assert.match(thumbnailSource, /if \(href\) onOpen\(\)/);
  assert.match(thumbnailSource, /onClick=\{\(event\) => \{[\s\S]*?event\.stopPropagation\(\);[\s\S]*?retry\(\)/);
});

test('the real local persistence normalizer continues to strip signed URLs when canonical storage exists', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { location: { origin: 'https://heavy-web.example.test' }, localStorage: { getItem: () => null } } as unknown as Window & typeof globalThis;
  const vite = await createServer({
    configFile: false,
    envFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': '"true"',
      'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': '"https://heavy-api.example.test"',
    },
  });
  let disposeAuth = () => {};
  try {
    const { auth } = await vite.ssrLoadModule('/src/lib/auth.ts');
    disposeAuth = () => auth.dispose();
    const { normalizeWorkspaceArtifactForPersistence } = await vite.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts');
    const normalized = normalizeWorkspaceArtifactForPersistence({
      id: 'local-a1d3a15d-4d27-4c93-ad1c-5fe04d438df6',
      brandId: 'brand-a',
      featureType: 'fashion-studio-detail-generated-result',
      title: 'Fashion Studio result',
      imageUrl: 'https://signed.example/ephemeral?token=not-for-persistence',
      prompt: null,
      createdAt: '2026-09-30T00:00:00.000Z',
      metadata: { remoteStoragePath: 'generated-images/design-shirt' },
    });
    assert.equal(normalized.imageUrl, '');
    assert.equal(normalized.metadata.remoteStoragePath, 'generated-images/design-shirt');
  } finally {
    disposeAuth();
    await vite.close();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});
