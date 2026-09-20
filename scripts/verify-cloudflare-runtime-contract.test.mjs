import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  requiredFiles,
  verifyCloudflareRuntimeContract,
} from './verify-cloudflare-runtime-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const cleanRuntimeFiles = Object.fromEntries(requiredFiles.map((path) => [path, 'export {};\n']));

async function withFixture({ scripts, dependencies = {}, files = {} }, callback) {
  const root = await mkdtemp(join(tmpdir(), 'heavy-chain-cloudflare-runtime-contract-'));
  try {
    const fixtureFiles = {
      ...cleanRuntimeFiles,
      'package.json': JSON.stringify({
        name: 'cloudflare-runtime-contract-fixture',
        private: true,
        type: 'module',
        scripts,
        dependencies,
      }, null, 2),
      ...files,
    };

    for (const [path, contents] of Object.entries(fixtureFiles)) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents, 'utf8');
    }
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('current checkout passes the Cloudflare runtime contract', () => {
  const result = verifyCloudflareRuntimeContract({ rootDir: repoRoot });
  assert.equal(result.ok, true, result.failures.join('\n'));
});

test('an active direct legacy invocation fails', async () => {
  await withFixture({
    scripts: {
      'legacy:verify': 'bash scripts/supabase-prod-verify.sh',
    },
    files: {
      'scripts/supabase-prod-verify.sh': '#!/usr/bin/env bash\nexit 2\n',
    },
  }, (root) => {
    const result = verifyCloudflareRuntimeContract({ rootDir: root });
    assert.equal(result.ok, false);
    assert.match(result.failures.join('\n'), /active legacy entrypoint.*supabase-prod-verify\.sh/i);
  });
});

test('a wrapper-mediated legacy invocation fails through its local entrypoint chain', async () => {
  await withFixture({
    scripts: {
      'legacy:verify': 'node scripts/wrapper.mjs',
    },
    files: {
      'scripts/wrapper.mjs': "import './legacy-runner.mjs';\n",
      'scripts/legacy-runner.mjs': "import { execFileSync } from 'node:child_process';\nexecFileSync('bash', ['scripts/deploy-edge-functions.sh']);\n",
      'scripts/deploy-edge-functions.sh': '#!/usr/bin/env bash\nexit 2\n',
    },
  }, (root) => {
    const result = verifyCloudflareRuntimeContract({ rootDir: root });
    assert.equal(result.ok, false);
    assert.match(result.failures.join('\n'), /legacy-runner\.mjs[\s\S]*deploy-edge-functions\.sh|deploy-edge-functions\.sh[\s\S]*legacy-runner\.mjs/i);
  });
});

test('preserved unreferenced Supabase sources and historical files pass', async () => {
  await withFixture({
    scripts: {
      start: 'node scripts/app.mjs',
    },
    files: {
      'scripts/app.mjs': 'export const runtime = "cloudflare";\n',
      'scripts/historical-legacy.mjs': 'supabase functions deploy legacy\n',
      'supabase/functions/legacy/index.ts': "import '@supabase/supabase-js';\n",
      'docs/historical/legacy.md': 'supabase functions deploy legacy\n',
    },
  }, (root) => {
    const result = verifyCloudflareRuntimeContract({ rootDir: root });
    assert.equal(result.ok, true, result.failures.join('\n'));
  });
});

test('a missing active entrypoint fails explicitly', async () => {
  await withFixture({
    scripts: {
      start: 'node scripts/missing-entrypoint.mjs',
    },
  }, (root) => {
    const result = verifyCloudflareRuntimeContract({ rootDir: root });
    assert.equal(result.ok, false);
    assert.match(result.failures.join('\n'), /unresolved active local entrypoint.*missing-entrypoint\.mjs/i);
  });
});

test('a legacy package dependency fails even when runtime files are clean', async () => {
  await withFixture({
    scripts: {
      start: 'node scripts/app.mjs',
    },
    dependencies: {
      '@supabase/supabase-js': '^2.0.0',
    },
    files: {
      'scripts/app.mjs': 'export const runtime = "cloudflare";\n',
    },
  }, (root) => {
    const result = verifyCloudflareRuntimeContract({ rootDir: root });
    assert.equal(result.ok, false);
    assert.match(result.failures.join('\n'), /legacy dependency.*@supabase\/supabase-js/i);
  });
});
