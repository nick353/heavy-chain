import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectProductionHealth } from './monitor-production-health.mjs';
import { verifyScaleOpsEvidence } from './cloudflare-scale-ops-evidence.mjs';
import { validateG618ScaleOps } from './verify-release-gate-unified.mjs';

const now=Date.parse('2026-09-07T00:00:00Z');
const expected={apiOrigin:'https://fixture.invalid',brandId:'brand',windowHours:96,maxFailureRate:0,minStorageImages:1};
const bytes=Buffer.from('fixture image'), sha=createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  return collectProductionHealth({apiBaseUrl:expected.apiOrigin,brandId:'brand',token:'test-session',now,windowHours:96,
    maxFailureRate:expected.maxFailureRate,sampleSize:20},async input=>{
    const p=new URL(input).pathname, row={brand_id:'brand',created_at:'2026-09-06T23:00:00Z'};
    if(p==='/v1/health') return Response.json({service:'heavy-api',status:'ok',media:'private-r2'});
    if(p==='/v1/generation-jobs') return Response.json([{...row,id:'job',status:'completed'}]);
    if(p==='/v1/generated-images') return Response.json([{...row,id:'image',metadata:{contentSha256:sha,contentBytes:bytes.length}}]);
    if(p.endsWith('/content')) return new Response(bytes,{headers:{'content-type':'image/png'}});
    if(p==='/v1/image-ai/usage') return Response.json({measurementScope:'cloudflare_image_ai_only',billing:'estimate_not_invoice',imageAIEnabled:true,
      periodStart:'2026-09-01T00:00:00Z',periodEnd:'2026-10-01T00:00:00Z',plannedImages:1,completedImages:1,runningImages:0,uncertainImages:0,
      attemptedImages:1,unknownEstimateCount:0,estimatedMicroUSD:1,estimatedNeurons:1,averageInferenceMs:10,remainingUnits:24,monthlyQuota:25});
    throw Error('unexpected path');
  });
}
const passes=(report,e=expected,time=now)=>verifyScaleOpsEvidence(report,e,time).every(c=>c.passed);
test('real monitor output shape passes only observable Cloudflare scope',async()=>{
  const report=await fixture(); assert.equal(passes(report),true);
  assert.equal(report.coverage.businessCompletion,'not_verified'); assert.equal(report.coverage.cpu,'not_measured');
});
test('missing sections, empty terminal jobs and inconsistent counters do not default to success',async()=>{
  for(const change of [r=>r.sections={},r=>r.sections.generation.counts={},r=>r.sections.generation.total=2,
    r=>r.sections.generation.failureRate=null,r=>r.sections.storage.checks=[],r=>r.sections.storage.readable=2,
    r=>r.sections.storage.checks.push(r.sections.storage.checks[0]),r=>r.sections.usage.estimatedMicroUSD=null]) {
    const r=await fixture(); change(r); assert.equal(passes(r),false);
  }
});
test('foreign, stale, uncertain, disabled, checksum and warning observations fail',async()=>{
  for(const change of [r=>r.brandId='other',r=>r.baseUrl='https://other.invalid',r=>r.schema='heavy-chain.production-monitor.v1',
    r=>r.window.hours=24,r=>r.sections.storage.checks[0].checksumVerified=false,r=>r.sections.usage.uncertainImages=1,
    r=>r.sections.usage.imageAIEnabled=false,r=>r.sections.usage.periodEnd=r.capturedAt,r=>r.warnings.push({code:'known_old_probe'}),
    r=>r.coverage.jobs='all_users']) {
    const r=await fixture(); change(r); assert.equal(passes(r),false);
  }
  assert.equal(passes(await fixture(),expected,now+900001),false);
  assert.equal(passes(await fixture(),{...expected,windowHours:24}),false);
  assert.equal(passes(null),false);
});
test('runner rejects missing authority before any build or browser work',()=>{
  const env={...process.env}; delete env.HEAVY_CHAIN_MONITOR_TOKEN;
  const result=spawnSync(process.execPath,['scripts/verify-g618-scale-ops-baseline.mjs','--apiBaseUrl','https://fixture.invalid','--brandId','brand'],{env,encoding:'utf8'});
  assert.equal(result.status,1); assert.match(result.stderr,/no build or browser started/); assert.equal(result.stdout,'');
});
test('release validator accepts v2 fixture, rejects v1, and keeps explicit origin/brand binding',async()=>{
  const monitor=await fixture();
  const releaseExpected={...expected,minStorageImages:4};
  const sample=monitor.sections.storage.checks[0];
  monitor.sections.storage.checks=Array.from({length:4},(_,index)=>({...sample,imageId:`image-${index+1}`}));
  monitor.sections.storage.checkedImages=4;
  monitor.sections.storage.totalRecentImages=4;
  monitor.sections.storage.readable=4;
  monitor.sections.storage.errors=0;
  const performance={ok:true,issues:[],fixture:{imageCount:1200,canvasObjectCount:600},
    galleryStress:{renderedTilesInitial:60},canvasStress:{persistedObjects:600,export:{validPng:true,width:3200,height:9000,
      edgeColorSamples:{top:21,bottom:21}}},cleanup:{previewProcessCleanup:{groupAliveAfter:false}}};
  const localChecks=['performance summary readable','production monitor summary readable','production readback window covers G618 baseline',
    'local scale fixture size','local scale performance passed','local route SLO','gallery virtualization guard','canvas object readback','preview cleanup proof'];
  const monitorChecks=verifyScaleOpsEvidence(monitor,releaseExpected,now).map(check=>check.name);
  const checks=[...localChecks,...monitorChecks].map(name=>({name,passed:true}));
  const commands=[{passed:true},{passed:true},{passed:true}];
  const temporaryDir=mkdtempSync(path.join(os.tmpdir(),'heavy-chain-g618-release-'));
  const performancePath=path.join(temporaryDir,'performance.json');
  const monitorPath=path.join(temporaryDir,'monitor.json');
  try {
    writeFileSync(performancePath,JSON.stringify(performance));
    writeFileSync(monitorPath,JSON.stringify(monitor));
    const baseline={schema:'heavy-chain.g618.scale-ops-baseline.v2',ok:true,blockers:[],businessCompletion:'not_verified',
      unverified:['production_concurrent_load','worker_cpu','provider_invoice','fleet_wide_slo','browser_business_workflow'],
      monitorExpectations:{...releaseExpected,source:'explicit_cli_or_environment'},capturedAt:new Date(now).toISOString(),
      fixture:{imageCount:1200,canvasObjectCount:600},thresholds:{maxFailureRate:0,productionReadbackWindowHours:96,minStorageImages:4},
      irreversibleActions:{generationSubmit:'not_clicked',purchasePaymentCheckout:'not_touched',externalPublish:'not_touched',
        destructiveCleanup:'not_touched',deploy:'not_run'},commands,checks,summary:{commands:commands.length,checks:checks.length,imageCount:1200,
          canvasObjectCount:600,performanceOk:true,monitorOk:true},artifacts:{performanceSummary:performancePath,productionMonitorSummary:monitorPath}};
    assert.equal(validateG618ScaleOps(baseline,now),true);
    assert.equal(validateG618ScaleOps({...baseline,schema:'heavy-chain.g618.scale-ops-baseline.v1'},now),false);
    monitor.brandId='other';
    writeFileSync(monitorPath,JSON.stringify(monitor));
    assert.equal(validateG618ScaleOps(baseline,now),false);
  } finally {
    rmSync(temporaryDir,{recursive:true,force:true});
  }
});
