#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

export const validID = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
export const safeError = error => /^(http_\d+|request_failed|response_size_limit|empty_response_body|invalid_json_response|invalid_page|invalid_row_scope|unstable_pagination|observation_row_limit|unexpected_service|invalid_usage_contract|invalid_usage_value|invalid_media_content|media_checksum_mismatch)$/.test(error?.message) ? error.message : 'read_failed';
const finite = (value, fallback, min, max) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error('invalid_monitor_limit');
  return n;
};
export function apiOrigin(value) {
  let url; try { url = new URL(value); } catch { throw new Error('cloudflare_api_origin_required'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('invalid_cloudflare_api_origin');
  }
  return url.origin;
}
export async function boundedBytes(response, maximum) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty_response_body');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum) throw new Error('response_size_limit');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}

/** Authenticated GETs only. Jobs/media cover this principal, usage the authorized brand.
 * No login, token refresh, signed-URL creation, inference or repair is performed.
 */
export async function collectProductionHealth(options, fetchImpl = fetch) {
  const baseUrl = apiOrigin(options.apiBaseUrl);
  if (!validID(options.brandId)) throw new Error('cloudflare_monitor_brand_required');
  if (typeof options.token !== 'string' || !options.token.trim() || /[\r\n]/.test(options.token)) throw new Error('cloudflare_monitor_session_required');
  const now = options.now ?? Date.now();
  const windowHours = finite(options.windowHours, 24, 1, 24 * 31);
  const staleMinutes = finite(options.staleMinutes, 20, 1, 1440);
  const maxRows = finite(options.maxRows, 5000, 100, 10000);
  const sampleSize = finite(options.sampleSize, 20, 1, 50);
  if (!Number.isInteger(maxRows) || maxRows % 100 || !Number.isInteger(sampleSize)) throw new Error('invalid_monitor_limit');
  const maxFailureRate = finite(options.maxFailureRate, 0.15, 0, 1);
  const maxFailedJobs = finite(options.maxFailedJobs, 0, 0, maxRows);
  const maxStaleActiveJobs = finite(options.maxStaleActiveJobs, 0, 0, maxRows);
  const maxStorageErrors = finite(options.maxStorageErrors, 0, 0, sampleSize);
  if (![maxFailedJobs, maxStaleActiveJobs, maxStorageErrors].every(Number.isInteger)) throw new Error('invalid_monitor_limit');
  if (options.runId !== undefined && options.runId !== null && !validID(options.runId)) throw new Error('invalid_monitor_run_id');
  const since = now - windowHours * 3600000;
  const report = {
    schema: 'heavy-chain.production-monitor.v2',
    capturedAt: new Date(now).toISOString(), baseUrl, brandId: options.brandId, runId: options.runId ?? null,
    mode: 'cloudflare_authenticated_read_only', ok: false,
    coverage: { jobs: 'current_principal_and_brand', media: 'current_principal_recent_sample',
      usage: 'authorized_brand_current_month', ui: 'not_checked', cpu: 'not_measured',
      providerBilling: 'not_available', businessCompletion: 'not_verified',
      pagination: 'bounded_nontransactional_observation' },
    window: { hours: windowHours, since: new Date(since).toISOString(), staleMinutes },
    thresholds: { maxFailureRate, maxFailedJobs, maxStaleActiveJobs, maxStorageErrors, maxRows, sampleSize },
    sections: {}, blockers: [], warnings: [],
  };
  const blocker = code => report.blockers.push({ code });
  const get = async route => {
    let response;
    try { response = await fetchImpl(baseUrl + route, { method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { authorization: 'Bearer ' + options.token }, signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('request_failed'); }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error('http_' + response.status); }
    return response;
  };
  const json = async route => {
    try { return JSON.parse((await boundedBytes(await get(route), 4 * 1024 * 1024)).toString('utf8')); }
    catch (error) {
      if (/^(http_\d+|request_failed|response_size_limit)$/.test(error.message)) throw error;
      throw new Error('invalid_json_response');
    }
  };
  const brandQuery = 'brand_id=' + encodeURIComponent(options.brandId);
  const rows = async resource => {
    const collected = []; const seen = new Set();
    for (let offset = 0; offset < maxRows; offset += 100) {
      const page = await json('/v1/' + resource + '?' + brandQuery + '&limit=100&offset=' + offset);
      if (!Array.isArray(page) || page.length > 100) throw new Error('invalid_page');
      for (const row of page) {
        if (!validID(row?.id) || row.brand_id !== options.brandId || !Number.isFinite(Date.parse(row.created_at))) throw new Error('invalid_row_scope');
        if (seen.has(row.id)) throw new Error('unstable_pagination');
        seen.add(row.id);
        if (Date.parse(row.created_at) >= since) collected.push(row);
      }
      if (page.length < 100 || page.every(row => Date.parse(row.created_at) < since)) return collected;
    }
    throw new Error('observation_row_limit');
  };
  try {
    const health = await json('/v1/health');
    if (health.service !== 'heavy-api' || health.status !== 'ok' || health.media !== 'private-r2') throw new Error('unexpected_service');
    report.sections.api = { status: 'ok', media: 'private-r2' };
  } catch (error) { blocker('api_' + safeError(error)); }
  try {
    const jobs = await rows('generation-jobs');
    const counts = Object.create(null);
    for (const job of jobs) counts[job.status] = (counts[job.status] ?? 0) + 1;
    const failed = counts.failed ?? 0;
    const terminal = failed + (counts.completed ?? 0);
    const failureRate = terminal ? failed / terminal : null;
    const stale = jobs.filter(job => ['pending', 'processing', 'queued', 'running'].includes(job.status) && Date.parse(job.created_at) < now - staleMinutes * 60000);
    report.sections.generation = { total: jobs.length, counts, terminal, failed, failureRate, staleActive: stale.length,
      staleJobIds: stale.map(job => job.id), failedJobIds: jobs.filter(job => job.status === 'failed').map(job => job.id) };
    if (!jobs.length) blocker('no_generation_evidence');
    if (failureRate !== null && failureRate > maxFailureRate) blocker('generation_failure_rate_high');
    if (failed > maxFailedJobs) blocker('recent_generation_jobs_failed');
    if (stale.length > maxStaleActiveJobs) blocker('stale_generation_jobs');
    if (jobs.some(job => !['pending', 'processing', 'queued', 'running', 'completed', 'failed', 'cancelled'].includes(job.status))) blocker('unknown_generation_state');
  } catch (error) { blocker('generation_' + safeError(error)); }
  try {
    const usage = await json('/v1/image-ai/usage?' + brandQuery);
    if (usage?.measurementScope !== 'cloudflare_image_ai_only' || usage.billing !== 'estimate_not_invoice' ||
        !Number.isFinite(usage.remainingUnits) || !Number.isFinite(usage.monthlyQuota)) throw new Error('invalid_usage_contract');
    const fields = ['plannedImages','completedImages','runningImages','uncertainImages','attemptedImages','unknownEstimateCount',
      'estimatedMicroUSD','estimatedNeurons','averageInferenceMs','remainingUnits','monthlyQuota'];
    for (const field of fields) if (usage[field] !== null && (!Number.isFinite(usage[field]) || usage[field] < 0)) throw new Error('invalid_usage_value');
    report.sections.usage = Object.fromEntries(fields.map(field => [field, usage[field]]));
    Object.assign(report.sections.usage, { scope: 'authorized_brand_current_month', billing: 'estimate_not_invoice',
      periodStart: usage.periodStart, periodEnd: usage.periodEnd, imageAIEnabled: usage.imageAIEnabled === true });
    if (usage.uncertainImages > 0) blocker('unresolved_image_ai_candidates');
    if (usage.unknownEstimateCount > 0) report.warnings.push({ code: 'unknown_usage_estimates' });
    if (!usage.imageAIEnabled) report.warnings.push({ code: 'image_ai_disabled' });
  } catch (error) { blocker('usage_' + safeError(error)); }
  try {
    const images = await rows('generated-images');
    const sample = images.slice(0, sampleSize); const checks = [];
    for (const row of sample) {
      try {
        const response = await get('/v1/generated-images/' + encodeURIComponent(row.id) + '/content');
        const bytes = await boundedBytes(response, 10 * 1024 * 1024);
        if (!response.headers.get('content-type')?.startsWith('image/') || !bytes.length) throw new Error('invalid_media_content');
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const expected = row.metadata?.contentSha256 ?? row.metadata?.sha256;
        const expectedSize = row.metadata?.contentBytes;
        if (expected && expected !== sha256 || expectedSize !== undefined && expectedSize !== bytes.length) throw new Error('media_checksum_mismatch');
        checks.push({ imageId: row.id, ok: true, bytes: bytes.length, sha256, checksumVerified: Boolean(expected) });
      } catch (error) { checks.push({ imageId: row.id, ok: false, error: safeError(error) }); }
    }
    report.sections.storage = { totalRecentImages: images.length, checkedImages: checks.length,
      readable: checks.filter(check => check.ok).length, errors: checks.filter(check => !check.ok).length, checks };
    if (!checks.length) blocker('no_private_media_evidence');
    if (checks.filter(check => !check.ok).length > maxStorageErrors) blocker('private_media_read_failed');
  } catch (error) { blocker('storage_' + safeError(error)); }
  report.ok = report.blockers.length === 0;
  return report;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    apiBaseUrl: { type: 'string' }, brandId: { type: 'string' }, out: { type: 'string' }, runId: { type: 'string' },
    windowHours: { type: 'string' }, staleMinutes: { type: 'string' },
    maxRows: { type: 'string' }, sampleSize: { type: 'string' }, maxFailureRate: { type: 'string' },
    maxFailedJobs: { type: 'string' }, maxStaleActiveJobs: { type: 'string' }, maxStorageErrors: { type: 'string' },
    'skip-ui': { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Cloudflare read-only API monitor. Requires --apiBaseUrl https://API_ORIGIN --brandId ID and HEAVY_CHAIN_MONITOR_TOKEN (live consumer-auth session). Optional --out DIR --windowHours 24 --staleMinutes 20 --maxRows 5000 --sampleSize 20 --maxFailureRate 0.15. No UI/CPU/billing/E2E proof; no old environment files are loaded.');
    return;
  }
  const report = await collectProductionHealth({ ...values,
    apiBaseUrl: values.apiBaseUrl ?? env.HEAVY_CHAIN_MONITOR_API_URL,
    brandId: values.brandId ?? env.HEAVY_CHAIN_MONITOR_BRAND_ID, token: env.HEAVY_CHAIN_MONITOR_TOKEN,
    runId: values.runId ?? env.HEAVY_CHAIN_MONITOR_RUN_ID });
  const out = values.out ?? 'output/cloudflare-monitor-' + report.capturedAt.replace(/[:.]/g, '-');
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, summaryPath: path.join(out, 'summary.json'), blockers: report.blockers }));
  process.exitCode = report.ok ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main().catch(() => { console.error('monitor_failed: check explicit API/brand/session configuration and bounded limits; no credentials printed'); process.exitCode = 1; });
}
