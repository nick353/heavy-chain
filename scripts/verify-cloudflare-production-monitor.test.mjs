import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { collectProductionHealth } from './monitor-production-health.mjs';

const now = Date.parse('2026-09-06T14:00:00Z');
const options = { apiBaseUrl: 'https://api.fixture.invalid', brandId: 'brand-1', token: 'fixture-session-secret', now };
const created_at = new Date(now - 60000).toISOString();
const bytes = Buffer.from([137,80,78,71,13,10,26,10]);
const sha = createHash('sha256').update(bytes).digest('hex');
const job = { id: 'job-1', brand_id: 'brand-1', created_at, status: 'completed' };
const image = { id: 'image-1', brand_id: 'brand-1', created_at, metadata: { contentSha256: sha, contentBytes: bytes.length } };
const usage = { plannedImages: 1, completedImages: 1, runningImages: 0, uncertainImages: 0, attemptedImages: 1,
  unknownEstimateCount: 0, estimatedMicroUSD: 2, estimatedNeurons: 3, averageInferenceMs: 4, remainingUnits: 24,
  monthlyQuota: 25, measurementScope: 'cloudflare_image_ai_only', billing: 'estimate_not_invoice', imageAIEnabled: true };
function fixture(overrides = {}) {
  const calls = [];
  return { calls, fetch: async (input, init) => {
    calls.push({ input, init });
    const url = new URL(input);
    assert.equal(url.origin, options.apiBaseUrl);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.authorization, 'Bearer ' + options.token);
    if (url.pathname === '/v1/health') return Response.json({ service: 'heavy-api', status: 'ok', media: 'private-r2' });
    assert.equal(url.searchParams.get('brand_id'), url.pathname.endsWith('/content') ? null : 'brand-1');
    if (url.pathname === '/v1/generation-jobs') return Response.json(overrides.jobs?.(url) ?? [job]);
    if (url.pathname === '/v1/generated-images') return Response.json(overrides.images ?? [image]);
    if (url.pathname === '/v1/image-ai/usage') return Response.json(overrides.usage ?? usage);
    if (url.pathname === '/v1/generated-images/image-1/content') return overrides.content?.() ?? new Response(bytes, { headers: { 'content-type': 'image/png' } });
    throw new Error('unexpected path');
  } };
}
test('monitor performs scoped GETs, measures actual private bytes and labels estimates separately', async () => {
  const f = fixture(); const report = await collectProductionHealth(options, f.fetch);
  assert.equal(report.ok, true); assert.equal(f.calls.length, 5);
  assert.equal(report.sections.storage.checks[0].sha256, sha);
  assert.equal(report.sections.storage.checks[0].checksumVerified, true);
  assert.equal(report.sections.usage.billing, 'estimate_not_invoice');
  assert.equal(report.coverage.jobs, 'current_principal_and_brand');
  assert.equal(report.coverage.businessCompletion, 'not_verified');
  assert.doesNotMatch(JSON.stringify(report), /fixture-session-secret|authorization|Bearer/);
});
test('pagination reaches older pages but hitting the bound or duplicate pages is not a healthy observation', async () => {
  const page = Array.from({ length: 100 }, (_, n) => ({ ...job, id: 'job-' + n }));
  const f = fixture({ jobs: url => url.searchParams.get('offset') === '0' ? page : [{ ...job, id: 'older', status: 'failed' }] });
  const report = await collectProductionHealth({ ...options, maxFailureRate: 0 }, f.fetch);
  assert.equal(report.sections.generation.total, 101);
  assert.ok(report.blockers.some(b => b.code === 'generation_failure_rate_high'));
  const limited = await collectProductionHealth({ ...options, maxRows: 100 }, fixture({ jobs: () => page }).fetch);
  assert.ok(limited.blockers.some(b => b.code === 'generation_observation_row_limit'));
  const unstable = await collectProductionHealth(options, fixture({ jobs: () => page }).fetch);
  assert.ok(unstable.blockers.some(b => b.code === 'generation_unstable_pagination'));
});
test('empty, foreign and uncertain evidence cannot pass', async () => {
  const empty = await collectProductionHealth(options, fixture({ jobs: () => [], images: [] }).fetch);
  assert.equal(empty.ok, false);
  assert.ok(empty.blockers.some(b => b.code === 'no_generation_evidence'));
  assert.ok(empty.blockers.some(b => b.code === 'no_private_media_evidence'));
  const wrong = await collectProductionHealth(options, fixture({ jobs: () => [{ ...job, brand_id: 'foreign' }], usage: { ...usage, uncertainImages: 1 } }).fetch);
  assert.ok(wrong.blockers.some(b => b.code === 'generation_invalid_row_scope'));
  assert.ok(wrong.blockers.some(b => b.code === 'unresolved_image_ai_candidates'));
});
test('failed and stale job thresholds retain zero-tolerance defaults even below the rate threshold', async () => {
  const jobs = Array.from({ length: 20 }, (_, n) => ({ ...job, id: 'job-' + n, status: n ? 'completed' : 'failed' }));
  const report = await collectProductionHealth(options, fixture({ jobs: () => jobs }).fetch);
  assert.equal(report.sections.generation.failureRate, 0.05);
  assert.ok(report.blockers.some(b => b.code === 'recent_generation_jobs_failed'));
  const accepted = await collectProductionHealth({ ...options, maxFailedJobs: 1 }, fixture({ jobs: () => jobs }).fetch);
  assert.equal(accepted.ok, true);
  const stale = await collectProductionHealth(options, fixture({ jobs: () => [{ ...job, status: 'processing', created_at: new Date(now - 3600000).toISOString() }] }).fetch);
  assert.ok(stale.blockers.some(b => b.code === 'stale_generation_jobs'));
});
test('content rejection and checksum mismatch are not retried or replaced by signed URL success', async () => {
  const f = fixture({ content: () => new Response('private remote diagnostic', { status: 403 }) });
  const report = await collectProductionHealth(options, f.fetch);
  assert.equal(report.sections.storage.errors, 1);
  assert.equal(f.calls.filter(c => c.input.endsWith('/content')).length, 1);
  assert.doesNotMatch(JSON.stringify(report), /private remote diagnostic/);
  const mismatch = await collectProductionHealth(options, fixture({ images: [{ ...image, metadata: { contentSha256: 'wrong' } }] }).fetch);
  assert.equal(mismatch.sections.storage.checks[0].error, 'media_checksum_mismatch');
});
test('missing authority and unsafe targets stop before fetch; transport errors cannot print credentials', async () => {
  let calls = 0; const unavailable = async () => { calls++; throw Error(options.token); };
  for (const changed of [{ token: '' }, { brandId: '' }, { apiBaseUrl: 'http://api.fixture.invalid' }, { apiBaseUrl: 'https://user:password@api.fixture.invalid' }]) {
    await assert.rejects(collectProductionHealth({ ...options, ...changed }, unavailable));
  }
  assert.equal(calls, 0);
  const report = await collectProductionHealth(options, unavailable);
  assert.equal(report.ok, false); assert.doesNotMatch(JSON.stringify(report), /fixture-session-secret/);
});
