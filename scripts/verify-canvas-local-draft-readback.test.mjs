import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/canvasLocalDraftReadback.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { readOwnerScopedCanvasLocalDraft } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

const ids = ['ai-a1d3a15d-4d27-4c93-ad1c-5fe04d438df6-0', 'ai-6422c795-febf-4672-982d-e0f31a21d0bf-1'];
function fixture() {
  const state = { currentProjectId: null, name: 'Original two', selectedIds: [],
    view: { zoom: 1, panX: 0, panY: 0, canvasWidth: 658, canvasHeight: 635 },
    objects: ids.map((id, i) => ({ id: ['w13mb2h10wh','mu3keorhdms'][i], type: 'image', src: 'generated-images/' + id,
      x: 464, y: 68 + i * 1.5, width: 440, height: 440, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, visible: true, locked: false, zIndex: i,
      metadata: { feature: 'gallery-import', generation: 0, imageId: id, galleryImageId: id, storagePath: 'generated-images/' + id,
        jobId: id.slice(0,-2), provider: 'openai', providerModel: 'actual-model', parameters: { providerRequestId: id.slice(3,-2), originalValue: 'stored; do not replace' } } })) };
  const rows = ids.map(id => ({ id, storage_path: 'generated-images/' + id, job_id: id.slice(0,-2), user_id: 'owner', brand_id: 'heavy' }));
  let reads = 0, asserts = 0;
  const input = { enabled: true, userId: 'owner', brandId: 'heavy', readState: () => state,
    listOwnerImages: async () => { reads++; return rows; }, assertCurrent: () => { asserts++; } };
  return { state, rows, input, counts: () => ({ reads, asserts }) };
}

test('actual two-object state and full metadata are detached without changing the draft', async () => {
  const f=fixture(), before=JSON.stringify(f.state);
  const result=await readOwnerScopedCanvasLocalDraft(f.input);
  assert.deepEqual(result.rawDraft,f.state); assert.equal(JSON.stringify(f.state),before);
  assert.equal(result.ownerImages.length,2); assert.equal(f.counts().reads,1);
  assert.deepEqual(result.scope,{userId:'owner',brandId:'heavy'});
  result.rawDraft.objects[0].metadata.parameters.originalValue='changed exported copy';
  assert.equal(JSON.stringify(f.state),before);
});

test('disabled or missing authentication scope performs no read', async () => {
  for (const update of [{enabled:false},{userId:''},{brandId:''}]) {
    const f=fixture();await assert.rejects(readOwnerScopedCanvasLocalDraft({...f.input,...update}),/not_enabled/);
    assert.deepEqual(f.counts(),{reads:0,asserts:0});
  }
});

test('wrong owner, brand, storage or job cannot export local metadata', async () => {
  for (const [field,value,code] of [['user_id','other','owner_scope'],['brand_id','other','owner_scope'],['storage_path','generated-images/other','owner_image_unavailable'],['job_id','other','job_identity']]) {
    const f=fixture();f.rows[0][field]=value;
    await assert.rejects(readOwnerScopedCanvasLocalDraft(f.input),new RegExp(code));
  }
});

test('conflicting declared image/storage identities and noncanonical local sources stop before lookup', async () => {
  for (const field of ['imageId','galleryImageId','storagePath','galleryStoragePath']) {
    const f=fixture();f.state.objects[0].metadata[field]='other';
    await assert.rejects(readOwnerScopedCanvasLocalDraft(f.input),/identity_mismatch/);assert.equal(f.counts().reads,0);
  }
  const f=fixture();f.state.objects[0].src='local-canvas-asset://other';
  await assert.rejects(readOwnerScopedCanvasLocalDraft(f.input),/source_not_canonical/);assert.equal(f.counts().reads,0);
});

test('revoked context after the owner GET exposes no captured draft', async () => {
  const f=fixture();let current=true;
  f.input.assertCurrent=()=>{if(!current)throw new Error('revoked');};
  f.input.listOwnerImages=async()=>{current=false;return f.rows;};
  await assert.rejects(readOwnerScopedCanvasLocalDraft(f.input),/revoked/);
});

test('an edit during the owner GET invalidates capture instead of exporting stale values', async () => {
  const f=fixture();f.input.listOwnerImages=async()=>{f.state.objects[0].x+=1;return f.rows;};
  await assert.rejects(readOwnerScopedCanvasLocalDraft(f.input),/changed_during_readback/);
});

test('missing and duplicate exact owner rows cannot grant snapshot authority', async () => {
  for (const duplicate of [false,true]) {
    const f=fixture();f.input.listOwnerImages=async()=>duplicate?[...f.rows,f.rows[0]]:f.rows.slice(1);
    await assert.rejects(readOwnerScopedCanvasLocalDraft(f.input),/owner_image_unavailable/);
  }
});

test('empty and oversized drafts perform no owner lookup or write', async () => {
  for (const oversized of [false,true]) {
    const f=fixture();if(oversized)f.state.objects[0].metadata.parameters.originalValue='x'.repeat(200001);else f.state.objects=[];
    await assert.rejects(readOwnerScopedCanvasLocalDraft(f.input),oversized?/too_large/:/empty/);assert.equal(f.counts().reads,0);
  }
});

const authSource = fs.readFileSync(new URL('../src/lib/authBrandSelection.ts', import.meta.url), 'utf8');
const authCompiled = ts.transpileModule(authSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { captureAuthBrandFence, assertAuthBrandFence } = await import('data:text/javascript;base64,' + Buffer.from(authCompiled).toString('base64'));
const pageSource = fs.readFileSync(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8');
const pageAst = ts.createSourceFile('CanvasEditorPage.tsx',pageSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let handlerExpression;
function visit(node) {
  if(ts.isVariableDeclaration(node)&&node.name.getText(pageAst)==='handleReadLocalDraft')handlerExpression=node.initializer.getText(pageAst);
  ts.forEachChild(node,visit);
}
visit(pageAst); assert.ok(handlerExpression,'actual production page handler must be exercised');
function mountedHandlerFixture() {
  const f=fixture(), outputs=[];
  const liveAuth={user:{id:'owner'},currentBrand:{id:'heavy'},brandState:{status:'success_nonempty',userId:'owner',requestGeneration:1,confirmedBrandIds:['heavy'],error:null}};
  const state={...f.state,currentProjectName:f.state.name,...f.state.view};let lookups=0;
  const dataPlane={listGeneratedImages:async(brand,options)=>{assert.equal(brand,'heavy');assert.deepEqual(options,{limit:100,order:'newest'});lookups++;return f.rows;}};
  const context={canvasDebugEnabled:true,heavyWorkspaceReady:true,user:{id:'owner'},currentBrand:{id:'heavy'},
    cloudflareDataPlane:dataPlane,useAuthStore:{getState:()=>liveAuth},useCanvasStore:{getState:()=>state},
    isMountedRef:{current:true},canvasSize:{width:658,height:635},setCanvasDraftExport:value=>outputs.push(value),
    captureAuthBrandFence,assertAuthBrandFence,readOwnerScopedCanvasLocalDraft};
  const js=ts.transpileModule('return '+handlerExpression+';', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const run=()=>new Function(...Object.keys(context),js)(...Object.values(context))();
  return {f,context,liveAuth,state,outputs,run,lookups:()=>lookups};
}

test('actual page handler exports the owner-checked real store values without persistence callbacks',async()=>{
  const h=mountedHandlerFixture(),before=JSON.stringify(h.state);await h.run();
  assert.equal(h.lookups(),1);assert.equal(JSON.stringify(h.state),before);
  assert.deepEqual(h.outputs.map(value=>value===null),[true,false]);
  assert.equal(h.outputs[1].result.rawDraft.objects[1].metadata.parameters.originalValue,'stored; do not replace');
  assert.equal(h.outputs[1].error,null);
});

test('actual page stale render scope stops before requesting owner records',async()=>{
  const h=mountedHandlerFixture();h.liveAuth.user={id:'other'};await h.run();
  assert.equal(h.lookups(),0);assert.equal(h.outputs.at(-1).result,null);
  assert.match(h.outputs.at(-1).error,/scope_changed/);
});

test('actual page auth generation change after the owner GET never publishes the captured object metadata',async()=>{
  const h=mountedHandlerFixture();h.context.cloudflareDataPlane.listGeneratedImages=async()=>{h.liveAuth.brandState.requestGeneration++;return h.f.rows;};
  await h.run();assert.equal(h.outputs.at(-1).result,null);assert.ok(h.outputs.at(-1).error);
});

test('disabled debug mode and unmounted page never expose snapshot data',async()=>{
  const disabled=mountedHandlerFixture();disabled.context.canvasDebugEnabled=false;await disabled.run();
  assert.equal(disabled.lookups(),0);assert.deepEqual(disabled.outputs,[]);
  const unmounted=mountedHandlerFixture();unmounted.context.isMountedRef.current=false;await unmounted.run();
  assert.equal(unmounted.lookups(),0);assert.equal(unmounted.outputs.at(-1).result,null);
});
