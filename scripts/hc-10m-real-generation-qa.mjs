#!/usr/bin/env node
import { mkdir, readFile, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { apiOrigin, validID, boundedBytes, safeError } from './monitor-production-health.mjs';
import { collectWorkspaceReadback } from './collect-workspace-live-readback.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const actions = new Set(['generate-image','edit-image','model-matrix']);
const states = new Set(['planned','running','completed','failed','unknown','storing']);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value);

/** A receipt read can reconcile existing persistence on the API, never reinfer.
 * A new inference requires explicit submit, a fresh 404 and a durable exclusive
 * local attempt record. Once recorded, even a crash-before-send cannot replay.
 */
export async function runImageQA(options, journal, fetchImpl = fetch) {
  const origin = apiOrigin(options.apiBaseUrl);
  if (!UUID.test(options.requestId ?? '') || !validID(options.brandId)) throw new Error('exact_request_and_brand_required');
  if (typeof options.token !== 'string' || !options.token.trim() || /[\r\n]/.test(options.token)) throw new Error('live_session_required');
  const mode = options.mode ?? 'readback';
  if (!['readback','submit'].includes(mode)) throw new Error('unsupported_mode');
  let bodyText = null, payloadHash = null;
  if (mode === 'submit') {
    if (!actions.has(options.action) || !options.payload || options.payload.brandId !== options.brandId || options.payload.rightsConfirmed !== true) throw new Error('explicit_action_payload_rights_required');
    bodyText = JSON.stringify(options.payload);
    if (Buffer.byteLength(bodyText) > 12 * 1024 * 1024) throw new Error('payload_too_large');
    payloadHash = createHash('sha256').update(canonical(options.payload)).digest('hex');
  }
  const call = async (route, init = {}) => {
    let response;
    try { response = await fetchImpl(origin + route, { method:'GET', redirect:'error', cache:'no-store', ...init,
      headers:{ authorization:'Bearer ' + options.token, ...init.headers }, signal:AbortSignal.timeout(150000) }); }
    catch { return { status:null, data:null, error:'request_failed' }; }
    try { return { status:response.status, data:JSON.parse((await boundedBytes(response, 4 * 1024 * 1024)).toString('utf8')) }; }
    catch(error) { return { status:response.status, data:null, error:safeError(error) }; }
  };
  const profile = await call('/v1/profile');
  if (profile.status !== 200 || !validID(profile.data?.id)) throw new Error('verified_profile_required');
  const userId = profile.data.id;
  const context = { schema:'heavy-chain.image-qa-attempt.v2', apiOrigin:origin, brandId:options.brandId, userId, requestId:options.requestId,
    action:options.action ?? null, payloadHash, recordedAt:new Date().toISOString() };
  const prior = await journal.read();
  if (prior && (prior.schema !== context.schema || prior.apiOrigin !== origin || prior.brandId !== options.brandId ||
      prior.userId !== userId || prior.requestId !== options.requestId ||
      mode === 'submit' && (prior.action !== options.action || prior.payloadHash !== payloadHash))) throw new Error('attempt_context_mismatch');
  const route = '/v1/image-ai/requests/' + options.requestId;
  let observed = await call(route);
  let submission = prior ? 'previous_attempt_no_replay' : 'not_requested';
  if (mode === 'submit' && !prior && observed.status === 404 && observed.data?.error === 'image_request_not_found') {
    // This write must complete durably before any POST. An exclusive-create
    // failure (including a competing process) aborts, rather than submitting.
    await journal.record(context);
    submission = 'attempt_recorded';
    await call('/v1/provider-actions/' + options.action, { method:'POST',
      headers:{'content-type':'application/json','idempotency-key':options.requestId},body:bodyText });
    observed = await call(route);
  } else if (mode === 'submit' && !prior && observed.status === 200) submission = 'existing_request_no_submission';
  const report = { schema:'heavy-chain.image-qa.v2', capturedAt:new Date().toISOString(),
    apiOrigin:origin, brandId:options.brandId, userId, requestId:options.requestId,
    submission, receiptObserved:false, persistedResultVerified:false, businessCompletion:'not_verified',
    quality:'requires_visual_review', receipt:null, workspace:null, blockers:[] };
  if (mode === 'submit' && submission === 'existing_request_no_submission') {
    report.blockers.push({code:'existing_request_input_not_locally_bound_use_readback'});
    return report;
  }
  const receipt = observed.data;
  if (observed.status !== 200 || receipt?.requestId !== options.requestId || receipt?.jobId !== 'ai-' + options.requestId ||
      receipt?.provider !== 'workers_ai' || receipt?.backendProvider !== 'cloudflare-workers-ai' || !states.has(receipt?.state)) {
    report.blockers.push({code: observed.status === 404 ? 'request_not_found_no_replay' : 'receipt_unavailable_or_invalid'});
    return report;
  }
  const job = await call('/v1/generation-jobs/' + encodeURIComponent(receipt.jobId));
  if (job.status !== 200 || job.data?.id !== receipt.jobId || job.data?.user_id !== userId || job.data?.brand_id !== options.brandId) throw new Error('receipt_scope_mismatch');
  report.receiptObserved = true;
  report.receipt = { jobId:receipt.jobId, state:receipt.state, success:receipt.success === true,
    requiresProtectedComposite:receipt.requiresProtectedComposite === true,
    requestedCandidateCount:Number.isSafeInteger(receipt.requestedCandidateCount) ? receipt.requestedCandidateCount : null,
    persistedCandidateCount:Number.isSafeInteger(receipt.persistedCandidateCount) ? receipt.persistedCandidateCount : null,
    provider:'workers_ai', backendProvider:'cloudflare-workers-ai' };
  const expected = receipt.requestedCandidateCount;
  const candidates = receipt.images;
  if (receipt.success !== true || receipt.state !== 'completed' || !Number.isSafeInteger(expected) || expected < 1 || expected > 4 || receipt.persistedCandidateCount !== expected ||
      !Array.isArray(candidates) || candidates.length !== expected || new Set(candidates.map(item=>item.imageId)).size !== expected ||
      new Set(candidates.map(item=>item.candidateIndex)).size !== expected || candidates.some(item=>!validID(item.imageId) || item.jobId !== receipt.jobId || !Number.isSafeInteger(item.candidateIndex) || item.candidateIndex < 0 || item.candidateIndex >= expected)) {
    report.blockers.push({code:'generation_not_complete_no_reinference'});
    return report;
  }
  if (!Number.isFinite(Date.parse(job.data.created_at))) throw new Error('invalid_job_time');
  report.workspace = await collectWorkspaceReadback({ apiBaseUrl:origin, brandId:options.brandId, jobIds:[receipt.jobId],
    token:options.token, since:job.data.created_at },fetchImpl);
  const proof = report.workspace;
  const phases = receipt.requiresProtectedComposite ? [0,1,2] : [0,1];
  const requiredStepsComplete = proof.executionSteps.length === expected * phases.length && candidates.every(candidate=>phases.every(phase=>
    proof.executionSteps.some(step=>step.id === options.requestId + ':' + candidate.candidateIndex + ':' + phase && step.job_id === receipt.jobId && step.status === 'completed')));
  const finalCount = receipt.requiresProtectedComposite ? proof.canonicalFinalLinks.length : proof.images.length;
  const matchingImages = candidates.every(candidate=>receipt.requiresProtectedComposite
    ? proof.canonicalFinalLinks.some(link=>link.sourceJobId === receipt.jobId && link.executionStepId === options.requestId + ':' + candidate.candidateIndex + ':2')
    : proof.images.some(image=>image.id === candidate.imageId && image.job_id === receipt.jobId));
  report.persistedResultVerified = proof.collectionComplete && requiredStepsComplete && matchingImages && finalCount === expected && proof.storage.every(item=>item.readable && item.checksumVerified);
  if (!report.persistedResultVerified) report.blockers.push({code:receipt.requiresProtectedComposite ? 'protected_final_composition_or_persistence_unverified' : 'result_persistence_unverified'});
  if (JSON.stringify(report).includes(options.token)) throw new Error('sensitive_output_refused');
  return report;
}

export function createAttemptJournal(out) {
  const attemptPath = path.join(out,'attempt.json');
  return {
    read:async()=>{try{return JSON.parse(await readFile(attemptPath,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}},
    record:async record=>{
      await mkdir(out,{recursive:true});
      const file = await open(attemptPath,'wx',0o600);
      try { await file.writeFile(JSON.stringify(record,null,2)+'\n');await file.sync(); } finally { await file.close(); }
      const directory = await open(out,'r');
      try { await directory.sync(); } finally { await directory.close(); }
      const saved = JSON.parse(await readFile(attemptPath,'utf8'));
      if(canonical(saved)!==canonical(record))throw Error('attempt_readback_failed');
    },
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const {values} = parseArgs({ args:argv,strict:true,options:{
    mode:{type:'string'},apiBaseUrl:{type:'string'},brandId:{type:'string'},requestId:{type:'string'},
    action:{type:'string'},input:{type:'string'},outDir:{type:'string'},help:{type:'boolean'},
  }});
  if(values.help) {
    console.log('Cloudflare image QA: default --mode readback; explicit --mode submit requires --action generate-image|edit-image|model-matrix and --input JSON-file with brandId and rightsConfirmed:true. Requires --apiBaseUrl HTTPS_ORIGIN --brandId ID --requestId UUID and HEAVY_CHAIN_MONITOR_TOKEN. Optional --outDir DIR. Durable attempt prevents replay; no old defaults, provider keys, enqueue, automatic polling or cleanup. Protected edits still require the existing browser final compositor; this CLI does not replace it.');
    return;
  }
  if(!UUID.test(values.requestId ?? '')) throw Error('request_id_required');
  const out = path.resolve(values.outDir ?? path.join('output','cloudflare-image-qa',values.requestId));
  const payload = values.input ? JSON.parse(await readFile(values.input,'utf8')) : undefined;
  const journal = createAttemptJournal(out);
  const report=await runImageQA({...values,payload,apiBaseUrl:values.apiBaseUrl ?? env.HEAVY_CHAIN_MONITOR_API_URL,
    brandId:values.brandId ?? env.HEAVY_CHAIN_MONITOR_BRAND_ID,token:env.HEAVY_CHAIN_MONITOR_TOKEN},journal);
  await mkdir(out,{recursive:true});
  await writeFile(path.join(out,'readback.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({persistedResultVerified:report.persistedResultVerified,out,blockers:report.blockers}));
  process.exitCode=report.persistedResultVerified ? 0 : 1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  await main().catch(()=>{console.error('image_qa_failed: check explicit scope/session/input and durable attempt; no retry was issued and no credentials printed');process.exitCode=1;});
}
