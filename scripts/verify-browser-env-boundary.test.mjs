import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadConfigFromFile } from 'vite';

test('actual browser and worker builds exclude retired local environment credentials', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'heavy-public-env-')));
  try {
    const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, fileURLToPath(new URL('../vite.config.ts', import.meta.url)));
    assert.ok(loaded?.config.envPrefix);
    await writeFile(path.join(root, '.env.production.local'), [
      'VITE_UNRELATED_PRIVATE_SETTING=unrelated-fixture-marker',
      'SERVER_ONLY_SECRET=server-only-fixture-marker',
      'VITE_CLOUDFLARE_API_BASE_URL=https://current-api.fixture.invalid',
      'VITE_CLOUDFLARE_API_ENABLED=true',
      'VITE_MEDIA_PROVIDER_ORDER=cloudflare_r2',
      'VITE_MEDIA_GATEWAY_URL=https://current-api.fixture.invalid',
      'VITE_GENERATION_PROVIDER=workers_ai',
      'VITE_EFFICIENT_SAM_ENCODER_URL=https://encoder.fixture.invalid/model.onnx',
    ].join('\n'));
    await writeFile(path.join(root, 'index.html'), '<script type="module" src="/entry.js"></script>');
    await writeFile(path.join(root, 'entry.js'), 'globalThis.browserEnvironment = import.meta.env; new Worker(new URL("./worker.js", import.meta.url), {type:"module"});');
    await writeFile(path.join(root, 'worker.js'), 'self.postMessage(import.meta.env);');
    await build({ configFile: false, root, envPrefix: loaded.config.envPrefix, logLevel: 'silent' });
    const files = (await readdir(path.join(root, 'dist/assets'))).filter(name => name.endsWith('.js'));
    assert.ok(files.some(name => name.startsWith('worker-')));
    assert.ok(files.some(name => name.startsWith('index-')));
    for (const name of files) {
      const source = await readFile(path.join(root, 'dist/assets', name), 'utf8');
      assert.doesNotMatch(source, /unrelated-fixture|server-only-fixture/);
      assert.match(source, /current-api\.fixture\.invalid/);
      assert.match(source, /cloudflare_r2/);
      assert.match(source, /workers_ai/);
      assert.match(source, /encoder\.fixture\.invalid/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
