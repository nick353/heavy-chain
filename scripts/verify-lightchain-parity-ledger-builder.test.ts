import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const builder = path.join(repoRoot, 'scripts/build-lightchain-parity-behavior-ledger.ts');
const sourceReadback = 'work/heavy-companion-lightchain-readback-20260825-r95.md';

test('requires an explicit existing current source readback', async () => {
  const missingSource = spawnSync(
    process.execPath,
    ['--experimental-strip-types', builder, 'work/parity-builder-missing-source.json'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.notEqual(missingSource.status, 0);
  assert.match(`${missingSource.stdout}\n${missingSource.stderr}`, /parity_behavior_source_readback_required/);

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'heavy-parity-builder-'));
  const outputPath = path.join(tempRoot, 'ledger.json');
  try {
    const generated = spawnSync(
      process.execPath,
      ['--experimental-strip-types', builder, outputPath, `--source-readback=${sourceReadback}`],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(generated.status, 0, `${generated.stdout}\n${generated.stderr}`);
    const artifact = JSON.parse(await readFile(outputPath, 'utf8')) as {
      evidenceBoundary?: { sourceReadback?: string };
    };
    assert.equal(artifact.evidenceBoundary?.sourceReadback, sourceReadback);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
