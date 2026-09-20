import { validID, apiOrigin } from './monitor-production-health.mjs';

// Offline consistency check of a freshly collected report, not an attestation of
// its origin or of browser/AI quality. Expectations come from the intended run.
export function verifyWorkspaceEvidence(report, expected, now = Date.now()) {
  const failures = [];
  const fail = code => { if (!failures.includes(code)) failures.push(code); };
  const finish = () => ({ persistedEvidenceConsistent: failures.length === 0,
    businessCompletion: 'not_verified', failures });
  try {
    if (!expected || !validID(expected.brandId) || !validID(expected.userId) ||
        apiOrigin(expected.apiOrigin) !== expected.apiOrigin || !Array.isArray(expected.jobs) ||
        !expected.jobs.length || expected.jobs.length > 100 ||
        expected.jobs.some(j => !validID(j.id) || !validID(j.requestId) ||
          !Number.isInteger(j.candidateCount) || j.candidateCount < 1 || j.candidateCount > 4 || typeof j.protectedEdit !== 'boolean') ||
        new Set(expected.jobs.map(j => j.id)).size !== expected.jobs.length) throw Error();
  } catch { fail('invalid_explicit_expectations'); return finish(); }
  const since = Date.parse(expected.since), captured = Date.parse(report?.capturedAt);
  if (!Number.isFinite(since) || !Number.isFinite(captured) || since > captured || captured > now || now - captured > 15 * 60 * 1000) fail('invalid_or_stale_observation');
  const ids = expected.jobs.map(j => j.id), scope = report?.scope;
  if (report?.schema !== 'heavy-chain.workspace-readback.v2' || report.collectionComplete !== true ||
      report.businessCompletion !== 'not_verified' || !Array.isArray(report.blockers) || report.blockers.length) fail('incomplete_collection');
  if (scope?.apiOrigin !== expected.apiOrigin || scope?.brandId !== expected.brandId || Date.parse(scope?.since) !== since ||
      scope?.principal !== 'current_consumer_auth_session' || scope?.observation !== 'nontransactional_read_only' ||
      !Array.isArray(scope?.requestedJobIds) || scope.requestedJobIds.length !== ids.length ||
      new Set(scope.requestedJobIds).size !== ids.length || scope.requestedJobIds.some(id => !ids.includes(id))) fail('scope_mismatch');
  for (const key of ['jobs','images','executionSteps','canonicalFinalLinks','storage']) {
    if (!Array.isArray(report?.[key])) { fail('invalid_report_arrays'); return finish(); }
  }
  const rows = (key, idKey) => {
    const map = new Map();
    for (const row of report[key]) {
      if (!row || !validID(row[idKey]) || map.has(row[idKey])) { fail('duplicate_or_invalid_' + key); continue; }
      map.set(row[idKey], row);
    }
    return map;
  };
  const jobs = rows('jobs','id'), images = rows('images','id'), storage = rows('storage','imageId');
  for (const row of [...jobs.values(), ...images.values()]) {
    const created = Date.parse(row.created_at);
    if (row.brand_id !== expected.brandId || row.user_id !== expected.userId || !Number.isFinite(created) || created < since || created > captured) fail('row_scope_mismatch');
  }
  const usedJobs = new Set(ids), usedImages = new Set(), usedLinks = new Set(), usedSteps = new Set();
  const verifyImage = (imageId, jobId) => {
    const image = images.get(imageId), content = storage.get(imageId);
    if (usedImages.has(imageId)) fail('duplicate_candidate_image');
    usedImages.add(imageId); usedJobs.add(jobId);
    if (!image || image.job_id !== jobId || !content || content.jobId !== jobId || content.readable !== true ||
        content.checksumVerified !== true || !Number.isSafeInteger(content.bytes) || content.bytes <= 0 ||
        !/^[a-f0-9]{64}$/.test(content.sha256)) fail('private_image_evidence_missing');
  };
  for (const wanted of expected.jobs) {
    const job = jobs.get(wanted.id);
    if (!job || job.status !== 'completed') fail('requested_job_not_completed');
    for (let candidate = 0; candidate < wanted.candidateCount; candidate++) {
      let candidateImage;
      for (let phase = 0; phase < (wanted.protectedEdit ? 3 : 2); phase++) {
        const stepId = `${wanted.requestId}:${candidate}:${phase}`;
        const matches = report.executionSteps.filter(s => s?.job_id === wanted.id && s.id === stepId);
        if (matches.length !== 1) { fail('missing_or_duplicate_execution_step'); continue; }
        const step = matches[0]; usedSteps.add(step);
        if (step.status !== 'completed' || step.basis !== 'cloudflare_execution_ledger' || step.step_index !== candidate * 3 + phase || !validID(step.image_id)) fail('execution_step_not_verified');
        if (phase === 0) candidateImage = step.image_id;
        if (phase === 1 && step.image_id !== candidateImage) fail('candidate_image_mismatch');
        if (phase === 1 && !wanted.protectedEdit) verifyImage(step.image_id, wanted.id);
        if (phase === 2) {
          const links = report.canonicalFinalLinks.filter(l => l?.sourceJobId === wanted.id && l.executionStepId === stepId && l.imageId === step.image_id);
          if (links.length !== 1) { fail('canonical_final_link_missing'); continue; }
          const link = links[0]; usedLinks.add(link);
          if (link.basis !== 'cloudflare_execution_ledger' || link.finalJobId !== link.imageId || jobs.get(link.finalJobId)?.status !== 'completed') fail('invalid_final_job');
          verifyImage(link.imageId, link.finalJobId);
        }
      }
    }
  }
  if (report.executionSteps.some(s => !usedSteps.has(s)) || report.canonicalFinalLinks.some(l => !usedLinks.has(l)) ||
      [...jobs.keys()].some(id => !usedJobs.has(id)) || [...images.keys()].some(id => !usedImages.has(id)) ||
      [...storage.keys()].some(id => !usedImages.has(id))) fail('unexpected_evidence_rows');
  return finish();
}
