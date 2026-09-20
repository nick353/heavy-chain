import { apiOrigin, validID } from './monitor-production-health.mjs';

/** Validates the monitor's observable scope only. Never upgrades samples to
 * fleet SLOs, cost estimates to invoices, or local fixtures to production load. */
export function verifyScaleOpsEvidence(report, expected, now = Date.now()) {
  const checks = [];
  const check = (name, passed) => checks.push({name,passed:Boolean(passed)});
  const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  try {
    if (apiOrigin(expected.apiOrigin) !== expected.apiOrigin || !validID(expected.brandId) ||
        !nonnegative(expected.maxFailureRate) || expected.maxFailureRate > 1 ||
        !integer(expected.minStorageImages) || expected.minStorageImages < 1 || expected.minStorageImages > 50 ||
        !nonnegative(expected.windowHours) || expected.windowHours < 96 || expected.windowHours > 744) throw Error();
  } catch { check('explicit Cloudflare monitor expectations',false); return checks; }
  check('Cloudflare monitor v2 contract',report?.schema === 'heavy-chain.production-monitor.v2' && report.mode === 'cloudflare_authenticated_read_only');
  check('monitor origin and brand match',report?.baseUrl === expected.apiOrigin && report?.brandId === expected.brandId);
  const captured = Date.parse(report?.capturedAt), since = Date.parse(report?.window?.since);
  check('fresh complete observation window',Number.isFinite(captured) && captured <= now && now-captured <= 900000 &&
    report?.window?.hours === expected.windowHours && captured-since === expected.windowHours*3600000);
  const coverage=report?.coverage;
  check('principal sample and estimate scope explicit',coverage?.jobs === 'current_principal_and_brand' &&
    coverage?.media === 'current_principal_recent_sample' && coverage?.usage === 'authorized_brand_current_month' &&
    coverage?.pagination === 'bounded_nontransactional_observation' && coverage?.businessCompletion === 'not_verified' &&
    coverage?.cpu === 'not_measured' && coverage?.providerBilling === 'not_available' && coverage?.ui === 'not_checked');
  check('monitor has no blockers or unresolved warnings',report?.ok === true && Array.isArray(report.blockers) && !report.blockers.length && Array.isArray(report.warnings) && !report.warnings.length);
  check('private R2 API health',report?.sections?.api?.status === 'ok' && report.sections.api.media === 'private-r2');
  const generation=report?.sections?.generation ?? {}, counts=generation.counts;
  const validCounts=counts && typeof counts==='object' && !Array.isArray(counts) &&
    Object.entries(counts).every(([key,value])=>['pending','processing','queued','running','completed','failed','cancelled'].includes(key) && integer(value));
  const total=validCounts ? Object.values(counts).reduce((a,b)=>a+b,0) : -1;
  const failed=validCounts ? counts.failed ?? 0 : -1, completed=validCounts ? counts.completed ?? 0 : -1;
  const terminal=failed+completed;
  check('nonempty consistent generation observations',validCounts && total>0 && completed>0 && generation.total===total &&
    generation.failed===failed && generation.terminal===terminal && generation.failureRate===failed/terminal);
  check('observed generation SLO',nonnegative(generation.failureRate) && generation.failureRate<=expected.maxFailureRate &&
    generation.failed===0 && generation.staleActive===0 && Array.isArray(generation.failedJobIds) && !generation.failedJobIds.length &&
    Array.isArray(generation.staleJobIds) && !generation.staleJobIds.length);
  const storage=report?.sections?.storage ?? {}, samples=storage.checks;
  check('private image sample readback',Array.isArray(samples) && samples.length>=expected.minStorageImages &&
    storage.checkedImages===samples.length && integer(storage.totalRecentImages) && storage.totalRecentImages>=samples.length &&
    storage.readable===samples.length && storage.errors===0 && new Set(samples.map(s=>s?.imageId)).size===samples.length &&
    samples.every(s=>validID(s?.imageId) && s.ok===true && integer(s.bytes) && s.bytes>0 && /^[a-f0-9]{64}$/.test(s.sha256) && s.checksumVerified===true));
  const usage=report?.sections?.usage ?? {};
  const fields=['plannedImages','completedImages','runningImages','uncertainImages','attemptedImages','unknownEstimateCount','estimatedMicroUSD','estimatedNeurons','remainingUnits','monthlyQuota'];
  const start=Date.parse(usage.periodStart), end=Date.parse(usage.periodEnd);
  check('current brand AI estimates and quota available',usage.scope==='authorized_brand_current_month' && usage.billing==='estimate_not_invoice' &&
    fields.every(f=>nonnegative(usage[f])) && usage.uncertainImages===0 && usage.unknownEstimateCount===0 &&
    usage.imageAIEnabled===true && usage.monthlyQuota>0 && usage.remainingUnits<=usage.monthlyQuota &&
    Number.isFinite(start) && start<=captured && captured<end &&
    (usage.averageInferenceMs===null || nonnegative(usage.averageInferenceMs)));
  return checks;
}
