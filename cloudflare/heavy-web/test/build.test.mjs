import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectStaticAsset, validateStaticReferences } from '../build.mjs';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);

test('rejects the observed SPA HTML fallback even when labelled image/png', () => {
  const fallback = Buffer.alloc(2187, 0x20);
  Buffer.from('<!doctype html><html><body>SPA fallback</body></html>').copy(fallback);
  const result = inspectStaticAsset('/templates/lookbook-2col.png', fallback, 'image/png');
  assert.deepEqual(result, {
    path: '/templates/lookbook-2col.png',
    ok: false,
    reason: 'html_bytes_for_image_path',
  });
});

test('accepts a genuine PNG and rejects an HTML Content-Type for an image path', () => {
  assert.equal(inspectStaticAsset('/templates/genuine.png', png, 'image/png').ok, true);
  assert.equal(inspectStaticAsset('/templates/genuine.png', png, 'text/html').reason, 'html_content_type_for_image_path');
});

test('candidate scan reports every unresolved or invalid static reference', async () => {
  const site = await mkdtemp(path.join(os.tmpdir(), 'heavy-web-static-validation-'));
  try {
    await mkdir(path.join(site, 'templates'), { recursive: true });
    await writeFile(path.join(site, 'index.js'), [
      "const first = '/templates/missing-a.png';",
      "const second = `/templates/missing-b.png`;",
      "const invalid = '/templates/fallback.png';",
    ].join('\n'));
    const fallback = Buffer.from('<!doctype html><html><body>SPA</body></html>');
    await writeFile(path.join(site, 'templates', 'fallback.png'), fallback);
    const result = await validateStaticReferences(site);
    assert.equal(result.ok, false);
    assert.deepEqual(result.unresolved, [
      { path: '/templates/missing-a.png', reason: 'missing_file' },
      { path: '/templates/missing-b.png', reason: 'missing_file' },
    ]);
    assert.deepEqual(result.invalid, [{
      path: '/templates/fallback.png',
      ok: false,
      reason: 'html_bytes_for_image_path',
    }]);
  } finally {
    await rm(site, { recursive: true, force: true });
  }
});
