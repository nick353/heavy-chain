import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,envFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
const recovery=await vite.ssrLoadModule('/src/lib/canvasDocumentSaveRecovery.ts');
const recoverySource = await (await import('node:fs/promises')).readFile(
  new URL('../src/lib/canvasDocumentSaveRecovery.ts', import.meta.url), 'utf8',
);
after(async()=>{await vite.close();});

const scope={origin:'https://canvas.test',userId:'alice',brandId:'brand'};
const content=(text='draft')=>({title:'Board',snapshot:{version:1,localProjectId:null,objects:[{id:'note',type:'text',text}]}});
function setup(){
  const values=new Map();globalThis.window={localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
  const id=crypto.randomUUID();const counters={get:0,create:0,update:0};let document=null;
  const transport={
    get:async requestId=>{counters.get++;assert.equal(requestId,id);if(!document)throw new Error('cloudflare_api_404_not_found');return structuredClone(document);},
    create:async(requestId,body)=>{counters.create++;assert.equal(requestId,id);assert.equal(document,null);document={id,ownerId:'alice',brandId:'brand',...structuredClone(body),revision:0,snapshotVersion:1,createdAt:'2026-09-06',updatedAt:'2026-09-06'};return structuredClone(document);},
    update:async(requestId,revision,body)=>{counters.update++;assert.equal(requestId,id);assert.equal(revision,document.revision);document={...document,...structuredClone(body),revision:revision+1};return structuredClone(document);},
  };
  const options={scope,documentId:id,ownerId:'alice',expectedRevision:null,content:content(),transport,assertCurrent:()=>{}};
  return{values,id,counters,transport,options,document:()=>document,setDocument:value=>{document=value;}};
}

test('local project identity is stable per app/user/brand, not per changing content',async()=>{
  assert.equal(await recovery.initialCanvasDocumentId(scope,'local-1'),await recovery.initialCanvasDocumentId(scope,'local-1'));
  assert.notEqual(await recovery.initialCanvasDocumentId(scope,'local-1'),await recovery.initialCanvasDocumentId({...scope,userId:'bob'},'local-1'));
  assert.notEqual(await recovery.initialCanvasDocumentId(scope,'local-1'),await recovery.initialCanvasDocumentId({...scope,origin:'https://other.test'},'local-1'));
  assert.notEqual(await recovery.initialCanvasDocumentId(scope,null),await recovery.initialCanvasDocumentId(scope,null));
});

test('create response loss plus failed reconciliation survives module reload; inspection never writes',async()=>{
  const s=setup();const create=s.transport.create,get=s.transport.get;let outage=false;
  s.transport.create=async(...args)=>{await create(...args);outage=true;throw new Error('response_lost');};
  s.transport.get=async(...args)=>{if(outage)throw new Error('cloudflare_api_503_unavailable');return get(...args);};
  await assert.rejects(recovery.saveCanvasDocumentRecoverably(s.options),/503/);
  assert.equal(recovery.readCanvasSaveRecovery(scope,s.id).pending.kind,'create');
  outage=false;const restarted=await vite.ssrLoadModule('/src/lib/canvasDocumentSaveRecovery.ts?restart='+crypto.randomUUID());
  const result=await restarted.inspectCanvasSaveRecovery({...s.options});
  assert.equal(result.state,'saved');assert.equal(result.entry.pending,null);assert.equal(s.counters.create,1);assert.equal(s.counters.update,0);
  const saved=await restarted.saveCanvasDocumentRecoverably(s.options);assert.equal(saved.id,s.id);assert.equal(s.counters.create,1);
});

test('unadmitted draft reload stays local until explicit Save uses the same pre-persisted ID',async()=>{
  const s=setup();recovery.retainCanvasSaveDraft(scope,s.id,content(),{ownerId:'alice',revision:null});
  const inspected=await recovery.inspectCanvasSaveRecovery(s.options);assert.equal(inspected.state,'draft');assert.equal(s.counters.create,0);
  await recovery.saveCanvasDocumentRecoverably(s.options);assert.equal(s.counters.create,1);assert.equal(s.document().id,s.id);
});

test('concurrent identical saves use one create; storage readback precedes its dispatch',async()=>{
  const s=setup();const create=s.transport.create;
  s.transport.create=async(...args)=>{const entry=recovery.readCanvasSaveRecovery(scope,s.id);assert.equal(entry.pending.kind,'create');return create(...args);};
  const result=await Promise.all([recovery.saveCanvasDocumentRecoverably(s.options),recovery.saveCanvasDocumentRecoverably(s.options)]);
  assert.equal(result[0].id,result[1].id);assert.equal(s.counters.create,1);assert.equal(s.counters.update,0);
});

test('lost update response is observed, not replayed; later working edits remain unsaved',async()=>{
  const s=setup();await recovery.saveCanvasDocumentRecoverably(s.options);const update=s.transport.update;
  s.transport.update=async(...args)=>{await update(...args);recovery.retainCanvasSaveDraft(scope,s.id,content('late annotation'));throw new Error('lost_update_response');};
  const saved=await recovery.saveCanvasDocumentRecoverably({...s.options,expectedRevision:0,content:content('clicked save')});
  assert.equal(saved.revision,1);assert.equal(s.counters.update,1);
  const entry=recovery.readCanvasSaveRecovery(scope,s.id);assert.equal(entry.snapshot.objects[0].text,'late annotation');assert.equal(entry.pending,null);
  const read=await recovery.inspectCanvasSaveRecovery(s.options);assert.equal(read.state,'draft');assert.equal(s.counters.update,1);
});

test('foreign scope, owner and revision cannot be adopted or overwritten',async()=>{
  const s=setup();await recovery.saveCanvasDocumentRecoverably(s.options);
  assert.equal(recovery.readCanvasSaveRecovery({...scope,userId:'bob'},s.id),null);
  assert.equal(recovery.readCanvasSaveRecovery({...scope,brandId:'elsewhere'},s.id),null);
  s.setDocument({...s.document(),revision:2,...content('another editor')});
  await assert.rejects(recovery.saveCanvasDocumentRecoverably({...s.options,expectedRevision:0,content:content('mine')}),/conflict/);
  assert.equal(s.counters.update,0);assert.equal(s.document().snapshot.objects[0].text,'another editor');
  s.setDocument({...s.document(),ownerId:'bob'});
  await assert.rejects(recovery.inspectCanvasSaveRecovery(s.options),/readback_mismatch/);
});

test('uncertain create with changed remote content conflicts instead of overwriting or creating another ID',async()=>{
  const s=setup();const create=s.transport.create,get=s.transport.get;let outage=false;
  s.transport.create=async(...args)=>{await create(...args);s.setDocument({...s.document(),...content('changed elsewhere')});outage=true;throw new Error('lost');};
  s.transport.get=async(...args)=>{if(outage)throw new Error('unavailable');return get(...args);};
  await assert.rejects(recovery.saveCanvasDocumentRecoverably(s.options),/unavailable/);outage=false;
  const result=await recovery.inspectCanvasSaveRecovery(s.options);assert.equal(result.state,'conflict');
  await assert.rejects(recovery.saveCanvasDocumentRecoverably(s.options),/conflict/);
  assert.equal(s.counters.create,1);assert.equal(s.counters.update,0);assert.equal(s.document().snapshot.objects[0].text,'changed elsewhere');
});

test('null or malformed cache fails closed before any request',async()=>{
  const s=setup();s.values.set(recovery.canvasSaveRecoveryKey(scope,s.id),'null');
  assert.throws(()=>recovery.readCanvasSaveRecovery(scope,s.id),/canvas_save_cache_invalid/);
  await assert.rejects(recovery.saveCanvasDocumentRecoverably(s.options),/canvas_save_cache_invalid/);assert.equal(s.counters.get,0);
});

test('edits during an inspection GET survive its late readback',async()=>{
  const s=setup();await recovery.saveCanvasDocumentRecoverably(s.options);const get=s.transport.get;
  s.transport.get=async(...args)=>{const doc=await get(...args);recovery.retainCanvasSaveDraft(scope,s.id,content('typed during GET'));return doc;};
  const read=await recovery.inspectCanvasSaveRecovery(s.options);assert.equal(read.state,'draft');
  assert.equal(read.entry.snapshot.objects[0].text,'typed during GET');
  assert.equal(recovery.readCanvasSaveRecovery(scope,s.id).snapshot.objects[0].text,'typed during GET');assert.equal(s.counters.create,1);
});

test('definite server validation rejection with an unchanged destination permits corrected input on the same ID',async()=>{
  const s=setup(),create=s.transport.create;let attempts=0;
  s.transport.create=async(...args)=>{attempts++;if(attempts===1)throw new Error('cloudflare_api_400_invalid_canvas_document');return create(...args);};
  await assert.rejects(recovery.saveCanvasDocumentRecoverably(s.options),/invalid_canvas_document/);
  assert.equal(recovery.readCanvasSaveRecovery(scope,s.id).pending,null);
  await recovery.saveCanvasDocumentRecoverably({...s.options,content:content('corrected')});
  assert.equal(s.document().id,s.id);assert.equal(s.counters.create,1);assert.equal(s.document().snapshot.objects[0].text,'corrected');
  const update=s.transport.update;s.transport.update=async()=>{throw new Error('cloudflare_api_400_invalid_canvas_document');};
  await assert.rejects(recovery.saveCanvasDocumentRecoverably({...s.options,expectedRevision:0,content:content('rejected change')}),/invalid_canvas_document/);
  assert.equal(recovery.readCanvasSaveRecovery(scope,s.id).pending,null);assert.equal(s.document().revision,0);
  s.transport.update=update;await recovery.saveCanvasDocumentRecoverably({...s.options,expectedRevision:0,content:content('corrected update')});assert.equal(s.document().revision,1);
});

test('storage failure and a changed session stop before any write',async()=>{
  const s=setup();window.localStorage.setItem=()=>{throw new Error('quota');};
  await assert.rejects(recovery.saveCanvasDocumentRecoverably(s.options),/quota/);assert.equal(s.counters.create,0);
  const next=setup();const get=next.transport.get;let valid=true;
  next.transport.get=async(...args)=>{try{return await get(...args);}finally{valid=false;}};
  await assert.rejects(recovery.saveCanvasDocumentRecoverably({...next.options,assertCurrent:()=>{if(!valid)throw new Error('session_changed');}}),/session_changed/);
  assert.equal(next.counters.create,0);
});

test('invalid desired or cached pending content is checked without clearing its evidence', () => {
  assert.match(recoverySource, /validateContent\(desired\);/);
  assert.match(recoverySource, /if\(entry\.pending\)validateContent\(entry\.pending\);/g);
  assert.match(recoverySource, /const dispatch=async\(pending:PendingWrite\)=>\{\s*validateContent\(pending\);/s);
  assert.match(recoverySource, /pending:PendingWrite|null/);
  assert.match(recoverySource, /writeId:string/);
});

test('invalid desired content creates no recovery write or transport call',async()=>{
  const s=setup();
  const broken={title:'Board',snapshot:{version:1,objects:[{id:'broken',type:'image',src:''}]}};
  await assert.rejects(recovery.saveCanvasDocumentRecoverably({...s.options,content:broken}),/canvas_image_source_invalid/);
  assert.equal(s.counters.get,0);assert.equal(s.counters.create,0);assert.equal(s.counters.update,0);
  assert.equal(recovery.readCanvasSaveRecovery(scope,s.id),null);
});

test('invalid cached pending content is preserved and never dispatched',async()=>{
  const s=setup();
  recovery.retainCanvasSaveDraft(scope,s.id,content(),{ownerId:'alice',revision:null});
  const key=recovery.canvasSaveRecoveryKey(scope,s.id);
  const entry=recovery.readCanvasSaveRecovery(scope,s.id);
  entry.pending={...content('invalid pending'),writeId:crypto.randomUUID(),kind:'create',expectedRevision:null,
    snapshot:{version:1,objects:[{id:'broken',type:'image',src:'',label:'broken pending'}]}};
  s.values.set(key,JSON.stringify(entry));
  await assert.rejects(recovery.saveCanvasDocumentRecoverably(s.options),/canvas_image_source_invalid/);
  assert.equal(s.counters.get,0);assert.equal(s.counters.create,0);assert.equal(s.counters.update,0);
  const preserved=recovery.readCanvasSaveRecovery(scope,s.id);
  assert.equal(preserved.pending.writeId,entry.pending.writeId);
  assert.equal(preserved.pending.snapshot.objects[0].label,'broken pending');
});
