import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const verifier = path.resolve('scripts/verify-generation-quality-scorecard.mjs');

async function fixture(providerEvidence) {
  const directory = await mkdtemp(path.join(tmpdir(), 'heavy-scorecard-provider-'));
  const imagePath = path.join(directory, 'campaign-image.bin');
  const scorecardPath = path.join(directory, 'visual-scorecard.json');
  const readbackPath = path.join(directory, 'readback.json');
  await writeFile(imagePath, Buffer.from([1, 2, 3, 4]));
  await writeFile(scorecardPath, JSON.stringify({
    rows: [{
      feature: 'campaign-image',
      imagePath,
      jobId: 'job-1',
      decision: 'Pass',
      scores: { promptAdherence: 4, apparelFidelity: 4, artifactSafety: 5, composition: 4, commercialUsefulness: 4 },
      average: 4.2,
      notes: 'Product hero chain image has complete visual evidence.',
    }],
  }));
  await writeFile(readbackPath, JSON.stringify({
    ...providerEvidence,
    counts: { completedJobs: 1, images: 1, storage: 1, signedUrlOk: 1 },
    jobs: [{ feature: 'campaign-image', jobId: 'job-1' }],
    images: [{ feature: 'campaign-image', jobId: 'job-1' }],
    storage: [{ feature: 'campaign-image', jobId: 'job-1' }],
  }));
  return { directory, scorecardPath, readbackPath };
}

function run(input) {
  return spawnSync(process.execPath, [
    verifier,
    '--scorecard', input.scorecardPath,
    '--readback', input.readbackPath,
    '--expected-features', 'campaign-image',
    '--required-provider', 'openai',
    '--required-backend-provider', 'openai-images-api',
  ], { cwd: process.cwd(), encoding: 'utf8' });
}

test('accepts a scorecard only when readback proves OpenAI provenance', async () => {
  const input = await fixture({ receipt: { provider: 'openai', backendProvider: 'openai-images-api' } });
  try {
    const result = run(input);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    assert.match(result.stdout, /"passed": true/);
  } finally {
    await rm(input.directory, { recursive: true, force: true });
  }
});

test('rejects a scorecard backed by a legacy Workers AI receipt', async () => {
  const input = await fixture({ receipt: { provider: 'workers_ai', backendProvider: 'cloudflare-workers-ai' } });
  try {
    const result = run(input);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /readback_provider_provenance_mismatch/);
  } finally {
    await rm(input.directory, { recursive: true, force: true });
  }
});

test('rejects a scorecard when provider provenance is absent', async () => {
  const input = await fixture({});
  try {
    const result = run(input);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /readback_provider_provenance_missing/);
  } finally {
    await rm(input.directory, { recursive: true, force: true });
  }
});
