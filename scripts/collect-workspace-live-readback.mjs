#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { validID, apiOrigin, boundedBytes, safeError } from './monitor-production-health.mjs';

const DEFAULT_WORKSPACES = ['patterns', 'studio', 'video', 'lab', 'models', 'marketing', 'fitting'];
const stepStates = new Set(['queued','processing','completed','failed','unknown','not_started']);
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' && value.length <= 256 && !/https?:|Bearer\s|[\r\n]/i.test(value) ? value : null;
function sourceInfo(row) {
  const p = record(row.input_params), m = record(row.metadata), g = record(row.generation_params);
  const candidates = [p, p.metadata, p.sourceReadback, p.generationIntent, p.generationIntent?.sourceReadback,
    m, m.sourceReadback, m.generationIntent, m.generationIntent?.sourceReadback, g];
  for (const value of candidates) {
    const v = record(value);
    if (text(v.sourceWorkspace ?? v.source_workspace) || text(v.workflowVersion ?? v.workflow_version)) return {
      sourceWorkspace: text(v.sourceWorkspace ?? v.source_workspace), workflowVersion: text(v.workflowVersion ?? v.workflow_version),
      basis: 'declared_metadata_not_execution',
    };
  }
  return { sourceWorkspace: null, workflowVersion: null, basis: 'not_recorded' };
}

/** Collect only named jobs, their own final images and persisted execution rows.
 * No fuzzy timestamp attribution or synthetic completed task codes.
 */
export async function collectWorkspaceReadback(options, fetchImpl = fetch) {
  const origin = apiOrigin(options.apiBaseUrl);
  if (!validID(options.brandId) || !Array.isArray(options.jobIds) || !options.jobIds.length ||
      options.jobIds.length > 100 || options.jobIds.some(id => !validID(id)) || new Set(options.jobIds).size !== options.jobIds.length) throw new Error('explicit_brand_and_job_ids_required');
  const since = Date.parse(options.since);
  const now = options.now ?? Date.now();
  if (!Number.isFinite(since) || since > now) throw new Error('valid_since_required');
  if (typeof options.token !== 'string' || !options.token.trim() || /[\r\n]/.test(options.token)) throw new Error('live_session_required');
  const report = { schema: 'heavy-chain.workspace-readback.v2', capturedAt: new Date(now).toISOString(),
    collectionComplete: false, businessCompletion: 'not_verified',
    scope: { apiOrigin: origin, brandId: options.brandId, requestedJobIds: options.jobIds, since: new Date(since).toISOString(),
      principal: 'current_consumer_auth_session', observation: 'nontransactional_read_only' },
    jobs: [], images: [], executionSteps: [], canonicalFinalLinks: [], storage: [], blockers: [],
    unsupportedEvidence: ['legacy_edge_function_runs','legacy_usage_events','provider_invoice','browser_workflow','cleanup_receipt'],
  };
  const get = async route => {
    let response;
    try { response = await fetchImpl(origin + route, { method:'GET', redirect:'error', cache:'no-store',
      headers:{ authorization:'Bearer ' + options.token }, signal:AbortSignal.timeout(15000) }); }
    catch { throw new Error('request_failed'); }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error('http_' + response.status); }
    return response;
  };
  const json = async route => {
    const bytes = await boundedBytes(await get(route), 4 * 1024 * 1024);
    try { return JSON.parse(bytes.toString('utf8')); } catch { throw new Error('invalid_json_response'); }
  };
  const fail = (code, jobId = null) => report.blockers.push({ code, jobId });
  const imagesSeen = new Set();
  const jobRows = new Map();
  const addJob = row => {
    if (jobRows.has(row.id)) return;
    jobRows.set(row.id, row);
    report.jobs.push({ id:row.id, brand_id:row.brand_id, user_id:row.user_id, status:text(row.status), feature_type:text(row.feature_type),
      created_at:row.created_at, completed_at:row.completed_at ?? null, source:sourceInfo(row) });
  };
  const collectImage = async image => {
    if (report.images.some(item => item.id === image.id)) return;
    const jobId = image.job_id;
    report.images.push({ id:image.id, job_id:jobId, brand_id:image.brand_id, user_id:image.user_id,
      feature_type:text(image.feature_type), created_at:image.created_at, source:sourceInfo(image) });
    try {
      const response = await get('/v1/generated-images/' + encodeURIComponent(image.id) + '/content');
      const bytes = await boundedBytes(response, 10 * 1024 * 1024);
      if (!bytes.length || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('invalid_media_content');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const m = record(image.metadata), expected = m.contentSha256 ?? m.sha256;
      if (expected && expected !== sha256 || m.contentBytes != null && m.contentBytes !== bytes.length) throw new Error('media_checksum_mismatch');
      report.storage.push({ imageId:image.id, jobId, readable:true, bytes:bytes.length, sha256, checksumVerified:Boolean(expected) });
    } catch (error) { report.storage.push({ imageId:image.id, jobId, readable:false, error:safeError(error) }); fail('private_media_read_failed', jobId); }
  };
  let principalId = null;
  for (const jobId of options.jobIds) {
    try {
      const row = await json('/v1/generation-jobs/' + encodeURIComponent(jobId));
      if (row.id !== jobId || row.brand_id !== options.brandId || !validID(row.user_id) || !Number.isFinite(Date.parse(row.created_at)) || Date.parse(row.created_at) < since) throw new Error('invalid_row_scope');
      if (principalId && principalId !== row.user_id) throw new Error('invalid_row_scope');
      principalId = row.user_id;
      addJob(row);
      const jobImages = []; let finished = false;
      for (let offset = 0; offset < 10000; offset += 100) {
        const query = new URLSearchParams({ brand_id:options.brandId, job_id:jobId, limit:'100', offset:String(offset) });
        const page = await json('/v1/generated-images?' + query);
        if (!Array.isArray(page) || page.length > 100) throw new Error('invalid_page');
        for (const image of page) {
          if (!validID(image.id) || image.job_id !== jobId || image.brand_id !== options.brandId || image.user_id !== row.user_id ||
              !Number.isFinite(Date.parse(image.created_at)) || Date.parse(image.created_at) < since) throw new Error('invalid_row_scope');
          if (imagesSeen.has(image.id)) throw new Error('unstable_pagination');
          imagesSeen.add(image.id); jobImages.push(image);
        }
        if (page.length < 100) { finished = true; break; }
      }
      if (!finished) throw new Error('observation_row_limit');
      for (const image of jobImages) {
        await collectImage(image);
      }
    } catch (error) { fail('job_' + safeError(error), jobId); }
  }
  try {
    const query = new URLSearchParams({ brand_id:options.brandId });
    options.jobIds.forEach(id => query.append('job_id', id));
    const steps = await json('/v1/workspace-execution-steps?' + query);
    if (!Array.isArray(steps)) throw new Error('invalid_page');
    const seen = new Set();
    for (const step of steps) {
      if (typeof step.id !== 'string' || step.id.length > 256 || !options.jobIds.includes(step.job_id) ||
          step.image_id !== null && !validID(step.image_id) || step.basis !== 'cloudflare_execution_ledger' ||
          !stepStates.has(step.status) || !Number.isSafeInteger(step.step_index) || step.step_index < 0 || !text(step.task_code)) throw new Error('invalid_row_scope');
      const key = step.job_id + ':' + step.id;
      if (seen.has(key)) throw new Error('unstable_pagination');
      seen.add(key);
      report.executionSteps.push({ id:step.id, job_id:step.job_id, image_id:step.image_id,
        task_code:step.task_code, step_index:step.step_index, status:step.status, basis:step.basis });
    }
    // Only the API's final-save phase can discover another job. Declared IDs
    // in input metadata never trigger a lookup, nor do intermediate images.
    for (const step of report.executionSteps) {
      if (step.step_index % 3 !== 2 || step.status !== 'completed' || !step.image_id || !jobRows.has(step.job_id)) continue;
      try {
        const identity = /^([^:]+):(\d+):2$/.exec(step.id);
        if (!identity || !validID(identity[1]) || Number(identity[2]) * 3 + 2 !== step.step_index) throw new Error('invalid_row_scope');
        const image = await json('/v1/generated-images/' + encodeURIComponent(step.image_id));
        if (image.id !== step.image_id || image.job_id !== image.id || image.brand_id !== options.brandId || image.user_id !== principalId ||
            image.storage_path !== 'generated-images/' + image.id || !Number.isFinite(Date.parse(image.created_at)) || Date.parse(image.created_at) < since ||
            image.metadata?.artifactRole === 'provider-intermediate') throw new Error('invalid_row_scope');
        const final = jobRows.get(image.job_id) ?? await json('/v1/generation-jobs/' + encodeURIComponent(image.job_id));
        const params = record(final.input_params), ai = record(params.imageAI);
        const sourceJobId = params.sourceJobId;
        if (final.id !== image.job_id || final.brand_id !== options.brandId || final.user_id !== principalId || final.status !== 'completed' ||
            !Number.isFinite(Date.parse(final.created_at)) || Date.parse(final.created_at) < since ||
            !validID(sourceJobId) || (step.job_id !== final.id && sourceJobId !== step.job_id) ||
            ai.requestId !== identity[1] || ai.candidateIndex !== Number(identity[2]) ||
            !/^[a-f0-9]{64}$/.test(params.checksum) || !Number.isSafeInteger(params.contentBytes) || params.contentBytes <= 0) throw new Error('invalid_row_scope');
        addJob(final);
        await collectImage(image);
        const content = report.storage.find(item => item.imageId === image.id);
        if (!content?.readable || content.sha256 !== params.checksum || content.bytes !== params.contentBytes) throw new Error('media_checksum_mismatch');
        content.checksumVerified = true;
        if (!report.canonicalFinalLinks.some(link => link.sourceJobId === sourceJobId && link.imageId === image.id)) {
          report.canonicalFinalLinks.push({ sourceJobId, finalJobId:final.id, imageId:image.id, executionStepId:step.id, basis:step.basis });
        }
      } catch (error) { fail('final_link_' + safeError(error), step.job_id); }
    }
    for (const jobId of options.jobIds) if (!report.executionSteps.some(step => step.job_id === jobId)) fail('execution_records_not_available', jobId);
  } catch (error) { fail('execution_' + safeError(error)); }
  for (const jobId of options.jobIds) {
    if (!report.images.some(image => image.job_id === jobId) && !report.canonicalFinalLinks.some(link => link.sourceJobId === jobId)) fail('no_final_image_for_requested_job', jobId);
  }
  report.collectionComplete = report.blockers.length === 0;
  if (JSON.stringify(report).includes(options.token)) throw new Error('sensitive_output_refused');
  return report;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({ args:argv, strict:true, options:{
    apiBaseUrl:{type:'string'}, brandId:{type:'string'}, jobIds:{type:'string'}, since:{type:'string'},
    out:{type:'string'}, help:{type:'boolean'},
  } });
  if (values.help) {
    console.log('Read-only Cloudflare job/image/execution collector. Requires --apiBaseUrl HTTPS_ORIGIN --brandId ID --jobIds ID,ID --since ISO and HEAVY_CHAIN_MONITOR_TOKEN. Optional --out FILE. Source workspace metadata (' + DEFAULT_WORKSPACES.join(',') + ') is declared input, not execution proof. No login, replay, inference, repair or old DB access.');
    return;
  }
  const report = await collectWorkspaceReadback({ ...values,
    apiBaseUrl:values.apiBaseUrl ?? env.HEAVY_CHAIN_MONITOR_API_URL,
    brandId:values.brandId ?? env.HEAVY_CHAIN_MONITOR_BRAND_ID,
    jobIds:values.jobIds?.split(',').map(s => s.trim()), token:env.HEAVY_CHAIN_MONITOR_TOKEN });
  const out = values.out ?? 'output/cloudflare-workspace-' + report.capturedAt.replace(/[:.]/g, '-') + '/workspace-readback.json';
  await mkdir(path.dirname(out), { recursive:true });
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ collectionComplete:report.collectionComplete, out, blockers:report.blockers }));
  process.exitCode = report.collectionComplete ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main().catch(() => { console.error('collector_failed: explicit API/brand/job IDs/since/live session required; credentials not printed'); process.exitCode = 1; });
}
